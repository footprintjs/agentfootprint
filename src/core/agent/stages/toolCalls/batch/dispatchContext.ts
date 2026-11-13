import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ContextRole } from '../../../../../events/types.js';
import { assistantReplayFields } from '../../../assistantReplay.js';
import { frozenTurnOf } from '../access/bindings.js';
import { isSealed } from '../../../../../lib/frozenCopy.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { ToolResultStatus } from '../../../../../semantics/toolEffects.js';
import { towersFor } from '../evidence/towers.js';
import type { TimeLineage } from '../../route.js';
import type { TransitionBatchState } from '../contracts/callFacts.js';
import type { DispatchCall } from '../contracts/batchCall.js';

/** Compose the existing synchronous dispatchContext phase; no additional await or checkpoint state. */
export function buildDispatchContext(
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'allowedSkillIds'
    | 'engagementPlan'
    | 'resultsLayer'
    | 'findings'
    | 'evidenceGate'
    | 'evidenceExempt'
  >,
) {
  const prepareDispatchContext = (
    scope: TypedScope<AgentState>,
    toolCalls: readonly DispatchCall[],
    iteration: number,
    timeLineage?: TimeLineage,
  ) => {
    const newHistory: LLMMessage[] = [...(scope.history as readonly LLMMessage[])];
    // ALWAYS push the assistant turn when there are tool calls — even
    // if the content was empty — so providers (Anthropic, OpenAI) can
    // round-trip the tool_use blocks via `LLMMessage.toolCalls`.
    // Without this, the next iteration's request lacks the assistant
    // turn that initiated the tool call, and the API rejects the
    // following tool_result with "preceding tool_use missing".
    if (scope.llmLatestContent || toolCalls.length > 0) {
      // v2.14 — attach thinking blocks (if any). Required for
      // Anthropic signature round-trip: the next request MUST echo
      // back the signed blocks BYTE-EXACT or Anthropic returns 400.
      // Empty array (no thinking) → field omitted from message.
      const thinkingBlocks = (scope as { thinkingBlocks?: readonly unknown[] }).thinkingBlocks;
      const hasThinking = thinkingBlocks !== undefined && thinkingBlocks.length > 0;
      newHistory.push({
        role: 'assistant' as ContextRole,
        content: scope.llmLatestContent ?? '',
        ...(toolCalls.length > 0 && { toolCalls }),
        // Spread = materialize the proxy view (see toolCalls above).
        ...(hasThinking && { thinkingBlocks: [...thinkingBlocks] as never }),
        ...assistantReplayFields(scope),
      });
    }
    // ── ONE FROZEN COPY OF THE BATCH, for every pre-execute callback ──
    // The assistant turn just pushed holds every call's arguments — the
    // objects the calls run with. A callback that reads the history (the
    // permission checker, middleware, a check-in predicate, the evidence
    // assembler) gets it with this turn as a frozen copy, and each call's
    // `tool_start`, checker and predicate share that copy's arguments: one
    // copy of the batch, and nothing a callback holds reaches what runs.
    // Earlier turns are handed as they are: their calls already ran, and
    // deep-copying the whole conversation for every call would cost
    // O(conversation) per call.
    const turnAt = newHistory.length - 1;
    const pushedTurn = toolCalls.length > 0 ? newHistory[turnAt] : undefined;
    const frozenTurn = pushedTurn === undefined ? undefined : frozenTurnOf(pushedTurn);
    /**
     * The history a pre-execute callback is handed — the batch's turn frozen.
     * The one copy is shared only when freezing SEALED it (`isSealed`: every
     * JSON turn); a turn holding a container freezing leaves writable (a
     * `Map`, a `Date`, a typed array an app's provider put in a call) is
     * copied again for each callback, so none can change what the next sees.
     */
    const callbackHistory = (): LLMMessage[] => {
      if (pushedTurn === undefined || frozenTurn === undefined) return [...newHistory];
      const turn = isSealed(frozenTurn) ? frozenTurn : frozenTurnOf(pushedTurn);
      return newHistory.map((message, at) => (at === turnAt ? turn : message));
    };
    /** The batch's sealed copy of call `at`'s arguments, when there is one to share. */
    const frozenArgsAt = (at: number): ToolArgs | undefined => {
      const shared = frozenTurn?.toolCalls?.[at]?.args as ToolArgs | undefined;
      return isSealed(shared) ? shared : undefined;
    };
    // `lookupTool` is hoisted to the handler closure (shared with resume).

    // ── The model's `read_skill` pick: one-shot by construction ──────
    // Cleared at the TOP of every iteration that dispatches tools, and set
    // below only when the gate ACCEPTS a pick. Since the only way back into
    // the ReAct loop is through this handler, a pick can never survive into a
    // later iteration and drag the cursor backwards after a declared edge has
    // moved it. Written only for skill-graph agents (the gate is what makes a
    // pick "validated"); a plain read_skill agent never sees this key.
    if (deps.allowedSkillIds) scope.pendingSkillPick = undefined;

    // ── The pass's ACCEPTED picks (9.59.0) — per-pass by construction ──
    // Same one-shot discipline as `pendingSkillPick` one line up, and for
    // the same reason: the mount kernel's renewal feed must see evidence
    // from THIS pass. It used to read `activatedInjectionIds`, which is
    // cleared only at run start, so one accepted pick anywhere kept the
    // kernel disarmed for the whole turn. Every accepted pick lands here —
    // hops, open skills and re-engagements alike — while
    // `pendingSkillPick` keeps its exact meaning (the last accepted HOP,
    // the cursor's input). Written only for agents with the kernel mounted.
    if (deps.engagementPlan) scope.acceptedSkillPicks = [];

    // ── The iteration's tool-result batch, in call order (9.16.0) ────
    // Reset here, appended beside every `lastToolResult` write — each entry
    // stamped as its result lands, so a pause mid-batch commits exactly the
    // results that really happened (the resume paths APPEND the answered
    // call to this same array). `lastToolResult` stays the last entry;
    // `on-tool-return` triggers and skill-graph routes read the batch.
    const batchResults: {
      toolName: string;
      result: string;
      toolCallId: string;
      status?: ToolResultStatus;
    }[] = [];
    // Findings standings were preserved in the admission preflight, before
    // the batch ask could pause. Their identity came from this response's
    // immutable request witness, not this resetting result list. Absence
    // interpretation still uses the existing known-results/coverage reader.
    scope.toolResults = [];
    // The results layer (honesty layer 3) judges each batch ONCE, at the
    // first loop-head visit after it ran — told apart from a re-entry by
    // the iteration that dispatched it, never by call id (a provider may
    // reuse one). Written beside the batch, under the arm only.
    if (deps.resultsLayer === true) scope.toolResultsIteration = iteration;
    // ── THE TOWERS AT DISPATCH (9.110.0) — one corpus per batch ────────
    // Built AFTER the standings above are on the record (a standing the
    // model declared on THIS batch's calls counts for this batch's
    // arguments) and only when the fold holds a set-aside standing at
    // all. The history is the list this call was served — the same one
    // `knownResults` read one screen up — and the exempt set comes from the
    // route decider's own builder and arm (`turnExempt.ts` · `exemptForTurn`), so
    // a value the person or the app supplied is never a tower at either moment.
    const towers = towersFor(
      scope,
      deps.findings,
      deps.evidenceGate,
      deps.evidenceExempt,
      timeLineage,
    );

    // ── The batch's transition bookkeeping (9.19.0) ───────────────────
    // First ACCEPTED `propose-transition` wins (committed at acceptance);
    // later ones to other targets are suppressed + aggregated at batch end.
    const transitionState: TransitionBatchState = { losers: [] };

    // Capture run identity from scope for the enriched permission ctx.
    // Same value the Tools slot passes to ToolProvider.list(ctx) so the
    // checker sees consistent identity across both gates.
    const runIdentity = scope.runIdentity as
      | { tenant?: string; principal?: string; conversationId: string }
      | undefined;
    const env = scope.$getEnv();
    return {
      newHistory,
      frozenTurn,
      callbackHistory,
      frozenArgsAt,
      batchResults,
      towers,
      transitionState,
      runIdentity,
      env,
    };
  };
  return { prepareDispatchContext };
}
