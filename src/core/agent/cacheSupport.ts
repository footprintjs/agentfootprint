/** Build-time cache diagnostic. Never evaluates a policy predicate, reads
 * prompt text, or serializes a provider/options bag. The Agent calls once
 * at construction; the returned policy source becomes fixed run metadata.
 */
import { isDevMode } from 'footprintjs';
import type { CachePolicy, CacheStrategy } from '../../cache/types.js';
import type { Injection } from '../../injection-engine/types.js';

export function cacheRequestedWithoutSupport(args: {
  readonly strategy: CacheStrategy;
  readonly providerName: string;
  readonly systemPrompt: string;
  readonly systemPolicy: CachePolicy;
  readonly systemExplicit: boolean;
  readonly modelAwareUnavailable: boolean;
  readonly injections: readonly Injection[];
  readonly disabled: boolean;
}): 'explicit' | 'default' | undefined {
  if (args.disabled || args.strategy.name !== 'none') return undefined;
  let requested: 'explicit' | 'default' | undefined =
    args.systemPrompt.length > 0 && args.systemPolicy !== 'never'
      ? args.systemExplicit
        ? 'explicit'
        : 'default'
      : undefined;
  for (const injection of args.injections) {
    if (
      !(
        injection.inject.systemPrompt?.length ||
        injection.inject.messages?.length ||
        injection.inject.tools?.length
      )
    )
      continue;
    if (injection.metadata?.cache === undefined || injection.metadata.cache === 'never') continue;
    // Named factories record the source before applying their defaults. A
    // custom Injection that authors metadata.cache itself is explicit.
    const source = injection.metadata.cachePolicySource === 'default' ? 'default' : 'explicit';
    if (source === 'explicit' || requested === undefined) requested = source;
  }
  if (requested === undefined) return undefined;
  if (isDevMode() && (requested === 'explicit' || args.modelAwareUnavailable)) {
    // eslint-disable-next-line no-console
    console.warn(
      (requested === 'explicit'
        ? `agentfootprint Agent: caching was requested, but provider '${args.providerName}' `
        : `agentfootprint Agent: the default cache policy applies, but provider '${args.providerName}' `) +
        "is configured with cache strategy 'none'. No cache markers will be sent. " +
        'Choose a supported provider/model, or disable caching.',
    );
  }
  return requested;
}
