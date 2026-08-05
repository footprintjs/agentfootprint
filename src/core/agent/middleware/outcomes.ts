/**
 * middleware/outcomes — PUBLIC. The three verbs a middleware speaks.
 *
 * Pattern: Smart constructors over a closed union.
 * Role:    core/ layer. `allow` / `deny` / `ask` are the entire vocabulary
 *          of both chains, which is why they are short: they are written
 *          inside every middleware body, several times, and a governance
 *          rule reads better as `deny('writes to prod need a ticket')` than
 *          as a namespaced ceremony.
 * Emits:   N/A.
 *
 * The `allow` overloads carry a rule: you can pass the value through
 * untouched with no explanation, but you cannot CHANGE it without one. A
 * transform is the only thing here that makes the trace and the wire
 * disagree, so it is the only thing required to say why.
 */

import type { AllowOutcome, AskOutcome, AskPayload, DenyOutcome } from './types.js';

/** Pass the value through untouched. */
export function allow(): AllowOutcome<never>;
/**
 * Pass the value through untouched, and say why you were comfortable.
 *
 * The row still reads `changed: false` — nothing moved — but it carries the
 * reason, which is what a rule that remembers an earlier decision needs:
 * "approved by dana@ops at 14:02" belongs in the record of the call it
 * silently permitted, not only in the record of the call that asked.
 */
export function allow(value: undefined, why: string): AllowOutcome<never>;
/**
 * Replace the value and say why.
 *
 * The `why` is mandatory and lands in the ledger next to the before/after
 * pair, so a run that was scrubbed can be read back as a run that was
 * scrubbed rather than as a run whose input was always that way.
 */
export function allow<T>(value: T, why: string): AllowOutcome<T>;
export function allow<T>(value?: T, why?: string): AllowOutcome<T> {
  if (value === undefined) {
    return typeof why === 'string' && why.length > 0 ? { kind: 'allow', why } : { kind: 'allow' };
  }
  if (typeof why !== 'string' || why.length === 0) {
    throw new Error(
      'allow(value, why): a transform must say why. Pass a short reason — it is what the ' +
        'ledger shows next to the before/after pair. To pass the value through unchanged, ' +
        'call allow() with no arguments.',
    );
  }
  return { kind: 'allow', value, why };
}

/**
 * Refuse the call.
 *
 * For a tool the reason reaches the model verbatim, as the tool's result,
 * and the loop continues — the agent gets to adapt. For a message it
 * surfaces as a `MessageDeniedError`.
 *
 * At the after-tool moment it means "the model does not get to read this" — the
 * tool has already run, so the refusal replaces what the model reads while
 * the run keeps the real result in the ledger. Refusing there hides an answer
 * from the model; it cannot un-happen a side effect, and it does not pretend
 * to.
 */
export function deny(reason: string): DenyOutcome {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error(
      'deny(reason): a refusal must carry a reason. For a tool it is the text the model ' +
        'reads and adapts to, so write it for the model, not for a log line.',
    );
  }
  return { kind: 'deny', reason };
}

/**
 * Suspend the run and put the question to a person. Tool dispatch only —
 * `MessageOutcome` has no `ask` arm, so this cannot be returned from a
 * message middleware.
 *
 * The answer is a decision, not a result: approve and the chain continues
 * and the REAL tool runs; decline and it becomes a denial the model reads.
 * A middleware never gets to write the answer itself.
 */
export function ask(payload: AskPayload): AskOutcome {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof payload.question !== 'string' ||
    payload.question.length === 0
  ) {
    throw new Error(
      'ask(payload): expected { question, detail? } with a non-empty question. The question ' +
        'is what a person is shown when the run pauses.',
    );
  }
  return { kind: 'ask', payload };
}
