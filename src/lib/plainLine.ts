/**
 * plainLine — the ONE rule for "one visible line of plain text" that a
 * person will read in a report.
 *
 * Pattern: One predicate, no imports, no state.
 * Role:    Leaf. Asked by the three doors that take a short declared label:
 *          `core/agent/coverage/items.ts` (a coverage item's `short`, at the
 *          `absent()` / `coverage()` mint AND at the dispatch reader) and
 *          `lib/injection-engine/factories/defineSkill.ts` (a skill's
 *          `title`). One rule, so the three cannot disagree.
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
