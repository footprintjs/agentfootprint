/**
 * thinkingModeFor — the thinking mode a provider DECLARES for one model.
 *
 * Pattern: capability declaration (the `thinkingHandlerFor` /
 *          `cacheStrategyFor` twin). The adapter knows which thinking request
 *          each model on its wire takes and declares it
 *          (`LLMProvider.thinkingMode`); a wrapper forwards the field. Never
 *          derived from `provider.name`.
 * Role:    the ONE place the agent reads that declaration, so a malformed one
 *          is refused at build, by provider name, instead of meaning "no claim".
 */

import type { LLMProvider } from '../adapters/types.js';
import type { ThinkingMode } from './types.js';

const MODES: ReadonlySet<unknown> = new Set<ThinkingMode>(['adaptive', 'budget', 'none']);

/**
 * The mode `provider` declares for `model`, or `undefined` when it declares
 * none (it makes no per-model claim; requests carry `thinking: { budget }`
 * and the adapter decides).
 *
 * @throws TypeError when the declaration is not a function, or answers
 *   something other than `'adaptive'`, `'budget'` or `'none'`.
 *
 * @example
 * ```ts
 * thinkingModeFor(withRetry(anthropic()), 'claude-opus-5-5'); // 'adaptive'
 * ```
 */
export function thinkingModeFor(
  provider: Pick<LLMProvider, 'name' | 'thinkingMode'>,
  model: string,
): ThinkingMode | undefined {
  const declared = provider.thinkingMode as unknown;
  if (declared === undefined) return undefined;
  if (typeof declared !== 'function') {
    throw new TypeError(
      `the '${provider.name}' provider declares a thinkingMode that is not a function of the ` +
        `model id. Declare (model) => 'adaptive' | 'budget' | 'none', or leave it out.`,
    );
  }
  const mode: unknown = (declared as (model: string) => unknown)(model);
  if (!MODES.has(mode)) {
    throw new TypeError(
      `the '${provider.name}' provider's thinkingMode('${model}') answered ` +
        `${JSON.stringify(mode)}; a ThinkingMode is 'adaptive', 'budget' or 'none'.`,
    );
  }
  return mode as ThinkingMode;
}
