/**
 * The window keeps what the model says it STANDS ON — `'ledger-fact'`
 * (9.102.0). The twin of `window-last-tool-result.test.ts`.
 *
 * ## The measured gap
 *
 * From `bench/findings-context.mjs`, step 3: under `slidingWindow` (keep 6,
 * twenty calls, six planted facts) the ledger PIECE carried all six facts to
 * the answer turn while the wire carried two of them verbatim. The refusal
 * engine saw a fact and a noise result as the same bytes, so recency decided
 * — the facts left oldest-first with the noise around them while younger
 * noise stayed.
 *
 * ## The rule, as shipped
 *
 * A turn whose result the MODEL declared a `fact` on its findings ledger is
 * held, up to `keepLedgerFacts` (default 4) beyond `keepRecentTurns`, until
 * the model re-files it or the person asks something new. It is a BOUNDED
 * HOLD in the shared refusal engine — the `'last-tool-result'` grammar with a
 * content-aware candidate — so every strategy inherits it, including one a
 * consumer wrote. It never exists without its ceiling and its stand-down:
 * two consecutive boundaries blocked by nothing but pins release the fact
 * pins for one visit, on the record. 'Noise first' follows with no second
 * mechanism — noise, ruled-out, open and undeclared turns are unpinned and
 * leave oldest-first exactly as before.
 *
 * The pin itself (`ledgerFactPinsOf`, `turnStandingOf`, `rankStanding`) is
 * pinned in `window-ledger-fact-pins.test.ts`; this file pins the ENGINE
 * (`turns.ts`), the STAGE (`stages/window.ts`) and the run.
 */

import { describe, expect, it } from 'vitest';

import { Agent, slidingWindow, tokenBudget } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { defineTool } from '../../src/core/tools.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { foldLedger } from '../../src/core/agent/findings/ledger.js';
import type { FindingsRow, Standing } from '../../src/core/agent/findings/types.js';
import {
  answeredCallIds,
  planRemoval,
  refusalFor,
  segmentTurns,
  type RemovalGuards,
  type Turn,
} from '../../src/core/agent/window/turns.js';
import { toolResultPinsOf } from '../../src/core/agent/window/lastToolResult.js';
import { ledgerFactPinsOf, turnStandingOf } from '../../src/core/agent/window/ledgerFactPins.js';
import { currentRequestIndexOf } from '../../src/core/agent/window/currentRequest.js';
import { indexRange, removalFacts } from '../../src/core/agent/window/removal.js';
import type { WindowStrategy, WindowStrategyInput } from '../../src/core/agent/window/strategy.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';
import { buildWindowStage, type WindowStageDeps } from '../../src/core/agent/stages/window.js';
import type { CompactionMeterHandle } from '../../src/recorders/core/CompactionMeter.js';

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const TASK = 'Walk the whole floor and tell me which rack is hottest.';
const HOLDS = 'HOLDS: aix-lab-01-rack-a, aix-lab-01-rack-b, aix-lab-02-rack-a';
const FRESH = 'FRESH: aix-lab-03-rack-a';

const user = (content: string): LLMMessage => ({ role: 'user', content });
const asks = (calls: { id: string; name: string }[]): LLMMessage => ({
  role: 'assistant',
  content: '',
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: {} })),
});
const answers = (id: string, name: string, content = 'ok'): LLMMessage => ({
  role: 'tool',
  content,
  toolCallId: id,
  toolName: name,
});
/** One ReAct round: the call and its answer, which segment as ONE turn. */
const round = (id: string, name: string, content = 'ok'): LLMMessage[] => [
  asks([{ id, name }]),
  answers(id, name, content),
];

/**
 * A hand-built ledger: one standing row per result id, the shape
 * `recordFindings` files (the fold takes the LAST row per id, so one row each
 * is the settled reading). An id absent from `rows` is UNDECLARED.
 */
function ledgerOf(rows: Record<string, Standing>): FindingsRow[] {
  return Object.entries(rows).map(([toolCallId, standing], i) => ({
    kind: 'standing',
    toolCallId,
    standing,
    assertions: [],
    declaredOn: { toolCallId: `declaring-${i}` },
    iteration: 2,
  }));
}

/** `standingOf`, as the stage binds it: the fold lifted to the turn. */
function standingsOf(rows: Record<string, Standing>): (turn: Turn) => Standing | undefined {
  const fold = foldLedger(ledgerOf(rows));
  return (turn) => turnStandingOf(turn, (id) => fold.standingOf.get(id)?.standing);
}

interface Dials {
  /** The model's standings by result id. Absent = the ledger holds nothing. */
  readonly facts?: Record<string, Standing>;
  /** The fact hold's ceiling. Absent or 0 = no hold. */
  readonly keepLedgerFacts?: number;
  /** The recency pin's ceiling. Absent or 0 = that pin off. */
  readonly keepLastToolResults?: number;
}

