/**
 * llm-providers — LLM provider adapters.
 *
 * Pattern: Adapter (GoF) — concrete `LLMProvider` implementations that
 *          translate the agentfootprint port to a specific vendor SDK.
 * Role:    Outer ring (Hexagonal). Swappable at runtime; the Agent
 *          knows nothing about vendor specifics.
 *
 * @example
 *   import { mock, AnthropicProvider } from 'agentfootprint/providers';
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/providers`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

export * from './providers.js';
