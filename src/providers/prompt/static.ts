/**
 * staticPrompt — simplest PromptProvider. Returns the same string every turn.
 */

import type { PromptProvider } from '../../core';

export function staticPrompt(prompt: string): PromptProvider {
  return {
    resolve: () => ({ value: prompt, chosen: 'static' }),
  };
}
