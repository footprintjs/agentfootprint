/**
 * staticPrompt — simplest PromptProvider. Returns the same string every turn.
 *
 * Usage:
 *   agentLoop().promptProvider(staticPrompt('You are a helpful assistant.'))
 */

import type { PromptProvider } from '../../core';

export function staticPrompt(prompt: string): PromptProvider {
  return {
    resolve: () => prompt,
  };
}
