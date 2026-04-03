/**
 * compositePrompt — PromptProvider that chains multiple providers together.
 *
 * Resolves each provider in order and concatenates results with a separator.
 * Supports both sync and async providers. Empty results are filtered out.
 *
 * Usage:
 *   const prompt = compositePrompt([
 *     staticPrompt('You are a helpful assistant.'),
 *     skillBasedPrompt(skills),
 *     templatePrompt('Current turn: {{turnNumber}}.'),
 *   ]);
 */

import type { PromptProvider, PromptContext } from '../../core';

export interface CompositePromptOptions {
  /** Separator between provider results. Defaults to '\n\n'. */
  readonly separator?: string;
}

export function compositePrompt(
  providers: readonly PromptProvider[],
  options: CompositePromptOptions = {},
): PromptProvider {
  const { separator = '\n\n' } = options;

  return {
    resolve: async (ctx: PromptContext) => {
      const decisions = await Promise.all(providers.map((p) => p.resolve(ctx)));
      const values = decisions.map((d) => d.value).filter((v) => v.length > 0);
      const labels = decisions.map((d) => d.chosen).filter((c) => c !== 'static');
      return {
        value: values.join(separator),
        chosen: labels.length > 0 ? `composite: ${labels.join(' + ')}` : 'composite',
      };
    },
  };
}
