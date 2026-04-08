/**
 * Parallel — concurrent agent execution with fan-out/fan-in.
 *
 * Runs N agents in parallel, each as an isolated subflow. Merges results
 * via LLM call (default) or custom function.
 *
 * Flowchart:
 *   Seed → [fork]
 *            ├── agent-A (isolated subflow)
 *            ├── agent-B (isolated subflow)
 *            └── agent-C (isolated subflow)
 *          Merge → Finalize
 *
 * Each branch gets its own ExecutionRuntime (isolated scope).
 * Results flow back through outputMapper (delta pattern).
 *
 * Usage:
 *   const parallel = Parallel.create({ provider })
 *     .agent('research', researchAgent, 'Research the topic')
 *     .agent('writing', writingAgent, 'Draft content')
 *     .mergeWithLLM('Synthesize into a coherent report')
 *     .build();
 *   const result = await parallel.run('Write about AI safety');
 */

import { flowChart, FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartType, FlowChartExecutorOptions, TypedScope } from 'footprintjs';
import type { LLMProvider, Message } from '../types';
import type { ModelConfig } from '../models';
import { userMessage, systemMessage } from '../types';
import type { RunnerLike } from '../types/multiAgent';
import type { AgentRecorder } from '../core';
import { RecorderBridge } from '../recorders/RecorderBridge';
import { resolveProvider } from '../adapters/createProvider';
import { createAgentRenderer } from '../lib/narrative';
import { annotateSpecIcons } from './specIcons';
import type { SpecLike } from './specIcons';
import { createCallLLMStage } from '../stages/callLLM';

// ── Types ────────────────────────────────────────────────────

export interface ParallelOptions {
  /** LLMProvider instance or ModelConfig from anthropic()/openai()/bedrock()/ollama(). */
  readonly provider: LLMProvider | ModelConfig;
  readonly name?: string;
}

interface BranchDef {
  readonly id: string;
  readonly description: string;
  readonly runner: RunnerLike;
}

/** Result from a single parallel branch. */
export interface BranchResult {
  readonly id: string;
  readonly status: 'fulfilled' | 'rejected';
  readonly content: string;
  readonly error?: string;
}

export interface ParallelResult {
  /** Final merged content. */
  readonly content: string;
  /** Per-branch results. */
  readonly branches: readonly BranchResult[];
  /** Full message history (if LLM merge was used). */
  readonly messages: Message[];
}

const MAX_BRANCHES = 10;

// ── Builder ──────────────────────────────────────────────────

export class Parallel {
  private readonly provider: LLMProvider;
  private readonly parallelName: string;
  private readonly branches: BranchDef[] = [];
  private mergePrompt?: string;
  private mergeFn?: (results: Record<string, BranchResult>) => string;
  private readonly recorders: AgentRecorder[] = [];
  private streamingEnabled = false;

  private constructor(options: ParallelOptions) {
    this.provider = resolveProvider(options.provider);
    this.parallelName = options.name ?? 'parallel';
  }

  static create(options: ParallelOptions): Parallel {
    return new Parallel(options);
  }

  /** Add an agent branch to run in parallel. */
  agent(id: string, runner: RunnerLike, description: string): this {
    if (this.branches.length >= MAX_BRANCHES) {
      throw new Error(
        `Parallel: maximum ${MAX_BRANCHES} branches. Got ${this.branches.length + 1}.`,
      );
    }
    if (this.branches.some((b) => b.id === id)) {
      throw new Error(`Parallel: duplicate branch ID '${id}'.`);
    }
    this.branches.push({ id, description, runner });
    return this;
  }

  /**
   * Merge results using an LLM call (default strategy).
   * The LLM receives all branch results as context and generates a unified response.
   */
  mergeWithLLM(prompt: string): this {
    this.mergePrompt = prompt;
    this.mergeFn = undefined;
    return this;
  }

  /**
   * Merge results using a custom function (escape hatch for structured data).
   */
  merge(fn: (results: Record<string, BranchResult>) => string): this {
    this.mergeFn = fn;
    this.mergePrompt = undefined;
    return this;
  }

  streaming(enabled: boolean): this {
    this.streamingEnabled = enabled;
    return this;
  }

  recorder(rec: AgentRecorder): this {
    this.recorders.push(rec);
    return this;
  }

  build(): ParallelRunner {
    if (this.branches.length < 2) {
      throw new Error('Parallel requires at least 2 branches.');
    }
    if (!this.mergePrompt && !this.mergeFn) {
      throw new Error(
        'Parallel requires a merge strategy. Call .mergeWithLLM(prompt) or .merge(fn).',
      );
    }
    return new ParallelRunner({
      provider: this.provider,
      name: this.parallelName,
      branches: [...this.branches],
      mergePrompt: this.mergePrompt,
      mergeFn: this.mergeFn,
      streaming: this.streamingEnabled,
      recorders: [...this.recorders],
    });
  }
}

// ── Runner ───────────────────────────────────────────────────

interface ParallelRunnerOptions {
  readonly provider: LLMProvider;
  readonly name: string;
  readonly branches: readonly BranchDef[];
  readonly mergePrompt?: string;
  readonly mergeFn?: (results: Record<string, BranchResult>) => string;
  readonly streaming: boolean;
  readonly recorders: AgentRecorder[];
}

/** Scope state for the parallel flowchart. */
interface ParallelState {
  message: string;
  branchResults: Record<string, BranchResult>;
  mergedContent: string;
  result: string;
  messages: Message[];
  [key: string]: unknown;
}

export class ParallelRunner {
  private readonly opts: ParallelRunnerOptions;
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  private readonly narrativeRenderer = createAgentRenderer();

