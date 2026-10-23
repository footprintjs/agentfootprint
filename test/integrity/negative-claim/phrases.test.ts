/**
 * negative-claim — the phrase packs (design § 5.2, `phrases.ts`): closed, versioned and hashed.
 *
 * The hash pins the packs to their version: an edit to any phrase without a new version fails
 * here, so a measured number can always name the grammar it measured (bench/negative/RULE.md).
 *
 * Test types: contract (version ↔ hash pin; frozen packs; unique ids) · negative (no bare
 * "every" or "zero"; hedges are a pack of their own, never scope).
 */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../../src/lib/sha256.js';
import { stableJson } from '../../../src/lib/stableJson.js';
import {
  NEGATIVE_CLAIM_PHRASES,
  NEGATIVE_CLAIM_PHRASES_HASH,
  NEGATIVE_CLAIM_PHRASES_VERSION,
} from '../../../src/integrity/negative-claim/phrases.js';

/** version → hash. A new version adds a row; an edited pack without one fails. */
const PINNED: Readonly<Record<string, string>> = {
  '1': '7d83d90ecd339d0eebd31ab1e30d4849048c47faf4bd8121739db6f6b6dd915d',
};

describe('the packs are versioned and hashed', () => {
  it('the hash is the sha256 of the packs’ stable JSON', () => {
    expect(NEGATIVE_CLAIM_PHRASES_HASH).toBe(sha256Hex(stableJson(NEGATIVE_CLAIM_PHRASES) ?? ''));
  });

  it('the version pins the hash', () => {
    expect(PINNED[NEGATIVE_CLAIM_PHRASES_VERSION]).toBe(NEGATIVE_CLAIM_PHRASES_HASH);
  });

  it('the packs are closed: frozen all the way down', () => {
    expect(Object.isFrozen(NEGATIVE_CLAIM_PHRASES)).toBe(true);
    for (const pack of Object.values(NEGATIVE_CLAIM_PHRASES)) {
      expect(Object.isFrozen(pack)).toBe(true);
      for (const phrase of pack) expect(Object.isFrozen(phrase)).toBe(true);
    }
  });

  it('every phrase id is unique and names its pack', () => {
    const ids = Object.entries(NEGATIVE_CLAIM_PHRASES).flatMap(([pack, phrases]) =>
      phrases.map((p) => {
        expect(p.id.startsWith(`${pack}.`)).toBe(true);
        return p.id;
      }),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no claim phrase is a bare "every" or "zero"', () => {
    for (const pack of [NEGATIVE_CLAIM_PHRASES.none, NEGATIVE_CLAIM_PHRASES.complete]) {
      for (const phrase of pack) {
        expect(phrase.words.join(' ')).not.toMatch(/^(every|zero)$/);
      }
    }
  });

  it('holds the six packs: none, complete, unbounded, source, window, hedge', () => {
    expect(Object.keys(NEGATIVE_CLAIM_PHRASES).sort()).toEqual(
      ['complete', 'hedge', 'none', 'source', 'unbounded', 'window'].sort(),
    );
  });
});
