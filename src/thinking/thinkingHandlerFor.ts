/**
 * thinkingHandlerFor — the thinking handler a provider DECLARES.
 *
 * Pattern: capability declaration (the `promptCaching` / `cacheStrategyFor`
 *          twin). The adapter knows the shape its wire's thinking arrives in
 *          and declares the handler that normalizes it
 *          (`LLMProvider.thinkingHandler`); a wrapper forwards the field like
 *          `carriesInMessages`. Never chosen by `provider.name`.
 * Role:    the ONE place `Agent` and `LLMCall` resolve their handler when the
 *          builder did not set one.
 */

import type { LLMProvider } from '../adapters/types.js';
import type { ThinkingHandler } from './types.js';

/**
 * The thinking handler `provider` declares, or `undefined` when it declares
 * none (the agent then mounts no thinking stage).
 *
 * @throws TypeError when the declaration is not a handler (no string `id`, no
 *   `normalize` function) — refused at agent build, by provider name, rather
 *   than failing on the first response that carries thinking.
 *
 * @example
 * ```ts
 * thinkingHandlerFor(withRetry(anthropic()))?.id; // 'anthropic' — the wrapper forwards it
 * ```
 */
export function thinkingHandlerFor(
  provider: Pick<LLMProvider, 'name' | 'thinkingHandler'>,
): ThinkingHandler | undefined {
  const declared = provider.thinkingHandler as Partial<ThinkingHandler> | undefined;
  if (declared === undefined) return undefined;
  if (typeof declared.id !== 'string' || typeof declared.normalize !== 'function') {
    throw new TypeError(
      `the '${provider.name}' provider declares a thinkingHandler that is not one ` +
        '(a ThinkingHandler needs a string `id` and a `normalize(raw)` function). ' +
        'Leave thinkingHandler out if the provider emits no thinking.',
    );
  }
  return declared as ThinkingHandler;
}
