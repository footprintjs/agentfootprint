/**
 * LLMCall — the leaf primitive for a single LLM invocation (no tools, no loop).
 *
 * Pattern: Builder (GoF) → produces a Runner backed by a footprintjs FlowChart.
 * Role:    Layer-5 primitive (core/). Uses the 3-slot model internally:
 *            Seed → sf-system-prompt → sf-messages → sf-tools → call-llm
 *          Slot subflows write convention-keyed injections observed by
 *          ContextRecorder. The call-llm stage typedEmits stream.llm_start
 *          and stream.llm_end observed by StreamRecorder.
 * Emits:   Through its internally-attached recorders:
 *            agentfootprint.stream.llm_start / llm_end
 *            agentfootprint.context.injected / slot_composed
 */

import {
  FlowChartExecutor,
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type RunOptions,
  type TypedScope,
} from 'footprintjs';
import type { RunnerPauseOutcome } from './pause.js';
import { SUBFLOW_IDS, STAGE_IDS } from '../conventions.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { costRecorder } from '../recorders/core/CostRecorder.js';
import { evalRecorder } from '../recorders/core/EvalRecorder.js';
import { memoryRecorder } from '../recorders/core/MemoryRecorder.js';
import { skillRecorder } from '../recorders/core/SkillRecorder.js';
import { typedEmit } from '../recorders/core/typedEmit.js';
import type { InjectionRecord } from '../recorders/core/types.js';
import type { LLMProvider, PricingTable } from '../adapters/types.js';
import { emitCostTick } from './cost.js';
import { RunnerBase, makeRunId } from './RunnerBase.js';
import { buildSystemPromptSlot } from './slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from './slots/buildMessagesSlot.js';
import { buildToolsSlot } from './slots/buildToolsSlot.js';

export interface LLMCallOptions {
  readonly provider: LLMProvider;
  /** Human-friendly name shown in events/metrics. Default: 'LLMCall'. */
  readonly name?: string;
  /** Stable id used for topology + events. Default: 'llm-call'. */
  readonly id?: string;
  /** Model to request from the provider. */
  readonly model: string;
  /** Optional sampling temperature. */
  readonly temperature?: number;
  /** Optional max output tokens. */
  readonly maxTokens?: number;
  /**
   * Pricing adapter. When set, LLMCall emits `agentfootprint.cost.tick`
   * after every LLM response with per-call and cumulative USD. Run-scoped
   * — the cumulative resets on each `.run()`.
   */
  readonly pricingTable?: PricingTable;
  /**
   * Cumulative USD budget per run. When provided along with `pricingTable`,
   * LLMCall emits `agentfootprint.cost.limit_hit` with `action: 'warn'`
   * the first time cumulative USD crosses the budget. Execution continues
   * — consumers choose whether to abort by listening to the event.
   */
  readonly costBudget?: number;
}

export interface LLMCallInput {
  readonly message: string;
}

export type LLMCallOutput = string;

/**
 * Internal state shape — what flows through the scope during execution.
 * Not exported; all observation is via events.
 */
interface LLMCallState {
  userMessage: string;
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  toolsInjections: readonly InjectionRecord[];
  iteration: number;
  // Cost accounting (only populated when pricingTable is set).
  cumTokensInput: number;
  cumTokensOutput: number;
  cumEstimatedUsd: number;
  costBudgetHit: boolean;
}

export class LLMCall extends RunnerBase<LLMCallInput, LLMCallOutput> {
  readonly name: string;
  readonly id: string;
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly systemPromptValue: string;
  private readonly pricingTable?: PricingTable;
  private readonly costBudget?: number;

  // Run-scoped; refreshed each run().
  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  constructor(opts: LLMCallOptions, systemPromptValue: string) {
    super();
    this.provider = opts.provider;
    this.name = opts.name ?? 'LLMCall';
    this.id = opts.id ?? 'llm-call';
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
    this.systemPromptValue = systemPromptValue;
    if (opts.pricingTable) this.pricingTable = opts.pricingTable;
    if (opts.costBudget !== undefined) this.costBudget = opts.costBudget;
  }

  static create(opts: LLMCallOptions): LLMCallBuilder {
    return new LLMCallBuilder(opts);
  }

  toFlowChart(): FlowChart {
    return this.buildChart() as FlowChart;
  }

