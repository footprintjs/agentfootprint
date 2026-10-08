/**
 * Every executor a runner opens is KNOWN to the redaction — with its policy,
 * or explicitly with none — and an executor no run opened is UNKNOWN, which
 * a reader refuses rather than serve raw (`runRedaction.ts` · `policyOfExecutor`).
 *
 * A snapshot is served under the policy of the executor it comes from. A
 * lookup that missed used to read as "no policy" and serve the record as it
 * is; now "this run had no policy" is an explicit entry, and a miss — an
 * executor no run of this library opened — serves nothing.
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
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { Runner } from '../../src/core/runner.js';
import { mock } from '../../src/doors/providers.js';
import { policyOfExecutor } from '../../src/redaction/runRedaction.js';

const KEYS: RedactionPolicy = { keys: ['ssn'] };

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

/** The executor a runner last opened — protected on the class, read here only. */
const lastExecutorOf = (runner: Runner): object | undefined =>
  (runner as unknown as { lastExecutor?: object }).lastExecutor;

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

describe('every executor a runner opens is known, with its policy or explicitly none', () => {
  for (const [kind, make, expected] of KINDS) {
    it(kind, async () => {
      const runner = make();
      await runner.run({ message: 'go' });
      const executor = lastExecutorOf(runner);
      expect(executor).toBeDefined();
      const handed = policyOfExecutor(executor as object);
      expect(handed.known).toBe(true);
      if (!handed.known) return;
      if (expected === undefined) expect(handed.policy).toBeUndefined();
      else expect(handed.policy?.keys).toEqual(expect.arrayContaining(expected.keys ?? []));
      // …and its snapshot is served.
      expect(runner.getLastSnapshot()).toBeDefined();
    });
  }
});

describe('an executor no run opened is unknown — and refused, never served raw', () => {
  it('a foreign executor reads as unknown, not as "no policy"', () => {
    const foreign = new FlowChartExecutor(agent().getSpec());
    expect(policyOfExecutor(foreign)).toEqual({ known: false });
  });

  it('a runner whose last executor is one no run opened serves no snapshot', async () => {
    const runner = agent(KEYS);
    await runner.run({ message: 'go' });
    expect(runner.getLastSnapshot()).toBeDefined();
    const foreign = new FlowChartExecutor(runner.getSpec());
    await foreign.run({ input: { message: 'ssn SSN-FOREIGN-1' } });
    (runner as unknown as { lastExecutor: object }).lastExecutor = foreign;
    expect(runner.getLastSnapshot()).toBeUndefined();
    expect(runner.getSnapshot()).toBeUndefined();
  });

  it('a runner with NO policy still serves its record: "none" is known, not missing', async () => {
    const runner = agent();
    await runner.run({ message: 'go' });
    const handed = policyOfExecutor(lastExecutorOf(runner) as object);
    expect(handed).toEqual({ known: true, policy: undefined });
    expect(runner.getLastSnapshot()).toBeDefined();
  });
});
