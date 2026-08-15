/**
 * The battery's collision case, tested against stores that are KNOWN to be wrong.
 *
 * `awkward-session-ids-round-trip` is the one case standing between a
 * third-party store and a cross-user read, and it is exported for other people
 * to certify their own stores with. A case like that is worth exactly what it
 * CATCHES, and every check here is a mangling that a previous version of the
 * table let through:
 *
 *   - the suffix-only table was blind to every mapping that discards the HEAD,
 *     which is the single most likely real one (a store keying on the last path
 *     segment because its backend refuses `/` in a key);
 *   - the all-ASCII table was blind to Unicode normalisation, the classic silent
 *     id collision — macOS stores NFD, a column collates NFC.
 *
 * So this file is the gate on the gate: add a fold class to `FOLD_PAIRS` and
 * add the store that folds that way here, or the pair is unproven.
 */
import { describe, expect, it } from 'vitest';

import { runSessionLifecycleConformance } from '../../src/hosting/index.js';
import type { CheckpointEnvelope, SessionLifecycle } from '../../src/hosting/index.js';

const COLLISION_CASE = 'awkward-session-ids-round-trip';

/**
 * A store whose id→key mapping is deliberately broken in ONE way.
 *
 * Deliberately the smallest thing that can hold a conversation: the collision
 * case only persists and hydrates, and a bigger double would only add ways for
 * this file to fail for a reason that is not the fold under test.
 */
function storeFoldingIdsBy(toKey: (sessionId: string) => string): SessionLifecycle {
  const rows = new Map<string, CheckpointEnvelope>();
  return {
    async persist(sessionId, envelope) {
      rows.set(toKey(sessionId), envelope);
    },
    async hydrate(sessionId) {
      return rows.get(toKey(sessionId));
    },
  };
}

/** Manglings that are each non-injective in exactly one way. */
const BROKEN_MAPPINGS: readonly {
  readonly name: string;
  readonly toKey: (id: string) => string;
}[] = [
  {
    name: 'replaces every illegal character with one filler',
    toKey: (id) => id.replace(/[^A-Za-z0-9_-]/g, '-'),
  },
  { name: 'percent-decodes before storing', toKey: (id) => decodeURIComponent(id) },
  { name: 'lowercases the id', toKey: (id) => id.toLowerCase() },
  { name: 'keys on the last path segment', toKey: (id) => id.slice(id.lastIndexOf('/') + 1) },
  { name: 'keeps only the last 64 characters', toKey: (id) => id.slice(-64) },
  { name: 'strips a leading "session-" prefix', toKey: (id) => id.replace(/^session-/, '') },
  { name: 'truncates at a length ceiling', toKey: (id) => id.slice(0, 256) },
  { name: 'truncates from the front', toKey: (id) => id.slice(-256) },
  { name: 'normalises to NFC', toKey: (id) => id.normalize('NFC') },
  { name: 'normalises to NFD', toKey: (id) => id.normalize('NFD') },
  { name: 'normalises to NFKC', toKey: (id) => id.normalize('NFKC') },
  { name: 'strips zero-width characters', toKey: (id) => id.replace(/[​-‍﻿]/g, '') },
];

describe('the collision case catches a store that folds two ids into one', () => {
  for (const { name, toKey } of BROKEN_MAPPINGS) {
    it(`catches a store that ${name}`, async () => {
      const report = await runSessionLifecycleConformance({
        name: `broken: ${name}`,
        createStore: () => storeFoldingIdsBy(toKey),
      });
      const outcome = report.outcomes.find((row) => row.case === COLLISION_CASE);
      expect(
        outcome?.status,
        `a store that ${name} is NOT injective, and ${COLLISION_CASE} let it through. ` +
          `Every fold class in FOLD_PAIRS needs a store here that folds that way, or the ` +
          `pair is decoration.`,
      ).toBe('failed');
    });
  }

  it('passes a store whose mapping is injective, so the case is not simply always failing', async () => {
    // The control. Without it, a case that failed unconditionally would satisfy
    // every assertion above and prove nothing at all.
    const report = await runSessionLifecycleConformance({
      name: 'control: keys verbatim',
      createStore: () => storeFoldingIdsBy((id) => id),
    });
    const outcome = report.outcomes.find((row) => row.case === COLLISION_CASE);
    expect(outcome?.status).toBe('passed');
  });
});
