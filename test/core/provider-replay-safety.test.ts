import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { forbidAutomaticReplay } from '../../src/provider-contract/replaySafety.js';
import { Agent } from '../../src/core/Agent.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

describe('withheld transport failure remains transport, without an automatic resend', () => {
  for (const wrapped of ['retry', 'fallback', 'rules'] as const) {
    for (const stream of [false, true]) {
      it(`${wrapped} bypasses its policy (stream=${stream}) and preserves original error`, async () => {
        const cause = new Error('connection was interrupted');
        const error = forbidAutomaticReplay(
          Object.assign(new Error('[bedrock] transport interrupted'), {
            name: 'BedrockProviderError',
            cause,
            status: 503,
          }),
        );
        const complete = vi.fn(async () => {
          throw error;
        });
        const provider: LLMProvider = {
          name: 'scripted',
          complete,
          ...(stream && {
            stream: async function* () {
              yield await complete();
            },
          }),
        };
        const policy = vi.fn(() => {
          throw new Error('must not enter automatic resend policy');
        });
        const alternative = vi.fn(async () => ({
          content: 'wrong fallback',
          toolCalls: [],
          usage: { input: 0, output: 0 },
          stopReason: 'stop',
        }));
        let run: () => Promise<unknown>;
        if (wrapped === 'rules') {
          const agent = Agent.create({ provider, model: 'scripted' })
            .reliability({ postDecide: [{ when: policy, then: 'retry', kind: 'custom' }] })
            .build();
          run = () => agent.run('hello');
        } else {
          const side =
            wrapped === 'retry'
              ? withRetry(provider, { shouldRetry: policy })
              : withFallback(
                  provider,
                  { name: 'other', complete: alternative },
                  { shouldFallback: policy },
                );
          run = async () => {
            if (stream) {
              for await (const chunk of side.stream!({ model: 'x', messages: [] })) void chunk;
            } else await side.complete({ model: 'x', messages: [] });
          };
        }
        const result = await run().then(
          () => undefined,
          (caught: unknown) => caught,
        );
        // Agent may carry a transport recovery checkpoint, never a fabricated
        // ProviderBlocked/Unknown outcome. Its original cause remains reachable.
        const actual = (result as { cause?: unknown })?.cause === error ? error : result;
        expect(actual).toBe(error);
        expect(error.cause).toBe(cause);
        expect(error).not.toHaveProperty('intervention');
        expect(policy).not.toHaveBeenCalled();
        expect(complete).toHaveBeenCalledTimes(1);
        expect(alternative).not.toHaveBeenCalled();
      });
    }
  }
});
