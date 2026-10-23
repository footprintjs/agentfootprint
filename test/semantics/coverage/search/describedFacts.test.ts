/**
 * `describedResult({ resolved, paging })` — the found branch of a search tool
 * states the entity it resolved and whether a next page exists, in the same
 * rule set `absent()` uses. The model reads both as the tool's own claims; an
 * envelope carrying a malformed one stays DATA (strict recognition).
 *
 * Sections: Unit · Contract · Regression.
 */

import { describe, expect, it } from 'vitest';

import { describedResult } from '../../../../src/semantics/described.js';
import {
  explainSemantics,
  readSemantics,
  semanticsForModel,
} from '../../../../src/semantics/envelope.js';

const ROWS = {
  facts: [{ entity: 'INC-1', severity: 'sev2' }],
  provenance: { measuredAt: '2026-10-22T10:00:00Z', source: 'the incident store' },
} as const;

describe('describedResult resolved / paging — unit', () => {
  it('mints both onto the wire and recognizes the envelope', () => {
    const sem = describedResult({
      ...ROWS,
      resolved: [{ argument: 'service', id: 'payments', name: 'Payments' }],
      paging: { next: null },
    });
    expect(sem.resolved).toEqual([{ argument: 'service', id: 'payments', name: 'Payments' }]);
    expect(sem.paging).toEqual({ next: null });
    expect(readSemantics(sem)).toBe(sem);
  });

  it('serves both to the model — the tool’s claims, said out loud', () => {
    const served = semanticsForModel(
      describedResult({
        ...ROWS,
        resolved: [{ argument: 'service', id: 'payments' }],
        paging: { next: 'c2' },
      }),
    );
    expect(served.resolved).toEqual([{ argument: 'service', id: 'payments' }]);
    expect(served.paging).toEqual({ next: 'c2' });
  });
});

describe('describedResult resolved / paging — contract', () => {
  it('refuses a malformed value at the mint', () => {
    expect(() => describedResult({ ...ROWS, resolved: [] as never })).toThrow(/^refused: /);
    expect(() => describedResult({ ...ROWS, paging: { next: {} } as never })).toThrow(/^refused: /);
  });

  it('an envelope carrying a malformed value minted elsewhere stays data', () => {
    const minted = { ...describedResult(ROWS), paging: { more: true } };
    expect(readSemantics(minted)).toBeUndefined();
    expect(explainSemantics(minted)?.[0]?.field).toBe('paging');
  });
});

describe('describedResult resolved / paging — regression', () => {
  it('an envelope without them is served byte for byte as before', () => {
    const served = semanticsForModel(describedResult(ROWS));
    expect(Object.keys(served)).toEqual(['facts', 'provenance', 'note']);
  });
});
