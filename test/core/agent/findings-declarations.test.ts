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
 *
 *          Step 4 adds the OPTION and the THREAD for standing-aware eviction:
 *          `AgentOptions.keepLedgerFacts` beside `keepLastToolResults`, the
 *          same dial reachable through `findings({ keepLedgerFacts })`, ONE
 *          resolved value (the `.findings()` door wins; `false` -> 0; default
 *          4) threaded by `Agent` into `buildWindowStage`'s deps together
 *          with `hasFindingsLedger: true` — value-conditionally, so an
 *          unarmed agent hands the stage exactly today's deps. The stage
 *          does nothing with them yet (the wiring stage does), so the ONE
 *          observable seam is the deps object itself: `buildChart()` runs at
 *          `build()`, and the block below wraps the real `buildWindowStage`
 *          in a pass-through spy to read what it was handed.
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Agent, slidingWindow } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { epochLocations, readRunConstant } from '../../../src/lib/time-travel/index.js';
import { buildWindowStage } from '../../../src/core/agent/stages/window.js';
import type { WindowStageDeps } from '../../../src/core/agent/stages/window.js';
import type { AgentOptions, AgentState } from '../../../src/core/agent/types.js';
import type { AgentRunCheckpoint } from '../../../src/core/runCheckpoint.js';
import type { FindingsLedger, FindingsRow } from '../../../src/core/agent/findings/types.js';

// A pass-through spy on the window stage's factory: the real stage is built
// and runs unchanged; only the deps object `Agent.buildChart` hands it is
// recorded. Hoisted by vitest above every import, so `Agent.ts`'s own import
// of `buildWindowStage` resolves to the spy.
vi.mock('../../../src/core/agent/stages/window.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/agent/stages/window.js')>();
  return { ...actual, buildWindowStage: vi.fn(actual.buildWindowStage) };
});

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

// ─── keepLedgerFacts: the option, the door and the thread (step 4) ────────

/** An agent WITH a window strategy, so the window stage exists and is built at
 *  `build()`; the option rides `Agent.create`, the door rides `.findings()`. */
const windowed = (keepLedgerFacts?: number | false): Built =>
  Agent.create({
    provider: answerOnly(),
    model: 'm',
    ...(keepLedgerFacts !== undefined && { keepLedgerFacts }),
  }).window(slidingWindow({ keepRecentTurns: 2 }));

const stageFactory = () => vi.mocked(buildWindowStage);

/** Build ONE agent and return the deps object its window stage was handed —
 *  exactly one factory call per build, or the test is reading someone else's. */
const depsOf = (build: () => Agent): WindowStageDeps => {
  const before = stageFactory().mock.calls.length;
  build();
  const calls = stageFactory().mock.calls;
  expect(calls.length).toBe(before + 1);
  return calls[before]![0];
};

const keysOfDeps = (deps: WindowStageDeps): string[] => Object.keys(deps).sort();

describe('findings declarations — AgentOptions.keepLedgerFacts (step 4: the option)', () => {
  it('is number | false beside keepLastToolResults — the same shape, the same optionality', () => {
    expectTypeOf<AgentOptions['keepLedgerFacts']>().toEqualTypeOf<number | false | undefined>();
    expectTypeOf<AgentOptions['keepLedgerFacts']>().toEqualTypeOf<
      AgentOptions['keepLastToolResults']
    >();
  });

  it('the findings() door still carries only `serve` and `keepLedgerFacts`', () => {
    expectTypeOf<NonNullable<AgentOptions['findings']>['keepLedgerFacts']>().toEqualTypeOf<
      number | false | undefined
    >();
  });

  it('refuses a negative or non-integer value at BUILD, at either door, never mid-run', () => {
    for (const bad of [-1, 1.5, 'two', null]) {
      // The top-level option: refused by the Agent constructor at build()…
      expect(() =>
        Agent.create({ provider: answerOnly(), model: 'm', keepLedgerFacts: bad as never }).build(),
      ).toThrow(/keepLedgerFacts/);
      // …and refused there whether or not `.findings()` is on, so a dial that
      // would be ignored is never silently accepted.
      expect(() =>
        Agent.create({ provider: answerOnly(), model: 'm', keepLedgerFacts: bad as never })
          .findings()
          .build(),
      ).toThrow(/keepLedgerFacts/);
      // The `.findings()` door: refused by the builder at the call.
      expect(() =>
        Agent.create({ provider: answerOnly(), model: 'm' }).findings({
          keepLedgerFacts: bad as never,
        }),
      ).toThrow(/keepLedgerFacts/);
    }
  });

  it('accepts 0, false and a whole number, with or without .findings()', () => {
    for (const ok of [0, false, 3] as const) {
      expect(() =>
        Agent.create({ provider: answerOnly(), model: 'm', keepLedgerFacts: ok }).build(),
      ).not.toThrow();
      expect(() =>
        Agent.create({ provider: answerOnly(), model: 'm', keepLedgerFacts: ok })
          .findings()
          .build(),
      ).not.toThrow();
      expect(() =>
        Agent.create({ provider: answerOnly(), model: 'm' })
          .findings({ keepLedgerFacts: ok })
          .build(),
      ).not.toThrow();
    }
  });
});

