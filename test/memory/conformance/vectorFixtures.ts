/** Vendor boundary fakes answer the real adapter's SQL/RPC, never replace list(). */
import { pgVectorStore } from '../../../src/adapters/memory/pgVector.js';
import { s3VectorsStore } from '../../../src/adapters/memory/s3Vectors.js';
import { identityNamespace } from '../../../src/memory/identity/index.js';
import {
  PAGINATION_ENTRIES,
  PAGINATION_IDENTITY,
  type PaginationHarness,
} from './listPagination.js';
const NAMESPACE = identityNamespace(PAGINATION_IDENTITY);
const COLUMNS = [
  'namespace',
  'id',
  'value',
  'metadata',
  'embedding',
  'embedder_fp',
  'version',
  'created_at',
  'updated_at',
  'last_accessed_at',
  'access_count',
  'ttl',
  'tier',
  'source',
  'embedding_model',
];

export const vectorPagination: readonly PaginationHarness[] = [
  {
    name: 'pgVectorStore (fake SQL client)',
    maximumReturnedPage: 1000,
    async create() {
      const rows = PAGINATION_ENTRIES.map((entry) => ({
        id: entry.id,
        value: JSON.stringify(entry.value),
        version: entry.version,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
        last_accessed_at: entry.lastAccessedAt,
        access_count: entry.accessCount,
        ttl: null,
        tier: null,
        metadata: null,
        source: null,
        embedding_model: null,
      }));
      const client = {
        async query(sql: string, params: readonly unknown[] = []) {
          if (sql.includes('information_schema.columns'))
            return { rows: COLUMNS.map((column_name) => ({ column_name })) };
          if (!sql.includes('ORDER BY') || !sql.includes('LIMIT $3'))
            throw new Error('Unexpected SQL outside pagination fixture');
          const [namespace, after, limit] = params;
          if (namespace !== NAMESPACE) return { rows: [] };
          return { rows: rows.filter((row) => row.id > String(after)).slice(0, Number(limit)) };
        },
      };
      return { store: pgVectorStore({ _client: client }) };
    },
  },
  {
    name: 's3VectorsStore (fake ListVectors capped at 500 per service call)',
    maximumReturnedPage: 1000,
    async create() {
      const rows = PAGINATION_ENTRIES.map((entry) => ({
        key: `${NAMESPACE}#${entry.id}`,
        metadata: { ns: NAMESPACE, af: JSON.stringify(entry) },
        data: { float32: [1, 0] },
      }));
      const client = {
        async send(command: unknown) {
          const input = command as { __command: string; maxResults?: number; nextToken?: string };
          if (input.__command === 'GetIndex')
            return {
              index: {
                distanceMetric: 'cosine',
                metadataConfiguration: { nonFilterableMetadataKeys: ['af'] },
              },
            };
          if (input.__command !== 'ListVectors')
            throw new Error('Unexpected operation outside S3 pagination fixture');
          const size = input.maxResults ?? 100;
          if (!Number.isInteger(size) || size < 1 || size > 500)
            throw new RangeError('ListVectors fixture requires maxResults 1..500');
          const start = input.nextToken === undefined ? 0 : Number(input.nextToken);
          const vectors = rows.slice(start, start + size);
          const end = start + vectors.length;
          return { vectors, ...(end < rows.length && { nextToken: String(end) }) };
        },
      };
      return {
        store: s3VectorsStore({
          bucket: 'fixture-bucket',
          index: 'fixture-index',
          _client: client,
        }),
      };
    },
  },
];
