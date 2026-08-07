/**
 * sha256 — the content hash incremental re-indexing skips on.
 *
 * Pattern: leaf utility over `node:crypto`.
 * Role:    rag/ layer. Distinct from `lib/fnv1a` on purpose: FNV-1a identifies
 *          content for correlation inside one recording, where a collision
 *          costs a confusing trace. This one decides whether a document is
 *          RE-EMBEDDED, where a collision costs a stale answer that looks
 *          exactly like a fresh one — and it is compared across runs, machines
 *          and months rather than within a single process.
 * Emits:   N/A.
 */
import { lazyRequire } from '../lib/lazyRequire.js';

/** Hex sha-256 of the bytes or text given. */
export function sha256(input: Uint8Array | string): string {
  const crypto = lazyRequire<typeof import('node:crypto')>('node:crypto');
  return crypto
    .createHash('sha256')
    .update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input))
    .digest('hex');
}