describe('findings declarations — the thread into the window stage (step 4)', () => {
  it("unarmed: the stage gets exactly today's deps, whatever the option says", () => {
    const plain = depsOf(() => windowed().build());
    const dialled = depsOf(() => windowed(3).build());
    expect(plain).not.toHaveProperty('hasFindingsLedger');
    expect(plain).not.toHaveProperty('keepLedgerFacts');
    // The option without `.findings()` is accepted and threads NOTHING — the
    // same key set, byte for byte the deps an unarmed agent always built.
    expect(keysOfDeps(dialled)).toEqual(keysOfDeps(plain));
    expect(dialled).not.toHaveProperty('keepLedgerFacts');
  });

  it('armed with a window: hasFindingsLedger: true and the default ceiling 4, and nothing else moves', () => {
    const off = depsOf(() => windowed().build());
    const on = depsOf(() => windowed().findings().build());
    expect(on.hasFindingsLedger).toBe(true);
    expect(on.keepLedgerFacts).toBe(4);
    expect(keysOfDeps(on)).toEqual(
      [...keysOfDeps(off), 'hasFindingsLedger', 'keepLedgerFacts'].sort(),
    );
  });

  it('ONE resolved value: the option, the door, and the door winning when both are given', () => {
    expect(depsOf(() => windowed(3).findings().build()).keepLedgerFacts).toBe(3);
    expect(depsOf(() => windowed().findings({ keepLedgerFacts: 2 }).build()).keepLedgerFacts).toBe(
      2,
    );
    expect(depsOf(() => windowed(3).findings({ keepLedgerFacts: 2 }).build()).keepLedgerFacts).toBe(
      2,
    );
    // The door wins with `false` too — `??` skips nothing but undefined.
    expect(
      depsOf(() => windowed(3).findings({ keepLedgerFacts: false }).build()).keepLedgerFacts,
    ).toBe(0);
  });

  it('false and 0 both reach the stage as 0 — a number, never `false`, so the stage applies no default', () => {
    expect(depsOf(() => windowed(false).findings().build()).keepLedgerFacts).toBe(0);
    expect(depsOf(() => windowed(0).findings().build()).keepLedgerFacts).toBe(0);
    expect(depsOf(() => windowed().findings({ keepLedgerFacts: 0 }).build()).keepLedgerFacts).toBe(
      0,
    );
    // The arm still rides beside a switched-off hold: the gate and the
    // ceiling travel together or not at all.
    expect(depsOf(() => windowed(false).findings().build()).hasFindingsLedger).toBe(true);
  });

  it('armed with NO window strategy: there is no window stage, so nothing is threaded', () => {
    const before = stageFactory().mock.calls.length;
    Agent.create({ provider: answerOnly(), model: 'm', keepLedgerFacts: 3 }).findings().build();
    Agent.create({ provider: answerOnly(), model: 'm' }).findings({ keepLedgerFacts: 3 }).build();
    expect(stageFactory().mock.calls.length).toBe(before);
  });

  it('the thread is inert on the record until the wiring lands: same committed keys either way', async () => {
    // The stage carries the deps but acts on nothing yet, so an armed
    // windowed run commits the SAME key set with the ceiling named or not.
    const run = async (b: Built): Promise<Agent> => {
      const agent = b.build();
      await agent.run({ message: 'hi' });
      return agent;
    };
    const named = await run(windowed(1).findings());
    const unnamed = await run(windowed().findings());
    expect(keysOf(named)).toEqual(keysOf(unnamed));
  });
});
