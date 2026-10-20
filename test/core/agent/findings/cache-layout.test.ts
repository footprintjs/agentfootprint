import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import type { LLMRequest } from '../../../../src/provider-contract/types.js';
import { isLibraryAuthoredFrame } from '../../../../src/lib/saidByPerson.js';

const prefix = '[AgentFootprint findings DATA v1]';
async function run(mode: 'dynamic' | 'dynamic-grouped', caching?: 'off') {
  const requests: LLMRequest[] = [];
  let step = 0;
  const inner = mock({
    respond(request) {
      // Framework arrays may be proxy-backed; capture the JSON wire data.
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      step++;
      if (step < 3)
        return {
          content: '',
          toolCalls: [
            {
              id: `opaque-${step}`,
              name: 'lookup',
              args: {
                ...(step === 2 && {
                  _findings: {
                    basis: 'direct',
                    previous: [
                      {
                        toolCallId: 'opaque-1',
                        standing: 'fact',
                        assertions: [
                          {
                            subject: { kind: 'fixture', id: 'one' },
                            predicate: 'value',
                            value: 'synthetic-value',
                          },
                        ],
                      },
                    ],
                  },
                }),
              },
            },
          ],
        };
      return 'Synthetic answer.';
    },
  });
  const provider = {
    name: inner.name,
    complete: inner.complete.bind(inner),
    promptCaching: { mode: 'breakpoints' as const, maxBreakpoints: 4, reportsUsage: true },
  };
  const agent = Agent.create({
    provider,
    model: 'mock',
    reactMode: mode,
    maxIterations: 5,
    ...(caching && { caching }),
  })
    .system('Inspect the synthetic fixture.')
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Read one synthetic value.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => 'synthetic-value',
      }),
    )
    .findings()
    .build();
  await agent.run({ message: 'Read the fixture.' });
  return { agent, requests };
}

describe('findings stable cache layout', () => {
  for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${mode}: tool definitions and immutable system text stay stable as the offer and ledger change`, async () => {
      const { requests } = await run(mode);
      expect(requests).toHaveLength(3);
      expect(requests.map((request) => JSON.stringify(request.tools))).toEqual(
        Array(3).fill(JSON.stringify(requests[0]!.tools)),
      );
      expect(requests.map((request) => request.systemPrompt)).toEqual(
        Array(3).fill(requests[0]!.systemPrompt),
      );
      const tails = requests.map((request) =>
        request.messages.filter((message) => message.content.startsWith(prefix)),
      );
      expect(tails.map((tail) => tail.length)).toEqual([1, 1, 1]);
      expect(tails[1]![0]!.content).toContain('opaque-1');
      expect(tails[2]![0]!.content).toContain('synthetic-value');
      for (const tail of tails) expect(isLibraryAuthoredFrame(tail[0])).toBe(true);
      expect(requests[2]!.systemPrompt).not.toContain('synthetic-value');
    });
    it(`${mode}: cache breakpoints stop at committed history before the request-only findings data`, async () => {
      const { requests } = await run(mode);
      const request = requests[1]!;
      expect(request.cacheMarkers?.length ?? 0).toBeGreaterThan(0);
      const tail = request.messages.findIndex((message) => message.content.startsWith(prefix));
      const conversationMarkers =
        request.cacheMarkers?.filter((marker) => marker.field === 'messages') ?? [];
      expect(conversationMarkers.length).toBeGreaterThan(0);
      for (const marker of conversationMarkers) expect(marker.boundaryIndex).toBeLessThan(tail);
    });
  }
  it('global caching off keeps the same model content and removes all markers', async () => {
    const cached = await run('dynamic');
    const off = await run('dynamic', 'off');
    expect(off.requests.every((request) => !request.cacheMarkers?.length)).toBe(true);
    const content = (requests: LLMRequest[]) =>
      requests.map(({ cacheMarkers: _markers, ...request }) => request);
    expect(content(off.requests)).toEqual(content(cached.requests));
  });
});

describe('host-owned findings context ceiling', () => {
  it.each([0, -1, 1.5, 1023, 262145])(
    'refuses invalid %s before constructing a runnable agent or calling a provider',
    (value) => {
      let calls = 0;
      const provider = mock({
        respond() {
          calls++;
          return 'done';
        },
      });
      expect(() =>
        Agent.create({ provider, model: 'mock' }).findings({ maxContextBytes: value }),
      ).toThrow(RangeError);
      expect(() =>
        Agent.create({ provider, model: 'mock', findings: { maxContextBytes: value } }).build(),
      ).toThrow(RangeError);
      expect(calls).toBe(0);
    },
  );
  it('parallel independent agents keep their own request frames and ledgers', async () => {
    const all = await Promise.all([run('dynamic'), run('dynamic-grouped')]);
    expect(all[0].agent).not.toBe(all[1].agent);
    const first = all[0].requests[2]!.messages.at(-1)!;
    const second = all[1].requests[2]!.messages.at(-1)!;
    expect(first).not.toBe(second);
    expect(first.content).toBe(second.content);
    first.content = 'test-side mutation';
    expect(second.content).toContain('synthetic-value');
  });
});
