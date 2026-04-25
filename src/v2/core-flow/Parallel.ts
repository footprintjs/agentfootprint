/**
 * Parallel — fan-out composition: N branches run concurrently, then merge.
 *
 * Pattern: Builder (GoF) + Adapter over footprintjs's `addSubFlowChart`
 *          (fork children).
 * Role:    core-flow/ layer. All branches receive the same input
 *          `{ message }`. Each returns a string. A merge step combines
 *          them: either a pure function OR an LLM.
 * Emits:   agentfootprint.composition.enter / exit +
 *          composition.fork_start / branch_complete / merge_end
 *          (via compositionRecorder).
 */

import {
  FlowChartExecutor,
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type RunOptions,
  type TypedScope,
} from 'footprintjs';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { LLMMessage, LLMProvider } from '../adapters/types.js';
import type { Runner } from '../core/runner.js';
import { RunnerBase, makeRunId } from '../core/RunnerBase.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { compositionRecorder } from '../recorders/core/CompositionRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';

export interface ParallelOptions {
  readonly name?: string;
  readonly id?: string;
}

export interface ParallelInput {
  readonly message: string;
}

export type ParallelOutput = string;

type BranchChild = Runner<{ message: string }, string>;

export type MergeFn = (branchResults: Readonly<Record<string, string>>) => string;

/**
 * Outcome per branch in tolerant mode. One of:
 *   - `{ ok: true, value: string }` — branch succeeded; `value` is the returned string
 *   - `{ ok: false, error: string }` — branch threw; `error` is the error message
 *
 * Consumers in tolerant mode receive `Record<branchId, BranchOutcome>` and
 * decide how to handle partial failure (e.g., fall back to a default,
 * log, retry, or surface a user-facing message).
 */
export type BranchOutcome =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

export type MergeOutcomesFn = (
  outcomes: Readonly<Record<string, BranchOutcome>>,
) => string;

export interface MergeWithLLMOptions {
  readonly provider: LLMProvider;
  readonly model: string;
  /** Prompt prepended to the branch results when feeding the merge LLM. */
  readonly prompt: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

interface BranchEntry {
  readonly id: string;
  readonly name: string;
  readonly runner: BranchChild;
}

type MergeStrategy =
  | { readonly kind: 'fn'; readonly fn: MergeFn }
  | { readonly kind: 'llm'; readonly opts: MergeWithLLMOptions }
  | { readonly kind: 'outcomes-fn'; readonly fn: MergeOutcomesFn };

interface ParallelState {
  [k: string]: unknown;
}

export class Parallel extends RunnerBase<ParallelInput, ParallelOutput> {
  readonly name: string;
  readonly id: string;
  private readonly branches: readonly BranchEntry[];
  private readonly merge: MergeStrategy;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(
    opts: ParallelOptions,
    branches: readonly BranchEntry[],
    merge: MergeStrategy,
  ) {
    super();
    this.name = opts.name ?? 'Parallel';
    this.id = opts.id ?? 'parallel';
    if (branches.length < 2) {
      throw new Error('Parallel: must have at least 2 branches (use Sequence for a single runner)');
    }
    this.branches = branches;
    this.merge = merge;
  }

  static create(opts: ParallelOptions = {}): ParallelBuilder {
    return new ParallelBuilder(opts);
  }

  toFlowChart(): FlowChart {
    return this.buildChart();
  }

