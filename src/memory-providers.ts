/**
 * memory-providers — memory store adapters.
 *
 * RedisStore, AgentCoreStore, and future stores (DynamoDB, Postgres,
 * Pinecone, …) all live here — a new store adds an export, never a new
 * import path.
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

// A durable vector index in one SQLite file — zero dependencies (node:sqlite is
// inside Node), exact search, and the corpus embedded once rather than on every
// restart. Lazy-loads `node:sqlite` at construction, so importing this barrel
// costs nothing for consumers who never build one.
export {
  sqliteVectorStore,
  UnreadableIndexFileError,
  EmbedderMismatchError,
  type SqliteVectorStore,
  type SqliteVectorStoreOptions,
  type SqliteVectorDatabaseLike,
  type SqliteVectorStatementLike,
  type SqliteVectorModuleLike,
} from './adapters/memory/sqliteVector.js';

// The SAME refusal `sqliteSessions` raises for the same missing module — one
// class, so catching it does not require knowing which store was being built.
export { SqliteUnavailableError } from './lib/sqliteUnavailable.js';

// Read-only reader for the legacy Bedrock Agents auto session-summary memory.
// NOT a MemoryStore (Bedrock owns the writes) — see the class docstring.
export {
  BedrockAgentMemory,
  type BedrockAgentMemoryOptions,
  type BedrockAgentMemoryLikeClient,
  type BedrockAgentSummary,
} from './adapters/memory/bedrockAgentMemory.js';
