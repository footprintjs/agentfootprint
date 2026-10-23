/**
 * search/valueWords — the words a declaration gives one VALUE of a `filter` or
 * `source` argument, looked up without ever letting the value index an object.
 *
 * Pattern: one pure lookup, the only door to an argument's `said` map.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * The key is the value the CALL sent — model-controlled. Indexing a plain
 * object with it reads inherited properties: `"constructor"`, `"__proto__"`,
 * `"toString"` would hand back a function or a prototype, and spreading that
 * throws (a model-triggered failure) or yields junk. So the lookup asks for an
 * OWN property only, and accepts only a list of strings. The declaration is
 * also stored as a null-prototype map at `defineTool` and at the MCP ingest
 * door (`declaration.ts` · `freezeSearch`); this lookup holds even for a
 * hand-built `Tool` that skipped both.
 */

/**
 * The declared words for `value` under `said`, or `undefined` when the
 * declaration names none (or names something that is not a list of words).
 */
export function valueWords(
  said: Readonly<Record<string, readonly string[]>> | undefined,
  value: string,
): readonly string[] | undefined {
  if (said === undefined || said === null || typeof said !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(said, value)) return undefined;
  const words: unknown = (said as Readonly<Record<string, unknown>>)[value];
  if (!Array.isArray(words) || !words.every((w) => typeof w === 'string')) return undefined;
  return [...(words as readonly string[])];
}
