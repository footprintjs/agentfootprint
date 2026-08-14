/**
 * memory-providers — memory store adapters.
 *
 * RedisStore, AgentCoreStore, sqliteVectorStore, pgVectorStore, s3VectorsStore
 * and future stores (DynamoDB, Pinecone, …) all live here — a new store adds an
 * export, never a new import path.
 *
 * Pattern: Adapter (GoF) — each store translates the `MemoryStore`
 *          interface onto a specific backend (Redis, DynamoDB-style
 *          AWS Bedrock AgentCore Memory, etc.).
 * Role:    Outer ring (Hexagonal). All store adapters lazy-require
 *          their vendor SDKs at construction time, so importing this
 *          barrel costs ZERO peer-dep load — only the stores you
 *          actually instantiate pull their SDK in.
 *
 * @example
 *   import { RedisStore, AgentCoreStore } from 'agentfootprint/memory';
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/memory`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

// Lazy-required peer-dep stores. Both adapters defer their vendor SDK
// `require()` to constructor time; importing this barrel doesn't load
// `ioredis` or `@aws-sdk/client-bedrock-agent-runtime`.
export {
  RedisStore,
  type RedisStoreOptions,
  type RedisLikeClient,
  type RedisLikePipeline,
} from './adapters/memory/redis.js';

export {
  AgentCoreStore,
  UnreadableMemoryEntryError,
  type AgentCoreStoreOptions,
  type AgentCoreLikeClient,
  type AgentCoreEvent,
  type AgentCoreMemoryRecord,
} from './adapters/memory/agentcore.js';

// Vertex AI Memory Bank — a NATURAL-LANGUAGE memory service, not a vector
// store: it declares `supportsVectorSearch: false` and `ranksBy: 'server-text'`
// so the corpus builders refuse it by name, and it converts the service's
// DISTANCE (smaller is closer) rather than forwarding it as a similarity
// (higher is closer). Read the module header before the first write: `scope` is
// immutable, so the convention cannot be changed afterwards. An entry's
// `source`, caller `metadata` and `decayPolicy` are CARRIED (9.30.0) — a field
// trial caught 9.29.0 accepting and silently dropping them.
export {
  memoryBankStore,
  MemoryBankStore,
  MAX_PAGE_SIZE,
  MAX_CARRIED_JSON,
  scoreFromDistance,
  type MemoryBankStoreOptions,
  type MemoryScope,
} from './adapters/memory/memoryBank.js';

// A durable vector index in one SQLite file — zero dependencies (node:sqlite is
// inside Node), exact search, and the corpus embedded once rather than on every
// restart. Lazy-loads `node:sqlite` at construction, so importing this barrel
// costs nothing for consumers who never build one.
export {
  sqliteVectorStore,
  UnreadableIndexFileError,
  type SqliteVectorStore,
  type SqliteVectorStoreOptions,
  type SqliteVectorDatabaseLike,
  type SqliteVectorStatementLike,
  type SqliteVectorModuleLike,
} from './adapters/memory/sqliteVector.js';

// The SAME refusal `sqliteSessions` raises for the same missing module — one
// class, so catching it does not require knowing which store was being built.
export { SqliteUnavailableError } from './lib/sqliteUnavailable.js';

// ONE refusal for every store that can tell a vector met an index built by a
// different embedder (9.3.0). It lived in sqliteVector.ts from 8.9.0; when
// pgVectorStore and s3VectorsStore learned the same check it moved to lib/, so
// `catch (e) { if (e instanceof EmbedderMismatchError) }` cannot depend on
// which store threw. The old import path still works.
export { EmbedderMismatchError } from './lib/embedderMismatch.js';

// Postgres + pgvector: the corpus beside the application's own data, inheriting
// its backups, failover and access control. `pg` is lazy-required at the first
// call — pass `client` to reuse the pool your app already has.
export {
  pgVectorStore,
  PgVectorSchemaError,
  type PgVectorStore,
  type PgVectorStoreOptions,
  type PgVectorColumns,
  type PgLikeClient,
  type PgQueryResult,
  type PgSdkModule,
} from './adapters/memory/pgVector.js';

// Amazon S3 Vectors: a durable corpus with nothing to run, that can be added to
// from a cron job rather than at the next deploy. Lazy-requires
// `@aws-sdk/client-s3vectors` at the first call.
export {
  s3VectorsStore,
  type S3VectorsStore,
  type S3VectorsStoreOptions,
  type S3VectorsLikeClient,
  type S3VectorsSdkModule,
} from './adapters/memory/s3Vectors.js';

// Read-only reader for the legacy Bedrock Agents auto session-summary memory.
// NOT a MemoryStore (Bedrock owns the writes) — see the class docstring.
export {
  BedrockAgentMemory,
  type BedrockAgentMemoryOptions,
  type BedrockAgentMemoryLikeClient,
  type BedrockAgentSummary,
} from './adapters/memory/bedrockAgentMemory.js';
