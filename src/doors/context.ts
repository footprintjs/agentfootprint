/**
 * agentfootprint/context — how the model's context gets assembled.
 *
 * The injection engine: one `Injection` type, the sugar factories that build
 * one, and the engine subflow that resolves them into the three slots a
 * request is made of (system prompt, messages, tools).
 *
 * Named for the job rather than the machine — this was
 * `agentfootprint/injection-engine`, which described our implementation
 * instead of your task.
 *
 * @example
 * ```ts
 * import { defineInjection, type Injection } from 'agentfootprint/context';
 * ```
 */

export * from '../injection-engine.js';
