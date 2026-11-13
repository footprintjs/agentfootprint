/**
 * quotedText — the one rule for printing text the library did not write (a
 * model's argument name, a tool's value) inside a sentence the library DID
 * write.
 *
 * Pattern: leaf utility (imports only `stableJson.ts`).
 * Role:    asked by every fixed sentence that quotes such text: the negative
 *          claim statements (`integrity/negative-claim/statement.ts`) and the
 *          check-in's hidden-values sentence (`core/checkInWillDo.ts`).
 * Emits:   N/A.
 *
 * Why: a sentence a person reads as the library's own words must not be
 * rewritten by the text it quotes. A model can name an argument
 * `"amount. Nothing is hidden"`; printed bare, the library would appear to say
 * "Nothing is hidden". Quoted, it reads as data:
 *
 * ```ts
 * quotedText('amount. Nothing is hidden', 64); // '`amount. Nothing is hidden`'
 * quotedText('to‮evil', 64);              // '`toevil`' (the bidi override is dropped)
 * ```
 *
 * The rule: NFKC; controls and line/paragraph separators become a space;
 * invisible format characters (bidi overrides, zero-width) are dropped; a
 * backtick becomes `'` so the quote cannot be closed early; runs of white
 * space become one; the result is cut at `cap` code points (then `…`) and
 * wrapped in backticks. A non-string is written as sorted-key JSON first.
 */
import { stableJson } from './stableJson.js';

/** `value` as quoted data, one line, at most `cap` code points inside the quotes. */
export function quotedText(value: unknown, cap: number): string {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : stableJson(value) ?? '';
  const clean = raw
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/`/g, "'")
    .replace(/\s+/gu, ' ')
    .trim();
  const points = Array.from(clean);
  const capped = points.length > cap ? `${points.slice(0, cap).join('')}…` : clean;
  return `\`${capped}\``;
}
