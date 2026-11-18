import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { AgentfootprintEventMap } from '../../../../../events/registry.js';
import { frozenView, frozenProjectionOf } from '../../../../../lib/frozenCopy.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import {
  startToolCall,
  toolOutcomeOf,
  appendToolCall,
} from '../../../../../answer-validation/toolLedger.js';
import { settleNegativeCall, captureNegativeRefusal } from '../../../negativeClaims/capture.js';
import { withEntered } from '../../../../../semantics/toolRan.js';
import type { ToolObservationsOperations } from '../contracts/operations/observations.js';

/** Compose the existing observations callbacks once for this handler. */
export function buildToolObservationsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'toolCallLedger' | 'negativeClaimsArmed'>,
): ToolObservationsOperations {
  /** `emitToolEnd`'s twin: the call is open in the ledger until its `tool_end` lands. */
  const emitToolStart = (
    scope: TypedScope<AgentState>,
    payload: AgentfootprintEventMap['agentfootprint.stream.tool_start']['payload'],
  ): void => {
    // A listener sees the call's frozen copy — the dispatch loop's shared one
    // when it hands that over — never the arguments the tool runs with: one
    // that set `amount = 9000` used to refund 9000. Arguments no copy can be
    // made of are carried as a frozen, detached projection — what JSON writes
    // of them — never as their live objects.
    const args = frozenView(payload.args) ?? frozenProjectionOf(payload.args);
    typedEmit(scope, 'agentfootprint.stream.tool_start', { ...payload, args });
    const ledger = deps.toolCallLedger;
    if (ledger === undefined) return;
    const prior = scope.toolCallLedger;
    const next = startToolCall(prior, payload.toolCallId, ledger.maxCalls);
    if (next !== prior) scope.toolCallLedger = next;
  };

  /**
   * THE one door for a `stream.tool_end` bracket in this handler. Every
   * dispatch path here closes a call through it, so the run's tool-call ledger (when `answerValidation` keeps
   * one) lists exactly the brackets the stream reported — never arguments,
   * never results. `ran` is whether the tool's own code ran — every path
   * already knows it (the batch's `execution.executed`, each resume's own
   * flag). It is written onto the bracket here, once, as `entered`
   * (`semantics/toolRan.ts` · `withEntered`), and everything below reads the
   * stamped bracket, so the record, the ledger and the negative-claims row
   * cannot disagree. Example: an unknown tool name reaches here with
   * `{ error: true }` and `ran: false`, leaves as `{ error: true, entered:
   * false }`, and is listed `not-run`, never `error`.
   */
  const emitToolEnd = (
    scope: TypedScope<AgentState>,
    toolName: string,
    given: AgentfootprintEventMap['agentfootprint.stream.tool_end']['payload'],
    ran: boolean,
    declaredStatus: string | undefined = given.status,
    negativeResultId?: string,
    refusalArgs?: Readonly<Record<string, unknown>>,
  ): void => {
    const payload = withEntered(given, ran);
    if (deps.negativeClaimsArmed === true) {
      settleNegativeCall(scope, negativeResultId, toolOutcomeOf(payload));
      if (
        !ran ||
        payload.error ||
        ['invalid', 'denied', 'failure'].includes(declaredStatus ?? '')
      ) {
        captureNegativeRefusal(scope, toolName, payload.result, refusalArgs);
        if (payload.modelResult !== undefined)
          captureNegativeRefusal(scope, toolName, payload.modelResult, refusalArgs);
      }
    }
    typedEmit(scope, 'agentfootprint.stream.tool_end', payload);
    const ledger = deps.toolCallLedger;
    if (ledger === undefined) return;
    const prior = scope.toolCallLedger;
    const next = appendToolCall(
      prior,
      { name: toolName, callId: payload.toolCallId, outcome: toolOutcomeOf(payload) },
      ledger.maxCalls,
      // A tool that declared `pending` returned before its own work settled —
      // read off what the TOOL declared, before a ceiling or contract refusal
      // rewrote the bracket's status.
      declaredStatus !== 'pending' && payload.status !== 'pending',
    );
    if (next !== prior) scope.toolCallLedger = next;
  };

  return { emitToolStart, emitToolEnd };
}
