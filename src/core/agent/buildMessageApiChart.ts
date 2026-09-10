/**
 * buildMessageApiChart — PROOF of the locked "messageAPI merge-tree" shape
 * (MENTAL_MODEL.md ★ LOCKED DESIGN), LLM-only (no tools subflow yet).
 *
 * This is Step 1 of the agreed build order: prove the Context-selector →
 * slot subflows → messageAPI stage → Call-LLM tree works + renders, BEFORE
 * bringing it to the Agent (Step 2 adds the tools subflow + the loop).
 *
 * Chart shape (LLM-only):
 *
 *     Seed
 *       → Context (SELECTOR stage — picks which slots to engineer)
 *           ├─ sf-system-prompt ┐   (selected branches run in parallel)
 *           └─ sf-messages ──────┴─→ messageAPI stage   (the join point)
 *       → Call-LLM
 *
 * WHY a selector (not a plain fork): "Context = Selector stage" — it RETURNS
 * the list of slot branch ids to engineer this iteration, and `select()`
 * captures evidence (which slots + why). That is what will unify Static and
 * Dynamic agent in ONE chart later: Static picks only `messages` per loop;
 * Dynamic also picks `system-prompt` (and `tools`) when they re-engineer.
 * The picked-set IS the lit/unlit-pill signal. For this LLM-only proof the
 * selector picks BOTH slots (a one-shot call engineers everything once).
 *
 * WHY messageAPI is a REAL stage: it assembles the LLM request bulk that the
 * agent's `callLLM` builds invisibly today (`buildCallLLMStage`,
 * callLLM.ts · buildCallLLMStage) — `systemPrompt`
 * (separate field) + `messages` (the conversation, incl. tool-results) → the
 * message-API payload. Making it a stage makes that assembly visible +
 * inspectable in Lens/Trace. (Tools is a separate field added at Call-LLM —
 * it joins in Step 2.)
 *
 * Slots are REAL subflows (reused verbatim: buildSystemPromptSlot /
 * buildMessagesSlot) writing the convention INJECTION_KEYS, so ContextRecorder
 * emits context.injected and Lens renders them — no bespoke collapser.
 */

import { flowChartSelector, select } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { LLMMessage, LLMProvider, LLMRequest } from '../../adapters/types.js';
import { RECEIPT_KEY, type Receipt } from '../../lib/time-travel/receipt.js';
import { messageApiReceipt } from './messageApiReceipt.js';
import { SUBFLOW_IDS, STAGE_IDS, milestoneTagsFor } from '../../conventions.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { resilienceHooks } from '../../recorders/core/resilienceHooks.js';
import { buildSystemPromptSlot } from '../slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from '../slots/buildMessagesSlot.js';
import { joinSystemPrompt, stripFrameworkFields } from './composeRequest.js';

/** Minimal scope for the LLM-only proof. */
interface MessageApiState {
  userMessage: string;
  history: readonly LLMMessage[];
  iteration: number;
  /** Written by the sf-system-prompt slot (outputMapper). */
  systemPromptInjections: readonly InjectionRecord[];
  /** Written by the sf-messages slot (outputMapper). */
  messagesInjections: readonly InjectionRecord[];
  /** Written by the messageAPI stage — the assembled request bulk. */
  assembledSystem: string;
  assembledMessages: readonly LLMMessage[];
  /** Written by Call-LLM. */
  answer: string;
  /** Written by Call-LLM when the chart was given a run id — see
   *  {@link MessageApiChartDeps.getRunId}. */
  receipt?: Receipt;
}

