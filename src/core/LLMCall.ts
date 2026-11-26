import { LLMCallBuilder } from './LLMCall/builder.js';
import { SUBFLOW_IDS } from '../lib/conventions.js';
import { buildCallChart } from './LLMCall/chart.js';
import { interventionVerdictOf } from './providerIntervention.js';
import { terminalErrorOf, type ChildOutcome } from './terminalVerdict.js';
import type { LLMCallOptions, LLMCallInput, LLMCallOutput } from './LLMCall/types.js';
/**
 * LLMCall — the leaf primitive for a single LLM invocation (no tools).
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
  type CombinedRecorder,
  type RunSetup,
  type FlowChart,
  type FlowchartCheckpoint,
  type StructureRecorder,
} from 'footprintjs';
import type { RunOptions } from './runner.js';
import { requestOf } from './requestOfRun.js';
import type { RedactionPolicy } from 'footprintjs';
import type { GroupMetadata, GroupTranslator } from './translator.js';
import type { RunnerPauseOutcome } from './pause.js';
import type { RunnerInvocation } from './runnerExecution.js';
import type { RunRedaction } from '../redaction/runRedaction.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { contextRecordedRecorder } from '../recorders/core/ContextRecordedRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { errorBridge } from '../recorders/core/ErrorBridge.js';
import { costRecorder } from '../recorders/core/CostRecorder.js';
import { evalRecorder } from '../recorders/core/EvalRecorder.js';
import { memoryRecorder } from '../recorders/core/MemoryRecorder.js';
import { skillRecorder } from '../recorders/core/SkillRecorder.js';
import { resilienceRecorder } from '../recorders/core/ResilienceRecorder.js';
import type { LLMProvider, PricingTable } from '../provider-contract/types.js';
import { assertCostBudgetHasPricing, resolveCostBudget, type ResolvedCostBudget } from './cost.js';
import { RunnerBase, type RunnerCoreValues } from './RunnerBase.js';
import { normalizeRunInput } from './runInput.js';
import { thinkingHandlerFor } from '../thinking/thinkingHandlerFor.js';
import type { ThinkingHandler } from '../thinking/types.js';

export class LLMCall extends RunnerBase<LLMCallInput, LLMCallOutput> {
  readonly name: string;
  readonly id: string;
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly systemPromptValue: string;
  private readonly pricingTable?: PricingTable;
  /** Normalized at construction: a bare number is `{ usd, onExceed: 'warn' }`. */
  private readonly costBudget?: ResolvedCostBudget;
  /** Per-slot character budgets (8.11.0). Absent keys keep the slot default. */
  private readonly contextBudget?: LLMCallOptions['contextBudget'];
  /** `LLMCallOptions.recordSystemPrompt` (9.50.0) — opt-in, default OFF. */
  private readonly recordSystemPromptValue: boolean = false;
  /** `LLMCallOptions.recordReceipt` (9.91.0) — opt-OUT, default ON. */
  private readonly recordReceiptValue: boolean = true;
  private readonly structureRecorders?: readonly StructureRecorder[];
  private readonly groupTranslator?: GroupTranslator;
  /** The provider's DECLARED handler, read at construction (same as Agent —
   *  see thinkingHandlerFor). When undefined, sf-thinking is NOT mounted and
   *  the chart has zero thinking overhead (build-time conditional mount). */
  private readonly thinkingHandler?: ThinkingHandler;

  constructor(opts: LLMCallOptions, systemPromptValue: string) {
    super();
    this.provider = opts.provider;
    this.name = opts.name ?? 'LLMCall';
    this.id = opts.id ?? 'llm-call';
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
    this.systemPromptValue = systemPromptValue;
    // A dial without its switch — refused rather than run as a no-op (8.13.0).
    // Same check and same message as Agent: the pair is identical here, and so
    // was the silence.
    assertCostBudgetHasPricing('LLMCall', opts.pricingTable, opts.costBudget);
    if (opts.pricingTable) this.pricingTable = opts.pricingTable;
    // `onExceed: 'halt'` is refused here — one call has no next boundary to
    // stop at, so accepting it would be a stop button wired to nothing.
    const resolvedCostBudget = resolveCostBudget('LLMCall', opts.costBudget);
    if (resolvedCostBudget !== undefined) this.costBudget = resolvedCostBudget;
    if (opts.contextBudget !== undefined) this.contextBudget = opts.contextBudget;
    if (opts.recordSystemPrompt === true) this.recordSystemPromptValue = true;
    if (opts.recordReceipt === false) this.recordReceiptValue = false;
    if (opts.structureRecorders) this.structureRecorders = opts.structureRecorders;
    if (opts.groupTranslator) this.groupTranslator = opts.groupTranslator;
    // The ThinkingHandler the provider DECLARES — the same resolution Agent
    // uses (`thinkingHandlerFor`). A provider that declares none leaves the
    // field undefined and sf-thinking is not mounted.
    const declared = thinkingHandlerFor(opts.provider);
    if (declared) this.thinkingHandler = declared;
    // Eager chart construction (footprintjs inventor convention): build
    // once at constructor time so `buildTimeStructure` is a stable
    // immutable object reference, each `StructureRecorder` fires
    // exactly N times (N = node count) per LLMCall, and reference-equality memos
    // on `getSpec()` work. Subsequent `getSpec()` calls return the
    // cached chart; each `run()` reuses it in a fresh executor.
    this.initChart(() => this.buildChart() as FlowChart, {
      runnerId: this.id,
      compositionPath: [`LLMCall:${this.id}`],
      initialize: () => ({}),
    });
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
    input: LLMCallInput | string,
    options?: RunOptions,
  ): Promise<LLMCallOutput | RunnerPauseOutcome> {
    return this.runExecution().withRun(async (invocation) => {
      requestOf(options, 'LLMCall.run');
      const runInput = normalizeRunInput<LLMCallInput>(input, 'LLMCall.run');
      const prepared = this.createRunSetup(invocation);
      const result = await invocation.execute(
        {
          kind: 'run',
          options: { ...options, input: { message: runInput.message } },
        },
        prepared.setup,
        { bindScope: prepared.bindScope },
      );
      return this.finalizeResult(invocation, result);
    });
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<LLMCallOutput | RunnerPauseOutcome> {
    this.noteResumeTakenUp(checkpoint);
    return this.runExecution().withRun(async (invocation) => {
      requestOf(options, 'LLMCall.resume');
      const resumeLeg = this.emitPauseResume(checkpoint, input);
      const prepared = this.createRunSetup(invocation, resumeLeg);
      const result = await invocation.execute(
        { kind: 'resume', mode: 'fresh', checkpoint, input, options },
        prepared.setup,
        { bindScope: prepared.bindScope },
      );
      return this.finalizeResult(invocation, result);
    });
  }

  private createRunSetup(
    invocation: RunnerInvocation<RunnerCoreValues>,
    resumeLeg?: RedactionPolicy,
  ): {
    readonly setup: RunSetup;
    readonly bindScope: RunRedaction['bindScope'];
  } {
    const getRunCtx = () => invocation.context();
    const redaction = this.prepareRunRedaction(invocation, resumeLeg);
    const dispatcher = this.getDispatcher();
    const recorders: CombinedRecorder[] = [
      ...redaction.recorders,
      contextRecordedRecorder({ dispatcher, getRunContext: getRunCtx }),
      new ContextRecorder({ dispatcher, getRunContext: getRunCtx, realWrites: redaction }),
      streamRecorder({ dispatcher, getRunContext: getRunCtx }),
      errorBridge({ dispatcher, getRunContext: getRunCtx }),
    ];
    if (this.pricingTable) recorders.push(costRecorder({ dispatcher, getRunContext: getRunCtx }));
    recorders.push(
      evalRecorder({ dispatcher, getRunContext: getRunCtx }),
      memoryRecorder({ dispatcher, getRunContext: getRunCtx }),
      skillRecorder({ dispatcher, getRunContext: getRunCtx }),
      resilienceRecorder({ dispatcher, getRunContext: getRunCtx }),
      ...this.attachedRecorders,
    );
    return {
      setup: {
        redaction: redaction.policy,
        attachments: recorders.map((recorder) => ({ recorder })),
        onOrigin: () => this.bindRunServing(invocation),
      },
      bindScope: redaction.bindScope,
    };
  }

  private finalizeResult(
    invocation: RunnerInvocation<RunnerCoreValues>,
    result: unknown,
  ): LLMCallOutput | RunnerPauseOutcome {
    const paused = this.detectPause(invocation, result);
    if (paused) return paused;
    if (result instanceof Error) throw result;
    const verdict = interventionVerdictOf(
      (invocation.view.snapshot()?.sharedState ?? {}) as Readonly<Record<string, unknown>>,
    );
    if (verdict !== undefined) throw terminalErrorOf(verdict);
    // Client stage is the chart's last-executed stage (it $break()s
    // on the second visit). It deliberately returns void per the
    // TypedStageFunction contract; the LLM answer flows through
    // `scope.answer` on the outer-chart state. Read it from the
    // snapshot here to bridge to LLMCall.run()'s string return.
    if (typeof result === 'string') return result;
    const snap = invocation.view.snapshot();
    const sharedState = (snap as { sharedState?: { answer?: unknown } } | undefined)?.sharedState;
    const answer = sharedState?.answer;
    if (typeof answer === 'string') return answer;
    throw new Error('LLMCall: unexpected result shape — expected string');
  }

  /** A mount reads the same native terminal record as this runner's own boundary. */
  outcomeOf(output: unknown): ChildOutcome {
    if (typeof output === 'object' && output !== null) {
      const verdict = interventionVerdictOf(output as Readonly<Record<string, unknown>>);
      if (verdict !== undefined) return { verdict };
    }
    return { answer: output };
  }

  // ─── Internal chart construction ────────────────────────────────

  private buildChart(): FlowChart {
    return buildCallChart({
      provider: this.provider,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      systemPromptValue: this.systemPromptValue,
      pricingTable: this.pricingTable,
      costBudget: this.costBudget,
      thinkingHandler: this.thinkingHandler,
      recordReceiptValue: this.recordReceiptValue,
      contextBudget: this.contextBudget,
      recordSystemPromptValue: this.recordSystemPromptValue,
      structureRecorders: this.structureRecorders,
      runIdOf: (scope) => this.runExecution().forScope(scope).context.runId,
    });
  }
}

// (Helpers previously inlined are now in ./slots/helpers.ts — the slot
// builders import them directly. LLMCall stays thin: Builder + chart
// assembly + internal recorder wiring.)

export type { LLMCallOptions, LLMCallInput, LLMCallOutput } from './LLMCall/types.js';

export { LLMCallBuilder } from './LLMCall/builder.js';
