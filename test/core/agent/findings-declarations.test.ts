/**
 * Type-level tests — the findings ledger's DECLARATIONS on state, options
 * and the checkpoint (9.101.0, step 2 of the findings-ledger program).
 *
 * Pattern: Test-as-specification (compile-time via `expectTypeOf`).
 * Role:    Pin the three public shapes so no name drifts before the serving
 *          steps land: `AgentOptions.findings`, `AgentState.findingsLedger`
 *          and `AgentRunCheckpoint.findingsLedger` — all optional, all
 *          absent by default, the checkpoint's and the state's the SAME
 *          `FindingsLedger` so a continued run re-seeds what it stored.
 *
 *          Step 3 adds the one RUN CONSTANT the serving needs on the record:
 *          `AgentState.findingsServe`, written by `stages/seed.ts` beside
 *          `forcedOutputToolName` on an armed agent only, and read back the
 *          way the rebuild reads it (`epochs.ts` · `readRunConstant`). The
 *          runtime block below drives real runs on the mock provider so the
 *          gate is proven, not just typed.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { epochLocations, readRunConstant } from '../../../src/lib/time-travel/index.js';
import type { AgentOptions, AgentState } from '../../../src/core/agent/types.js';
import type { AgentRunCheckpoint } from '../../../src/core/runCheckpoint.js';
import type { FindingsLedger, FindingsRow } from '../../../src/core/agent/findings/types.js';

describe('findings declarations — AgentOptions.findings', () => {
  it('is optional and carries only `serve` and `keepLedgerFacts`', () => {
    expectTypeOf<AgentOptions['findings']>().toEqualTypeOf<
      | {
          readonly serve?: 'ledger-and-facts' | 'ledger-only';
          readonly keepLedgerFacts?: number | false;
        }
      | undefined
    >();
  });

  it('an agent that never calls .findings() types the option as absent', () => {
    const opts: AgentOptions = {} as AgentOptions;
    expectTypeOf(opts.findings).toEqualTypeOf<AgentOptions['findings']>();
  });
});

describe('findings declarations — AgentState.findingsLedger', () => {
  it('is the optional FindingsLedger — one flat list of basis / standing / conflict rows', () => {
    expectTypeOf<AgentState['findingsLedger']>().toEqualTypeOf<FindingsLedger | undefined>();
    expectTypeOf<FindingsLedger>().toEqualTypeOf<readonly FindingsRow[]>();
    expectTypeOf<FindingsRow['kind']>().toEqualTypeOf<'basis' | 'standing' | 'conflict'>();
  });

  it('the run constant `findingsServe` is the SAME literal pair as `AgentOptions.findings.serve`', () => {
    expectTypeOf<AgentState['findingsServe']>().toEqualTypeOf<
      'ledger-and-facts' | 'ledger-only' | undefined
    >();
    expectTypeOf<AgentState['findingsServe']>().toEqualTypeOf<
      NonNullable<AgentOptions['findings']>['serve']
    >();
  });
});

// ─── the run constant on the record (step 3) ─────────────────────────────

/** One text answer, no tool calls — seed runs, the model declares nothing. */
const answerOnly = () => mock({ respond: () => 'done' });

type Built = ReturnType<typeof Agent.create>;

/** The committed key set, sorted — the `findings-ledger.test.ts` · `keysOf` twin. */
const keysOf = (agent: Agent): string[] =>
  Object.keys(agent.getLastSnapshot()?.sharedState ?? {}).sort();

/** `findingsServe` read the way `servedView.ts` · `viewOf` will read it: from the
 *  run log, at every epoch the run has, through `readRunConstant`. */
const servedModeAtEveryEpoch = (agent: Agent): unknown[] => {
  const snapshot = agent.getLastSnapshot();
  const locations = epochLocations(snapshot);
  expect(locations.length).toBeGreaterThan(0);
  return locations.map((location) => readRunConstant(location, 'findingsServe'));
};

async function ran(build: (b: Built) => Built): Promise<Agent> {
  const agent = build(Agent.create({ provider: answerOnly(), model: 'm' })).build();
  await agent.run({ message: 'hi' });
  return agent;
}

describe('findings declarations — the run constant `findingsServe` (seed, armed only)', () => {
  it("armed with no options: the record carries 'ledger-and-facts' — the dial's default", async () => {
    const agent = await ran((b) => b.findings());
    const state = agent.getLastSnapshot()?.sharedState as Partial<AgentState> | undefined;
    expect(state?.findingsServe).toBe('ledger-and-facts');
    expect(new Set(servedModeAtEveryEpoch(agent))).toEqual(new Set(['ledger-and-facts']));
  });

  it("armed with { serve: 'ledger-only' }: the record carries the mode asked for", async () => {
    const agent = await ran((b) => b.findings({ serve: 'ledger-only' }));
    const state = agent.getLastSnapshot()?.sharedState as Partial<AgentState> | undefined;
    expect(state?.findingsServe).toBe('ledger-only');
    expect(new Set(servedModeAtEveryEpoch(agent))).toEqual(new Set(['ledger-only']));
  });

  it('unarmed: the key is absent from the record and the reader finds nothing', async () => {
    const agent = await ran((b) => b);
    expect(keysOf(agent)).not.toContain('findingsServe');
    expect(new Set(servedModeAtEveryEpoch(agent))).toEqual(new Set([undefined]));
  });

  it('the arm adds exactly this one key when the model declares nothing (no ledger, no other key)', async () => {
    const off = await ran((b) => b);
    const on = await ran((b) => b.findings());
    expect(keysOf(on)).toEqual([...keysOf(off), 'findingsServe'].sort());
    expect(keysOf(on)).not.toContain('findingsLedger');
  });
});

describe('findings declarations — AgentRunCheckpoint.findingsLedger', () => {
  it('is the SAME FindingsLedger the state holds, optional, on version 1', () => {
    expectTypeOf<AgentRunCheckpoint['findingsLedger']>().toEqualTypeOf<
      AgentState['findingsLedger']
    >();
    expectTypeOf<AgentRunCheckpoint['version']>().toEqualTypeOf<1>();
  });
});