function guardsFor(history: readonly LLMMessage[], dials: Dials): RemovalGuards {
  const turns = segmentTurns(history);
  const anchor = currentRequestIndexOf(history, TASK);
  const latestLimit = dials.keepLastToolResults ?? 0;
  const factLimit = dials.keepLedgerFacts ?? 0;
  const latest = latestLimit > 0 ? toolResultPinsOf(turns, history, anchor) : [];
  const facts =
    factLimit > 0 ? ledgerFactPinsOf(turns, history, standingsOf(dials.facts ?? {}), anchor) : [];
  return {
    answeredCallIds: answeredCallIds(history),
    ...(anchor >= 0 && { currentRequestIndex: anchor }),
    ...(latest.length > 0 && { toolResultPins: latest, keepLastToolResults: latestLimit }),
    ...(facts.length > 0 && { ledgerFactPins: facts, keepLedgerFacts: factLimit }),
  };
}

function inputFor(
  history: readonly LLMMessage[],
  iteration: number,
  dials: Dials,
): WindowStrategyInput {
  const turns = segmentTurns(history);
  const guards = guardsFor(history, dials);
  const origins = history.map((_, i) => ({ stageId: `tool-calls#${i}`, bornAtMs: 0 }));
  return {
    history,
    turns,
    measured: { input: 999_999, output: 10 },
    iteration,
    runId: 'run-1',
    agentModel: 'm',
    providerName: 'mock',
    signal: undefined,
    now: () => 1_000,
    planRemoval: (keep, isExistingSummary) => planRemoval(turns, keep, guards, isExistingSummary),
    removalFacts: (indices, at) => removalFacts(origins, indices, at),
    ...(dials.facts !== undefined && { standingOf: standingsOf(dials.facts) }),
  };
}

/** The meter the stage reads, with nothing to say. */
function fakeMeter(): CompactionMeterHandle {
  return {
    id: 'fake',
    lastCall: () => ({ input: 999_999, output: 10, iteration: 1 } as never),
    unmeteredSinceLastGood: () => 0,
    origins: () => [],
    rebaseForWindowChange: () => {},
    clear: () => {},
    onWrite: () => {},
    onEmit: () => {},
  };
}

interface FakeScope {
  history: readonly LLMMessage[];
  iteration: number;
  userMessage: string;
  compactions: WindowRecord[];
  findingsLedger?: readonly FindingsRow[];
  $emit: (name: string, payload?: unknown) => void;
}

/** Just enough scope for the stage: the keys it reads, writes and emits on. */
function fakeScope(history: readonly LLMMessage[], ledger?: readonly FindingsRow[]): FakeScope {
  return {
    history: [...history],
    iteration: 1,
    userMessage: TASK,
    compactions: [],
    ...(ledger !== undefined && { findingsLedger: ledger }),
    $emit: () => {},
  };
}

/** A strategy that honours whatever the refusal engine allows, and files it. */
const obedient: WindowStrategy = {
  name: 'obedient',
  plan: async (input) => {
    const plan = input.planRemoval(2);
    const removed =
      plan.from === -1
        ? 0
        : input.turns[plan.to]!.start +
          input.turns[plan.to]!.length -
          input.turns[plan.from]!.start;
    return {
      record: {
        strategy: 'obedient',
        iteration: input.iteration,
        removedStageIds: [],
        removedMessageCount: removed,
        windowCharsBefore: 0,
        windowCharsAfter: 0,
        refusals: plan.refusals,
      },
      evictions: [],
    };
  },
};

/** A consumer-written strategy that really removes the span it is allowed. */
const dropper: WindowStrategy = {
  name: 'dropper',
  plan: async (input) => {
    const plan = input.planRemoval(2);
    const base = {
      strategy: 'dropper',
      iteration: input.iteration,
      windowCharsBefore: 0,
      windowCharsAfter: 0,
      refusals: plan.refusals,
    };
    if (plan.from === -1) {
      return { record: { ...base, removedStageIds: [], removedMessageCount: 0 }, evictions: [] };
    }
    const start = input.turns[plan.from]!.start;
    const end = input.turns[plan.to]!.start + input.turns[plan.to]!.length;
    const facts = input.removalFacts(indexRange(start, end), input.now());
    return {
      window: [...input.history.slice(0, start), ...input.history.slice(end)],
      rebase: { headCount: start, keptTailCount: input.history.length - end },
      record: {
        ...base,
        removedStageIds: facts.removedStageIds,
        removedMessageCount: end - start,
      },
      evictions: facts.evictions,
    };
  },
};

function stageFor(strategy: WindowStrategy, deps: Partial<WindowStageDeps> = {}) {
  return buildWindowStage({
    strategy,
    meter: fakeMeter(),
    agentModel: 'm',
    providerName: 'mock',
    now: () => 1_000,
    ...deps,
  });
}

const ARMED: Partial<WindowStageDeps> = { hasFindingsLedger: true, keepLedgerFacts: 4 };

// ─────────────────────────────────────────────────────────────────
// Unit — refusal precedence
// ─────────────────────────────────────────────────────────────────

