/**
 * Sample 21: Provider Fallback
 *
 * Multi-provider failover chain — automatic fallback across LLM providers.
 * fallbackProvider() tries providers in order, falls back on failure.
 */
import { Agent } from 'agentfootprint';
import { fallbackProvider } from 'agentfootprint/resilience';

export async function run(input: string) {
  const fallbacks: string[] = [];

  const primaryProvider = {
    chat: async () => { throw new Error('429 Rate Limited'); },
  };

  const backupProvider = {
    chat: async () => ({
      content: 'Hello! I am the backup provider (GPT-4o). The primary was rate limited.',
      model: 'gpt-4o',
      finishReason: 'stop' as const,
    }),
  };

  const provider = fallbackProvider(
    [primaryProvider, backupProvider],
    {
      onFallback: (from: number, to: number, error: Error) => {
        fallbacks.push(`Falling back from ${from} to ${to}: ${error.message}`);
      },
      shouldFallback: (error: Error) => {
        return error.message.includes('429') || error.message.includes('500');
      },
    },
  );

  const runner = Agent.create({ provider })
    .system('You are helpful.')
    .build();

  const result = await runner.run(input);
  return { content: result.content, fallbacks };
}

if (process.argv[1] === import.meta.filename) {
  run('Hello!').then(console.log);
}
