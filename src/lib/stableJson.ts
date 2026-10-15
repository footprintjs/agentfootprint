/**
 * stableJson — the one sorted-key JSON spelling every fingerprint in this
 * library hashes: the receipt's digests (`time-travel/receipt.ts`), the
 * ontology's hash (`ontology/define.ts` · `ontologyHash`). A leaf so that the
 * layers that hash a value and cannot import each other spell it the same way.
 */

/**
 * JSON with object keys in sorted order, at every depth — so two structurally
 * equal values hash the same however they were built. Property order survives
 * `structuredClone`, but it does NOT survive every path a value takes through
 * a delta-encoded commit log and back, and a fingerprint that depends on
 * insertion order is a fingerprint that reports a change nobody made.
 *
 * Returns `undefined` — never `''` — for anything JSON cannot express (a
 * cycle, a `BigInt`, a value whose `toJSON` throws). It does not throw,
 * because a receipt is bookkeeping and must never be able to stop a run; and
 * it does not collapse, because `''` made every unreadable value equal to
 * every other one. Two requests that both failed to serialize compared EQUAL,
 * and the receipt wrote `transformHash: null` — "the cache strategy changed
 * nothing" — about a pair it had not read. Callers substitute
 * `time-travel/receipt.ts` · `UNSERIALIZABLE` where a digest needs bytes, and
 * branch where a comparison needs truth.
 */
export function stableJson(value: unknown): string | undefined {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      const source = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        const next = canonical(source[key]);
        if (next === undefined) continue;
        out[key] = next;
      }
      return out;
    }
    return input;
  };
  try {
    return JSON.stringify(canonical(value)) ?? undefined;
  } catch {
    return undefined;
  }
}
