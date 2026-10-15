/** The declared transports an Agent call can reach through reliability.
 * A nonempty ordered list replaces the default; an absent/empty list does not.
 * Skill-brain capability checks remain owned by thinkingSupport. */
import type { LLMProvider } from '../../provider-contract/types.js';
import type { ReliabilityProvider } from '../../reliability/types.js';

export interface ProviderTarget {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly site: string;
}

export function providerTargets(
  provider: LLMProvider,
  model: string,
  reliabilityProviders?: readonly ReliabilityProvider[],
): readonly ProviderTarget[] {
  return reliabilityProviders !== undefined && reliabilityProviders.length > 0
    ? reliabilityProviders.map((entry, index) => ({
        provider: entry.provider,
        model: entry.model,
        site: `reliability provider ${index + 1} ('${entry.name}')`,
      }))
    : [{ provider, model, site: 'the agent' }];
}
