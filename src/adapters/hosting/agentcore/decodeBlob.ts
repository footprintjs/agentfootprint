/**
 * Turn one stored blob back into an envelope — the adapter's ONE decode step.
 *
 * ── Why a string is the normal case, not the exotic one ──────────────────────
 * This adapter writes the envelope as **JSON text** (see `createEvent` below),
 * so the blob that comes back is a string and is parsed here. Objects are still
 * accepted: a caller who supplies their own `client` can hand back a real
 * object, and refusing it would break a seam that never had this problem.
 *
 * A blob it cannot decode is handed back **AS-IS**, never as `null`. `null`
 * means "no blob", which is an absence, and an absence is answered with a fresh
 * start; a conversation that exists and cannot be read must not be. Passing the
 * raw value on puts it in front of `checkEnvelope`, which refuses by name.
 */
export function decodeBlob(blob: unknown): unknown {
  if (typeof blob !== 'string') return blob;
  try {
    const parsed: unknown = JSON.parse(blob);
    // JSON.parse('"x"') is a string, not an envelope. Hand back the ORIGINAL
    // bytes so the refusal quotes what the store actually holds.
    return parsed !== null && typeof parsed === 'object' ? parsed : blob;
  } catch {
    return blob;
  }
}
