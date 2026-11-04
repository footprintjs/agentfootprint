import { expect, it } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { ServedToolParties } from '../../slots/buildToolsSlot.js';
import type { ToolParty } from '../../../tools/toolParty.js';
import { jsonBytes } from '../../../lib/boundedJson.js';
import { readServedParties, restoreServedParties, saveServedParties } from './servedParties.js';
import { buildToolResolver } from './toolResolver.js';
import { defineTool } from '../../../tools/tools.js';
import { Agent, isPaused, requestInput } from '../../../index.js';
import type { LLMResponse } from '../../../provider-contract/types.js';

const party: ToolParty = { channel: 'registry' };
function scopeOf() {
  const state: Record<string, unknown> = {
    toolResourceOwner: {
      version: 1,
      birth: { runId: 'run', componentOrdinal: 0 },
      nextDispatch: 0,
    },
    turnNumber: 1,
    iteration: 1,
    llmLatestToolCalls: [],
  };
  return Object.assign(state, {
    $getValue: (key: string) => state[key],
  }) as unknown as TypedScope<AgentState>;
}
function offered(names: readonly string[]): ServedToolParties {
  return {
    current: new Map(names.map((name) => [name, party])),
    lastServed: new Map(names.map((name) => [name, party])),
  };
}

it.each([
  ['row limit', 1100, (i: number) => `tool-${i}`],
  ['byte limit', 650, (i: number) => `${String(i).padStart(5, '0')}-${'x'.repeat(64)}`],
  ['escaped UTF-8 bytes', 700, (i: number) => `${i}-\u0001${'界'.repeat(48)}`],
] as const)(
  'a legal catalog over the %s remains a bounded resumable pause',
  (_reason, count, nameOf) => {
    const names = Array.from({ length: count }, (_, index) => nameOf(index));
    const scope = scopeOf();
    expect(() => saveServedParties(scope, offered(names))).not.toThrow();
    const carrier = readServedParties(scope as unknown as Record<string, unknown>);
    expect(carrier.last.length).toBeGreaterThan(0);
    expect(carrier.last.length).toBeLessThan(count);
    expect(carrier.last.length).toBeLessThanOrEqual(1024);
    expect(jsonBytes(carrier)).toBeLessThanOrEqual(131072);
    expect(carrier.last.at(-1)?.name.value).toBe(names.at(-1));
    expect(carrier.current).toEqual(carrier.last);
  },
);

it('drops old history first and cannot assign an omitted name to a current holder on restore', () => {
  const scope = scopeOf();
  const names = Array.from({ length: 1100 }, (_, index) => `tool-${index}`);
  const served = offered(names);
  saveServedParties(scope, served);
  const carrier = readServedParties(scope as unknown as Record<string, unknown>);
  expect(carrier.last[0]?.name.value).not.toBe(names[0]);
  const restored: ServedToolParties = { current: new Map(), lastServed: new Map() };
  restoreServedParties(scope, restored);
  const omitted = defineTool({
    name: names[0]!,
    description: 'omitted',
    inputSchema: { type: 'object' },
    execute: () => 'unsafe',
  });
  const resolve = buildToolResolver({
    registryByName: new Map([[names[0]!, omitted]]),
    servedTools: restored,
    notServed: () => 'not served',
  });
  expect(resolve(names[0]!)).toEqual({ refusal: 'not served' });
  expect(resolve(names[0]!, party)).toEqual({ refusal: 'not served' });
});

it('bounds remembered epochs independently of the current wire', () => {
  const scope = scopeOf();
  const names = Array.from({ length: 1500 }, (_, index) => `tool-${index}`);
  const served = offered(names);
  served.current = new Map([[names.at(-1)!, party]]);
  saveServedParties(scope, served);
  const carrier = readServedParties(scope as unknown as Record<string, unknown>);
  expect(carrier.current).toEqual([{ name: { kind: 'plain', value: names.at(-1) }, party }]);
  expect(carrier.last.length).toBeLessThanOrEqual(1024);
  expect(carrier.last.at(-1)?.name.value).toBe(names.at(-1));
});

it('keeps current wire order and does not inspect unrelated checkpoint fields', () => {
  const scope = scopeOf();
  const served = offered(['first', 'second']);
  served.current = new Map([
    ['second', party],
    ['first', party],
  ]);
  saveServedParties(scope, served);
  const leaf = Object.assign(
    Object.create({ unrelated: 'inherited' }) as Record<string, unknown>,
    scope,
  );
  Object.defineProperty(leaf, 'otherDomain', {
    get: () => {
      throw new Error('unrelated getter');
    },
  });
  expect(readServedParties(leaf).current.map((row) => row.name.value)).toEqual(['second', 'first']);
  const bad = { ...scope };
  Object.defineProperty(bad, 'servedToolParties', {
    get: () => {
      throw new Error('carrier getter');
    },
  });
  expect(() => readServedParties(bad as unknown as Record<string, unknown>)).toThrow();
});

