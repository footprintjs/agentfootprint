/**
 * agentfootprint/hosting — putting an agent behind a wire.
 *
 * The hosts (`nodeHost`, `httpHost`, `standingAgent`), the session stores
 * (in-memory, SQLite), the checkpoint envelope helpers, the typed host
 * errors — and the AgentCore runtime host + session adapters that speak the
 * same ports.
 *
 * @example
 * ```ts
 * import { httpHost, memorySessions, agentCoreRuntimeHost } from 'agentfootprint/hosting';
 * ```
 */

export * from '../hosting/index.js';
export * from '../hosting-providers.js';
