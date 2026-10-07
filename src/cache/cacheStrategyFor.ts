/**
 * cacheStrategyFor — the cache strategy for a provider, chosen from what the
 * provider DECLARES (`LLMProvider.promptCaching`), never from its name.
 *
 * Pattern: Strategy, selected by capability. The provider adapter declares
 *          how its wire caches (`'breakpoints'` | `'automatic'` | absent);
 *          this function maps the declaration to the one strategy that
 *          serves it.
 * Role:    the ONE place an agent's cache strategy is chosen (`Agent`, and a
 *          skill brain whose provider differs from the agent's).
 *
 * Why not by name: the name is a label, and labels get rewritten. The
 * registry this replaces keyed strategies by `provider.name`, so every
 * decorator that renamed its provider — `withRetry` (`anthropic+retry`),
 * `withFallback` (`a|b`), an application's own routing wrapper
 * (`my-app/anthropic`) — silently fell through to the no-op strategy: no
 * cache markers, every call at full input price, and nothing in the run to
 * say why. A wrapper that forwards the declaration (the library's three
 * decorators do) caches exactly like the adapter it wraps.
 *
 * @example
 * ```ts
 * import { cacheStrategyFor } from 'agentfootprint/cache';
 * import { withRetry } from 'agentfootprint/resilience';
 * import { anthropic } from 'agentfootprint/providers';
 *
 * cacheStrategyFor(withRetry(anthropic())).name; // 'breakpoints'
 * cacheStrategyFor({ name: 'x', complete }).name; // 'none' — nothing declared
 * ```
 */

import type { LLMProvider, PromptCaching } from '../adapters/types.js';
import type { CacheStrategy } from './types.js';
import { AutomaticCacheStrategy } from './strategies/AutomaticCacheStrategy.js';
import { BreakpointCacheStrategy } from './strategies/BreakpointCacheStrategy.js';
import { NoOpCacheStrategy } from './strategies/NoOpCacheStrategy.js';

/** One shared instance: the no-op strategy holds no state. */
const NO_CACHING = new NoOpCacheStrategy();

/**
 * The strategy that serves `provider`'s declared prompt caching.
 *
 * @throws TypeError when the declaration is malformed (an unknown `mode`, a
 *   `maxBreakpoints` that is not a positive integer, a non-boolean
 *   `reportsUsage`) — refused at agent build, by provider name. A typo that
 *   quietly fell back to "no caching" would be the very failure this
 *   function exists to end.
 */
export function cacheStrategyFor(
  provider: Pick<LLMProvider, 'name' | 'promptCaching'>,
): CacheStrategy {
  const declared = provider.promptCaching;
  if (declared === undefined) return NO_CACHING;
  const who = `the '${provider.name}' provider`;
  assertDeclaration(declared, who);
  return declared.mode === 'breakpoints'
    ? new BreakpointCacheStrategy(declared, who)
    : new AutomaticCacheStrategy(declared, who);
}

function assertDeclaration(declared: PromptCaching, who: string): void {
  const shape = declared as { mode?: unknown; maxBreakpoints?: unknown; reportsUsage?: unknown };
  const refuse = (what: string): never => {
    throw new TypeError(
      `${who} declares promptCaching ${what}. Declare { mode: 'breakpoints', maxBreakpoints, ` +
        "reportsUsage } or { mode: 'automatic', reportsUsage } — or leave promptCaching out " +
        'if the provider does no caching the agent can drive.',
    );
  };
  if (shape.mode !== 'breakpoints' && shape.mode !== 'automatic') {
    refuse(`with mode ${JSON.stringify(shape.mode)}`);
  }
  if (
    shape.mode === 'breakpoints' &&
    !(Number.isInteger(shape.maxBreakpoints) && (shape.maxBreakpoints as number) > 0)
  ) {
    refuse(`with maxBreakpoints ${JSON.stringify(shape.maxBreakpoints)} (a positive integer)`);
  }
  if (typeof shape.reportsUsage !== 'boolean') {
    refuse(`with reportsUsage ${JSON.stringify(shape.reportsUsage)} (true or false)`);
  }
}
