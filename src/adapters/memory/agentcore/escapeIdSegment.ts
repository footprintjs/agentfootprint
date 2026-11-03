/** Characters an escaped segment carries through unchanged. */
const VERBATIM_ID_CHAR = /[A-Za-z0-9-]/;

/**
 * Escape one identity field into AgentCore's alphabet, reversibly.
 *
 * Every code unit outside {@link VERBATIM_ID_CHAR} becomes `introducer` + its
 * four-digit hex — fixed width, so a decoder reading `introducer` always knows
 * exactly how much to consume, which is what makes this a left inverse and
 * therefore injective.
 *
 * The escape character escapes ITSELF for free here, and that is deliberate:
 * `identity/encode.ts` has to order its two `.replace()` passes so `%` goes
 * first (reverse them and `a%2Fb` lands on the value that produced it). A
 * single left-to-right pass over code units has no ordering to get wrong — the
 * introducer is simply not in the verbatim set, so it is escaped like any other
 * character. Do not "optimise" this back into chained replaces.
 *
 * Code UNITS, not code points: a lone surrogate is a legal JS string and would
 * be flattened to U+FFFD by a UTF-8 pass, which is a collision.
 */
export function escapeIdSegment(raw: string, introducer: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    out += VERBATIM_ID_CHAR.test(ch)
      ? ch
      : introducer + raw.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}
