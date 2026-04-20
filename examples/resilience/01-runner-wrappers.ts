/**
 * Runner-level resilience — withRetry wraps any RunnerLike with retry
 * behavior. Compose withFallback and withCircuitBreaker for the full
 * production stack.
 */

import { withRetry } from 'agentfootprint/resilience';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'resilience/01-runner-wrappers',
  title: 'withRetry / withFallback / withCircuitBreaker',
  group: 'resilience',
  description: 'Wrap any RunnerLike with retry, fallback, or circuit-breaker semantics.',
  defaultInput: 'Do something unreliable.',
  providerSlots: [],
  tags: ['resilience', 'retry', 'fallback', 'circuit-breaker'],
};

export async function run(input: string, _provider?: LLMProvider) {
  let attempt = 0;
  const flakyRunner = {
    run: async (_msg: string) => {
      attempt++;
      if (attempt < 3) throw new Error(`Server overloaded (attempt ${attempt})`);
      return { content: `Success on attempt ${attempt}` };
    },
  };

  const resilient = withRetry(flakyRunner, { maxRetries: 5, backoffMs: 0 });
  const result = await resilient.run(input);

  return { content: result.content, attempts: attempt };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
