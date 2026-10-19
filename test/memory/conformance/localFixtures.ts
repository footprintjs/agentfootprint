/** Local stores: real public store verbs, no service or network. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryStore } from '../../../src/memory/store/InMemoryStore.js';
import {
  staticVectorStore,
  CORPUS_BUNDLE_FORMAT,
} from '../../../src/memory/store/staticVectorStore.js';
import { sqliteVectorStore } from '../../../src/adapters/memory/sqliteVector.js';
import { identityNamespace } from '../../../src/memory/identity/index.js';
import {
  PAGINATION_ENTRIES,
  PAGINATION_IDENTITY,
  type PaginationHarness,
} from './listPagination.js';

export const localPagination: readonly PaginationHarness[] = [
  {
    name: 'InMemoryStore',
    maximumReturnedPage: 1000,
    async create() {
      const store = new InMemoryStore();
      await store.putMany(PAGINATION_IDENTITY, PAGINATION_ENTRIES);
      return { store };
    },
  },
  {
    name: 'staticVectorStore (read-only corpus fixture)',
    maximumReturnedPage: 1000,
    async create() {
      const store = staticVectorStore({
        format: CORPUS_BUNDLE_FORMAT,
        embedder: { id: 'fixture-embedder', dimensions: 2 },
        namespace: identityNamespace(PAGINATION_IDENTITY),
        exportedAt: 1_700_000_000_000,
        entries: PAGINATION_ENTRIES.map((entry) => ({
          id: entry.id,
          text: `content of ${entry.id}`,
          vector: [1, 0],
        })),
      });
      return { store };
    },
  },
  {
    name: 'sqliteVectorStore (temporary local SQLite file)',
    maximumReturnedPage: 1000,
    async create() {
      const directory = mkdtempSync(join(tmpdir(), 'af-list-conformance-'));
      const store = sqliteVectorStore({ file: join(directory, 'entries.db') });
      try {
        await store.putMany(PAGINATION_IDENTITY, PAGINATION_ENTRIES);
      } catch (error) {
        store.close();
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      return {
        store,
        close: () => {
          store.close();
          rmSync(directory, { recursive: true, force: true });
        },
      };
    },
  },
];
