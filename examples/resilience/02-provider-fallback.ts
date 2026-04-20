/**
 * fallbackProvider() — multi-provider failover at the LLMProvider level.
 * Tries providers in order; falls through to the next on failure.
 *
 * Operates at the provider interface, so it can switch between model
 * families (Claude → GPT → local Ollama) — something infrastructure-level
 * load balancers can't do.
 */

import { Agent } from 'agentfootprint';
import { fallbackProvider } from 'agentfootprint/resilience';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'resilience/02-provider-fallback',
  title: 'fallbackProvider — multi-provider failover',
  group: 'resilience',
  description: 'Automatic failover across LLM providers (Anthropic → OpenAI → local).',
  defaultInput: 'Hello!',
  providerSlots: [],
  tags: ['resilience', 'fallback', 'provider'],
};

export async function run(input: string, _provider?: LLMProvider) {
  const fallbacks: string[] = [];

  const primaryProvider = {
    chat: async () => {
      throw new Error('429 Rate Limited');
    },
  };

  const backupProvider = {
    chat: async () => ({
      content: 'Hello! I am the backup provider. The primary was rate limited.',
      model: 'gpt-4o',
      finishReason: 'stop' as const,
    }),
  };

  const provider = fallbackProvider([primaryProvider, backupProvider], {
    onFallback: (from: number, to: number, error: unknown) => {
      fallbacks.push(`Falling back from ${from} to ${to}: ${(error as Error).message}`);
    },
    shouldFallback: (error: unknown) => {
      return (
        error instanceof Error &&
        (error.message.includes('429') || error.message.includes('500'))
      );
    },
  });

  const runner = Agent.create({ provider }).system('You are helpful.').build();
  const result = await runner.run(input);
  return { content: result.content, fallbacks };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
