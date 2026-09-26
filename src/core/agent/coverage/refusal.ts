/**
 * coverage/refusal — how a result helper refuses: the words every refusal
 * starts with, and the one unknown-key check its declaration passes.
 *
 * Pattern: one voice, three doors (`absent()`, `coverage()` and
 *          `semantic()`), so the three cannot disagree about what a refusal
 *          looks like or which keys a declaration may carry.
 * Role:    core/ layer, pure, a leaf — no imports.
 * Emits:   N/A.
 *
 * ## Why the prefix never names the helper
 *
 * These helpers run inside a tool's `execute`. A refusal is thrown there, the
 * dispatch loop catches it, and its message becomes that call's error result
 * — the text the MODEL reads in place of the data. Every refusal used to start
 * with the helper's own name (`absent: …`, `coverage: …`, `semantic: …`), and
 * a tool result that starts `absent:` reads like a finding. No provider
 * adapter this library ships marks a tool result as an error on the wire
 * (Anthropic's `is_error` is never set), so the words are all the model has:
 * they say what the text IS first, in the same word for all three helpers,
 * whatever the helper is called.
 *
 * ## Why an unknown key is refused, never dropped
 *
 * A declaration built in plain JavaScript, parsed from JSON or held in a
 * widened variable escapes the type checker. `coverage: { checked,
 * not_checked }` then minted the `checked` list and dropped the rest without
 * a word: the declared limit vanished, and the answer read as if the tool had
 * none. So every key a declaration carries is either one the helper reads or
 * a refusal, and a refusal names the spelling meant when the key is that
 * spelling with its case or separators changed (`not_checked` →
 * `notChecked`, `measuredAt` → `measured_at`).
 */

/**
 * The first words of every refusal `absent()`, `coverage()` and `semantic()`
 * throw — and so of the error result a model reads when one of them refuses
 * inside a tool's `execute`. Neutral on purpose: it says what the text is and
 * never depends on which helper refused.
 */
export const REFUSED_PREFIX = 'refused: ';

/** The error a result helper throws: the prefix, then what was refused. */
export function refusal(message: string): Error {
  return new Error(`${REFUSED_PREFIX}${message}`);
}

/** A key with its case and separators folded away — `not_checked`,
 *  `notChecked` and `NotChecked` fold to the same string. */
const folded = (key: string): string => key.replace(/[_-]/g, '').toLowerCase();

/**
 * The known key `key` is a respelling of — the same letters with a
 * different case or separators (a snake_case / camelCase slip) — or
 * `undefined` when it is no such thing. Never a guess past the spelling: a
 * key with a different word gets no suggestion.
 */
export function spellingMeant(key: string, known: readonly string[]): string | undefined {
  const want = folded(key);
  return known.find((candidate) => candidate !== key && folded(candidate) === want);
}

/**
 * Refuse the first own key of `value` that `known` does not list. `at` names
 * the nested object the keys belong to (`'coverage'`), or is omitted for the
 * declaration itself. The refusal names the key, the spelling meant when it is
 * a slip of a known one, and the fields that object has.
 *
 * @example
 *   refuseUnknownKeys({ checked: ['a'], not_checked: ['b'] }, ['checked', 'notChecked', 'cannotCover'], 'coverage');
 *   // throws: refused: 'coverage.not_checked' is not a field this vocabulary has — did you
 *   //         mean `notChecked`? The fields of `coverage` are: checked, notChecked, cannotCover.
 */
export function refuseUnknownKeys(value: object, known: readonly string[], at?: string): void {
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue;
    const meant = spellingMeant(key, known);
    const path = at === undefined ? key : `${at}.${key}`;
    throw refusal(
      `'${path}' is not a field this vocabulary has` +
        (meant === undefined ? '.' : ` — did you mean \`${meant}\`?`) +
        ` The fields${at === undefined ? '' : ` of \`${at}\``} are: ${known.join(', ')}.`,
    );
  }
}
