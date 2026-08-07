/**
 * agentfootprint/memory-providers — memory store adapters (canonical subpath).
 *
 * The Block B canonical name. Mirrors the parallel structure shipped in
 * v2.5:
 *
 *   agentfootprint/llm-providers     ← LLM provider adapters
 *   agentfootprint/tool-providers    ← tool dispatch + tool sources
 *   agentfootprint/memory-providers  ← memory store adapters (this file)
 *   agentfootprint/security          ← cross-cutting authorization
 *
 * One subpath that grows — RedisStore, AgentCoreStore, and future
 * stores (DynamoDB, Postgres, Pinecone, …) all live here. No more
 * adding `agentfootprint/memory-<vendor>` per-adapter subpath each
 * time a new store ships.
 *
 * Per-adapter aliases (`agentfootprint/memory-redis`,
 * `agentfootprint/memory-agentcore`) stay available through the v2.x
 * line — they point at the same files. New code SHOULD import from
 * `agentfootprint/memory-providers`:
 *
 *   import { RedisStore, AgentCoreStore } from 'agentfootprint/memory-providers';
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
 *   import { RedisStore, AgentCoreStore } from 'agentfootprint/memory-providers';
 *
 * @deprecated Since 8.0.0 — import from `agentfootprint/memory` instead.
 * This path keeps working for all of 8.x and is removed in 9.0.0. Every name
 * here is the same symbol on the new door, not a copy.
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
