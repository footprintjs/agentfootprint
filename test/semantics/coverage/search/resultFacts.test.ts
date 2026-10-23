/**
 * `resolved` and `paging` — two facts a search tool's RESULT states out loud.
 * One rule set, two doors: the mint (`absent()`, `describedResult()`) refuses
 * a malformed value at the line the author wrote; the reader (an envelope
 * minted elsewhere) drops it, never repairs it.
 *
 * Sections: Unit · Contract · Edge.
 */

import { describe, expect, it } from 'vitest';

import {
  mintPaging,
  mintResolved,
  readPaging,
  readResolved,
} from '../../../../src/semantics/coverage/search/resultFacts.js';

describe('resolved — unit', () => {
  it('mints a copy of a well-formed list', () => {
    const declared = [{ argument: 'service', id: 'payments', name: 'Payments', aliases: ['pay'] }];
    const minted = mintResolved(declared);
    expect(minted).toEqual(declared);
    expect(minted).not.toBe(declared);
    expect(minted?.[0]?.aliases).not.toBe(declared[0]?.aliases);
  });

  it('mints nothing for undefined or null', () => {
    expect(mintResolved(undefined)).toBeUndefined();
    expect(mintResolved(null)).toBeUndefined();
  });
});

describe('resolved — contract: refused at the mint, dropped at the reader', () => {
  it.each([
    ['an empty list', []],
    ['not a list', { argument: 'service', id: 'p' }],
    ['no argument', [{ id: 'p' }]],
    ['a blank id', [{ argument: 'service', id: ' ' }]],
    ['a numeric id', [{ argument: 'service', id: 7 }]],
    ['aliases not a list', [{ argument: 'service', id: 'p', aliases: 'pay' }]],
    ['a blank alias', [{ argument: 'service', id: 'p', aliases: [''] }]],
    ['an unknown key', [{ argument: 'service', id: 'p', score: 1 }]],
  ])('%s', (_label, bad) => {
    expect(() => mintResolved(bad)).toThrow(/^refused: .*resolved/);
    expect(readResolved(bad)).toBeUndefined();
  });
});

describe('paging — unit and contract', () => {
  it.each([null, 'cursor-2', 3])('mints and reads next = %j', (next) => {
    expect(mintPaging({ next })).toEqual({ next });
    expect(readPaging({ next })).toEqual({ next });
  });

  it.each([
    ['no next', {}],
    ['next undefined', { next: undefined }],
    ['next an object', { next: { page: 2 } }],
    ['a blank cursor', { next: '' }],
    ['not an object', 'next'],
    ['an unknown key', { next: null, total: 5 }],
  ])('%s is refused and dropped', (_label, bad) => {
    expect(() => mintPaging(bad)).toThrow(/^refused: .*paging/);
    expect(readPaging(bad)).toBeUndefined();
  });

  it('mints nothing for undefined', () => {
    expect(mintPaging(undefined)).toBeUndefined();
  });
});
