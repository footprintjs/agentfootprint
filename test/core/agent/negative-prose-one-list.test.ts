/**
 * One list feeds both: the prose row types and checkpoint admission
 * (`core/agent/findings/negativeProse.ts` · `negativeProseRowIsWellFormed`)
 * read the same `PROSE_NOTE_CODES` / `PROSE_CLAIM_KINDS`.
 *
 * Why a module mock: while the lists agree, a validator holding its own
 * literals admits exactly the same rows, so no plain input tells the two
 * apart. The drift this guards is a member added to the list — so the test
 * adds one, and admission must take it without being edited.
 *
 * Test type (Convention 3): regression.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/integrity/negative-claim/types.js', async (importOriginal) => {
  const real = await importOriginal<
    typeof import('../../../src/integrity/negative-claim/types.js')
  >();
  return {
    ...real,
    PROSE_NOTE_CODES: [...real.PROSE_NOTE_CODES, 'a-code-added-later'],
    PROSE_CLAIM_KINDS: [...real.PROSE_CLAIM_KINDS, 'a-kind-added-later'],
  };
});

const { negativeProseRowIsWellFormed } = await import(
  '../../../src/core/agent/findings/negativeProse.js'
);

const CLAIM = {
  kind: 'negative-claim',
  field: '/summary',
  claim: 'none',
  span: { start: 13, end: 22 },
  phraseId: 'none.never-had',
  packVersion: '1',
  notes: ['entity-unresolved'],
  results: [],
  iteration: 2,
  turn: 1,
};
const NOTE = {
  kind: 'negative-claim-note',
  field: '/',
  code: 'input-limit',
  span: { start: 0, end: 65_537 },
  packVersion: '1',
  iteration: 2,
  turn: 1,
};

describe('regression: a member added to the list is admitted on restore', () => {
  it('a note code added to PROSE_NOTE_CODES', () => {
    expect(negativeProseRowIsWellFormed({ ...NOTE, code: 'a-code-added-later' })).toBe(true);
  });

  it('a claim kind added to PROSE_CLAIM_KINDS', () => {
    expect(negativeProseRowIsWellFormed({ ...CLAIM, claim: 'a-kind-added-later' })).toBe(true);
  });

  it('a value on neither list is still refused', () => {
    expect(negativeProseRowIsWellFormed({ ...NOTE, code: 'never-declared' })).toBe(false);
  });
});
