/**
 * lib/storedPreview — how much of somebody's stored data an error may quote.
 *
 * A refusal about unreadable bytes has to show enough of them to be diagnosable
 * ("ah, that is our envelope stringified by something that was not JSON") and no
 * more, because the rest of those bytes are a conversation, a memory, or
 * whatever else a user said. Error messages travel: they land in logs, in
 * dashboards, in bug reports pasted into chat windows. So the quote is capped,
 * and the cap lives HERE rather than being re-decided by each adapter that needs
 * one — two copies of a redaction rule is one copy that will drift.
 *
 * Structured values are SUMMARISED rather than serialized: an array reports its
 * length and an object its keys, because `String(anObject)` and
 * `JSON.stringify(anArray)` are both ways of accidentally printing the payload
 * this file exists to keep out of the message.
 *
 * Two functions, because a cap is only safe when the first bytes are structure.
 * {@link previewStored} quotes a capped prefix — right for a value whose opening
 * fields are metadata. {@link describeStoredShape} quotes nothing at all — right
 * for a value whose content starts immediately. Choosing between them is the
 * caller's job because only the caller knows what its bytes begin with.
 */

/**
 * How much of a stored value a refusal may quote. Enough to recognise a mangled
 * encoding at a glance; not enough to leak what was being said.
 */
export const STORED_PREVIEW_LIMIT = 64;

/**
 * Describe what a store handed back WITHOUT quoting the whole thing.
 *
 * @example
 *   previewStored('{format=conversation-v1, data={version=1, …}}')
 *   // → '"{format=conversation-v1, data={version=1, …" (96 chars)'
 *   previewStored({ id: 'm-1', value: 'her address is …' })
 *   // → 'an object with keys: id, value'
 */
export function previewStored(value: unknown): string {
  if (typeof value === 'string') {
    return value.length <= STORED_PREVIEW_LIMIT
      ? `"${value}"`
      : `"${value.slice(0, STORED_PREVIEW_LIMIT)}…" (${value.length} chars)`;
  }
  return describeStoredShape(value);
}

/**
 * Describe a stored value **without quoting any of it** — its type, its size and
 * its shape, and nothing that came from a person.
 *
 * Use this instead of {@link previewStored} wherever the stored bytes carry
 * user content from their first characters, so that even a capped prefix would
 * leak. A `CheckpointEnvelope` opens with `format`, `data`, `savedAt` and can
 * afford to be quoted; a `MemoryEntry` opens with `id` and then `value`, so its
 * second field IS the thing somebody asked an agent to remember. The cap is a
 * policy about how MUCH may be shown; this is the answer when the honest amount
 * is none.
 *
 * It stays diagnosable, which is the whole job of the quote it replaces: a
 * length, whether it is JSON at all, and its opening character are enough to
 * recognise "an object stringified by something that was not JSON".
 *
 * @example
 *   describeStoredShape('{id=a, value={text=her address is …}}')
 *   // → "a 37-character string that is not JSON, starting '{'"
 */
export function describeStoredShape(value: unknown): string {
  if (typeof value === 'string') {
    let parsedShape = 'is not JSON';
    try {
      const parsed: unknown = JSON.parse(value);
      parsedShape =
        parsed !== null && typeof parsed === 'object'
          ? 'parses as JSON'
          : `parses as JSON but is a bare ${parsed === null ? 'null' : typeof parsed}`;
    } catch {
      /* not JSON — the interesting case, and already the default */
    }
    // The opening character only: '{' or '[' is what says "something
    // stringified an object", and one structural character is not content.
    const opener = value.length > 0 ? `, starting ${JSON.stringify(value[0])}` : '';
    return `a ${value.length}-character string that ${parsedShape}${opener}`;
  }
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    return keys.length > 0
      ? `an object with keys: ${keys.slice(0, 8).join(', ')}`
      : 'an object with no keys';
  }
  return `${typeof value} ${String(value)}`;
}
