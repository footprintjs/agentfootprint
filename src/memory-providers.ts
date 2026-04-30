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
 *   // New canonical import
 *   import { RedisStore } from 'agentfootprint/memory-providers';
 *
 *   // Legacy per-adapter alias (still works through v2.x)
 *   import { RedisStore } from 'agentfootprint/memory-redis';
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
  type AgentCoreStoreOptions,
  type AgentCoreLikeClient,
} from './adapters/memory/agentcore.js';