describe('refusalFor precedence', () => {
  const turn = segmentTurns([asks([{ id: 'u', name: 'look' }])])[0]!;

  it('a pinned fact turn also holding the request reports the request', () => {
    expect(
      refusalFor(turn, {
        answeredCallIds: new Set(['u']),
        currentRequestIndex: 0,
        factPinnedTurnIndexes: new Set([0]),
      }),
    ).toBe('current-request');
  });

  it('a pinned fact turn also holding an unanswered call reports the unanswered call', () => {
    expect(
      refusalFor(turn, {
        answeredCallIds: new Set<string>(),
        factPinnedTurnIndexes: new Set([0]),
      }),
    ).toBe('unresolved-tool-call');
  });

  it('a turn held by BOTH pins reports the recency pin — the content-blind rule first', () => {
    expect(
      refusalFor(turn, {
        answeredCallIds: new Set(['u']),
        pinnedTurnIndexes: new Set([0]),
        factPinnedTurnIndexes: new Set([0]),
      }),
    ).toBe('last-tool-result');
  });

  it('with nothing else to say, it reports the fact', () => {
    expect(
      refusalFor(turn, { answeredCallIds: new Set(['u']), factPinnedTurnIndexes: new Set([0]) }),
    ).toBe('ledger-fact');
  });
});

// ─────────────────────────────────────────────────────────────────
// Unit — which turns the engine holds
// ─────────────────────────────────────────────────────────────────

