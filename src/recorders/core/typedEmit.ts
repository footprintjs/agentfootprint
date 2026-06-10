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

import { isDevMode } from 'footprintjs';
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
 * Dev-mode contract guard (RFC-001 Block 10): library event payloads must
 * be DETACHED PLAIN DATA — structured-clone-safe. A payload holding a live
 * TypedScope proxy (e.g. `history: scope.history` instead of a plain local
 * array) breaks `observerDelivery: 'deferred'`: 'clone' capture degrades
 * to 'summary' and the EmitBridge can no longer forward the typed event.
 * Warn once per event type; zero cost in production (isDevMode-gated).
 */
const warnedUnclonable = new Set<string>();

function devWarnIfUnclonable(type: string, payload: unknown): void {
  if (!isDevMode() || warnedUnclonable.has(type)) return;
  try {
    structuredClone(payload);
  } catch {
    warnedUnclonable.add(type);
    // eslint-disable-next-line no-console
    console.warn(
      `[agentfootprint typedEmit] payload of '${type}' is not structured-clone-safe ` +
        '(does it hold a live scope proxy or a class instance?). Typed event payloads ' +
        "must be detached plain data — under observerDelivery: 'deferred' this event " +
        'would degrade to a summary and never reach agent.on() listeners.',
    );
  }
}

/**
 * Emit a typed event from inside stage code.
 *
 * @example
 *   typedEmit(scope, 'agentfootprint.stream.llm_start', {
 *     iteration: 1,
 *     provider: 'anthropic',
 *     model: 'claude-opus-4-8',
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
  devWarnIfUnclonable(type, payload);
  scope.$emit(type, payload);
}
