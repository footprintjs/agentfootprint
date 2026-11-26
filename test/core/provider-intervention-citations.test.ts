import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, describedResult } from '../../src/index.js';
import { recordRun } from '../../src/observe.js';
import {
  prepareCitationOffer,
  requestAttempt,
} from '../../src/provider-contract/requestObserver.js';
import type {
  LLMCallHooks,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../src/provider-contract/types.js';
import type { ProseCitationOptions } from '../../src/core/agent/citations/config.js';

const citations: ProseCitationOptions = {
  verification: {
    rules: [
      {
        id: 'measurement',
        version: '1',
        toolName: 'measure',
        scopeDeclaration: {
          id: 'measurement',
          version: '1',
          dimensions: [{ name: 'unit', argumentPath: ['unit'] }],
        },
        fact: { entity: 'North', field: 'amount' },
        coverage: () => 'complete',
      },
    ],
    authorizeEvidence: () => ({ resultVisible: true, scopeVisible: true }),
  },
  extractClaim: (span) =>
    span === 'North recorded 12 mm'
      ? {
          ruleId: 'measurement',
          entity: 'North',
          field: 'amount',
          intendedScope: { unit: 'mm' },
          value: 12,
        }
      : undefined,
};

type Outcome = 'ordinary' | 'masked' | 'blocked' | 'unknown';
function fixture(outcome: Outcome, transport: 'complete' | 'stream') {
  let calls = 0;
  let forbiddenReads = 0;
  const answer = (request: LLMRequest, hooks: LLMCallHooks | undefined): LLMResponse => {
    calls++;
    if (calls === 1)
      return {
        content: '',
        usage: { input: 2, output: 3 },
        stopReason: 'tool_use',
        toolCalls: [{ id: 'measurement', name: 'measure', args: { unit: 'mm' } }],
      };
    if (calls !== 2) throw new Error('Unexpected extra model invocation.');
    const attempt = requestAttempt(hooks, request);
    try {
      const rows = request.messages
        .filter((row) => row.role === 'tool')
        .map((source, index) => ({ source, body: source.content, blockNumber: index + 1 }));
      const offer = prepareCitationOffer(attempt.hooks, rows);
      expect(offer).toBeDefined();
      const marker = offer?.instruction.match(/\[c:[A-Za-z0-9_-]+:1\]/u)?.[0];
      expect(marker).toBeDefined();
      const response: LLMResponse =
        outcome === 'blocked' || outcome === 'unknown'
          ? {
              usage: { input: 2, output: 3 },
              stopReason: 'content_filter',
              intervention: { outcome, code: 'guardrail_intervened', filters: [] },
              get content() {
                forbiddenReads++;
                throw new Error('Private terminal content');
              },
              get toolCalls() {
                forbiddenReads++;
                throw new Error('Private terminal tools');
              },
              get replay() {
                forbiddenReads++;
                throw new Error('Private terminal replay');
              },
            }
          : {
              content: `North recorded 12 mm ${marker}.`,
              toolCalls: [],
              usage: { input: 2, output: 3 },
              stopReason: 'stop',
              ...(outcome === 'masked' && {
                intervention: { outcome, code: 'guardrail_intervened', filters: [] },
              }),
            };
      offer?.accept(response);
      attempt.close('response');
      return response;
    } finally {
      attempt.close();
    }
  };
  const complete = vi.fn(async (request: LLMRequest, hooks?: LLMCallHooks) =>
    answer(request, hooks),
  );
  const stream = vi.fn(async function* (request: LLMRequest, hooks?: LLMCallHooks) {
    const response = answer(request, hooks);
    yield { tokenIndex: 0, content: '', done: true, response };
  });
  const provider: LLMProvider = {
    name: 'scripted-citation-leaf',
    complete,
    ...(transport === 'stream' && { stream }),
  };
  return { provider, complete, stream, calls: () => calls, forbiddenReads: () => forbiddenReads };
}

describe('citations survive usable intervention admission only', () => {
  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    for (const transport of ['complete', 'stream'] as const) {
      for (const outcome of ['ordinary', 'masked', 'blocked', 'unknown'] as const) {
        it(`${reactMode}/${transport}/${outcome} keeps the accepted-response boundary`, async () => {
          const scripted = fixture(outcome, transport);
          const execute = vi.fn(() =>
            describedResult({
              facts: [{ entity: 'North', amount: 12 }],
              provenance: { measuredAt: '2026-11-23T00:00:00Z', source: 'fixture' },
              coverage: { checked: ['amount'] },
            }),
          );
          const agent = Agent.create({
            provider: scripted.provider,
            model: 'scripted',
            reactMode,
            citations,
          })
            .tool(
              defineTool({
                name: 'measure',
                description: 'Read a measurement.',
                inputSchema: {
                  type: 'object',
                  properties: { unit: { type: 'string' } },
                  required: ['unit'],
                },
                execute,
              }),
            )
            .build();
          const recording = recordRun(agent);
          try {
            if (outcome === 'ordinary' || outcome === 'masked') {
              await expect(agent.run('Read the measurement in mm.')).resolves.toMatch(
                /North recorded 12 mm \[c:/u,
              );
              expect(recording.toRecording().snapshot?.sharedState?.answerCitations).toMatchObject({
                complete: true,
                findings: [{ kind: 'citation', slot: 1, outcome: 'supported' }],
              });
            } else {
              await expect(agent.run('Read the measurement in mm.')).rejects.toMatchObject({
                code:
                  outcome === 'blocked'
                    ? 'ERR_PROVIDER_BLOCKED'
                    : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
              });
              expect(
                recording.toRecording().snapshot?.sharedState?.answerCitations,
              ).toBeUndefined();
            }
            expect(scripted.calls()).toBe(2);
            expect(execute).toHaveBeenCalledTimes(1);
            expect(scripted.forbiddenReads()).toBe(0);
            expect(scripted.complete).toHaveBeenCalledTimes(transport === 'complete' ? 2 : 0);
            expect(scripted.stream).toHaveBeenCalledTimes(transport === 'stream' ? 2 : 0);
          } finally {
            recording.stop();
            await agent.shutdown();
          }
        });
      }
    }
  }
});
