/**
 * bench/honest-report/harness/endings.mjs — how one run ended, in the vocabulary of RULE.md § 5
 * (`rule-tables.mjs` · `ENDINGS`).
 *
 * Read from typed fields only: what `run()` returned or threw, the stop reason of the last model
 * response, the record's `stoppedEarly` / `costBudgetHit`, and the output-contract event. Never
 * from the answer's words.
 *
 * Order of precedence, when more than one holds: a provider refusal, then a cut-off, then an
 * early stop, then a broken form. A refused answer is excluded whatever else is true of it.
 *
 * Example: `endingOf({ threw: Object.assign(new Error('x'), { status: 529 }) })` → `'service-fault'`.
 */

const SERVICE_STATUSES = (s) => s === 408 || s === 429 || (s >= 500 && s <= 599);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

/** Whether a thrown value (or anything in its `cause` chain) is a service fault. */
export function isServiceFault(err, depth = 0) {
  if (err === null || typeof err !== 'object' || depth > 5) return false;
  const status = Number(err.status ?? err.statusCode ?? err.response?.status);
  if (Number.isFinite(status) && SERVICE_STATUSES(status)) return true;
  if (typeof err.code === 'string' && NETWORK_CODES.has(err.code)) return true;
  return isServiceFault(err.cause, depth + 1);
}

/**
 * @param {object} r
 * @param {unknown} [r.threw]         what `run()` threw, when it threw
 * @param {boolean} [r.paused]        `run()` returned a pause
 * @param {string} [r.lastStopReason] the stop reason of the last model response
 * @param {object} [r.state]          the record's committed state (`snapshot.sharedState`)
 * @param {boolean} [r.formUnmet]     the fixed form's contract was not met
 */
export function endingOf({ threw, paused, lastStopReason, state, formUnmet } = {}) {
  if (threw !== undefined) return isServiceFault(threw) ? 'service-fault' : 'agent-error';
  if (paused) return 'paused';
  if (lastStopReason === 'refusal') return 'provider-refusal';
  if (lastStopReason === 'max_tokens' || lastStopReason === 'length') return 'cut-off';
  if ((state?.stoppedEarly !== undefined && state?.stoppedEarly !== null) || state?.costBudgetHit === true) return 'stopped-early';
  if (formUnmet) return 'form-unparsed';
  return 'answered';
}
