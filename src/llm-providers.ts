/**
 * agentfootprint/llm-providers — LLM provider adapters (canonical subpath).
 *
 * The Block B canonical name. Mirrors the parallel structure shipped in
 * v2.5:
 *
 *   agentfootprint/llm-providers     ← LLM provider adapters (this file)
 *   agentfootprint/tool-providers    ← tool dispatch + tool sources
 *   agentfootprint/memory-providers  ← memory store adapters
 *   agentfootprint/security          ← cross-cutting authorization
 *
 * The legacy `agentfootprint/providers` subpath stays available as an
 * alias through the v2.x line — it points at the same exports. New
 * code SHOULD import from `agentfootprint/llm-providers` for clarity:
 * grep'ing for "llm-providers" finds every LLM-side import in one
 * shot, parallel to "tool-providers" and "memory-providers".
 *
 * Pattern: Adapter (GoF) — concrete `LLMProvider` implementations that
 *          translate the agentfootprint port to a specific vendor SDK.
 * Role:    Outer ring (Hexagonal). Swappable at runtime; the Agent
 *          knows nothing about vendor specifics.
 *
 * @example
 *   // New canonical import
 *   import { mock, AnthropicProvider } from 'agentfootprint/llm-providers';
 *
 *   // Legacy alias (still works through v2.x)
 *   import { mock, AnthropicProvider } from 'agentfootprint/providers';
 */

export * from './providers.js';
