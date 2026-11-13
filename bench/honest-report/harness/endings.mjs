/**
 * bench/honest-report/harness/endings.mjs — how one run ended, in the vocabulary of RULE.md § 5
 * (`rule-tables.mjs` · `ENDINGS`).
 *
 * Read from typed fields only: what `run()` returned or threw, the stop reason of the last model
 * response, the record's `stoppedEarly` / `costBudgetHit`, and the output-contract event. Never
 * from the answer's words.
 *
 * Order of precedence, when more than one holds: a throw, then a text mismatch (the harness's
 * record of the model's text disagrees with the library's, or the delivered text does not start
 * with it: the run cannot be scored, RULE.md § 5), then a pause, a provider refusal, a cut-off,
 * an early stop, a broken form. A refused answer is excluded whatever else is true of it.
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
 * @param {boolean} [r.textMismatch]  the two records of the model's text disagree (`textMismatchOf`)
 */
export function endingOf({ threw, paused, lastStopReason, state, formUnmet, textMismatch } = {}) {
  if (threw !== undefined) return isServiceFault(threw) ? 'service-fault' : 'agent-error';
  if (textMismatch) return 'text-mismatch';
  if (paused) return 'paused';
  if (lastStopReason === 'refusal') return 'provider-refusal';
  if (lastStopReason === 'max_tokens' || lastStopReason === 'length') return 'cut-off';
  if ((state?.stoppedEarly !== undefined && state?.stoppedEarly !== null) || state?.costBudgetHit === true) return 'stopped-early';
  if (formUnmet) return 'form-unparsed';
  return 'answered';
}

/**
 * Why the model's text cannot be trusted for this run (RULE.md § 4–5), or undefined: the
 * harness's own record (`wrapperText`) and the library's events (`eventText`) disagree, or the
 * delivered text does not start with the model's text. No text and an empty text are the same.
 * Example: `textMismatchOf({ wrapperText: 'Done.', eventText: 'Done.', deliveredText: 'Not sure. Done.' })`
 * → `'the delivered text does not start with the model's text'`.
 */
export function textMismatchOf({ wrapperText, eventText, deliveredText }) {
  if ((wrapperText ?? '') !== (eventText ?? '')) return "the harness's record of the model's text and the library's events differ";
  if (typeof deliveredText === 'string' && typeof wrapperText === 'string' && !deliveredText.startsWith(wrapperText)) return "the delivered text does not start with the model's text";
  return undefined;
}

/** The HTTP status a thrown value carries (itself or its `cause` chain), or undefined. */
export function httpStatusOf(err, depth = 0) {
  if (err === null || typeof err !== 'object' || depth > 5) return undefined;
  const status = Number(err.status ?? err.statusCode ?? err.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  return httpStatusOf(err.cause, depth + 1);
}
