import { expect } from 'vitest';
import type { MemoryStore } from '../../../src/memory/store/types.js';
import { PAGINATION_IDENTITY, type PaginationHarness } from './listPagination.js';

export const INVALID_REQUEST_LIMITS = [
  { label: 'zero', value: 0 },
  { label: 'negative', value: -1 },
  { label: 'fractional', value: 1.5 },
  { label: 'NaN', value: Number.NaN },
  { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
  { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
  { label: 'runtime null', value: null },
] as const;

const IDENTITIES = [
  PAGINATION_IDENTITY,
  { ...PAGINATION_IDENTITY, tenant: 'empty-tenant', conversationId: 'empty-session' },
];

export async function verifyInvalidRequestLimit(
  harness: PaginationHarness,
  operation: 'list' | 'search',
  value: unknown,
): Promise<void> {
  const opened = await harness.create();
  const option = operation === 'list' ? 'limit' : 'k';
  const expectedMessage = `MemoryStore.${operation}(): \`${option}\` must be a positive integer when provided.`;
  try {
    for (const identity of IDENTITIES) {
      // Empty vector/namespace shortcuts must not swallow an invalid bound.
      for (const vector of operation === 'list' ? [[1, 0]] : [[1, 0], []]) {
        const before = opened.backendCalls?.();
        let failure: unknown;
        try {
          if (operation === 'list') {
            await opened.store.list(identity, { limit: value as number });
          } else {
            const search = requireSearch(opened.store);
            await search.call(opened.store, identity, vector, {
              k: value as number,
              text: 'fixture query',
            });
          }
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(RangeError);
        expect((failure as Error).message).toBe(expectedMessage);
        if (before !== undefined) expect(opened.backendCalls?.()).toBe(before);
      }
    }
  } finally {
    opened.close?.();
  }
}

export async function verifyDefaultRequestLimits(harness: PaginationHarness): Promise<void> {
  const opened = await harness.create();
  try {
    const omitted = await opened.store.list(PAGINATION_IDENTITY);
    const explicitUndefined = await opened.store.list(PAGINATION_IDENTITY, { limit: undefined });
    expect(omitted.entries.length).toBeGreaterThan(0);
    expect(explicitUndefined).toEqual(omitted);
    expect(typeof opened.store.search).toBe(harness.supportsSearch ? 'function' : 'undefined');
    if (harness.supportsSearch) {
      const search = requireSearch(opened.store);
      const defaultSearch = await search.call(opened.store, PAGINATION_IDENTITY, [1, 0], {
        text: 'fixture query',
      });
      expect(
        await search.call(opened.store, PAGINATION_IDENTITY, [1, 0], {
          text: 'fixture query',
          k: undefined,
        }),
      ).toEqual(defaultSearch);
    }
  } finally {
    opened.close?.();
  }
}

function requireSearch(store: MemoryStore): NonNullable<MemoryStore['search']> {
  if (store.search === undefined) throw new Error('Expected a shipped search implementation');
  return store.search;
}
