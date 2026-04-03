/**
 * Agent — re-exports builder and runner from split files.
 * Preserves backward compatibility for imports.
 */
export { Agent } from './AgentBuilder';
export type { AgentOptions } from './AgentBuilder';
export { AgentRunner } from './AgentRunner';