  constructor(options: ParallelRunnerOptions) {
    this.opts = options;
  }

  get name(): string {
    return this.opts.name;
  }

  /** Build the parallel flowchart. */
  private buildChart(message: string): FlowChartType {
    const { provider, branches, mergePrompt, mergeFn } = this.opts;

    // Seed: initialize message
    let builder = flowChart<ParallelState>(
      'Seed',
      (scope) => {
        scope.message = message;
        scope.branchResults = {};
        scope.messages = [];
      },
      'seed',
      undefined,
      'Initialize parallel execution',
    );

    // Mount each branch as a parallel subflow (fork children with isolated ExecutionRuntime)
    for (const branch of branches) {
      const branchChart = this.buildBranchChart(branch);
      builder = builder.addSubFlowChart(branch.id, branchChart, branch.description, {
        inputMapper: (parent: Record<string, unknown>) => ({
          message: parent.message ?? '',
        }),
        // applyOutputMapping merges nested keys — return only the new branch delta
        outputMapper: (sfOutput: Record<string, unknown>) => {
          const content = String(sfOutput.result ?? sfOutput.content ?? '');
          return {
            branchResults: {
              [branch.id]: { id: branch.id, status: 'fulfilled' as const, content },
            },
          };
        },
      });
    }

    // Merge stage — after all branches complete
    if (mergePrompt) {
      // LLM merge: feed all branch results to LLM
      const callLLM = createCallLLMStage(provider);

      builder = builder
        .addFunction(
          'FormatMerge',
          (scope) => {
            const results = scope.branchResults ?? {};
            // Format branch results as XML-tagged sections for the LLM
            // Escape XML special chars to prevent prompt injection via branch content
            const escapeXml = (s: string) =>
              s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const sections = Object.values(results)
              .map(
                (r: BranchResult) =>
                  `<branch id="${escapeXml(r.id)}">\n${escapeXml(r.content)}\n</branch>`,
              )
              .join('\n\n');

            scope.messages = [
              systemMessage(
                `${mergePrompt}\n\nMerge the following parallel results into a coherent response:`,
              ),
              userMessage(sections),
            ];
          },
          'format-merge',
          'Format branch results for LLM merge',
        )
        .addFunction('MergeLLM', callLLM, 'merge-llm', 'LLM synthesizes branch results')
        .addFunction(
          'ExtractMerge',
          (scope) => {
            const raw = scope.$getValue('adapterRawResponse') as { content?: string } | undefined;
            scope.result = raw?.content ?? '';
          },
          'extract-merge',
          'Extract merged result from LLM response',
        );
    } else if (mergeFn) {
      // Function merge
      const fn = mergeFn;
      builder = builder.addFunction(
        'Merge',
        (scope) => {
          const results = scope.branchResults ?? {};
          scope.result = fn(results);
        },
        'merge',
        'Merge branch results with custom function',
      );
    }

    this.lastSpec = annotateSpecIcons(builder.toSpec() as SpecLike);
    return builder.build();
  }

  /** Build a single branch's flowchart. */
  private buildBranchChart(branch: BranchDef): FlowChartType {
    // Check if runner has its own flowchart (for BTS drill-down)
    const runner = branch.runner as RunnerLike & { toFlowChart?: () => FlowChartType };
    if (typeof runner.toFlowChart === 'function') {
      return runner.toFlowChart();
    }

    // Fallback: wrap runner.run() in a single-stage flowchart with error capture
    return flowChart(
      branch.id,
      async (scope: TypedScope<{ message: string; result: string; branchError?: string }>) => {
        try {
          const res = await branch.runner.run(scope.message ?? '');
          scope.result = res.content;
        } catch (err: unknown) {
          scope.branchError = err instanceof Error ? err.message : String(err);
          scope.result = `[Error: ${scope.branchError}]`;
        }
      },
      `${branch.id}-run`,
      undefined,
      branch.description,
    ).build();
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number; onToken?: (token: string) => void },
  ): Promise<ParallelResult> {
    const chart = this.buildChart(message);
    const bridge = this.opts.recorders.length > 0 ? new RecorderBridge(this.opts.recorders) : null;
    bridge?.dispatchTurnStart(message);

    const executorOpts: FlowChartExecutorOptions = { enrichSnapshots: true };
    if (options?.onToken && this.opts.streaming) {
      executorOpts.streamHandlers = {
        onToken: (_id: string, token: string) => options.onToken!(token),
        onStart: () => {},
        onEnd: () => {},
      };
    }

    const executor = new FlowChartExecutor(chart, executorOpts);
    executor.enableNarrative({ renderer: this.narrativeRenderer });
    executor.attachRecorder(new MetricRecorder('metrics'));

    try {
      await executor.run({
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      this.lastExecutor = executor;
      bridge?.dispatchError('llm', err);
      throw err;
    }

    this.lastExecutor = executor;

    const state = executor.getSnapshot()?.sharedState ?? {};
    const result = (state.result as string) ?? '';
    const branchResults = (state.branchResults ?? {}) as Record<string, BranchResult>;
    const messages = (state.messages as Message[]) ?? [];

    bridge?.dispatchTurnComplete(result, messages.length);

    return {
      content: result,
      branches: Object.values(branchResults),
      messages,
    };
  }

  getNarrative(): string[] {
    return this.lastExecutor?.getNarrative() ?? [];
  }

  getNarrativeEntries() {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }

  getSpec(): unknown {
    if (!this.lastSpec) {
      this.buildChart('');
    }
    return this.lastSpec;
  }
}
