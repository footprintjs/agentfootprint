/** Build-time cache diagnostic. Never evaluates a policy predicate, reads
 * prompt text, or serializes a provider/options bag. The Agent calls once
 * at construction; the returned boolean becomes fixed run-manifest metadata.
 */
import { isDevMode } from 'footprintjs';
import type { CachePolicy, CacheStrategy } from '../../cache/types.js';
import type { Injection } from '../../injection-engine/types.js';

export function cacheRequestedWithoutSupport(args: {
  readonly strategy: CacheStrategy;
  readonly providerName: string;
  readonly systemPrompt: string;
  readonly systemPolicy: CachePolicy;
  readonly injections: readonly Injection[];
  readonly disabled: boolean;
}): boolean {
  if (args.disabled || args.strategy.name !== 'none') return false;
  const requested =
    (args.systemPrompt.length > 0 && args.systemPolicy !== 'never') ||
    args.injections.some(
      (injection) =>
        injection.metadata?.cache !== undefined && injection.metadata.cache !== 'never',
    );
  if (!requested) return false;
  if (isDevMode()) {
    // eslint-disable-next-line no-console
    console.warn(
      `agentfootprint Agent: caching was requested, but provider '${args.providerName}' ` +
        'declares no prompt caching for the selected model. No cache markers will be sent. ' +
        'Choose a supported provider/model, or disable caching.',
    );
  }
  return true;
}
