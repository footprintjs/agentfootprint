/** Local stores: real public store verbs, no service or network. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
    supportsSearch: true,
    maximumReturnedPage: 1000,
    async create() {
      const store = new InMemoryStore();
      await store.putMany(PAGINATION_IDENTITY, PAGINATION_ENTRIES);
      return { store };
    },
  },
  {
    name: 'staticVectorStore (read-only corpus fixture)',
    supportsSearch: true,
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
    supportsSearch: true,
    maximumReturnedPage: 1000,
    async create() {
      const directory = mkdtempSync(join(tmpdir(), 'af-list-conformance-'));
      let backendCalls = 0;
      // Keep real SQLite semantics while observing the database boundary; a
      // rejected request must not prepare or run SQL, even on an empty namespace.
      class ObservedDatabase extends DatabaseSync {
        override exec(sql: string): void {
          backendCalls += 1;
          super.exec(sql);
        }
        override prepare(sql: string) {
          backendCalls += 1;
          return new Proxy(super.prepare(sql), {
            get(statement, property) {
              const member = Reflect.get(statement, property, statement);
              if (typeof member !== 'function') return member;
              return (...parameters: unknown[]) => {
                backendCalls += 1;
                return Reflect.apply(member, statement, parameters);
              };
            },
          });
        }
      }
      const store = sqliteVectorStore({
        file: join(directory, 'entries.db'),
        _sqlite: ObservedDatabase,
      });
      try {
        await store.putMany(PAGINATION_IDENTITY, PAGINATION_ENTRIES);
      } catch (error) {
        store.close();
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      return {
        store,
        backendCalls: () => backendCalls,
        close: () => {
          store.close();
          rmSync(directory, { recursive: true, force: true });
        },
      };
    },
  },
];
