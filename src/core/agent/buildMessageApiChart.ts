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
 * agent's `callLLM` builds invisibly today (callLLM.ts:132) — `systemPrompt`
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
import type { LLMMessage, LLMProvider } from '../../adapters/types.js';
import { SUBFLOW_IDS } from '../../conventions.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { typedEmit } from '../../recorders/core/typedEmit.js';
import { buildSystemPromptSlot } from '../slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from '../slots/buildMessagesSlot.js';

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
}

export interface MessageApiChartDeps {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly systemPrompt: string;
  readonly structureRecorders?: readonly import('footprintjs').StructureRecorder[];
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
    scope.assembledSystem = sysInjections
      .map((r) => r.rawContent ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n');
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
    const messages = (scope.assembledMessages ?? []) as readonly LLMMessage[];
    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration: scope.iteration,
      provider: provider.name,
      model,
      systemPromptChars: system.length,
      messagesCount: messages.length,
      toolsCount: 0,
    });
    const startMs = Date.now();
    const response = await provider.complete({
      ...(system.length > 0 && { systemPrompt: system }),
      messages,
      model,
    });
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
    .addFunction('CallLLM', callLLM as never, 'call-llm', 'Send the assembled request to the LLM');

  return builder.build();
}