it('a positively acquired wire adds no carrier reads to an ordinary batch', () => {
  const scope = {
    $getValue: () => {
      throw new Error('phantom carrier read');
    },
  } as unknown as TypedScope<AgentState>;
  const served = { ...offered([]), wireReady: true as const };
  expect(() => restoreServedParties(scope, served)).not.toThrow();
});

it.each(['same', 'fresh'] as const)(
  'a validated %s ask receipt retains call ownership when the finite wire omits its name',
  async (mode) => {
    let calls = 0,
      effects = 0;
    const make = () =>
      Agent.create({
        provider: {
          name: 'scripted',
          complete: async (): Promise<LLMResponse> => {
            calls++;
            return calls === 1
              ? {
                  content: '',
                  toolCalls: [{ id: 'ask', name: 'collect', args: {} }],
                  usage: { input: 1, output: 1 },
                }
              : { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
          },
        },
        model: 'mock',
      })
        .tools([
          defineTool({
            name: 'collect',
            description: 'Collect',
            inputSchema: { type: 'object', properties: { year: { type: 'number' } } },
            askOrAssume: { year: { ask: 'Which year?' } },
            execute: () => {
              effects++;
              return 'called';
            },
          }),
          ...Array.from({ length: 1100 }, (_, index) =>
            defineTool({
              name: `other-${index}`,
              description: 'Other',
              inputSchema: { type: 'object' },
              execute: () => 'unused',
            }),
          ),
        ])
        .build();
    const agent = make(),
      paused = await agent.run('go');
    if (!isPaused(paused) || paused.awaitingInput === undefined) throw new Error('Expected ask');
    const carrier = readServedParties(paused.checkpoint.sharedState);
    expect(carrier.current.some((row) => row.name.value === 'collect')).toBe(false);
    expect(carrier.last.some((row) => row.name.value === 'collect')).toBe(false);
    const resumed = mode === 'same' ? agent : make();
    await expect(
      resumed.resume(paused.checkpoint, {
        requestId: paused.awaitingInput.requestId,
        values: { f1: 2026 },
      }),
    ).resolves.toBe('done');
    expect(effects).toBe(1);
  },
);

it('does not fail a tool that pauses after many rotating provider epochs', async () => {
  let iteration = 0,
    effects = 0;
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (): Promise<LLMResponse> => {
        iteration++;
        if (iteration > 20)
          return { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
        return {
          content: '',
          toolCalls: [
            {
              id: `c-${iteration}`,
              name: iteration < 20 ? `tool-${iteration}-0` : 'pauser',
              args: {},
            },
          ],
          usage: { input: 1, output: 1 },
        };
      },
    },
    model: 'mock',
    reactMode: 'dynamic',
    maxIterations: 30,
  })
    .tool(
      defineTool({
        name: 'pauser',
        description: 'Pause',
        inputSchema: { type: 'object' },
        execute: () => {
          effects++;
          return requestInput({
            id: 'question',
            question: 'Which value?',
            fields: [{ id: 'value', type: 'string', required: true }],
          });
        },
      }),
    )
    .toolProvider({
      id: 'rotating',
      list: (context) =>
        Array.from({ length: 60 }, (_, index) =>
          defineTool({
            name: `tool-${context.iteration}-${index}`,
            description: 'Tool',
            inputSchema: { type: 'object' },
            execute: () => 'done',
          }),
        ),
    })
    .build();
  const paused = await agent.run('go');
  expect(isPaused(paused)).toBe(true);
  expect(effects).toBe(1);
  expect(iteration).toBe(20);
  if (!isPaused(paused)) throw new Error('Expected pause');
  const carrier = readServedParties(paused.checkpoint.sharedState);
  expect(carrier.last.length).toBeLessThanOrEqual(1024);
  expect(jsonBytes(carrier)).toBeLessThanOrEqual(131072);
  expect(carrier.current.some((row) => row.name.value === 'pauser')).toBe(true);
  await expect(
    agent.resume(paused.checkpoint, {
      requestId: paused.awaitingInput!.requestId,
      values: { value: 'answered' },
    }),
  ).resolves.toBe('done');
  expect(effects).toBe(1);
});