export interface MessageApiChartDeps {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly systemPrompt: string;
  readonly structureRecorders?: readonly import('footprintjs').StructureRecorder[];
  /**
   * The id of the run this chart is about to make (9.91.0) — supply it and
   * Call-LLM mints a receipt, the fingerprint of what the model was handed,
   * committed at the call for `receiptAt` and `servedAt` to read.
   *
   * IT IS A DEP BECAUSE THIS IS A CHART BUILDER, NOT A RUNNER. `Agent` and
   * `LLMCall` own their executor and mint a run id per run; this chart is
   * handed to a `FlowChartExecutor` the caller owns, and nothing in a stage's
   * scope carries that executor's run id. So the one value the receipt cannot
   * do without has to come from whoever starts the run.
   *
   * OMIT IT AND NO RECEIPT IS MINTED — deliberately, rather than minting an
   * unsalted one. Every hash on a receipt is salted with the run id precisely
   * so a short system prompt or a two-word turn cannot be fingerprinted across
   * runs (`receipt.ts`, the third law), and a receipt is committed state that
   * travels in recordings. A chart that minted with an empty salt would ship
   * dictionary-attackable fingerprints by default. `servedAt` then declares
   * the absence — `no-receipt-on-chart`, cause `'no-receipt-committed'` — and
   * rebuilds the view as it always did.
   *
   * @example (internal — `buildMessageApiChart` is not on the package's public
   * surface; the type is, so a caller composing this chart inside the library
   * reads the contract here)
   * ```ts
   * const runId = `run-${Date.now()}`;
   * const chart = buildMessageApiChart({ provider, model, systemPrompt, getRunId: () => runId });
   * const executor = new FlowChartExecutor(chart);
   * await executor.run({ input: { message: 'hi' } });
   * receiptAt(executor.getSnapshot(), 1)?.basis.runId; // runId
   * ```
   */
  readonly getRunId?: () => string | undefined;
}

/**
 * Build the LLM-only messageAPI merge-tree chart.
 */
