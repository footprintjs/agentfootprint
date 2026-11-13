/**
 * The "Anything wrong" counts of the answer account — ONE tally that
 * `facts.errors` (`answer-account/account.ts`) and the `wrong.errors` line
 * (`answer-account/signals.ts` · `wrongLines`) both read, so the data and the sentence cannot disagree.
 *
 * WHY its own module: since set 16 a call that never reached its tool has its
 * own count ("not executed") and is never "failed"; two hand-written copies
 * of the counts had already drifted once (the line said "0 not run" beside
 * "the call was not executed").
 */

import type { AnswerFacts, CallOutcome } from '../types.js';
import type { CallRead } from './calls.js';

/**
 * The calls counted as "failed" — the one rule both counts read
 * (`facts.errors.failed`, the "Anything wrong" line): a tool that ran and
 * ended in an error, and an error on a record that does not say whether the
 * tool ran ("failed" is true of the call either way). A call that never
 * reached its tool is never one of them: it has its own count,
 * `facts.errors.notExecuted` ("not executed").
 */
export function endedInError(call: CallRead): boolean {
  return call.fact.outcome === 'failed' || call.fact.outcome === 'ended-in-error';
}

/** No call: every count zero (`facts.errors` of an account that read no run). */
export const NO_ERRORS: AnswerFacts['errors'] = Object.freeze(errorCounts([]));

/**
 * The "Anything wrong" counts, over EVERY call (a count is a judgement; only
 * the listing is capped) — `facts.errors` and the `wrong.errors` line read
 * this one tally, so they cannot disagree. Each call lands in at most one of
 * the first five; `withheld` counts calls whose result a rule withheld after
 * the tool ran. Example, an unknown tool name: `{ notExecuted: 1, failed: 0, … }`.
 */
export function errorCounts(calls: readonly CallRead[]): AnswerFacts['errors'] {
  const count = (o: CallOutcome) => calls.filter((c) => c.fact.outcome === o).length;
  return {
    failed: calls.filter(endedInError).length,
    notExecuted: count('not-executed'),
    refused: count('refused'),
    declined: count('declined'),
    notDispatched: count('not-dispatched'),
    withheld: calls.filter((c) => c.fact.withheldBy !== undefined).length,
  };
}
