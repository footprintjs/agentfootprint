/**
 * Sample 09: Resilience
 *
 * withRetry, withFallback — wrap any RunnerLike with retry/fallback.
 */
import { withRetry } from 'agentfootprint/resilience';

export async function run(input: string) {
  let attempt = 0;
  const flakyRunner = {
    run: async (_msg: string) => {
      attempt++;
      if (attempt < 3) throw new Error('Server overloaded (attempt ' + attempt + ')');
      return { content: 'Success on attempt ' + attempt };
    },
  };

  const resilient = withRetry(flakyRunner, { maxRetries: 5, backoffMs: 0 });
  const result = await resilient.run(input);

  return { content: result.content, attempts: attempt };
}

if (process.argv[1] === import.meta.filename) {
  run('Do something unreliable.').then(console.log);
}
