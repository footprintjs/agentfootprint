/**
 * artifacts/naming — the ONE owner of the ref grammar.
 *
 * `art_` + 22 crypto-random base62 chars = 26 chars the model can speak
 * cheaply and copy reliably. The grammar lives in exactly one module (the
 * `branchSegment.ts` precedent upstream): mint here, recognize here, and
 * nowhere else — an adapter that parses refs with its own regex is a design
 * smell this header exists to refuse.
 *
 * NEVER content-addressed. The digest is metadata on {@link ArtifactMeta};
 * making content the key would collide two tenants' identical bytes into one
 * object (an isolation bug wearing a dedup win) and could never name two
 * generations of "the current dataset". Randomness comes from
 * `globalThis.crypto` — present in every supported Node and every browser —
 * so minting works wherever the in-memory adapter does.
 */

import type { ArtifactRef } from './types.js';

/** The prefix every minted ref carries. */
export const ARTIFACT_REF_PREFIX = 'art_';

/** Random chars after the prefix. 62^22 ≈ 2^131 — collision is not a case. */
const RANDOM_LENGTH = 22;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** The full shape, anchored: `art_` + exactly 22 base62 chars. */
const REF_PATTERN = /^art_[A-Za-z0-9]{22}$/;

/**
 * Mint a fresh, opaque, never-content-derived ref.
 *
 * Rejection sampling keeps the distribution uniform (256 % 62 ≠ 0, so a bare
 * modulo would bias the low end of the alphabet — cosmetically fine,
 * cryptographically sloppy, and cheap to do right).
 */
export function mintArtifactRef(): ArtifactRef {
  const out: string[] = [];
  const bytes = new Uint8Array(RANDOM_LENGTH * 2);
  while (out.length < RANDOM_LENGTH) {
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // 248 = 4 * 62: the largest multiple of 62 below 256. Values at or
      // above it are re-drawn instead of folded onto the alphabet unevenly.
      if (b >= 248) continue;
      out.push(ALPHABET[b % ALPHABET.length]);
      if (out.length === RANDOM_LENGTH) break;
    }
  }
  return `${ARTIFACT_REF_PREFIX}${out.join('')}`;
}

/**
 * Is this string a well-formed artifact ref?
 *
 * Structural, total, and the ONLY recognizer. Adapters call it before any
 * ref touches a filesystem path or a SQL parameter: refs are minted so a
 * traversal payload cannot arrive by construction — and this asserts it
 * anyway, because "cannot happen" is a claim, not a defence.
 */
export function isArtifactRef(candidate: unknown): candidate is ArtifactRef {
  return typeof candidate === 'string' && REF_PATTERN.test(candidate);
}
