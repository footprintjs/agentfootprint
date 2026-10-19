/** One pagination law, independent of the store implementation or test framework. */
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';
import type { MemoryStore } from '../../../src/memory/store/types.js';

export const PAGINATION_IDENTITY: MemoryIdentity = {
  tenant: 'pagination-tenant',
  principal: 'pagination-reader',
  conversationId: 'pagination-session',
};
export const REQUESTED_PAGE_LIMIT = 1000;
export const PAGINATION_ENTRIES: readonly MemoryEntry[] = Array.from(
  { length: 1003 },
  (_, index) => ({
    id: `entry-${String(index).padStart(4, '0')}`,
    value: { content: `entry ${index}` },
    version: 1,
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
    lastAccessedAt: 1_700_000_000_000,
    accessCount: 0,
  }),
);
export interface PaginationHarness {
  readonly name: string;
  /** Contract bound for the returned page, not the provider's internal batch. */
  readonly maximumReturnedPage: number;
  readonly create: () => Promise<{ readonly store: MemoryStore; readonly close?: () => void }>;
}

function requireContract(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`MemoryStore pagination: ${message}`);
}

export async function verifyOversizedListPagination(harness: PaginationHarness): Promise<void> {
  const opened = await harness.create();
  const expected = new Set(PAGINATION_ENTRIES.map((entry) => entry.id));
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  try {
    // This is a termination bound, not a retry budget. Every response must make
    // progress and all 1003 seeded rows must be seen once, regardless of order.
    for (let pageNumber = 0; pageNumber <= PAGINATION_ENTRIES.length; pageNumber += 1) {
      const page = await opened.store.list(PAGINATION_IDENTITY, {
        limit: REQUESTED_PAGE_LIMIT,
        ...(cursor !== undefined && { cursor }),
      });
      requireContract(
        page.entries.length > 0,
        `${harness.name} returned an empty page before exhaustion`,
      );
      requireContract(
        page.entries.length <= Math.min(REQUESTED_PAGE_LIMIT, harness.maximumReturnedPage),
        `${harness.name} exceeded the caller/adapter page bound`,
      );
      for (const entry of page.entries) {
        requireContract(
          expected.has(entry.id),
          `${harness.name} returned a row outside the seeded corpus`,
        );
        requireContract(
          !seen.has(entry.id),
          `${harness.name} repeated a row while following cursors`,
        );
        seen.add(entry.id);
      }
      if (seen.size === expected.size) {
        requireContract(
          page.cursor === undefined,
          `${harness.name} reported another page after exhaustion`,
        );
        return;
      }
      requireContract(
        typeof page.cursor === 'string' && page.cursor.length > 0,
        `${harness.name} omitted the cursor while entries remain`,
      );
      requireContract(
        !cursors.has(page.cursor),
        `${harness.name} repeated a cursor without completing the corpus`,
      );
      cursors.add(page.cursor);
      cursor = page.cursor;
    }
    throw new Error(`${harness.name} exceeded the bounded page walk`);
  } finally {
    opened.close?.();
  }
}
