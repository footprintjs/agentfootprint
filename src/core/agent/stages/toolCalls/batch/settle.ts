import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolResultStatus } from '../../../../../semantics/toolEffects.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';

/**
 * Build the pausable tool-call handler for the agent's chart.
 */
/**
 * Append one landed result to the iteration's tool-result batch (9.16.0).
 *
 * The execute path resets `scope.toolResults` before its dispatch loop and
 * appends per call; the four RESUME paths go through here instead — the
 * paused iteration's partial batch (every sibling that ran before the pause)
 * is already committed on scope, and the answered call joins it in call
 * order rather than erasing it. Spread first: a TypedScope array read is a
 * live proxy view, and the batch must stay plain data.
 */
export function appendBatchResult(
  scope: TypedScope<AgentState>,
  entry: { toolName: string; result: string; toolCallId: string; status?: ToolResultStatus },
): void {
  scope.toolResults = [...(scope.toolResults ?? []), entry];
}

// LENS · tool-result · persistent-history
// reads: toolName ← the un-dispatched call on the paused turn (`pausedBatchOf`); paused ← scope.pausedToolName + scope.pausedToolCallId, the checkpoint's own carriers
// law: may omit, never deny; every clause anchored to the call it was composed on; names no destination.
/**
 * What a call the paused batch never dispatched gets back (9.113.0) — ONE
 * fixed sentence, on all four resume paths.
 *
 * Every clause is a past fact about one finished event, anchored by name: the
 * call this result answers ("that call"), the call the run paused on (by id
 * and by tool), and the resume. It names no destination. The design page's draft
 * (`docs/design/2026-09-honest-answer-ledger.md`, § 5.5, "The batch
 * settlement") ended "propose it again if still needed" — an instruction about a LATER call,
 * re-read on every call after this one, the tool-less wrap-up included.
 * Whether the call is still needed is the model's to judge from the facts;
 * the surfaces recomposed per request (the tool list, the system prompt) own
 * the present tense. Precedents: the 9.86.1 resumed-call refusal in this file
 * ("was not executed on that call, and the resumed dispatch had no second
 * checkpoint…") and `../selfCallNotice.ts` · `selfCallNotice`.
 *
 * "The run paused ON call …", never "call … paused the run": on two of the
 * four doors the pause was a gate's, not the call's — a middleware's `ask`, a
 * credential's consent need — and on all four the run paused AT that call.
 *
 * The sentence is for the MODEL. The same fact as data rides the settled
 * message as `LLMMessage.notDispatched` and both of its brackets as
 * `notDispatched` (`notDispatchedMarker`), and a reader asking "did this call
 * run?" reads that — never this text.
 *
 * Exported for the producer registry (`test/modelFacingSurfaces.test.ts`).
 */
export function notDispatchedResult(
  toolName: string,
  paused: { readonly toolName: string; readonly toolCallId: string },
): string {
  return (
    `Tool '${toolName}' was not executed on that call: the run paused on call ` +
    `'${paused.toolCallId}' to '${paused.toolName}', earlier in the same batch, and resumed ` +
    `without executing the calls that followed it in that batch.`
  );
}

/**
 * The same fact as DATA (9.113.0) — the ONE composer of the settlement's
 * marker, `{ pausedCall: { toolCallId, toolName } }`. The settled call's
 * history message (`LLMMessage.notDispatched`) and both of its brackets
 * (`ToolStartPayload.notDispatched`, `ToolEndPayload.notDispatched`) each take
 * a fresh copy from here, so the three carriers can never disagree and no
 * reader holds an object another reader holds.
 */
export function notDispatchedMarker(paused: {
  readonly toolName: string;
  readonly toolCallId: string;
}): NonNullable<LLMMessage['notDispatched']> {
  return { pausedCall: { toolCallId: paused.toolCallId, toolName: paused.toolName } };
}
