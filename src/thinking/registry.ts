/**
 * Registry — single source of truth for the framework's auto-wire
 * logic AND the shared contract test.
 *
 * Phase 3 wiring scans this array at chart build time and selects the
 * first handler whose `providerNames` includes the active
 * `provider.name`. Phase 4a adds AnthropicThinkingHandler; Phase 5
 * adds OpenAIThinkingHandler — append-only as new providers ship.
 *
 * Future provider authors:
 *   • Implement `ThinkingHandler` for your provider
 *   • Append to this array
 *   • The shared contract test in `test/thinking/contract.test.ts`
 *     verifies your handler honors the framework's invariants
 */

import { anthropicThinkingHandler } from './AnthropicThinkingHandler.js';
import { mockThinkingHandler } from './MockThinkingHandler.js';
import type { ThinkingHandler } from './types.js';

/**
 * All thinking handlers shipped with the library. Append in alphabetical
 * order (by `id`) so diffs stay readable as new handlers land.
 */
export const SHIPPED_THINKING_HANDLERS: readonly ThinkingHandler[] = [
  anthropicThinkingHandler,
  mockThinkingHandler,
  // Phase 5: openAIThinkingHandler
];

/**
 * Look up a handler by `provider.name`. Returns the first match in
 * `SHIPPED_THINKING_HANDLERS`. Returns `undefined` when no handler
 * matches — framework treats this as "no thinking support for this
 * provider", which is the correct default for providers that don't
 * emit thinking content (gpt-3.5, mistral, etc.).
 *
 * Used by:
 *   • Phase 3 framework auto-wire (chart build time)
 *   • Tests verifying registry lookup
 */
export function findThinkingHandler(providerName: string): ThinkingHandler | undefined {
  for (const handler of SHIPPED_THINKING_HANDLERS) {
    if (handler.providerNames.includes(providerName)) return handler;
  }
  return undefined;
}
