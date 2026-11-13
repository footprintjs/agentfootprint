/**
 * plainLine — the ONE rule for "one visible line of plain text" that a
 * person will read in a report.
 *
 * Pattern: One predicate and one cleaner, no imports, no state.
 * Role:    Leaf. The predicate is asked by the three doors that take a short
 *          declared label: `semantics/coverage/items.ts` (a coverage item's
 *          `short`, at the `absent()` / `coverage()` mint AND at the
 *          dispatch reader) and `injection-engine/factories/defineSkill.ts`
 *          (a skill's `title`). The cleaner (`plainLineOf`) is asked by
 *          `semantics/toolEffects.ts` · `unknownStatusOf`, for a status word
 *          a tool wrote that the library tells but does not know. One rule,
 *          so they cannot disagree.
 * Emits:   N/A.
 *
 * ## Why more than CR/LF
 *
 * A report exists to be honest about what a run did, and these labels are
 * printed in it verbatim. "One line" checked as `/[\r\n]/` let through the
 * characters that break a line or a reading WITHOUT being CR or LF:
 *
 *   - other controls (`\p{Cc}`) — VT, FF, NEL (U+0085), TAB;
 *   - line and paragraph separators (`\p{Zl}`, `\p{Zp}`) — U+2028 / U+2029;
 *   - format characters (`\p{Cf}`) — bidi overrides such as U+202E, which
 *     reverse what a reader sees (the "Trojan source" trick), and zero-width
 *     characters, which pad a 5-character label past any length limit while
 *     looking like 5 characters.
 *
 * The rule refuses all four classes, and it runs BEFORE the length is
 * measured, so a length limit is a limit on what a person sees.
 *
 * ## Deliberately strict for v1
 *
 * `\p{Cf}` also refuses marks that legitimate text uses: U+200E / U+200F
 * (LEFT-TO-RIGHT / RIGHT-TO-LEFT MARK, in right-to-left labels) and U+200D
 * (ZERO WIDTH JOINER, in emoji sequences). The report's surfaces are
 * English-only in v1, so nothing honest is lost today. A later locale packet
 * that admits right-to-left labels must allow those three explicitly — and
 * keep refusing the bidi OVERRIDES and isolates (U+202A–U+202E,
 * U+2066–U+2069), which reorder what a reader sees.
 */

/** The character classes a plain one-line label may not contain. */
const NOT_PLAIN = /[\p{Cc}\p{Zl}\p{Zp}\p{Cf}]/u;

/**
 * Why `text` is not one plain visible line, or `undefined` when it is. The
 * sentence names the field (`label`) and the offending code point, so a
 * refusal can be acted on without a hex editor.
 */
export function plainLineProblem(label: string, text: string): string | undefined {
  const found = NOT_PLAIN.exec(text);
  if (found === null) return undefined;
  const code = found[0].codePointAt(0) ?? 0;
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  return (
    `${label} must be one line of plain visible text — it contains ${hex}, a control, ` +
    'line/paragraph separator or invisible format character (a bidi override or a ' +
    'zero-width character), which a report would print as something other than what it says.'
  );
}

/** Every character of the class above, for removal. */
const NOT_PLAIN_ALL = new RegExp(NOT_PLAIN.source, 'gu');

/**
 * A word written by code the library does not control (a tool's result), made
 * safe to quote in a sentence the model or a person reads: every character
 * the rule above refuses is removed, the rest is trimmed, and text longer
 * than `maxChars` is cut there and ends in `…`. Never throws; may return ''.
 *
 * Why a cleaner here and not a refusal: a label is declared by the app at
 * build time and can be refused there, but a word inside a tool's result
 * arrives at run time and has to be told — so it is told without the
 * characters that would change what the reader sees (a bidi override
 * reversing the word, a line break starting a new instruction).
 *
 * @example plainLineOf('ok\u202Eay', 40) // 'okay'
 */
export function plainLineOf(text: string, maxChars: number): string {
  // Counted in code points, so a cut never splits a surrogate pair.
  const chars = Array.from(text.replace(NOT_PLAIN_ALL, '').trim());
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : chars.join('');
}
