/**
 * Coverage belongs to the actual admitted native record. An independently
 * executed chart cannot replace that record; missing domain coverage refuses.
 */
import { FlowChartExecutor } from 'footprintjs';
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  Conditional,
  LLMCall,
  Loop,
  Parallel,
  Sequence,
  graph,
  llmRouter,
  workflow,
} from '../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../src/provider-contract/types.js';
import type { Runner } from '../../src/core/runner.js';
import { mock } from '../../src/doors/providers.js';
import { servedUnderPolicy } from '../../src/redaction/marker.js';
import { carriedConversationPolicy, locationsOf } from './fixture.js';
import { UnknownRun } from './nativeRun.fixture.js';

// Select the fixture canary where each runner records its input.
const KEYS: RedactionPolicy = carriedConversationPolicy();

const text = (reply: string): LLMProvider => mock({ chunkDelayMs: 0, reply });

const llm = (reply: string) =>
  LLMCall.create({ provider: text(reply), model: 'm' })
    .system('')
    .build();

const agent = (redact?: RedactionPolicy) =>
  Agent.create({ provider: text('ok'), model: 'm', ...(redact !== undefined && { redact }) })
    .system('')
    .build();

const router = () =>
  llmRouter({
    provider: {
      name: 'router',
      complete: async (): Promise<LLMResponse> => ({
        content: JSON.stringify({ message: 'all set', reason: 'done' }),
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      }),
    },
    model: 'm',
    agents: [
      { id: 'billing', description: 'Invoices.' },
      { id: 'tech', description: 'Outages.' },
    ],
  }).step;

/** Every runner kind the library builds, with the policy its run must be known by. */
const KINDS: readonly (readonly [string, () => Runner, RedactionPolicy | undefined])[] = [
  ['Agent, declaring nothing', () => agent(), undefined],
  ['Agent, declaring a policy', () => agent(KEYS), KEYS],
  ['LLMCall', () => llm('ok'), undefined],
  ['LlmRouter', () => router() as unknown as Runner, undefined],
  ['Sequence', () => Sequence.create().step('a', agent(KEYS)).build(), KEYS],
  [
    'Parallel',
    () =>
      Parallel.create()
        .branch('a', agent(KEYS))
        .branch('b', llm('b'))
        .mergeWithFn((r) => Object.values(r).join(' '))
        .build(),
    KEYS,
  ],
  [
    'Conditional',
    () =>
      Conditional.create()
        .when('a', () => true, agent(KEYS))
        .otherwise('b', llm('b'))
        .build(),
    KEYS,
  ],
  ['Loop', () => Loop.create().repeat(agent(KEYS)).times(1).build(), KEYS],
  ['Workflow', () => workflow(agent(KEYS)) as unknown as Runner, KEYS],
  ['Graph', () => graph({ nodes: [{ id: 'a', runner: agent(KEYS) }], edges: [] }), KEYS],
];

describe('every runner serves its actual native record under its declared coverage', () => {
  for (const [kind, make, expected] of KINDS) {
    it(kind, async () => {
      const runner = make();
      const secret = 'SSN-ADMITTED-8541';
      await runner.run({ message: secret });
      const snapshot = runner.getLastSnapshot();
      expect(snapshot).toBeDefined();
      expect(servedUnderPolicy(snapshot)).toBe(expected !== undefined);
      if (expected === undefined) expect(locationsOf(snapshot, secret).length).toBeGreaterThan(0);
      else expect(locationsOf(snapshot, secret), kind).toEqual([]);
    });
  }
});

describe('native record selection never follows a foreign executor', () => {
  it('an independently executed chart cannot replace the runner’s admitted view', async () => {
    const runner = agent(KEYS);
    await runner.run({ message: 'go' });
    const before = runner.getLastSnapshot();
    const narrative = runner.getLastNarrativeEntries();
    expect(before).toBeDefined();
    const foreign = new FlowChartExecutor(runner.getSpec());
    await foreign.run({
      input: { message: 'ssn SSN-FOREIGN-1', identity: { conversationId: 'foreign-1' } },
    });
    expect(foreign.getSnapshot()).toBeDefined();
    expect(runner.getLastSnapshot()).toEqual(before);
    expect(runner.getSnapshot()).toEqual(before);
    expect(runner.getLastNarrativeEntries()).toEqual(narrative);
  });

  it('an actual native run without a domain declaration refuses its raw snapshot', async () => {
    const runner = new UnknownRun('SSN-UNKNOWN-8542');
    await runner.run('go');
    expect(locationsOf(runner.rawSnapshot(), 'SSN-UNKNOWN-8542').length).toBeGreaterThan(0);
    expect(locationsOf(runner.rawNarrative(), 'SSN-UNKNOWN-8542').length).toBeGreaterThan(0);
    expect(runner.getLastSnapshot()).toBeUndefined();
    expect(runner.getSnapshot()).toBeUndefined();
    expect(runner.getLastNarrativeEntries()).toEqual([]);
  });

  it('a runner with NO policy still serves its record: none is known, not missing', async () => {
    const runner = agent();
    await runner.run({ message: 'SSN-NONE-8543' });
    const snapshot = runner.getLastSnapshot();
    expect(snapshot).toBeDefined();
    expect(servedUnderPolicy(snapshot)).toBe(false);
    expect(locationsOf(snapshot, 'SSN-NONE-8543').length).toBeGreaterThan(0);
  });
});
