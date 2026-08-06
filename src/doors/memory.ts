/**
 * agentfootprint/memory — state that outlives a turn.
 *
 * `defineMemory` and the whole memory subsystem (beats, facts, causal
 * recall, embedding retrieval, pipelines, the `MemoryStore` port), together
 * with the shipped stores you can point it at: Redis, AgentCore, and the
 * read-only Bedrock Agents session-summary reader.
 *
 * Prompt caching lives at `agentfootprint/cache`, deliberately NOT here: it
 * registers vendor cache strategies on import, and side-effectful code stays
 * behind its own door rather than riding along with `defineMemory`.
 *
 * @example
 * ```ts
 * import { defineMemory, MEMORY_TYPES, RedisStore } from 'agentfootprint/memory';
 * ```
 */

export * from '../memory/index.js';
export * from '../memory-providers.js';
