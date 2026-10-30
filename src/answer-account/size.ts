/**
 * The account's size — README law 8 in its OWN unit, and its one authority.
 *
 * The contract is in serialized bytes: the account at most `ACCOUNT_BYTES`,
 * the op's body (`{ account, shown }`) at most `BODY_BYTES` — the UTF-8 bytes
 * of the JSON a reader is sent, escaping included (`lib/boundedJson.ts` ·
 * `jsonBytes`). A cut in characters per field cannot add up to that: JSON
 * writes a control character or a lone surrogate as six bytes, UTF-8 a BMP
 * character as up to three, a sentence carries each value three times
 * (`text`, `parts`, `vars`), and a pointer repeats its identity on every line
 * that names its event. So the bound is not composed from the fields — it is
 * MEASURED, here, on what the account serializes to.
 *
 * {@link fitAccount} is the last step of every account the reader tells:
 *
 *   - within the bound (every ordinary record) — the same object, unchanged;
 *   - over it — the LISTINGS are fitted, never the judgements: the seven
 *     rows' lines and the three fact lists (`calls`, `beforePause`, `inView`)
 *     share what the rest of the account leaves, each up to an equal share
 *     of what is left (max-min fair, so one long row cannot crowd out the
 *     others), in their own order. What a row cannot list is ONE line that
 *     counts it (`row.sizeBound`); what a fact list cannot is added to its
 *     omitted count (`callsOmitted`, …). Every count, check, chip and status
 *     was taken over everything before this step and is kept as it is;
 *   - when even the rest is over the bound (only a record built to be: every
 *     text at its cut in characters that JSON writes six bytes wide) — the
 *     account says this record is too large to explain within the limit,
 *     and counts it unread. Never a truncated account that looks whole.
 *
 * The per-field cuts (`FACT_TEXT_CHARS`, `MAX_VAR_CHARS`, the item and
 * long-text budgets) keep an ordinary account readable; this keeps every
 * account within its bound.
 */

import { jsonBytes } from '../lib/boundedJson.js';
import { n, sentence } from './render.js';
import type { AnswerAccount, AnswerFacts, Sentence } from './types.js';

/** The account, serialized: at most this many UTF-8 bytes (README law 8). */
export const ACCOUNT_BYTES = 128 * 1024;

/** The op's body, `{ account, shown }` (`hosting/artifactWire.ts` · `AnswerAccountWireBody`), serialized. */
export const BODY_BYTES = 192 * 1024;

/** What the body's own frame takes around its two values: `{"account":…,"shown":…}`. */
const BODY_FRAME_BYTES = jsonBytes({ account: 0, shown: 0 }) - 2;

/** The show-me map's share of the body: what the account and the frame leave (`shown.ts`). */
export const SHOWN_BYTES = BODY_BYTES - ACCOUNT_BYTES - BODY_FRAME_BYTES;

/**
 * An identity a pointer copies from the record — an event's `runtimeStageId`,
 * a history message's `toolCallId` — at most this many serialized bytes
 * (`facts/common.ts` · `boundedPointer`). It rides every pointer into its
 * event, so it is bounded in the contract's unit where it is copied.
 */
export const POINTER_ID_BYTES = 200;

/** The fact lists the account fits, each with the count that says what it did not list. */
const FACT_LISTS = [
  ['calls', 'callsOmitted'],
  ['beforePause', 'beforePauseOmitted'],
  ['inView', 'inViewOmitted'],
] as const;

/** The one line that says how many lines a row could not list within the bound. */
function sizeFold(count: number): Sentence {
  return sentence('row.sizeBound', { vars: { n: n(count) }, status: 'not-applicable' });
}

/**
 * Max-min fair shares of `available` among `needs`: in order of need, each
 * gets all it needs up to an equal share of what is left; what one does not
 * need is shared by the rest. Deterministic.
 */
export function fairShares(needs: readonly number[], available: number): number[] {
  const out = needs.map(() => 0);
  const order = needs
    .map((need, index) => ({ need, index }))
    .sort((a, b) => a.need - b.need || a.index - b.index);
  let left = Math.max(0, available);
  order.forEach(({ need, index }, rank) => {
    const share = Math.min(need, Math.floor(left / (order.length - rank)));
    out[index] = share;
    left -= share;
  });
  return out;
}

/** How many leading items of `sizes` fit in `allowance`. */
function leading(sizes: readonly number[], allowance: number): number {
  let used = 0;
  let k = 0;
  for (const size of sizes) {
    if (used + size > allowance) break;
    used += size;
    k++;
  }
  return k;
}

const total = (sizes: readonly number[]): number => sizes.reduce((a, b) => a + b, 0);

/**
 * `account` within {@link ACCOUNT_BYTES} — itself when it is (every ordinary
 * record), else its listings fitted as the module doc says; `tooLarge()` when
 * the part that is not a listing is over the bound on its own.
 */
export function fitAccount(account: AnswerAccount, tooLarge: () => AnswerAccount): AnswerAccount {
  if (jsonBytes(account) <= ACCOUNT_BYTES) return account;
  const facts = account.facts;
  const prior = (omitted: (typeof FACT_LISTS)[number][1]): number => facts[omitted] ?? 0;
  // The account with nothing listed: every part that is not a listing, whole.
  const unlisted = { ...facts };
  delete unlisted.callsOmitted;
  delete unlisted.beforePauseOmitted;
  delete unlisted.inViewOmitted;
  const base: AnswerAccount = {
    ...account,
    facts: { ...unlisted, calls: [], beforePause: [], inView: [] },
    rows: account.rows.map((row) => ({ ...row, lines: [] })),
  };
  // Each item costs its bytes and a comma; each listing reserves the most its fold can add.
  const listings = [
    ...account.rows.map((row) => ({
      sizes: row.lines.map((line) => jsonBytes(line) + 1),
      reserve: jsonBytes(sizeFold(row.lines.length)) + 1,
    })),
    ...FACT_LISTS.map(([list, omitted]) => ({
      sizes: facts[list].map((entry) => jsonBytes(entry) + 1),
      reserve: jsonBytes({ [omitted]: prior(omitted) + facts[list].length }) - 2 + 1,
    })),
  ];
  const available =
    ACCOUNT_BYTES - jsonBytes(base) - total(listings.map((listing) => listing.reserve));
  if (available < 0) return tooLarge();
  const shares = fairShares(
    listings.map((listing) => total(listing.sizes)),
    available,
  );
  const kept = listings.map((listing, i) => leading(listing.sizes, shares[i] ?? 0));
  const rows = account.rows.map((row, i) => {
    const k = kept[i] ?? 0;
    return k === row.lines.length
      ? row
      : { ...row, lines: [...row.lines.slice(0, k), sizeFold(row.lines.length - k)] };
  });
  const fitted: Record<string, unknown> = { ...facts };
  FACT_LISTS.forEach(([list, omitted], j) => {
    const entries = facts[list];
    const k = kept[account.rows.length + j] ?? 0;
    fitted[list] = entries.slice(0, k);
    const count = prior(omitted) + entries.length - k;
    if (count > 0) fitted[omitted] = count;
  });
  const result: AnswerAccount = { ...account, rows, facts: fitted as unknown as AnswerFacts };
  // Measured, not assumed: what is handed back is within the bound.
  return jsonBytes(result) <= ACCOUNT_BYTES ? result : tooLarge();
}
