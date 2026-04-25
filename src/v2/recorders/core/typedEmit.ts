/**
 * typedEmit — typed facade over footprintjs's `scope.$emit(name, payload)`.
 *
 * Pattern: Facade (GoF) over an untyped API.
 * Role:    Stage code inside LLMCall/Agent/slot subflows calls this helper
 *          to emit events. The EventMap + TS generics reject typos and
 *          payload drift at compile time; the runtime call is identical
 *          to footprintjs's `$emit`.
 * Emits:   Whatever `T` is — the consumer passes the type and payload.
 */

import type { AgentfootprintEventMap, AgentfootprintEventType } from '../../events/registry.js';

/**
 * Minimal scope surface we need to emit — structurally compatible with
 * footprintjs's `TypedScope<T>`, whose `$emit(name, payload?: unknown)` is
 * wider than this.
 */
interface EmitableScope {
  $emit(name: string, payload?: unknown): void;
}

/**
 * Emit a typed event from inside stage code.
 *
 * @example
 *   typedEmit(scope, 'agentfootprint.stream.llm_start', {
 *     iteration: 1,
 *     provider: 'anthropic',
 *     model: 'claude-opus-4-7',
 *     systemPromptChars: 800,
 *     messagesCount: 2,
 *     toolsCount: 0,
 *   });
 */
export function typedEmit<K extends AgentfootprintEventType>(
  scope: EmitableScope,
  type: K,
  payload: AgentfootprintEventMap[K]['payload'],
): void {
  scope.$emit(type, payload);
}