  async run(
    input: ParallelInput,
    options?: RunOptions,
  ): Promise<ParallelOutput | RunnerPauseOutcome> {
    const executor = this.createExecutor();
    const result = await executor.run({
      input: { message: input.message },
      ...(options ?? {}),
    });
    return this.finalizeResult(executor, result);
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<ParallelOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Parallel:${this.id}`],
    };

    const chart = this.buildChart();
    const executor = new FlowChartExecutor(chart);

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(
      new ContextRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      streamRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      agentRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    executor.attachCombinedRecorder(
      compositionRecorder({ dispatcher, getRunContext: getRunCtx }),
    );
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): ParallelOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Parallel: unexpected result shape — expected string');
  }

  private buildChart(): FlowChart {
    const branches = this.branches;
    const merge = this.merge;
    const compositionId = this.id;
    const compositionName = this.name;

    const seed = (scope: TypedScope<ParallelState>) => {
      const args = scope.$getArgs<ParallelInput>();
      scope.userMessage = args.message;
      scope.branchResults = {};
      typedEmit(scope, 'agentfootprint.composition.enter', {
        kind: 'Parallel',
        id: compositionId,
        name: compositionName,
        childCount: branches.length,
      });
      typedEmit(scope, 'agentfootprint.composition.fork_start', {
        parentId: compositionId,
        branches: branches.map((b) => ({ id: b.id, name: b.name })),
      });
    };

    // Root description prefix `Parallel:` is the taxonomy marker — see
    // FlowchartRecorder.mapTopologyToSteps for the consumer side.
    let builder = flowChart<ParallelState>(
      'Seed',
      seed,
      'seed',
      undefined,
      `Parallel: ${branches.length}-way fanout`,
    );

    // Fork children — each branch is wrapped in a chart that runs the
    // branch runner in try/catch. The wrapper always succeeds (no error
    // propagates up), so the outputMapper always fires and records a
    // typed `BranchOutcome` for the Merge stage to inspect.
    //
    // Strict mode (default): Merge throws on any branch failure. Tolerant
    // mode: Merge passes the full outcomes map to the consumer's merge fn.
    for (const branch of branches) {
      builder = builder.addSubFlowChart(
        branch.id,
        buildBranchWrapperChart(branch),
        branch.name,
        {
          inputMapper: (parent) => ({ message: (parent.userMessage as string) ?? '' }),
          // The wrapper's terminal stage returns a BranchOutcome. Stash it
          // under the branch id; shallow-merge across siblings produces
          // the full outcomes map.
          outputMapper: (sfOutput) => ({
            branchOutcomes: {
              [branch.id]: sfOutput as BranchOutcome,
            },
          }),
        },
      );
    }

    // Merge stage — runs after all fork children complete (join point).
    const mergeStage = async (scope: TypedScope<ParallelState>): Promise<string> => {
      const outcomes = (scope.branchOutcomes as Record<string, BranchOutcome>) ?? {};

      const failures = Object.entries(outcomes).filter(([, o]) => !o.ok);
      const isTolerant = merge.kind === 'outcomes-fn';
      if (failures.length > 0 && !isTolerant) {
        const details = failures
          .map(([id, o]) => `  ${id}: ${(o as { ok: false; error: string }).error}`)
          .join('\n');
        typedEmit(scope, 'agentfootprint.composition.exit', {
          kind: 'Parallel',
          id: compositionId,
          status: 'err',
          durationMs: Date.now() - this.currentRunContext.runStartMs,
        });
        throw new Error(
          `Parallel '${compositionId}': ${failures.length} branch(es) failed:\n${details}\n` +
            `(use .mergeOutcomesWithFn() for tolerant-mode partial-failure handling)`,
        );
      }

      let merged: string;
      if (merge.kind === 'fn') {
        const results: Record<string, string> = {};
        for (const [id, o] of Object.entries(outcomes)) {
          if (o.ok) results[id] = o.value;
        }
        merged = merge.fn(results);
      } else if (merge.kind === 'llm') {
        const results: Record<string, string> = {};
        for (const [id, o] of Object.entries(outcomes)) {
          if (o.ok) results[id] = o.value;
        }
        merged = await mergeWithLLM(scope, merge.opts, results);
      } else {
        merged = merge.fn(outcomes);
      }
      typedEmit(scope, 'agentfootprint.composition.merge_end', {
        parentId: compositionId,
        strategy: merge.kind === 'outcomes-fn' ? 'fn' : merge.kind,
        resultSummary: truncate(merged, 80),
        mergedBranchCount: branches.length,
      });
      typedEmit(scope, 'agentfootprint.composition.exit', {
        kind: 'Parallel',
        id: compositionId,
        status: 'ok',
        durationMs: Date.now() - this.currentRunContext.runStartMs,
      });
      return merged;
    };

    builder = builder.addFunction('Merge', mergeStage, 'merge', 'Parallel merge');

    return builder.build();
  }
}

/**
 * Build a wrapper chart that runs a branch Runner in a try/catch and
 * emits its events to the Parallel's dispatcher. The chart's terminal
 * stage returns a `BranchOutcome` — never throws up to the traverser.
 *
 * Event forwarding: the branch runner has its own EventDispatcher. We
 * subscribe to the wildcard `'*'` during run() and re-dispatch each
 * event on Parallel's dispatcher so consumers who attach listeners at
 * the Parallel level see the branch's llm/context/agent events.
 */
function buildBranchWrapperChart(branch: BranchEntry): FlowChart {
  const runBranch = async (scope: TypedScope<ParallelState>): Promise<BranchOutcome> => {
    const args = scope.$getArgs<{ message: string }>();
    // Forward every branch-runner event via `scope.$emit` so it flows
    // through footprintjs's emit channel. That channel reaches every
    // EmitBridge attached to the CURRENT executor — including bridges
    // belonging to outer compositions when this Parallel is nested
    // (e.g., `Loop(Parallel(...))`). Forwarding directly to the
    // Parallel's own dispatcher would be invisible to outer layers.
    const unsubscribe = branch.runner.on('*', (e) => {
      // `e.payload` is the typed payload union for the specific event;
      // $emit accepts `unknown`, so no cast is needed — let it pass
      // through structurally.
      scope.$emit(e.type, e.payload);
    });
    try {
      const result = await branch.runner.run({ message: args.message ?? '' });
      if (typeof result === 'string') {
        return { ok: true, value: result };
      }
      // Paused outcome: surface as "ok" with empty value — pauses from
      // nested runners aren't failures, but Parallel doesn't yet propagate
      // them through the merge. Consumers who need pause-inside-Parallel
      // should set up nested pause handling at their own layer.
      return { ok: true, value: '' };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      unsubscribe();
    }
  };

  return flowChart<ParallelState>(
    'RunBranch',
    runBranch,
    'run-branch',
    undefined,
    `Parallel branch '${branch.id}' — catches failures`,
  ).build();
}

/** Fluent builder. Requires at least 2 branches + one merge strategy. */
export class ParallelBuilder {
  private readonly opts: ParallelOptions;
  private readonly branches: BranchEntry[] = [];
  private merge: MergeStrategy | undefined;
  private readonly seenIds = new Set<string>();

  constructor(opts: ParallelOptions) {
    this.opts = opts;
  }

  /** Add a branch. All branches run concurrently with the same input. */
  branch(id: string, runner: BranchChild, name?: string): this {
    if (this.seenIds.has(id)) {
      throw new Error(`Parallel.branch(): duplicate branch id '${id}'`);
    }
    this.seenIds.add(id);
    this.branches.push({ id, runner, name: name ?? id });
    return this;
  }

  /**
   * Merge branch results via a pure function.
   * `fn` receives `{ [branchId]: string }` and returns the merged string.
   */
  mergeWithFn(fn: MergeFn): this {
    if (this.merge !== undefined) {
      throw new Error('Parallel: merge strategy already set');
    }
    this.merge = { kind: 'fn', fn };
    return this;
  }

  /** Merge branch results by feeding them to an LLM for synthesis. */
  mergeWithLLM(opts: MergeWithLLMOptions): this {
    if (this.merge !== undefined) {
      throw new Error('Parallel: merge strategy already set');
    }
    this.merge = { kind: 'llm', opts };
    return this;
  }

  /**
   * Tolerant merge — receives `{ [branchId]: BranchOutcome }` including
   * both successes (`{ ok: true, value }`) and failures (`{ ok: false, error }`).
   * Parallel does NOT throw on partial failure when this merge variant is
   * used; the consumer's `fn` decides how to handle it (fall back, surface
   * a warning, retry at a higher level, etc.).
   *
   * Use the default `mergeWithFn` / `mergeWithLLM` variants when you want
   * a single failing branch to abort the whole Parallel loudly.
   */
  mergeOutcomesWithFn(fn: MergeOutcomesFn): this {
    if (this.merge !== undefined) {
      throw new Error('Parallel: merge strategy already set');
    }
    this.merge = { kind: 'outcomes-fn', fn };
    return this;
  }

  build(): Parallel {
    if (this.merge === undefined) {
      throw new Error(
        'Parallel.build(): no merge strategy — call .mergeWithFn() or .mergeWithLLM() before build()',
      );
    }
    return new Parallel(this.opts, this.branches, this.merge);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function mergeWithLLM(
  scope: TypedScope<ParallelState>,
  opts: MergeWithLLMOptions,
  results: Readonly<Record<string, string>>,
): Promise<string> {
  // XML-escape branch content to avoid prompt-injection via branch output.
  const sections = Object.entries(results)
    .map(([id, content]) => `<${id}>${xmlEscape(content)}</${id}>`)
    .join('\n');
  const userContent = `${opts.prompt}\n\n${sections}`;
  const messages: LLMMessage[] = [{ role: 'user', content: userContent }];

  typedEmit(scope, 'agentfootprint.stream.llm_start', {
    iteration: 1,
    provider: opts.provider.name,
    model: opts.model,
    systemPromptChars: 0,
    messagesCount: 1,
    toolsCount: 0,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
  });
  const startMs = Date.now();
  const response = await opts.provider.complete({
    messages,
    model: opts.model,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
  });
  const durationMs = Date.now() - startMs;
  typedEmit(scope, 'agentfootprint.stream.llm_end', {
    iteration: 1,
    content: response.content,
    toolCallCount: response.toolCalls.length,
    usage: response.usage,
    stopReason: response.stopReason,
    durationMs,
  });
  return response.content;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
