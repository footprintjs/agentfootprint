/** Scripted stream timeout and retry. No AWS account, credentials or calls. */
import { bedrock, ProviderTimeoutError } from '../../src/doors/providers.js';
import { withRetry } from '../../src/resilience/index.js';
import type { LLMResponse } from '../../src/provider-contract/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/107-bedrock-stream-deadline',
  title: 'Recover a silent Bedrock stream',
  group: 'features',
  description: 'A scripted stalled request times out; the next attempt streams normally.',
  defaultInput: 'Show the next step.',
  providerSlots: [],
  tags: ['feature', 'bedrock', 'timeout', 'retry'],
};

class Command {
  constructor(readonly input: unknown) {}
}

export async function run(input = meta.defaultInput ?? 'Next step'): Promise<unknown> {
  let attempts = 0;
  let observedTimeout = false;
  // #region timeout
  // In an application: bedrock({ region: 'us-east-1', timeoutMs: 30_000, firstOutputTimeoutMs: 120_000, responseTimeoutMs: 180_000 }).
  // This example supplies an entirely local SDK double instead.
  const provider = bedrock({
    timeoutMs: 20,
    firstOutputTimeoutMs: 20,
    responseTimeoutMs: 100,
    _commands: { Converse: Command, ConverseStream: Command },
    _client: {
      send: async () => {
        attempts++;
        if (attempts === 1) return new Promise(() => undefined);
        return {
          stream: (async function* () {
            yield { contentBlockDelta: { delta: { text: 'Ready.' } } };
          })(),
        };
      },
    },
  });
  const resilient = withRetry(provider, {
    maxAttempts: 2,
    initialDelayMs: 0,
    onRetry: (error) => {
      observedTimeout = error instanceof ProviderTimeoutError;
    },
  });
  let answer: LLMResponse | undefined;
  for await (const chunk of resilient.stream!({
    model: 'bedrock',
    messages: [{ role: 'user', content: input }],
  })) {
    if (chunk.done) answer = chunk.response;
  }
  // #endregion timeout
  if (answer?.content !== 'Ready.' || attempts !== 2 || !observedTimeout) {
    throw new Error('The scripted timeout was not recovered.');
  }
  return { answer: answer.content, attempts, observedTimeout, liveAwsCalls: 0 };
}

if (isCliEntry(import.meta.url)) run().then(printResult);
