/**
 * fnv1a — the one 32-bit content hash this library uses.
 *
 * Pattern: leaf utility (imports nothing).
 * Role:    shared by the slot composers (`core/slots/helpers.ts`, which
 *          re-exports it under the same name) and by the memory layer's
 *          retrieval record. It lives here rather than in either of them
 *          because `memory/` must not import `core/` — `core/` already
 *          imports `memory/`, and a second hash implementation is how two
 *          recordings of the same bytes end up disagreeing about their id.
 * Emits:   N/A.
 *
 * Not cryptographic and not meant to be: this identifies content for
 * dedup and correlation inside one recording, never for authentication.
 */
export function fnv1a(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
