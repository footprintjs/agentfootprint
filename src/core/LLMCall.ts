/**
 * LLMCall — the leaf primitive for a single LLM invocation (no tools).
 *
 * Pattern: Builder (GoF) → produces a Runner backed by a footprintjs FlowChart.
 *
 * Chart shape — outer client wrapper around an inner llm-subflow:
 *
 *     Client → sf-llm-call → loopTo(client)
 *
 *   Outer `Client` stage:
 *     - First visit: receives args, writes userMessage to scope.
 *     - Second visit (after the loop completes): $break()s with
 *       scope.answer as the chart's TraversalResult.
 *
 *   Inner `sf-llm-call` subflow (drill-down view):
 *     Initialize → sf-system-prompt → sf-messages → call-llm
 *          → [sf-thinking if handler]  → extract-final
 *
 *   NO `sf-tools` slot — LLMCall has no tools by design (that's Agent's
 *   territory). Atomic LLMCall's lens chart is a clean 3-node top-level
 *   view (Client + LLM + loop edge) that drills into the real flowchart
 *   below.
 *
 *   Loop semantics: LLMCall is one-shot. The loop fires once; the
 *   second Client visit immediately breaks. The shape is identical to
 *   chat-mode (future): swap `$break()` for `pause()` and the same
 *   chart supports multi-turn conversation.
 *
 * Slot subflows write convention-keyed injections observed by
 * ContextRecorder. The call-llm stage typedEmits stream.llm_start
 * and stream.llm_end observed by StreamRecorder. When a
 * `ThinkingHandler` resolves for the provider, `sf-thinking` mounts
 * automatically (auto-wired by provider.name — same convention Agent
 * uses).
 *
 * Emits (through internally-attached recorders):
 *     agentfootprint.stream.llm_start / llm_end
 *     agentfootprint.context.injected / slot_composed
 *     agentfootprint.stream.thinking_end (when sf-thinking mounted)
 */

import {
  FlowChartExecutor,
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type RunOptions,
  type StructureRecorder,
  type TypedScope,
} from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';
import type { GroupMetadata, GroupTranslator } from './translator.js';
import type { RunnerPauseOutcome } from './pause.js';
import { SUBFLOW_IDS, STAGE_IDS } from '../conventions.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { errorBridge } from '../recorders/core/ErrorBridge.js';
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
import { buildThinkingSubflow } from './slots/buildThinkingSubflow.js';
import { findThinkingHandler } from '../thinking/registry.js';
import type { ThinkingBlock, ThinkingHandler } from '../thinking/types.js';

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
  /**
   * Optional build-time recorders threaded into footprintjs's
   * `flowChart()` factory. Each recorder observes per-node build
   * events (`onStageAdded` / `onSubflowMounted` / etc.) for this
   * LLMCall's internal chart (Initialize + slot mounts + CallLLM). When
   * omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). See
   * `core/translator.ts`. When attached, `runner.getUIGroup()` invokes
   * it with the LLMCall's `GroupMetadata` (kind `'LLMCall'`, id, name,
   * empty `members[]`, plus `extra.slots` with the three slot ids —
   * `system-prompt`, `messages`, `tools` — so Lens can render the slot
   * cards inside an LLMCall card without inspecting `buildTimeStructure`).
   * Returns `undefined` when omitted.
   */
  readonly groupTranslator?: GroupTranslator;
}

export interface LLMCallInput {
  readonly message: string;
}

export type LLMCallOutput = string;

/**
 * Internal state shape — what flows through the scope during execution.
 * Not exported; all observation is via events.
 *
 * Note: the OUTER `client` stage carries a subset of these (userMessage,
 * answer, cumulative cost counters). The INNER `sf-llm-call` subflow
 * carries the per-call working fields (injection arrays, rawThinking,
 * thinkingBlocks). inputMapper/outputMapper bridge the two scopes —
 * see `buildChart()` for the exact contract.
 */