  async run(
    input: LLMCallInput,
    options?: RunOptions,
  ): Promise<LLMCallOutput | RunnerPauseOutcome> {
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
  ): Promise<LLMCallOutput | RunnerPauseOutcome> {
    this.emitPauseResume(checkpoint, input);
    const executor = this.createExecutor();
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`LLMCall:${this.id}`],
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
    if (this.pricingTable) {
      // Only attach cost bridge when pricing is configured — zero overhead
      // on runs that don't opt into cost accounting.
      executor.attachCombinedRecorder(
        costRecorder({ dispatcher, getRunContext: getRunCtx }),
      );
    }
    // Always-on bridges for consumer-emitted domain events (eval / memory /
    // skill). EmitBridge early-exits when no listener is attached, so
    // these are zero-alloc on runs that don't emit.
    executor.attachCombinedRecorder(evalRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(memoryRecorder({ dispatcher, getRunContext: getRunCtx }));
    executor.attachCombinedRecorder(skillRecorder({ dispatcher, getRunContext: getRunCtx }));
    for (const r of this.attachedRecorders) executor.attachCombinedRecorder(r);
    return executor;
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): LLMCallOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('LLMCall: unexpected result shape — expected string');
  }

  // ─── Internal chart construction ────────────────────────────────

  private buildChart(): FlowChart {
    const provider = this.provider;
    const model = this.model;
    const temperature = this.temperature;
    const maxTokens = this.maxTokens;
    const systemPromptValue = this.systemPromptValue;
    const pricingTable = this.pricingTable;
    const costBudget = this.costBudget;

    const seed = (scope: TypedScope<LLMCallState>) => {
      const args = scope.$getArgs<LLMCallInput>();
      scope.userMessage = args.message;
      scope.systemPromptInjections = [];
      scope.messagesInjections = [];
      scope.toolsInjections = [];
      scope.iteration = 1;
      scope.cumTokensInput = 0;
      scope.cumTokensOutput = 0;
      scope.cumEstimatedUsd = 0;
      scope.costBudgetHit = false;
    };

    // v2 slot subflow builders. Each emits InjectionRecord[] + SlotComposition
    // through the convention scope keys; ContextRecorder observes and
    // dispatches context.* events.
    const systemPromptSubflow = buildSystemPromptSlot({
      prompt: systemPromptValue,
      reason: 'LLMCall.system()',
    });
    const messagesSubflow = buildMessagesSlot();
    const toolsSubflow = buildToolsSlot({ tools: [] });

    const callLLM = async (scope: TypedScope<LLMCallState>) => {
      const systemPromptInjections = (scope.systemPromptInjections ??
        []) as readonly InjectionRecord[];
      const messagesInjections = (scope.messagesInjections ??
        []) as readonly InjectionRecord[];
      const iteration = (scope.iteration as number | undefined) ?? 1;

      const systemPrompt = systemPromptInjections
        .map((r) => r.rawContent ?? '')
        .filter((s) => s.length > 0)
        .join('\n\n');

      const messages = messagesInjections
        .map((r) => ({
          role: r.asRole ?? 'user',
          content: r.rawContent ?? r.contentSummary,
        }))
        .filter((m) => m.content.length > 0);

      typedEmit(scope, 'agentfootprint.stream.llm_start', {
        iteration,
        provider: provider.name,
        model,
        systemPromptChars: systemPrompt.length,
        messagesCount: messages.length,
        toolsCount: 0,
        ...(temperature !== undefined && { temperature }),
      });

      const startMs = Date.now();
      const response = await provider.complete({
        systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
        messages,
        model,
        ...(temperature !== undefined && { temperature }),
        ...(maxTokens !== undefined && { maxTokens }),
      });
      const durationMs = Date.now() - startMs;

      typedEmit(scope, 'agentfootprint.stream.llm_end', {
        iteration,
        content: response.content,
        toolCallCount: response.toolCalls.length,
        usage: response.usage,
        stopReason: response.stopReason,
        durationMs,
      });

      emitCostTick(scope, pricingTable, costBudget, model, response.usage);

      // Return the content — it becomes the executor's TraversalResult
      // when LLMCall runs standalone, and the subflow's output when
      // LLMCall is composed into a Sequence/Parallel/Conditional/Loop.
      return response.content;
    };

    // Description prefix `LLMCall:` is a taxonomy marker — consumers
    // distinguish LLMCall subflows from Agent subflows (`Agent:`)
    // via this prefix. Only Agent subflows surface as "agent
    // boundaries" in Lens; LLMCall subflows are stages inside a
    // composition, not agents in their own right.
    return flowChart<LLMCallState>(
      'Seed',
      seed,
      STAGE_IDS.SEED,
      undefined,
      'LLMCall: one-shot',
    )
      .addSubFlowChartNext(SUBFLOW_IDS.SYSTEM_PROMPT, systemPromptSubflow, 'System Prompt', {
        inputMapper: (parent) => ({
          userMessage: parent.userMessage as string | undefined,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sfOutput) => ({ systemPromptInjections: sfOutput.systemPromptInjections }),
      })
      .addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, messagesSubflow, 'Messages', {
        inputMapper: (parent) => {
          // Wrap the single user message as a one-entry history for the
          // messages slot. Full conversation history arrives with Agent.
          const userMessage = parent.userMessage as string | undefined;
          return {
            messages: userMessage
              ? [{ role: 'user' as const, content: userMessage }]
              : [],
            iteration: parent.iteration as number | undefined,
          };
        },
        outputMapper: (sfOutput) => ({ messagesInjections: sfOutput.messagesInjections }),
      })
      .addSubFlowChartNext(SUBFLOW_IDS.TOOLS, toolsSubflow, 'Tools', {
        inputMapper: (parent) => ({ iteration: parent.iteration as number | undefined }),
        outputMapper: (sfOutput) => ({ toolsInjections: sfOutput.toolsInjections }),
      })
      .addFunction('CallLLM', callLLM, STAGE_IDS.CALL_LLM, 'LLM invocation')
      .build();
  }
}

/**
 * Tiny fluent builder. Validates required fields at build() time.
 */
export class LLMCallBuilder {
  private readonly opts: LLMCallOptions;
  private systemPromptValue = '';

  constructor(opts: LLMCallOptions) {
    this.opts = opts;
  }

  system(prompt: string): this {
    this.systemPromptValue = prompt;
    return this;
  }

  build(): LLMCall {
    return new LLMCall(this.opts, this.systemPromptValue);
  }
}

// (Helpers previously inlined are now in ./slots/helpers.ts — the slot
// builders import them directly. LLMCall stays thin: Builder + chart
// assembly + internal recorder wiring.)

