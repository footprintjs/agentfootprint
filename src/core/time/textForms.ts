/**
 * core/time/textForms — the spellings of the times written in TEXT (time
 * design § 9.5, step T7): the text rule of `forms.ts` · `timeFormsOf`, and
 * the small spelling parts both halves share.
 *
 * Pattern: pure regular expressions over the text — no reading, no resolver.
 * Role:    split from `forms.ts` BY FILE for the synchronous doors: the
 *          evidence gate's exempt corpus (`evidence/evidenceIndex.ts` ·
 *          `addExempt`) runs on every agent with a gate, and a bundler places
 *          a whole file on the synchronous graph — so the window half, which
 *          re-resolves a recorded reading (`resolve.ts`), stays behind
 *          `import()` (the optional-family law,
 *          `test/lib/trace-toolpack/browserGraph.test.ts`). Imports nothing.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * timeFormsOfText('2026-10-09').said; // ['2026', '10', '9']
 * timeFormsOfText('took 2h');         // { said: [], derived: [] }
 * ```
 */

/** The two lineages of the spellings of one source — see the file header. */
export interface TimeForms {
  readonly said: readonly string[];
  readonly derived: readonly string[];
}

// ─── The person's text ─────────────────────────────────────────────────────

/** An ISO calendar date in text — `2026-10-09`, also the date half of `2026-10-09T08:00`. */
const ISO_DATE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d])/g;

/**
 * A 12-hour clock reading in text — `8 Am`, `8:40 AM`, `8pm`, `8:40 p.m.`.
 * Read off the TEXT, not tokens, because the suffix is its own token.
 */
const TWELVE_HOUR = /(?<![\d:.])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m(?![a-z])/gi;

/**
 * The evidence tokenizer's boundary (`evidence/normalize.ts` · `tokenize`),
 * restated for this leaf so a 24-hour reading is recognised as the same
 * whole token the gate compares — pinned equal by `test/core/time/forms.test.ts`.
 */
const NOT_IN_TOKEN = /[^A-Za-z0-9:_\-/.,%+@#$]+/;
const LIST_COMMA = /,(?!\d)|(?<!\d),/;
const LEADING = /^[$#@+'"`([{<]+/;
const TRAILING = /[.,;:!?%'"`)\]}>]+$/;
const TWENTY_FOUR_HOUR = /^(\d{1,2}):(\d{2})$/;

/** The whole tokens of `text` that are a 24-hour clock reading, lower-cased as the gate reads them. */
function clockTokens(text: string): readonly string[] {
  const out: string[] = [];
  for (const rough of text.split(NOT_IN_TOKEN)) {
    for (const piece of rough.split(LIST_COMMA)) {
      const token = piece.toLowerCase().trim().replace(LEADING, '').replace(TRAILING, '');
      if (TWENTY_FOUR_HOUR.test(token)) out.push(token);
    }
  }
  return out;
}

/**
 * The spellings of the times written in `text` — `said` only (the text rule of
 * `forms.ts` · `timeFormsOf`, which delegates here): an ISO date → its year,
 * month and day; a 12-hour or 24-hour clock reading → its spellings. Slash
 * dates and durations are never read.
 *
 * @example
 * ```ts
 * timeFormsOfText('what connected 8 Am to 8:40 AM PST').said;
 * // ['8:00', '08:00', '8:00am', '8:40', '08:40', '8:40am']
 * ```
 */
export function timeFormsOfText(text: string): TimeForms {
  return { said: textForms(text), derived: [] };
}

/** The said spellings of every date and clock time written in `text` (the file header's text rule). */
function textForms(text: string): readonly string[] {
  const out = new Spellings();
  for (const [, year = '', mm, dd] of text.matchAll(ISO_DATE)) {
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    out.push(year, String(month), String(day));
  }
  for (const [, hh, mm, half = ''] of text.matchAll(TWELVE_HOUR)) {
    const hour = Number(hh);
    const minutes = mm ?? '00';
    if (hour < 1 || hour > 12 || Number(minutes) > 59) continue;
    const h24 = (hour % 12) + (half.toLowerCase() === 'p' ? 12 : 0);
    out.push(...clockSpellings(h24, minutes));
  }
  // A reading the 12-hour pass already took is not read again as 24-hour:
  // `8:40 p.m.` is 20:40, never also 08:40.
  for (const token of clockTokens(text.replace(TWELVE_HOUR, ' '))) {
    const [, hh = '', minutes = ''] = TWENTY_FOUR_HOUR.exec(token) ?? [];
    const h24 = Number(hh);
    if (h24 > 23 || Number(minutes) > 59) continue;
    out.push(...clockSpellings(h24, minutes));
  }
  return out.list();
}

/**
 * The spellings of ONE clock time: the 24-hour form bare and padded
 * (`8:00`, `08:00`, `20:00`), the 12-hour colon form (`8:00`) and its glued
 * suffix form (`8:00pm`). After tokenizing, `8:00 PM` and `8:00 AM` both read
 * `8:00` — the same hour on a 12-hour dial.
 */
export function clockSpellings(h24: number, minutes: string): readonly string[] {
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'am' : 'pm';
  return [
    `${h24}:${minutes}`,
    `${pad2(h24)}:${minutes}`,
    `${h12}:${minutes}`,
    `${h12}:${minutes}${suffix}`,
  ];
}

// ─── Small parts ─────────────────────────────────────────────────────────────

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** An insertion-ordered set of spellings. */
export class Spellings {
  private readonly seen = new Set<string>();
  push(...forms: readonly string[]): void {
    for (const form of forms) if (form !== '') this.seen.add(form);
  }
  list(): readonly string[] {
    return [...this.seen];
  }
}
