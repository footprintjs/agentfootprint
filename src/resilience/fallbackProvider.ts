/**
 * fallbackProvider — convenience for chained fallbacks across N providers.
 *
 * Pattern: Chain of Responsibility (GoF) over `LLMProvider` instances.
 * Role:    Outer ring (Hexagonal). Sugar over repeated `withFallback`.
 *
 * `fallbackProvider(p1, p2, p3)` is equivalent to
 * `withFallback(p1, withFallback(p2, p3))` — tries each provider in
 * order, advancing on errors that match the (optional) shouldFallback
 * predicate. The first success wins; if all fail, the last error throws.
 *
 * @example
 *   import { anthropic, openai, mock } from 'agentfootprint/providers';
 *   import { fallbackProvider } from 'agentfootprint/resilience';
 *
 *   const provider = fallbackProvider(
 *     anthropic({ apiKey: A }),
 *     openai({ apiKey: O }),
 *     mock({ reply: '[degraded] all upstream providers failed' }),
 *   );
 */

import type { LLMProvider } from '../adapters/types.js';
import { withFallback, type WithFallbackOptions } from './withFallback.js';

export interface FallbackProviderOptions extends WithFallbackOptions {
  /** Optional explicit name for the chained provider. */
  readonly name?: string;
}

/**
 * Compose N providers into a single fallback chain. At least one
 * provider is required; throws synchronously on empty input.
 */
export function fallbackProvider(...providers: readonly LLMProvider[]): LLMProvider;
export function fallbackProvider(
  options: FallbackProviderOptions,
  ...providers: readonly LLMProvider[]
): LLMProvider;
export function fallbackProvider(
  first: LLMProvider | FallbackProviderOptions,
  ...rest: readonly LLMProvider[]
): LLMProvider {
  // Distinguish overload: an options object has no `name` of type "function".
  // LLMProvider has `complete: function`; options doesn't.
  const hasComplete = (x: unknown): x is LLMProvider =>
    typeof x === 'object' && x !== null && typeof (x as LLMProvider).complete === 'function';

  let providers: readonly LLMProvider[];
  let options: FallbackProviderOptions = {};
  if (hasComplete(first)) {
    providers = [first, ...rest];
  } else {
    providers = rest;
    options = first;
  }

  // Length is checked first so the array accesses below are guaranteed
  // non-undefined; explicit guards satisfy TypeScript without `!`.
  if (providers.length === 0) {
    throw new Error('fallbackProvider() requires at least one provider');
  }
  const head = providers[0];
  const tail = providers[providers.length - 1];
  if (!head || !tail) {
    throw new Error('fallbackProvider() unreachable: array access after length guard');
  }
  if (providers.length === 1) {
    return head;
  }

  // Right-fold: withFallback(p0, withFallback(p1, withFallback(p2, p3)))
  let chained = tail;
  for (let i = providers.length - 2; i >= 0; i--) {
    const cur = providers[i];
    if (!cur) continue; // unreachable; guarded by loop bounds
    chained = withFallback(cur, chained, options);
  }

  // Optionally override the auto-generated name.
  if (options.name) {
    return { ...chained, name: options.name };
  }
  return chained;
}
