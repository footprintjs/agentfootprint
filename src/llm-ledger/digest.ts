/**
 * llm-ledger/digest — the folder's one door to Web Crypto: text digests and random bytes.
 *
 * Pattern: one owner of `globalThis.crypto`, so the rest of the folder runs
 *          wherever the platform's Web Crypto does (a browser, Node, a worker)
 *          and imports no Node API for it. The fence test refuses Web Crypto
 *          in any other file. The precedent is `artifacts/payload.ts`.
 * Role:    the digests the log stores in place of text (a draft, a delivered
 *          answer, a supplied value) and the randomness a session id is
 *          minted from. The file store's MAC is NOT here: it is keyed, and its
 *          key never leaves `fileStore.ts`.
 * Emits:   N/A.
 *
 * A digest is `sha256:` and 64 lower-case hex digits over the text's UTF-8
 * bytes. Equal digests mean equal texts; the digest says nothing about what
 * the text claims.
 */
import type { LedgerDigest } from './types.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Whether `value` is a digest in the ledger's one spelling. */
export function isDigest(value: unknown): value is LedgerDigest {
  return typeof value === 'string' && DIGEST.test(value);
}

/** The digest of `text`'s UTF-8 bytes. */
export async function digestOf(text: string): Promise<LedgerDigest> {
  const bytes = new TextEncoder().encode(text);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of hash) hex += byte.toString(16).padStart(2, '0');
  return `sha256:${hex}`;
}

/** `count` bytes from the platform's cryptographic random source. */
export function randomBytes(count: number): Uint8Array {
  if (!Number.isSafeInteger(count) || count < 1 || count > 65_536) {
    throw new RangeError('randomBytes: count must be a whole number from 1 to 65536');
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(count));
}
