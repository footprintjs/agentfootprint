/** Regression: a discarded provider attempt cannot revise the accepted attempt witness. */

import { it, expect } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { NoOpCacheStrategy } from '../../../src/cache/strategies/NoOpCacheStrategy.js';
import type { LLMProvider, LLMRequest } from '../../../src/provider-contract/types.js';

const response = (id?: string, refs: string[] = []) => ({
  content: id ? '' : 'done',
  toolCalls: id
    ? [
        {
          id,
          name: 'read',
          args: refs.length
            ? {
                _findings: {
                  previous: refs.map((toolCallId) => ({ toolCallId, standing: 'fact' })),
                },
              }
            : {},
        },
      ]
    : [],
  usage: { input: 0, output: 0 },
});

for (const decorator of ['fallback', 'retry'] as const) {
  for (const acceptedHasSource of [true, false]) {
    it(
      decorator +
        ': silent accepted leaf ignores delayed discarded callback: ' +
        (acceptedHasSource
          ? 'keeps real served source'
          : 'rejects discarded committed phantom source'),
      async () => {
        let calls = 0,
          executed = 0,
          acceptedLeaves = 0,
          sourceBeforeProjection: any,
          late: (() => void) | undefined;
        class ProjectSource extends NoOpCacheStrategy {
          async prepareRequest(req: LLMRequest) {
            const found = req.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c1');
            if (found) sourceBeforeProjection = found;
            // Synthetic adversarial provider-boundary projection only.
            // The source remains committed; the accepted request never contains it.
            return {
              request: acceptedHasSource
                ? req
                : { ...req, messages: req.messages.filter((m) => m.toolCallId !== 'c1') },
              markersApplied: [],
            };
          }
        }
        const failed = async (req: LLMRequest, hooks: any) => {
          expect(sourceBeforeProjection?.toolCallId).toBe('c1');
          expect(req.messages.some((m) => m.toolCallId === 'c1')).toBe(acceptedHasSource);
          late = () =>
            hooks?.onReplayPrepared?.({
              provider: 'synthetic-failed-leaf',
              model: req.model,
              request: {
                ...req,
                messages: acceptedHasSource
                  ? req.messages.filter((m) => m.role !== 'tool')
                  : [...req.messages, sourceBeforeProjection],
              },
              omissions: [],
            });
          throw Error('synthetic discarded leaf');
        };
        const silent = async (req: LLMRequest) => {
          acceptedLeaves++;
          expect(req.messages.some((m) => m.toolCallId === 'c1')).toBe(acceptedHasSource);
          await Promise.resolve(); // accepted leaf is pending while discarded leaf reports late
          expect(late).toBeTypeOf('function');
          late!();
          // Intentionally omit optional onReplayPrepared.
          return response('c2', ['c1']);
        };
        const provider: LLMProvider = {
          name: 'scripted-primary',
          complete: async (req, hooks) => {
            calls++;
            if (calls === 1) return response('c1');
            if (calls === 2) return failed(req, hooks);
            return decorator === 'retry' && calls === 3 ? silent(req) : response();
          },
        };
        const secondary: LLMProvider = { name: 'scripted-secondary', complete: silent };
        const chosen =
          decorator === 'fallback'
            ? withFallback(provider, secondary)
            : withRetry(provider, { maxAttempts: 2, initialDelayMs: 0 });
        const agent = Agent.create({
          provider: chosen,
          model: 'mock',
          cacheStrategy: new ProjectSource(),
        })
          .tool(
            defineTool({
              name: 'read',
              description: 'scripted synthetic evidence',
              inputSchema: { type: 'object', properties: {} },
              execute: () => {
                executed++;
                return 'SYNTHETIC_BODY';
              },
            }),
          )
          .findings()
          .build();
        await agent.run({ message: 'scripted synthetic probe' });
        expect(acceptedLeaves).toBe(1);
        expect(executed).toBe(acceptedHasSource ? 2 : 1);
        expect(calls).toBe(decorator === 'fallback' ? 3 : 4);
        if (!acceptedHasSource) {
          expect((agent.getLastSnapshot()?.sharedState as any).findingsLedger).toContainEqual(
            expect.objectContaining({ kind: 'reference-refusal' }),
          );
        }
      },
    );
  }
}
