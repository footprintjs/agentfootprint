import { recordModelContext } from '../recorders/core/recordModelContext.js';
import { LLMCallBuilder } from './LLMCall/builder.js';
import type { LLMCallOptions, LLMCallInput, LLMCallOutput, LLMCallState } from './LLMCall/types.js';
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
  flowChart,
  type FlowChart,
  type FlowchartCheckpoint,
  type StructureRecorder,
  type TypedScope,
} from 'footprintjs';
import type { RunOptions } from './runner.js';
import { requestOf } from './requestOfRun.js';
import type { RedactionPolicy } from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';
import type { GroupMetadata, GroupTranslator } from './translator.js';
import type { RunnerPauseOutcome } from './pause.js';
import { SUBFLOW_IDS, STAGE_IDS, milestoneTagsFor, RECEIPT_KEY } from '../lib/conventions.js';
import { callUnder } from '../lib/abort.js';
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
import { typedEmit } from '../recorders/core/typedEmit.js';
import { resilienceHooks } from '../recorders/core/resilienceHooks.js';
import { resilienceRecorder } from '../recorders/core/ResilienceRecorder.js';
import type { InjectionRecord } from '../recorders/core/types.js';
import type { LLMProvider, LLMRequest, PricingTable } from '../provider-contract/types.js';
import { buildReceipt, receiptPieces } from './agent/receipt/receipt.js';
import {
  assertCostBudgetHasPricing,
  emitCostTick,
  resolveCostBudget,
  type ResolvedCostBudget,
} from './cost.js';
import { RunnerBase, type RunnerCoreValues } from './RunnerBase.js';
import { normalizeRunInput } from './runInput.js';
import { buildSystemPromptSlot } from './slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from './slots/buildMessagesSlot.js';
import { buildThinkingSubflow } from './slots/buildThinkingSubflow.js';
import { thinkingHandlerFor } from '../thinking/thinkingHandlerFor.js';
import type { ThinkingHandler } from '../thinking/types.js';
import {
  joinSystemPrompt,
  messagesFromInjections,
  stripFrameworkFields,
} from './agent/composeRequest.js';

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
    const recordReceipt = this.recordReceiptValue;
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
    const client = (scope: TypedScope<LLMCallState>): string | undefined => {
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
    // Per-slot budgets (8.11.0) — forwarded only where the consumer set one,
    // so an unset slot keeps its own default.
    const budget = this.contextBudget;
    const recordSystemPrompt = this.recordSystemPromptValue;
    const systemPromptSubflow = buildSystemPromptSlot({
      prompt: systemPromptValue,
      reason: 'LLMCall.system()',
      ...(budget?.systemPrompt !== undefined && { budgetCap: budget.systemPrompt }),
    });
    const messagesSubflow = buildMessagesSlot({
      ...(budget?.messages !== undefined && { budgetCap: budget.messages }),
    });

    const callLLM = async (scope: TypedScope<LLMCallState>) => {
      const systemPromptInjections = (scope.systemPromptInjections ??
        []) as readonly InjectionRecord[];
      const messagesInjections = (scope.messagesInjections ?? []) as readonly InjectionRecord[];
      const iteration = (scope.iteration as number | undefined) ?? 1;

      const systemPrompt = joinSystemPrompt(systemPromptInjections);

      // The messages-slot join (9.88.0). One exported rule, for the same
      // reason the system-prompt join is one: `LLMCall` has no `history`, so
      // these records ARE the committed conversation, and `servedAt` rebuilds
      // it by calling this identical function over the identical records.
      //
      // The framework-field strip rides with it (9.91.0) — the third rule of
      // the one assembly. It is identity on what this slot composes today, and
      // it is here so the two sides cannot drift the day that changes: the
      // rebuild applies it, so the mint applies it.
      const messages = stripFrameworkFields(messagesFromInjections(messagesInjections));

      typedEmit(scope, 'agentfootprint.stream.llm_start', {
        iteration,
        provider: provider.name,
        model,
        systemPromptChars: systemPrompt.length,
        // Opt-in (9.50.0): the assembled prompt VERBATIM, exactly the string
        // handed to the provider below.
        ...(recordSystemPrompt && { systemPromptText: systemPrompt }),
        messagesCount: messages.length,
        toolsCount: 0,
        ...(temperature !== undefined && { temperature }),
      });

      const startMs = Date.now();
      // ONE request object, built once and both sent and fingerprinted —
      // never assembled twice (9.91.0). A second literal at the mint would be
      // a second assembly, and the whole point of a receipt is that it
      // describes THIS one.
      const request: LLMRequest = {
        systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
        messages,
        model,
        ...(temperature !== undefined && { temperature }),
        ...(maxTokens !== undefined && { maxTokens }),
      };

      recordModelContext(scope, () => ({
        iteration,
        systemPieces: systemPromptInjections,
        tools: [],
      }));

      // ── THE RECEIPT (9.91.0) ─────────────────────────────────────────
      // Written immediately before the provider is called, so it is committed
      // in the call-llm bundle that already exists — and before rather than
      // after on purpose: the stage commits on the error path too, so a call
      // that throws still leaves the record of what it was about to send.
      //
      // The mint is `receipt.ts` · `buildReceipt`, the same one the agent's
      // `call-llm` calls, salted with this run's own id. There is no cache
      // strategy on this chart, so the request handed out is the request
      // assembled: `baseRequest` and `preparedRequest` are the same object and
      // `cache.transform` records `'unchanged'` — exactly what an agent
      // running a pass-through strategy records, and true for the same reason.
      // `cache.strategy: null` is the half `transform` cannot say (9.93.0):
      // nothing stood between assembly and the port, so the served view
      // raises no `cache-transform` gap on this chart.
      //
      // NOT HERE: `omittedForAttention`. This chart has no window, so nothing
      // is ever dropped before a call, and the absent key says exactly that.
      if (recordReceipt) {
        scope[RECEIPT_KEY] = buildReceipt({
          runId: this.runExecution().forScope(scope).context.runId,
          epoch: iteration,
          model,
          provider: provider.name,
          systemText: systemPrompt,
          systemPieces: receiptPieces(systemPromptInjections),
          messages,
          requestOnly: [],
          tools: [],
          forced: null,
          withheld: null,
          baseRequest: request,
          preparedRequest: request,
          strategy: null,
        });
      }

      // Raw provider errors propagate untouched (reliability + merge
      // layers classify on the raw message). The friendly translation
      // for non-developers happens once at the terminal boundary —
      // ErrorBridge humanizes the `error.fatal` event the monitor reads.
      //
      // The run's signal (its deadline included) rides the request and bounds
      // the wait, and an answer that lands after it is refused before
      // `llm_end` or the cost tick could count it (lib/abort.ts · callUnder).
      const response = await callUnder(request, scope.$getEnv?.()?.signal, (wired) =>
        provider.complete(
          wired,
          // Resilience-report channel: a decorated provider's fallback /
          // retry / recovery becomes an in-run typed event here.
          resilienceHooks(scope, recordReceipt),
        ),
      );
      const durationMs = Date.now() - startMs;

      typedEmit(scope, 'agentfootprint.stream.llm_end', {
        iteration,
        content: response.content,
        toolCallCount: response.toolCalls.length,
        usage: response.usage,
        stopReason: response.stopReason,
        durationMs,
      });

      emitCostTick(
        scope,
        pricingTable,
        costBudget,
        { provider: provider.name, model },
        response.usage,
      );

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
      // Declared milestones (9.90.0): these slots are `addSubFlowChartNext`
      // mounts, so — unlike the Agent charts' selector branches — they CAN
      // carry the `slot` tag on their first commit bundle.
      .tag(...milestoneTagsFor(SUBFLOW_IDS.SYSTEM_PROMPT))
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
      .tag(...milestoneTagsFor(SUBFLOW_IDS.MESSAGES))
      .addFunction('CallLLM', callLLM, STAGE_IDS.CALL_LLM, 'LLM invocation')
      // Declared milestone (9.90.0): the LLM turn.
      .tag(...milestoneTagsFor(STAGE_IDS.CALL_LLM));

    // Conditional sf-thinking — mounted only when a ThinkingHandler
    // resolved (declared by the provider, read in the constructor). Same
    // build-time conditional pattern Agent uses (buildAgentChart.ts).
    if (thinkingHandler) {
      innerBuilder = innerBuilder.addSubFlowChartNext(
        SUBFLOW_IDS.THINKING,
        buildThinkingSubflow(thinkingHandler, provider.name),
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
    return (
      flowChart<string, TypedScope<LLMCallState>>('Client', client, STAGE_IDS.CLIENT, {
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
        // Declared milestone (9.90.0): the mount is the iteration boundary on the
        // outer log — one turn per LLMCall run.
        .tag(...milestoneTagsFor(SUBFLOW_IDS.LLM_CALL))
        .loopTo(STAGE_IDS.CLIENT)
        .build()
    );
  }
}

// (Helpers previously inlined are now in ./slots/helpers.ts — the slot
// builders import them directly. LLMCall stays thin: Builder + chart
// assembly + internal recorder wiring.)

export type { LLMCallOptions, LLMCallInput, LLMCallOutput } from './LLMCall/types.js';

export { LLMCallBuilder } from './LLMCall/builder.js';