interface LLMCallState {
  userMessage: string;
  /** Set by extract-final once the LLM has responded. Bubbled to the
   *  outer Client scope via outputMapper; Client's break path returns
   *  it as the chart's TraversalResult. */
  answer?: string;
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  iteration: number;
  /** Raw provider-specific thinking payload set by callLLM, consumed
   *  by sf-thinking when a ThinkingHandler is configured. */
  rawThinking?: unknown;
  /** Normalized thinking blocks written by sf-thinking (when mounted). */
  thinkingBlocks?: readonly ThinkingBlock[];
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
  private readonly structureRecorders?: readonly StructureRecorder[];
  private readonly groupTranslator?: GroupTranslator;
  /** Auto-resolved from provider.name at construction time (same
   *  convention Agent uses — see findThinkingHandler). When undefined,
   *  sf-thinking is NOT mounted and the chart has zero thinking
   *  overhead (build-time conditional mount). */
  private readonly thinkingHandler?: ThinkingHandler;

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
    if (opts.structureRecorders) this.structureRecorders = opts.structureRecorders;
    if (opts.groupTranslator) this.groupTranslator = opts.groupTranslator;
    // v2.14 alignment — auto-wire ThinkingHandler by provider.name. Same
    // mechanism Agent uses (Agent.ts:300+). When the registry has no
    // handler for this provider (e.g., MockProvider), the field stays
    // undefined and sf-thinking is not mounted.
    const auto = findThinkingHandler(opts.provider.name);
    if (auto) this.thinkingHandler = auto;
    // Eager chart construction (footprintjs inventor convention): build
    // once at constructor time so `buildTimeStructure` is a stable
    // immutable object reference, each `StructureRecorder` fires
    // exactly N times (N = node count) per LLMCall, and reference-equality memos
    // on `getSpec()` work. Subsequent `getSpec()` calls return the
    // cached chart; each `run()` reuses it in a fresh executor.
    this.initChart(() => this.buildChart() as FlowChart);
  }

  static create(opts: LLMCallOptions): LLMCallBuilder {
    return new LLMCallBuilder(opts);
  }

  // `getSpec()` is inherited from `RunnerBase` — returns the chart
  // cached by `initChart()` above. No subclass override needed.

  // ─── UI group translation (L1b) ───────────────────────────────
  protected override getGroupTranslator(): GroupTranslator | undefined {
    return this.groupTranslator;
  }

  /** LLMCall has no nested-runner members (slots are subflows of
   *  the LLMCall's own chart, not Runner instances). The slot ids
   *  are surfaced via `extra` so Lens can render the slot cards
   *  inside an LLMCall card without inspecting `buildTimeStructure`.
   *
   *  TWO slots only — LLMCall does not have tools (that's Agent's
   *  affordance). Atomic LLMCall renders as a clean 2-pill card in
   *  collapsed (top-level) view. */
  protected override buildUIGroupMetadata(): GroupMetadata {
    return {
      kind: 'LLMCall',
      id: this.id,
      name: this.name,
      members: [],
      extra: {
        slots: [SUBFLOW_IDS.SYSTEM_PROMPT, SUBFLOW_IDS.MESSAGES] as const,
      },
    };
  }

  async run(
    input: LLMCallInput,
    options?: RunOptions,
  ): Promise<LLMCallOutput | RunnerPauseOutcome> {
    const executor = this.createExecutor();
    this.lastExecutor = executor;
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
    this.lastExecutor = executor;
    const result = await executor.resume(checkpoint, input, options);
    return this.finalizeResult(executor, result);
  }

  private createExecutor(): FlowChartExecutor {
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`LLMCall:${this.id}`],
    };

    // Reuse the cached chart built at constructor time. `getSpec()` and
    // every `run()` share the same `FlowChart` object reference.
    const executor = new FlowChartExecutor(this.getSpec());

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    executor.attachCombinedRecorder(new ContextRecorder({ dispatcher, getRunContext: getRunCtx }));
    // NOTE: no contextEvaluatedRecorder here — LLMCall composes its slots
    // directly and does NOT mount the Injection Engine, so context.evaluated
    // never fires in an LLMCall (that event is Agent-only).
    executor.attachCombinedRecorder(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Terminal-failure bridge: footprintjs onRunFailed → typed error.fatal,
    // so a thrown run clears in-flight live state + flips monitor status.
    executor.attachCombinedRecorder(errorBridge({ dispatcher, getRunContext: getRunCtx }));
    if (this.pricingTable) {
      // Only attach cost bridge when pricing is configured — zero overhead
      // on runs that don't opt into cost accounting.
      executor.attachCombinedRecorder(costRecorder({ dispatcher, getRunContext: getRunCtx }));
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
    // Client stage is the chart's last-executed stage (it $break()s
    // on the second visit). It deliberately returns void per the
    // TypedStageFunction contract; the LLM answer flows through
    // `scope.answer` on the outer-chart state. Read it from the
    // snapshot here to bridge to LLMCall.run()'s string return.
    if (typeof result === 'string') return result;
    const snap = executor.getSnapshot();
    const sharedState = (snap as { sharedState?: { answer?: unknown } } | undefined)?.sharedState;
    const answer = sharedState?.answer;
    if (typeof answer === 'string') return answer;
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
    const thinkingHandler = this.thinkingHandler;

    // ─── Outer Client stage ─────────────────────────────────────────
    // First visit: receives args, sets userMessage on outer scope.
    // Second visit (post-loop): scope.answer has been populated by the
    // inner subflow's outputMapper. `$break` terminates the loop AND
    // returns scope.answer as the chart's TraversalResult.
    //
    // Returning the answer here is load-bearing for composition: when
    // LLMCall is mounted inside Sequence/Parallel/Conditional, the
    // parent's outputMapper reads `sfOutput` which IS the subflow's
    // TraversalResult (footprintjs convention). Without the return,
    // parent.current ends up as '' and downstream steps see no input.
    //
    // Cost counters live exclusively in the inner subflow's scope —
    // they don't need to cross the boundary because LLMCall is
    // one-shot. Threading them via inputMapper would seal them as
    // readonly input on the inner side (footprintjs convention) and
    // break `emitCostTick`'s scope writes.
    const client = (
      scope: TypedScope<LLMCallState>,
    ): string | undefined => {
      if (scope.answer !== undefined) {
        scope.$break('LLMCall: one-shot complete');
        return scope.answer;
      }
      const args = scope.$getArgs<LLMCallInput>();
      scope.userMessage = args.message;
      scope.iteration = 1;
      return undefined;
    };

    // ─── Inner subflow stages ───────────────────────────────────────
    // Inner seed initializes the per-call injection arrays AND the
    // local cost counters that emitCostTick mutates inside callLLM.
    // userMessage + iteration arrive via inputMapper from outer Client.
    const innerSeed = (scope: TypedScope<LLMCallState>) => {
      scope.systemPromptInjections = [];
      scope.messagesInjections = [];
      scope.cumTokensInput = 0;
      scope.cumTokensOutput = 0;
      scope.cumEstimatedUsd = 0;
      scope.costBudgetHit = false;
    };

    // slot subflow builders. Each emits InjectionRecord[] + SlotComposition
    // through the convention scope keys; ContextRecorder observes and
    // dispatches context.* events. NO tools slot — LLMCall has no tools.
    const systemPromptSubflow = buildSystemPromptSlot({
      prompt: systemPromptValue,
      reason: 'LLMCall.system()',
    });
    const messagesSubflow = buildMessagesSlot();

    const callLLM = async (scope: TypedScope<LLMCallState>) => {
      const systemPromptInjections = (scope.systemPromptInjections ??
        []) as readonly InjectionRecord[];
      const messagesInjections = (scope.messagesInjections ?? []) as readonly InjectionRecord[];
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
      // Raw provider errors propagate untouched (reliability + merge
      // layers classify on the raw message). The friendly translation
      // for non-developers happens once at the terminal boundary —
      // ErrorBridge humanizes the `error.fatal` event the monitor reads.
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

      // Write outputs to scope so downstream stages (sf-thinking,
      // extract-final) can read them. The chart's TraversalResult
      // bubbles up via scope.answer + outputMapper, NOT via this
      // stage's return value (which is intentionally undefined now).
      scope.answer = response.content;
      if (response.rawThinking !== undefined) {
        scope.rawThinking = response.rawThinking;
      }
      return undefined;
    };

    // extract-final stage — symmetric with Agent's sf-final branch.
    // For LLMCall (no tools) it's a thin "final answer is ready" marker
    // that gives lens a discrete commit boundary and matching chart
    // node. scope.answer is already set by callLLM; this stage just
    // surfaces a real "final" moment.
    const extractFinal = (scope: TypedScope<LLMCallState>) => {
      // No-op data-wise — scope.answer was set in callLLM. This stage
      // exists purely for chart shape (lens "Final" node + commit).
      void scope;
    };

    // ─── Build the inner sf-llm-call subflow ────────────────────────
    let innerBuilder = flowChart<LLMCallState>('Initialize', innerSeed, STAGE_IDS.SEED, {
      description: 'LLMCall: invocation internals',
    })
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
            messages: userMessage ? [{ role: 'user' as const, content: userMessage }] : [],
            iteration: parent.iteration as number | undefined,
          };
        },
        outputMapper: (sfOutput) => ({ messagesInjections: sfOutput.messagesInjections }),
      })
      .addFunction('CallLLM', callLLM, STAGE_IDS.CALL_LLM, 'LLM invocation');

    // Conditional sf-thinking — mounted only when a ThinkingHandler
    // resolved (auto-wired by provider.name in the constructor). Same
    // build-time conditional pattern Agent uses (buildAgentChart.ts).
    if (thinkingHandler) {
      innerBuilder = innerBuilder.addSubFlowChartNext(
        SUBFLOW_IDS.THINKING,
        buildThinkingSubflow(thinkingHandler),
        'NormalizeThinking',
        {
          inputMapper: (parent) => ({
            rawThinking: parent.rawThinking as unknown,
            iteration: parent.iteration as number | undefined,
          }),
          outputMapper: (sfOutput) => ({ thinkingBlocks: sfOutput.thinkingBlocks }),
          // Replace not concatenate — fresh thinking per iteration.
          arrayMerge: ArrayMergeMode.Replace,
        },
      );
    }

    const innerSubflow = innerBuilder
      .addFunction('ExtractFinal', extractFinal, STAGE_IDS.EXTRACT_FINAL, 'Final response ready')
      .build();

    // ─── Outer chart: Client → sf-llm-call → loopTo(client) ─────────
    // Description prefix `LLMCall:` is a taxonomy marker — consumers
    // distinguish LLMCall subflows from Agent subflows (`Agent:`) via
    // this prefix. Only Agent subflows surface as "agent boundaries"
    // in Lens; LLMCall is a primitive invocation, not an agent.
    //
    // Untyped <string, TypedScope<LLMCallState>> overload is used so
    // Client's `string | undefined` return is accepted — the chart's
    // TraversalResult is the answer string, which downstream
    // compositions (Sequence/Parallel/Conditional) read via
    // outputMapper's `sfOutput` parameter.
    return flowChart<string, TypedScope<LLMCallState>>('Client', client, STAGE_IDS.CLIENT, {
      ...(this.structureRecorders !== undefined && {
        structureRecorders: [...this.structureRecorders],
      }),
      description: 'LLMCall: one-shot',
    })
      .addSubFlowChartNext(SUBFLOW_IDS.LLM_CALL, innerSubflow, 'LLM', {
        inputMapper: (parent) => ({
          userMessage: parent.userMessage as string | undefined,
          iteration: parent.iteration as number | undefined,
        }),
        outputMapper: (sfOutput) => ({
          answer: sfOutput.answer,
        }),
      })
      .loopTo(STAGE_IDS.CLIENT)
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
