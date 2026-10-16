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

/** A run's ledger before any call landed — written by seed on every run that keeps one. */
export const EMPTY_TOOL_CALLS: AnswerToolCallsView = Object.freeze({
  calls: Object.freeze([]) as readonly AnswerToolCall[],
  complete: true,
});

/**
 * The ledger after one landing. Past `max` calls (or for an oversized name or
 * id) nothing more is listed and the view says it is incomplete, so a rule
 * that counts can tell "none ran" from "not listed". Returns `prior` itself
 * when nothing changes, so the caller can skip the write.
 */
export function appendToolCall(
  prior: AnswerToolCallsView | undefined,
  call: AnswerToolCall,
  max: number,
): AnswerToolCallsView {
  const ledger = prior ?? EMPTY_TOOL_CALLS;
  if (ledger.calls.length >= max || !fits(call.name) || !fits(call.callId)) {
    return ledger.complete ? { calls: [...ledger.calls], complete: false } : ledger;
  }
  return {
    calls: [...ledger.calls, { name: call.name, callId: call.callId, outcome: call.outcome }],
    complete: ledger.complete,
  };
}

/** A ledger that may have missed earlier calls of the same turn. */
export function incompleteToolCalls(): AnswerToolCallsView {
  return { calls: [], complete: false };
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
