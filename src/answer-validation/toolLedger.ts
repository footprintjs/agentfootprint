/**
 * The run's tool calls, as a bounded read-only parcel for an authored check.
 *
 * Names, call ids and outcomes only. Arguments and results never enter it:
 * both are redaction-sensitive, and a rule about WHICH tools ran needs
 * neither. The ledger is tracked state of the run that owns the check, so it
 * cannot hold another run's calls; it is written only on an agent with
 * `answerValidation`, so every other agent commits the keys it always did.
 */
import type { AnswerToolCall, AnswerToolCallsView } from './types.js';

/** Longest tool name or call id listed. A model can send any name and a
 *  provider any id; a longer one is left out and the view marked incomplete. */
export const MAX_TOOL_CALL_TEXT = 256;

const fits = (text: unknown): text is string =>
  typeof text === 'string' && text.length > 0 && text.length <= MAX_TOOL_CALL_TEXT;

/**
 * The ledger as the run's state holds it: the view's fields plus the ids of
 * calls whose `stream.tool_start` bracket opened and whose `tool_end` has not
 * yet closed. A call still open at the check makes the view incomplete.
 */
export interface ToolCallLedger extends AnswerToolCallsView {
  readonly inFlight?: readonly string[];
}

/** A ledger that may have missed calls: what ran before this run observed it. */
export function incompleteToolCalls(): ToolCallLedger {
  return { calls: [], complete: false };
}

// Seed starts a ledger on every run that keeps one, so a missing one at a
// landing means a run resumed from a checkpoint written before ledgers
// existed: what it did before the pause was not observed.
const orIncomplete = (prior: ToolCallLedger | undefined): ToolCallLedger =>
  prior ?? incompleteToolCalls();

const withInFlight = (
  ledger: ToolCallLedger,
  inFlight: readonly string[],
  complete: boolean,
): ToolCallLedger => ({
  calls: [...ledger.calls],
  complete,
  ...(inFlight.length > 0 && { inFlight: [...inFlight] }),
});

/**
 * The ledger after a call's `tool_start` bracket: the call is open until its
 * `tool_end` lands. Past `max` open calls, or for an oversized id, the ledger
 * cannot track it and says it is incomplete instead.
 */
export function startToolCall(
  prior: ToolCallLedger | undefined,
  callId: string,
  max: number,
): ToolCallLedger {
  const ledger = orIncomplete(prior);
  const inFlight = ledger.inFlight ?? [];
  if (inFlight.length >= max || !fits(callId)) {
    return ledger.complete ? withInFlight(ledger, inFlight, false) : ledger;
  }
  return withInFlight(ledger, [...inFlight, callId], ledger.complete);
}

/**
 * The ledger after one call's `tool_end` bracket: the call is closed and
 * listed. Past `max` calls (or for an oversized name or id) nothing more is
 * listed and the ledger says it is incomplete, so a rule that counts can tell
 * "none ran" from "not listed". A call whose own work has not settled (a tool
 * that declared `pending`) makes it incomplete too. Returns `prior` itself
 * when nothing changes, so the caller can skip the write.
 */
export function appendToolCall(
  prior: ToolCallLedger | undefined,
  call: AnswerToolCall,
  max: number,
  settled = true,
): ToolCallLedger {
  const ledger = orIncomplete(prior);
  const open = ledger.inFlight ?? [];
  const at = open.indexOf(call.callId);
  const inFlight = at === -1 ? open : [...open.slice(0, at), ...open.slice(at + 1)];
  const complete = ledger.complete && settled;
  if (ledger.calls.length >= max || !fits(call.name) || !fits(call.callId)) {
    if (at === -1 && !ledger.complete) return ledger;
    return withInFlight(ledger, inFlight, false);
  }
  return {
    ...withInFlight(ledger, inFlight, complete),
    calls: [...ledger.calls, { name: call.name, callId: call.callId, outcome: call.outcome }],
  };
}

/**
 * The ledger as one check sees it, read at the moment of the check: incomplete
 * when there is none, when a call is still open, or when the model's last
 * reply asked for calls that never went out (`undispatched` — the check runs
 * on the terminal branch, so a call on that reply was never dispatched: a run
 * cut off by its iteration or cost budget with calls still pending).
 */
export function ledgerAtCheck(
  ledger: ToolCallLedger | undefined,
  undispatched: number,
): AnswerToolCallsView {
  if (ledger === undefined) return incompleteToolCalls();
  const calls = Array.isArray(ledger.calls) ? ledger.calls : [];
  const open = Array.isArray(ledger.inFlight) ? ledger.inFlight.length : 0;
  return { calls, complete: ledger.complete === true && open === 0 && undispatched === 0 };
}

/**
 * The parcel one validation receives: detached from the run's state and frozen
 * at every level, so a check can neither edit the ledger nor reach live state
 * through it. Anything that is not the declared shape is dropped, never passed on.
 */
export function toolCallsView(
  ledger: AnswerToolCallsView | undefined,
  max: number,
): AnswerToolCallsView {
  // No ledger is not "nothing ran": a checkpoint written before the run kept
  // one, or a caller that passed none. Fail closed — say the list is partial.
  if (ledger === undefined) return Object.freeze({ calls: Object.freeze([]), complete: false });
  const source = Array.isArray(ledger.calls) ? ledger.calls : [];
  const calls: AnswerToolCall[] = [];
  let complete = ledger.complete === true && source.length <= max;
  for (const raw of source.slice(0, max)) {
    const name = raw?.name;
    const callId = raw?.callId;
    const outcome = raw?.outcome;
    if (
      !fits(name) ||
      !fits(callId) ||
      (outcome !== 'ok' && outcome !== 'error' && outcome !== 'not-run')
    ) {
      complete = false;
      continue;
    }
    calls.push(Object.freeze({ name, callId, outcome }));
  }
  return Object.freeze({ calls: Object.freeze(calls), complete });
}

/** A tool's own declared status that says it did not succeed. */
const FAILED_STATUS: ReadonlySet<string> = new Set(['failure', 'denied', 'invalid']);

/**
 * The outcome of one `stream.tool_end` bracket, in the view's words. `ran` is
 * whether the tool's own code ran: a call that did not run and carries no
 * `error` (a person declined it, a rule refused it, a paused batch settled it)
 * is `not-run`, never `ok`. A tool that ran but declared `failure`, `denied` or
 * `invalid` (a refused oversize result among them) is `error`.
 */
export function toolOutcomeOf(
  bracket: {
    readonly error?: boolean;
    readonly notExecuted?: boolean;
    readonly notDispatched?: unknown;
    readonly status?: string;
  },
  ran: boolean,
): AnswerToolCall['outcome'] {
  if (bracket.error === true) return 'error';
  if (bracket.notDispatched !== undefined || bracket.notExecuted === true || !ran) return 'not-run';
  return bracket.status !== undefined && FAILED_STATUS.has(bracket.status) ? 'error' : 'ok';
}