export function buildMessageApiChart(deps: MessageApiChartDeps): FlowChart {
  const { provider, model, systemPrompt } = deps;

  // ── Context: the ROOT SELECTOR. It runs FIRST — initialising the per-call
  // state from the run input (the old "seed" work, now folded in: there is no
  // separate seed stage), then returning which slot branches to engineer.
  //
  // select() collects one `then` PER matching rule, so multi-select = one rule
  // per slot (a single `then` array would be coerced to one bogus id). For a
  // one-shot LLM call both slots match → both branches run. select() captures
  // evidence so a consumer sees WHICH slots were chosen + why (the lit/unlit-
  // pill source that later distinguishes Static vs Dynamic). ──
  const contextSelector = (scope: TypedScope<MessageApiState>) => {
    // Init (formerly the seed stage) — Context is the chart's first node.
    const args = scope.$getArgs<{ message: string }>();
    scope.userMessage = args.message;
    scope.history = [{ role: 'user', content: args.message }];
    scope.iteration = 1;
    scope.systemPromptInjections = [];
    scope.messagesInjections = [];
    scope.assembledSystem = '';
    scope.assembledMessages = [];
    scope.answer = '';

    return select(scope, [
      { when: () => true, then: SUBFLOW_IDS.SYSTEM_PROMPT, label: 'engineer system-prompt' },
      { when: () => true, then: SUBFLOW_IDS.MESSAGES, label: 'engineer messages' },
    ]);
  };

  // ── messageAPI: assemble the request bulk (system + messages). This is
  // the assembly callLLM does invisibly today, surfaced as a real stage. ──
  const messageApiStage = (scope: TypedScope<MessageApiState>): void => {
    const sysInjections = (scope.systemPromptInjections ?? []) as readonly InjectionRecord[];
    scope.assembledSystem = joinSystemPrompt(sysInjections);
    // The conversation (incl. any tool-result messages) IS the message
    // stream — read from history directly (same as the agent's callLLM).
    // Materialise a plain array (history is a reactive proxy ref).
    scope.assembledMessages = [...((scope.history ?? []) as readonly LLMMessage[])];
    typedEmit(scope, 'agentfootprint.context.slot_composed', {
      slot: 'messages',
      iteration: scope.iteration,
      budget: { cap: 0, used: 0, headroomChars: 0 },
      sourceBreakdown: {},
      droppedCount: 0,
      droppedSummaries: [],
    });
  };

  // ── Call-LLM: send the assembled payload, write the answer. ──
  const callLLM = async (scope: TypedScope<MessageApiState>): Promise<void> => {
    const system = scope.assembledSystem;
    const messages = stripFrameworkFields((scope.assembledMessages ?? []) as readonly LLMMessage[]);
    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration: scope.iteration,
      provider: provider.name,
      model,
      systemPromptChars: system.length,
      messagesCount: messages.length,
      toolsCount: 0,
    });
    const startMs = Date.now();
    // ONE request object, sent and fingerprinted — see the receipt below.
    const request: LLMRequest = {
      ...(system.length > 0 && { systemPrompt: system }),
      messages,
      model,
    };
    // ── THE RECEIPT (9.91.0) ───────────────────────────────────────────
    // Minted immediately before the port is called, so it is committed in the
    // call-llm bundle that already exists — and before rather than after on
    // purpose: the stage commits on the error path too, so a call that throws
    // still leaves the record of what it was about to send. No run id ⇒ no
    // receipt; the rule and its reason live in `messageApiReceipt.ts`.
    const receipt = messageApiReceipt({
      runId: deps.getRunId?.(),
      epoch: scope.iteration,
      model,
      provider: provider.name,
      systemText: system,
      systemPieces: (scope.systemPromptInjections ?? []) as readonly InjectionRecord[],
      messages,
      tools: [],
      request,
    });
    if (receipt !== undefined) scope[RECEIPT_KEY] = receipt;
    const response = await provider.complete(
      request,
      // Resilience-report channel — see buildAgentMessageApiChart.
      resilienceHooks(scope),
    );
    scope.answer = response.content;
    typedEmit(scope, 'agentfootprint.stream.llm_end', {
      iteration: scope.iteration,
      content: response.content,
      toolCallCount: response.toolCalls.length,
      usage: response.usage,
      stopReason: response.stopReason,
      durationMs: Date.now() - startMs,
    });
  };

  // ── Build the tree — Context is the ROOT selector (no seed stage). ──
  const builder = flowChartSelector<MessageApiState, MessageApiState>(
    'Context',
    contextSelector as never,
    'context',
    {
      ...(deps.structureRecorders !== undefined && {
        structureRecorders: [...deps.structureRecorders],
      }),
      // 'LLMCall:' taxonomy marker → Lens renders this as an LLM group.
      description: 'LLMCall: messageAPI merge-tree',
    },
  )
    .addSubFlowChartBranch(
      SUBFLOW_IDS.SYSTEM_PROMPT,
      buildSystemPromptSlot({ prompt: systemPrompt, reason: 'messageAPI proof' }),
      'System Prompt',
      {
        tags: milestoneTagsFor(SUBFLOW_IDS.SYSTEM_PROMPT),
        inputMapper: (parent) => ({
          userMessage: (parent as MessageApiState).userMessage,
          iteration: (parent as MessageApiState).iteration,
        }),
        outputMapper: (sf) => ({
          systemPromptInjections: (sf as MessageApiState).systemPromptInjections,
        }),
      },
    )
    .addSubFlowChartBranch(SUBFLOW_IDS.MESSAGES, buildMessagesSlot(), 'Messages', {
      tags: milestoneTagsFor(SUBFLOW_IDS.MESSAGES),
      inputMapper: (parent) => ({
        messages: (parent as MessageApiState).history,
        iteration: (parent as MessageApiState).iteration,
      }),
      outputMapper: (sf) => ({ messagesInjections: (sf as MessageApiState).messagesInjections }),
    })
    .end()
    // Join point — runs after the selected slot branches converge.
    .addFunction(
      'messageAPI',
      messageApiStage as never,
      'message-api',
      'Assemble system + messages into the LLM request',
    )
    .addFunction('CallLLM', callLLM as never, 'call-llm', 'Send the assembled request to the LLM')
    // Declared milestone (9.90.0): the LLM turn (the slot branches above
    // declare theirs in their mount options).
    .tag(...milestoneTagsFor(STAGE_IDS.CALL_LLM));

  return builder.build();
}