describe('planRemoval with the fact hold', () => {
  it('holds fact turns ONLY, newest first — open, noise, ruled-out and undeclared leave', () => {
    // request(0) · a FACT(1) · b noise(2) · c open(3) · d ruled-out(4) ·
    // e undeclared(5) · f FACT(6) · keep(7,8)
    const history: LLMMessage[] = [
      user(TASK),
      ...round('a', 'whats_here', HOLDS),
      ...round('b', 'move'),
      ...round('c', 'move'),
      ...round('d', 'move'),
      ...round('e', 'move'),
      ...round('f', 'measure', 'rack-b 41C'),
      ...round('g', 'move'),
      ...round('h', 'move'),
    ];
    const plan = planRemoval(
      segmentTurns(history),
      2,
      guardsFor(history, {
        facts: { a: 'fact', b: 'noise', c: 'open', d: 'ruled-out', f: 'fact' },
        keepLedgerFacts: 4,
      }),
    );
    // The span is the noise between the two facts; the second fact ends it.
    expect([plan.from, plan.to]).toEqual([2, 5]);
    const held = plan.refusals.filter((r) => r.reason === 'ledger-fact').map((r) => r.turnIndex);
    expect(held).toEqual([1, 6]);
    // The record: newest first, nothing turned away, the ceiling named.
    expect(plan.ledgerFacts).toEqual({
      pinned: [
        { toolName: 'measure', turnIndex: 6, chars: 'rack-b 41C'.length },
        { toolName: 'whats_here', turnIndex: 1, chars: HOLDS.length },
      ],
      yielded: 0,
      limit: 4,
    });
    // No recency pin was configured, so its block is absent.
    expect(plan.observations).toBeUndefined();
  });

  it('nothing at or before the request — a declared fact from the previous loop leaves', () => {
    const history: LLMMessage[] = [
      ...round('old', 'whats_here', 'STALE'),
      user(TASK),
      ...round('a', 'whats_here', HOLDS),
      ...round('b', 'move'),
      ...round('c', 'move'),
    ];
    const plan = planRemoval(
      segmentTurns(history),
      2,
      guardsFor(history, { facts: { old: 'fact', a: 'fact' }, keepLedgerFacts: 4 }),
    );
    // The old fact is the span — declared or not, it is history now.
    expect([plan.from, plan.to]).toEqual([0, 0]);
    expect(plan.ledgerFacts!.pinned.map((p) => p.turnIndex)).toEqual([2]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Unit — the ceiling
// ─────────────────────────────────────────────────────────────────

describe('the ceiling', () => {
  /** Seven declared facts: five stale, two inside the keep window. */
  const sevenFacts: LLMMessage[] = [
    user(TASK),
    ...round('t1', 'tool_one'),
    ...round('t2', 'tool_two'),
    ...round('t3', 'tool_three'),
    ...round('t4', 'tool_four'),
    ...round('t5', 'tool_five'),
    ...round('t6', 'tool_six'),
    ...round('t7', 'tool_seven'),
  ];
  const allFacts: Record<string, Standing> = {
    t1: 'fact',
    t2: 'fact',
    t3: 'fact',
    t4: 'fact',
    t5: 'fact',
    t6: 'fact',
    t7: 'fact',
  };

  it('spends newest-first and reports what it turned away', () => {
    const plan = planRemoval(
      segmentTurns(sevenFacts),
      2,
      guardsFor(sevenFacts, { facts: allFacts, keepLedgerFacts: 2 }),
    );
    // Five contest two slots; the two NEWEST of them win; three are turned away.
    expect(plan.ledgerFacts!.limit).toBe(2);
    expect(plan.ledgerFacts!.pinned.map((p) => p.turnIndex)).toEqual([5, 4]);
    expect(plan.ledgerFacts!.yielded).toBe(3);
    // The three that yielded LEAVE — the record says a fact left, not the wire.
    expect([plan.from, plan.to]).toEqual([1, 3]);
    expect(plan.refusals.filter((r) => r.reason === 'ledger-fact').map((r) => r.turnIndex)).toEqual(
      [4],
    );
  });

  it('a pin already inside keepRecentTurns is FREE — it spends no slot', () => {
    // Every recent turn is a fact too; with one slot, the stale one gets it.
    const history: LLMMessage[] = [
      user(TASK),
      ...round('o', 'observer', HOLDS),
      ...round('a1', 'actuator'),
      ...round('a2', 'actuator'),
      ...round('a3', 'actuator'),
    ];
    const plan = planRemoval(
      segmentTurns(history),
      2,
      guardsFor(history, { facts: { o: 'fact', a2: 'fact', a3: 'fact' }, keepLedgerFacts: 1 }),
    );
    expect(plan.ledgerFacts!.pinned.map((p) => p.toolName)).toEqual(['observer']);
    expect(plan.ledgerFacts!.yielded).toBe(0);
  });

  it('limit 0 plans exactly as it did before the hold existed', () => {
    const turns = segmentTurns(sevenFacts);
    const off = planRemoval(
      turns,
      2,
      guardsFor(sevenFacts, { facts: allFacts, keepLedgerFacts: 0 }),
    );
    expect(off.ledgerFacts).toBeUndefined();
    expect(off.refusals.map((r) => r.reason)).not.toContain('ledger-fact');
    // Byte for byte the plan of a window whose ledger holds nothing at all.
    expect(off).toEqual(planRemoval(turns, 2, guardsFor(sevenFacts, {})));
  });

  it('the two pins keep separate books, with separate ceilings', () => {
    // `observer` answered once (a recency pin) and was declared a fact; the
    // `measure` result is a fact the recency rule moved past.
    const history: LLMMessage[] = [
      user(TASK),
      ...round('m1', 'measure', 'rack-a 39C'),
      ...round('o', 'observer', HOLDS),
      ...round('m2', 'measure', 'rack-b 41C'),
      ...round('x1', 'move'),
      ...round('x2', 'move'),
      ...round('x3', 'move'),
    ];
    const plan = planRemoval(
      segmentTurns(history),
      2,
      guardsFor(history, {
        facts: { m1: 'fact', o: 'fact' },
        keepLedgerFacts: 4,
        keepLastToolResults: 2,
      }),
    );
    expect(plan.observations!.limit).toBe(2);
    expect(plan.ledgerFacts!.limit).toBe(4);
    // The recency pin holds the latest of each tool: `measure` (m2) and `observer` (o).
    expect(plan.observations!.pinned.map((p) => p.turnIndex)).toEqual([3, 2]);
    // The fact pin holds what was DECLARED: o and m1 — o under both names.
    expect(plan.ledgerFacts!.pinned.map((p) => p.turnIndex)).toEqual([2, 1]);
    // A turn held by both reports the recency pin; m1 reports the fact.
    const byTurn = new Map(plan.refusals.map((r) => [r.turnIndex, r.reason]));
    expect(byTurn.get(1)).toBe('ledger-fact');
    expect(byTurn.get(2)).toBe('last-tool-result');
    expect(byTurn.get(3)).toBe('last-tool-result');
    // The first `move` is the oldest turn nothing holds, so it is the span.
    expect([plan.from, plan.to]).toEqual([4, 4]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Scenario — contiguity, both ways
// ─────────────────────────────────────────────────────────────────

describe('contiguity works BOTH ways', () => {
  it('a noise turn behind a pinned fact stays this visit — pinned BY NAME as the known limit', () => {
    // request(0) · a(1) · b(2) · c(3) · FACT(4) · d noise(5) · keep(6,7)
    const history: LLMMessage[] = [
      user(TASK),
      ...round('a', 'x'),
      ...round('b', 'x'),
      ...round('c', 'x'),
      ...round('pin', 'observer', HOLDS),
      ...round('d', 'x'),
      ...round('e', 'x'),
      ...round('f', 'x'),
    ];
    const dials: Dials = {
      facts: { a: 'noise', b: 'noise', c: 'noise', pin: 'fact', d: 'noise' },
      keepLedgerFacts: 4,
    };
    const first = planRemoval(segmentTurns(history), 2, guardsFor(history, dials));
    // Turn 0 refuses (the request), 1..3 go, and the fact ends the span. The
    // noise turn `d` behind it STAYS: `planRemoval` returns ONE contiguous
    // span, and that is the limit this hold accepts on purpose — a fold must
    // keep the conversation in order, and a drop takes the same span so a
    // refusal means one thing under every strategy. Step 3b's collapse is
    // what makes the wait cheap: `d` is a ticket on the wire, not a payload.
    expect([first.from, first.to]).toEqual([1, 3]);
    expect(first.refusals.find((r) => r.turnIndex === 4)?.reason).toBe('ledger-fact');
    expect(first.refusals.some((r) => r.turnIndex === 5)).toBe(false);

    // Next boundary, with 1..3 gone: request(0) · FACT(1) · d(2) · keep …
    const next: LLMMessage[] = [
      user(TASK),
      ...round('pin', 'observer', HOLDS),
      ...round('d', 'x'),
      ...round('e', 'x'),
      ...round('f', 'x'),
    ];
    const second = planRemoval(segmentTurns(next), 2, guardsFor(next, dials));
    // The fact is STEPPED OVER — a blocker before `from` never ends a span —
    // and the noise turn behind it is the one that leaves.
    expect([second.from, second.to]).toEqual([2, 2]);
    expect(second.refusals.find((r) => r.turnIndex === 1)?.reason).toBe('ledger-fact');
  });
});

// ─────────────────────────────────────────────────────────────────
// Scenario — the stand-down, and the alternation it closes
// ─────────────────────────────────────────────────────────────────

describe('the stand-down', () => {
  /** A window whose ONLY candidate is the declared fact: blocked for ever. */
  const wedge: LLMMessage[] = [
    ...round('pin', 'observer', HOLDS),
    ...round('a', 'move'),
    ...round('b', 'move'),
  ];

  async function visits(scope: FakeScope, stage: ReturnType<typeof stageFor>, n: number) {
    for (let iteration = 1; iteration <= n; iteration++) {
      scope.iteration = iteration;
      await stage(scope as never);
    }
    return scope.compactions;
  }

  it('the STAGE stands down on the third blocked boundary, and files the fact', async () => {
    const stage = stageFor(obedient, { ...ARMED, keepLastToolResults: false });
    const records = await visits(fakeScope(wedge, ledgerOf({ pin: 'fact' })), stage, 3);
    expect(records).toHaveLength(3);
    // Two boundaries blocked by the fact hold…
    for (const r of records.slice(0, 2)) {
      expect(r.removedMessageCount).toBe(0);
      expect(r.refusals.map((f) => f.reason)).toContain('ledger-fact');
      expect(r.ledgerFacts).toEqual({
        pinned: [{ toolName: 'observer', turnIndex: 0, chars: HOLDS.length }],
        yielded: 0,
        limit: 4,
      });
    }
    // …and the third stands down, ON THE RECORD, and progress follows.
    expect(records[2]!.ledgerFacts).toEqual({ pinned: [], yielded: 0, limit: 4, standDown: true });
    expect(records[2]!.refusals.map((r) => r.reason)).not.toContain('ledger-fact');
    expect(records[2]!.removedMessageCount).toBeGreaterThan(0);
    // The recency pin is off, so its block never appears.
    for (const r of records) expect('observations' in r).toBe(false);
  });

  it('a turn held by BOTH pins stands down as ONE family — no alternation, ever', async () => {
    // The observer's latest result is ALSO the declared fact. `refusalFor`
    // names the recency pin for it, so a fact stand-down that read only its
    // own name would never see this turn blocking, and the two pins would
    // take turns holding it under each other's name.
    const stage = stageFor(obedient, ARMED); // keepLastToolResults default 2
    const records = await visits(fakeScope(wedge, ledgerOf({ pin: 'fact' })), stage, 9);
    for (const r of records.slice(0, 2)) {
      expect(r.refusals.map((f) => f.reason)).toContain('last-tool-result');
      expect(r.refusals.map((f) => f.reason)).not.toContain('ledger-fact');
    }
    // Both blocks say so on the third visit, and the turn leaves.
    expect(records[2]!.observations).toEqual({ pinned: [], yielded: 0, limit: 2, standDown: true });
    expect(records[2]!.ledgerFacts).toEqual({ pinned: [], yielded: 0, limit: 4, standDown: true });
    expect(records[2]!.removedMessageCount).toBeGreaterThan(0);
    // And over nine visits no pin — under either name — blocks three running.
    let streak = 0;
    for (const r of records) {
      const blocked =
        r.removedMessageCount === 0 &&
        r.refusals.some((f) => f.reason === 'last-tool-result' || f.reason === 'ledger-fact');
      streak = blocked ? streak + 1 : 0;
      expect(streak).toBeLessThanOrEqual(2);
    }
  });

  it('the fact stand-down never fires on an unarmed stage, and the record has no such key', async () => {
    const stage = stageFor(obedient, { keepLastToolResults: false });
    const records = await visits(fakeScope(wedge), stage, 3);
    for (const r of records) {
      expect('ledgerFacts' in r).toBe(false);
      expect(r.refusals.map((f) => f.reason)).not.toContain('ledger-fact');
      expect(r.removedMessageCount).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Scenario — the audited run, under both drop strategies
// ─────────────────────────────────────────────────────────────────

describe('the holds survive', () => {
  const strategies = {
    slidingWindow: () => slidingWindow({ keepRecentTurns: 2 }),
    tokenBudget: () => tokenBudget({ thresholdTokens: 100, keepRecentTurns: 2 }),
  } as const;

  for (const [name, make] of Object.entries(strategies)) {
    it(`${name}: 30 iterations of actuator traffic, with the recency pin OFF`, async () => {
      let history: LLMMessage[] = [user(TASK), ...round('w', 'whats_here', HOLDS)];
      const strategy = make();
      const records: WindowRecord[] = [];
      for (let iteration = 2; iteration <= 30; iteration++) {
        const res = await strategy.plan(
          inputFor(history, iteration, { facts: { w: 'fact' }, keepLedgerFacts: 4 }),
        );
        if (res !== undefined) {
          records.push(res.record);
          if (res.window !== undefined) history = [...res.window];
        }
        history = [...history, ...round(`m${iteration}`, 'move')];
      }
      // The holds are STILL THERE at iteration 30 — by the model's claim alone.
      expect(history.some((m) => m.content === HOLDS)).toBe(true);
      // And the record says why, from the boundary the drop would have taken it.
      expect(records.some((r) => r.refusals.some((f) => f.reason === 'ledger-fact'))).toBe(true);
      // The window is still bounded — it did not stop dropping.
      expect(records.filter((r) => r.removedMessageCount > 0).length).toBeGreaterThanOrEqual(20);
      expect(history.length).toBeLessThanOrEqual(12);
    });

    it(`${name}: without the hold, the fact is gone — the measured gap, reproduced`, async () => {
      let history: LLMMessage[] = [user(TASK), ...round('w', 'whats_here', HOLDS)];
      const strategy = make();
      for (let iteration = 2; iteration <= 30; iteration++) {
        const res = await strategy.plan(
          inputFor(history, iteration, { facts: { w: 'fact' }, keepLedgerFacts: 0 }),
        );
        if (res?.window !== undefined) history = [...res.window];
        history = [...history, ...round(`m${iteration}`, 'move')];
      }
      expect(history.some((m) => m.content === HOLDS)).toBe(false);
    });
  }

  it('tokenBudget with an unreachable threshold declines rather than livelocks', async () => {
    const history: LLMMessage[] = [
      user(TASK),
      ...round('w', 'whats_here', HOLDS),
      ...round('p', 'pan', 'panned'),
      ...round('m1', 'move'),
      ...round('m2', 'move'),
    ];
    const res = await tokenBudget({ thresholdTokens: 1, keepRecentTurns: 2 }).plan(
      inputFor(history, 4, { facts: { w: 'fact', p: 'fact' }, keepLedgerFacts: 4 }),
    );
    expect(res).toBeDefined();
    expect((res!.record as { overBudget?: boolean }).overBudget).toBe(true);
    expect(res!.record.refusals.map((r) => r.reason)).toContain('ledger-fact');
  });
});

// ─────────────────────────────────────────────────────────────────
// Scenario — the record's honesty pass, on a strategy a consumer wrote
// ─────────────────────────────────────────────────────────────────

describe('droppedStandings', () => {
  // request(0) · a noise(1) · b ruled-out(2) · c undeclared(3) · keep(4,5)
  const history: LLMMessage[] = [
    user(TASK),
    ...round('a', 'look'),
    ...round('b', 'look'),
    ...round('c', 'probe'),
    ...round('d', 'look'),
    ...round('e', 'look'),
  ];

  it("stamped on a consumer-written strategy's record, by the model's claim — absent is undeclared", async () => {
    const stage = stageFor(dropper, { ...ARMED, keepLastToolResults: false });
    const scope = fakeScope(history, ledgerOf({ a: 'noise', b: 'ruled-out' }));
    await stage(scope as never);
    const [record] = scope.compactions;
    expect(record!.removedMessageCount).toBe(6);
    expect(record!.droppedObservations).toEqual(['look', 'probe']);
    expect(record!.droppedStandings).toEqual([
      { toolCallId: 'a', standing: 'noise' },
      { toolCallId: 'b', standing: 'ruled-out' },
      { toolCallId: 'c' },
    ]);
    // Nothing was held, so the hold's block is absent — not an empty one.
    expect('ledgerFacts' in record!).toBe(false);
    // The window really changed, and the request is still its head.
    expect(scope.history.map((m) => m.content)).toEqual([TASK, '', 'ok', '', 'ok']);
    // Committed with the record, so it must survive the record's clone.
    expect(structuredClone(record)).toEqual(record);
  });

  it('the strategy is handed `standingOf` under the arm — and the exact input it always was without', async () => {
    const seen: string[][] = [];
    const spy: WindowStrategy = {
      name: 'spy',
      plan: async (input) => {
        seen.push(Object.keys(input).sort());
        expect(input.standingOf?.(input.turns[1]!)).toBe(
          input.standingOf === undefined ? undefined : 'noise',
        );
        return undefined;
      },
    };
    await stageFor(spy)(fakeScope(history) as never);
    await stageFor(spy, ARMED)(fakeScope(history, ledgerOf({ a: 'noise' })) as never);
    expect(seen[1]).toEqual([...seen[0]!, 'standingOf'].sort());
    expect(seen[0]).not.toContain('standingOf');
  });

  it('never on an unarmed stage — and the ledger key is not even read there', async () => {
    const scope = fakeScope(history);
    let reads = 0;
    Object.defineProperty(scope, 'findingsLedger', {
      get: () => {
        reads++;
        return ledgerOf({ a: 'noise' });
      },
    });
    await stageFor(dropper, { keepLastToolResults: false })(scope as never);
    const [record] = scope.compactions;
    expect(record!.removedMessageCount).toBe(6);
    expect('droppedStandings' in record!).toBe(false);
    expect('ledgerFacts' in record!).toBe(false);
    // The gate: the phantom read `window/evictedTurns.ts` documents never happens.
    expect(reads).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Integration — the dial, the record, and byte-identity
// ─────────────────────────────────────────────────────────────────

describe('the dial', () => {
  const observer = defineTool({
    name: 'whats_here',
    description: 'what is on screen',
    inputSchema: { type: 'object', properties: { fresh: { type: 'boolean' } } },
    execute: (args: { fresh?: boolean }) => (args.fresh === true ? FRESH : HOLDS),
  } as never);
  const actuator = defineTool({
    name: 'move',
    description: 'move the view',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'moved',
  } as never);

  const FACT = {
    subject: { kind: 'rack', id: 'aix-lab-01-rack-a' },
    predicate: 'holds',
    value: 'aix-lab-01-rack-a',
  };

  /**
   * whats_here once, DECLARED A FACT on the next call, then nothing but the
   * actuator — the audited shape, with the model's claim on the record.
   * `again` re-asks whats_here at that call, so the recency pin moves on.
   */
  function screenScript(rounds: number, options: { again?: number } = {}): MockProvider {
    const replies: Partial<LLMResponse>[] = [];
    for (let call = 1; call <= rounds; call++) {
      const declaring =
        call === 2
          ? { previous: [{ toolCallId: 'c1', standing: 'fact', sought: true, assertions: [FACT] }] }
          : {};
      if (call === 1) {
        replies.push({
          toolCalls: [
            {
              id: 'c1',
              name: 'whats_here',
              args: { _findings: { basis: 'direct', expect: 'high' } },
            },
          ],
        });
      } else if (call === options.again) {
        replies.push({
          toolCalls: [
            {
              id: `c${call}`,
              name: 'whats_here',
              args: { fresh: true, _findings: { basis: 'exploratory' } },
            },
          ],
        });
      } else {
        replies.push({
          toolCalls: [
            {
              id: `c${call}`,
              name: 'move',
              args: { _findings: { basis: 'direct', ...declaring } },
            },
          ],
        });
      }
    }
    replies.push({ content: 'the hottest rack is aix-lab-01-rack-a' });
    return new MockProvider({ replies, usage: { input: 90_000, output: 5 } });
  }

  interface Build {
    readonly armed?: boolean;
    readonly keepLedgerFacts?: number | false;
    readonly door?: number | false;
    readonly keepLastToolResults?: number | false;
    readonly again?: number;
  }

  function buildAgent(b: Build): Agent {
    const builder = Agent.create({
      provider: screenScript(10, { again: b.again }),
      model: 'm',
      maxIterations: 14,
      ...(b.keepLedgerFacts !== undefined && { keepLedgerFacts: b.keepLedgerFacts }),
      ...(b.keepLastToolResults !== undefined && { keepLastToolResults: b.keepLastToolResults }),
    })
      .tool(observer as never)
      .tool(actuator as never)
      .window(slidingWindow({ keepRecentTurns: 2 }));
    const armed =
      b.armed === false
        ? builder
        : b.door !== undefined
        ? builder.findings({ keepLedgerFacts: b.door })
        : builder.findings();
    return armed.build();
  }

  function stateOf(agent: Agent): {
    keys: string[];
    history: readonly LLMMessage[];
    records: readonly WindowRecord[];
  } {
    const s = agent.getLastSnapshot()?.sharedState as
      | { history?: readonly LLMMessage[]; compactions?: readonly WindowRecord[] }
      | undefined;
    return {
      keys: Object.keys(s ?? {}).sort(),
      history: s?.history ?? [],
      records: s?.compactions ?? [],
    };
  }

  it('ON by default under .findings(): the declared fact survives, and the record names the cost', async () => {
    const agent = buildAgent({ keepLastToolResults: false });
    await agent.run({ message: TASK });
    const { history, records } = stateOf(agent);
    expect(history.some((m) => m.content === HOLDS)).toBe(true);

    const held = records.find((r) => (r.ledgerFacts?.pinned.length ?? 0) > 0);
    expect(held).toBeDefined();
    expect(held!.ledgerFacts!.limit).toBe(4);
    expect(held!.ledgerFacts!.pinned[0]!.toolName).toBe('whats_here');
    expect(held!.ledgerFacts!.pinned[0]!.chars).toBeGreaterThan(0);
    expect(records.some((r) => r.refusals.some((f) => f.reason === 'ledger-fact'))).toBe(true);
    // Whose standing left: the actuator's results, every one undeclared.
    const dropped = records.flatMap((r) => r.droppedStandings ?? []);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((d) => d.toolCallId.startsWith('c') && !('standing' in d))).toBe(true);
    // The recency pin is off, so its block never appears.
    for (const r of records) expect('observations' in r).toBe(false);
    // The record survives the boundary it is committed across.
    expect(structuredClone(held!.ledgerFacts)).toEqual(held!.ledgerFacts);
  });

  it('OFF reproduces the unheld window, and says a FACT left — and 0 is the same as false', async () => {
    const off = buildAgent({ keepLedgerFacts: false, keepLastToolResults: false });
    await off.run({ message: TASK });
    const zero = buildAgent({ keepLedgerFacts: 0, keepLastToolResults: false });
    await zero.run({ message: TASK });

    for (const agent of [off, zero]) {
      const { history, records } = stateOf(agent);
      expect(history.some((m) => m.content === HOLDS)).toBe(false);
      for (const r of records) expect('ledgerFacts' in r).toBe(false);
      expect(records.some((r) => r.refusals.some((f) => f.reason === 'ledger-fact'))).toBe(false);
      // Still armed: the honesty pass names the standing of what left.
      const dropped = records.flatMap((r) => r.droppedStandings ?? []);
      expect(dropped).toContainEqual({ toolCallId: 'c1', standing: 'fact' });
    }
    expect(stateOf(off).history.map((m) => m.content)).toEqual(
      stateOf(zero).history.map((m) => m.content),
    );
    expect(stateOf(off).records).toEqual(stateOf(zero).records);
  });

  it('the ceiling named at the door reaches the record', async () => {
    const agent = buildAgent({ door: 1, keepLastToolResults: false });
    await agent.run({ message: TASK });
    const held = stateOf(agent).records.find((r) => r.ledgerFacts !== undefined);
    expect(held!.ledgerFacts!.limit).toBe(1);
  });

  it('the recency pin moves on; the fact stays by its own name', async () => {
    // whats_here answers again at call 6 with a FRESH, undeclared result:
    // the recency pin follows it, and the declared fact behind it is held
    // by the ledger alone.
    const agent = buildAgent({ again: 6 });
    await agent.run({ message: TASK });
    const { history, records } = stateOf(agent);
    expect(history.some((m) => m.content === HOLDS)).toBe(true);
    expect(history.some((m) => m.content === FRESH)).toBe(true);
    const last = records[records.length - 1]!;
    expect(last.refusals.map((r) => r.reason)).toContain('ledger-fact');
    expect(last.refusals.map((r) => r.reason)).toContain('last-tool-result');
  });

  it('an agent with no .findings() is byte-identical either way', async () => {
    const bytes = (requests: LLMRequest[]): string[] =>
      requests.map((r) =>
        JSON.stringify({ system: r.systemPrompt, messages: r.messages, tools: r.tools }),
      );
    const make = (keepLedgerFacts?: number): { agent: Agent; requests: LLMRequest[] } => {
      const requests: LLMRequest[] = [];
      let call = 0;
      const provider = new MockProvider({
        usage: { input: 90_000, output: 5 },
        respond: (req) => {
          requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
          call++;
          if (call > 8) return 'the hottest rack is aix-lab-01-rack-a';
          return {
            content: '',
            toolCalls: [{ id: `c${call}`, name: call === 1 ? 'whats_here' : 'move', args: {} }],
          };
        },
      });
      const agent = Agent.create({
        provider,
        model: 'm',
        maxIterations: 12,
        ...(keepLedgerFacts !== undefined && { keepLedgerFacts }),
      })
        .tool(observer as never)
        .tool(actuator as never)
        .window(slidingWindow({ keepRecentTurns: 2 }))
        .build();
      return { agent, requests };
    };
    const plain = make();
    const dialled = make(5);
    const a = await plain.agent.run({ message: TASK });
    const b = await dialled.agent.run({ message: TASK });
    expect(a.output).toBe(b.output);
    expect(stateOf(dialled.agent).keys).toEqual(stateOf(plain.agent).keys);
    expect(stateOf(dialled.agent).records).toEqual(stateOf(plain.agent).records);
    expect(bytes(dialled.requests)).toEqual(bytes(plain.requests));
    // The window did drop, and no record of either carries the hold's vocabulary.
    expect(stateOf(plain.agent).records.some((r) => r.removedMessageCount > 0)).toBe(true);
    const serialized = JSON.stringify(stateOf(plain.agent).records);
    expect(serialized).not.toContain('ledger-fact');
    expect(serialized).not.toContain('ledgerFacts');
    expect(serialized).not.toContain('droppedStandings');
  });
});
