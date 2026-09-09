/**
 * milestoneStops (9.89.0) === milestoneStops (9.88.0), on real runs.
 *
 * 9.89.0 rewrote the strategy as `filterStops(commitStops(log, tree), keep)` —
 * footprintjs 9.18's composer — and deleted the hand-rolled bookend guard, the
 * re-partition loop and `milestoneOf`'s re-derivation. That is only allowed if
 * the axis a 9.88.0 consumer scrubbed is the axis it still scrubs. So the
 * 9.88.0 implementation is here VERBATIM (`git show
 * 739b8c2f:src/lib/time-travel/milestoneStops.ts`, renamed `legacy*`, not
 * otherwise touched) and driven over every recorded fixture the milestone
 * tests use, plus a dynamic-grouped run, its drilled inner histories, and a
 * paused-then-resumed run. New and legacy must agree stop for stop — step,
 * id, kind, label, commit range — and fold for fold. The ONLY permitted
 * differences are the two things 9.18 added: `meta` on a milestone stop and
 * `prologue` on a start that absorbed stages; both are asserted present and
 * right, never merely tolerated.
 *
 * Test types (Convention 3): regression (the axis a consumer already ships
 * against does not move) / property (agreement on every stop of every fixture)
 * / functional (both chart shapes, a drill, a pause and a resume) / edge (an
 * empty log, a log the classifier recognises nothing in).
 */

import { describe, expect, it } from 'vitest';
import { commitStops, timeTravel } from 'footprintjs/trace';
import type { Stop, TimeTravel, TimeTravelStrategy } from 'footprintjs/trace';
import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import {
  Agent,
  defineTool,
  isPaused,
  milestoneFor,
  milestoneOf,
  milestoneStops,
  milestoneStopsStrategy,
  pauseHere,
  type Milestone,
} from '../../../src/index.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';

// ─── 9.88.0, verbatim (739b8c2f) — renamed, nothing else touched ─────

function legacyMilestoneOf(stop: Stop): Milestone | null {
  return stop.runtimeStageId ? milestoneFor(stop.runtimeStageId) : null;
}

function legacyMilestoneStops(
  commitLog: readonly CommitBundle[],
  executionTree?: StageSnapshot,
): Stop[] {
  const perStage = commitStops(commitLog, executionTree);
  if (perStage.length === 0) return [];

  // `commitStops` guarantees the shape [start, …stages, end] for a non-empty
  // log. The bookends are kept verbatim in KIND and re-partitioned below; only
  // the stages in between are filtered.
  //
  // CHECK THE PROPERTY, NOT MERE PRESENCE. `Stop[]` does not pin that shape in
  // the type, and everything below rests on it: `'start'` is the only stop that
  // may open at `-1` (the fold base no commit index reaches) and `'end'` is the
  // only one that folds the whole log. If a future `commitStops` returned some
  // other shape, a presence check would take the first and last STAGE stops for
  // bookends — the first would silently inherit start's `-1` arithmetic and keep
  // its raw stage label, and the last milestone would lose its milestone label.
  // Refusing loudly is the honest answer: an empty axis would be
  // indistinguishable from "this run committed nothing", which is a different
  // fact about a different run.
  const [start, ...rest] = perStage;
  const end = rest.pop();
  if (!start || start.kind !== 'start' || !end || end.kind !== 'end') {
    throw new Error(
      'milestoneStops: commitStops returned an unexpected shape — expected ' +
        `[start, …stages, end], got kinds [${perStage.map((s) => s.kind).join(', ')}]. ` +
        'This is a footprintjs contract change, not something a run can cause.',
    );
  }

  const kept = rest
    .map((stop) => ({ stop, milestone: milestoneFor(stop.runtimeStageId) }))
    .filter((row): row is { stop: Stop; milestone: Milestone } => row.milestone !== null);

  const first = kept[0];
  const stops: Stop[] = [
    {
      ...start,
      step: 0,
      // Everything before the first milestone folds into `'start'`.
      lastCommitIdx: (first ? first.stop.commitIdx : commitLog.length) - 1,
    },
  ];

  for (const [i, { stop, milestone }] of kept.entries()) {
    const next = kept[i + 1];
    stops.push({
      ...stop,
      step: stops.length,
      // Absorb the non-milestone stages that ran after this one.
      lastCommitIdx: next ? next.stop.commitIdx - 1 : commitLog.length - 1,
      label: milestone.label,
    });
  }

  stops.push({ ...end, step: stops.length });
  return stops;
}

const legacyMilestoneStopsStrategy: TimeTravelStrategy = { stopsFor: legacyMilestoneStops };

// ─── the runs (the same harness the milestone tests use) ─────────────

type ReactMode = 'dynamic' | 'dynamic-grouped';
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

const skill = (id: string) =>
  defineSkill({
    id,
    description: `${id} does things`,
    body: `${id.toUpperCase()}_BODY`,
    tools: [tool(`${id}_tool`)],
  } as never);

const graph = () =>
  skillGraph({
    skills: [skill('alpha'), skill('beta')],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });

const TOOL_THEN_DONE = [
  { content: '', toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }] },
  { content: 'done', toolCalls: [] },
];

async function record(
  reactMode: ReactMode,
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
): Promise<Snapshot> {
  let i = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: () => TOOL_THEN_DONE[i++] ?? { content: 'done', toolCalls: [] },
  });
  const agent = build(
    Agent.create({ provider, model: 'mock', maxIterations: 6, reactMode }),
  ).build();
  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

/** A run that pauses inside a tool, and the snapshot on each side of the break. */
async function recordPausedAndResumed(
  reactMode: ReactMode,
): Promise<{ paused: Snapshot; resumed: Snapshot }> {
  const script = [
    { content: '', toolCalls: [{ id: 'c1', name: 'ask', args: {} }] },
    { content: 'done', toolCalls: [] },
  ];
  let i = 0;
  const agent = Agent.create({
    provider: mock({ chunkDelayMs: 0, respond: () => script[i++] ?? script[1]! }),
    model: 'mock',
    maxIterations: 6,
    reactMode,
  })
    .system('s')
    .tool(
      defineTool({
        name: 'ask',
        description: 'asks a person',
        execute: () => {
          pauseHere({ question: 'approve?' });
          return '';
        },
      }),
    )
    .build();
  const outcome = await agent.run({ message: 'go' });
  expect(isPaused(outcome)).toBe(true);
  if (!isPaused(outcome)) throw new Error('unreachable');
  const paused = agent.getSnapshot()!;
  await agent.resume(outcome.checkpoint, 'approved');
  return { paused, resumed: agent.getSnapshot()! };
}

// ─── the comparison ──────────────────────────────────────────────────

/** A stop with the two 9.18 additions removed — what 9.88.0 could see. */
function asLegacySaw(stop: Stop<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stop)) {
    if (key !== 'meta' && key !== 'prologue') out[key] = value;
  }
  return out;
}

/**
 * New against legacy, stop for stop. `perStageStart` is the port's own start
 * for this log, when the caller has it — it decides whether `prologue` MUST
 * be there (a stage was absorbed) or MUST NOT (nothing was).
 */
function expectSameAxis(
  fresh: readonly Stop<Milestone>[],
  legacy: readonly Stop[],
  perStageStart?: Stop,
): void {
  expect(fresh.length).toBe(legacy.length);
  for (const [i, stop] of fresh.entries()) {
    const was = legacy[i]!;
    // Every 9.88.0 field, equal — and no 9.88.0 key missing or added.
    expect(asLegacySaw(stop)).toEqual(asLegacySaw(was));
    expect(Object.keys(asLegacySaw(stop)).sort()).toEqual(Object.keys(was).sort());

    // meta: the milestone, on every milestone stop; nothing on the bookends.
    if (stop.kind === 'start' || stop.kind === 'end') {
      expect('meta' in stop).toBe(false);
      expect(milestoneOf(stop)).toBeNull();
      expect(legacyMilestoneOf(was)).toBeNull();
    } else {
      expect(stop.meta).toEqual(milestoneFor(stop.runtimeStageId));
      expect(stop.meta!.label).toBe(stop.label);
      // Both readings of the milestone agree, and the new one reads the slot.
      expect(milestoneOf(stop)).toEqual(legacyMilestoneOf(was));
      expect(milestoneOf(stop)).toBe(stop.meta);
    }

    // prologue: only on the start, only when it absorbed a stage.
    if (i === 0 && perStageStart !== undefined) {
      const absorbed = stop.lastCommitIdx > perStageStart.lastCommitIdx;
      if (absorbed) expect(stop.prologue).toBe(true);
      else expect('prologue' in stop).toBe(false);
    } else if (i === 0) {
      expect(stop.prologue === true || !('prologue' in stop)).toBe(true);
    } else {
      expect('prologue' in stop).toBe(false);
    }
  }
}

/** The folds agree at every stop — `stateAt` on each cursor, over its own stops. */
function expectSameFolds(fresh: TimeTravel<Milestone>, legacy: TimeTravel): void {
  expect(fresh.stops.length).toBe(legacy.stops.length);
  for (let i = 0; i < fresh.stops.length; i++) {
    const a = fresh.stateAt(fresh.stops[i]!);
    const b = legacy.stateAt(legacy.stops[i]!);
    expect(a.basis).toBe(b.basis);
    expect(a.state).toEqual(b.state);
    expect(a).toEqual(b);
  }
}

interface Source {
  readonly commitLog: readonly CommitBundle[];
  readonly executionTree?: StageSnapshot;
}

function expectEquivalent(source: Source): {
  fresh: TimeTravel<Milestone>;
  legacy: TimeTravel;
} {
  const log = source.commitLog;
  const tree = source.executionTree;
  const perStage = commitStops(log, tree);
  expectSameAxis(milestoneStops(log, tree), legacyMilestoneStops(log, tree), perStage[0]);

  const fresh = timeTravel(source, { strategy: milestoneStopsStrategy });
  const legacy = timeTravel(source, { strategy: legacyMilestoneStopsStrategy });
  expectSameAxis(fresh.stops, legacy.stops, perStage[0]);
  expectSameFolds(fresh, legacy);
  return { fresh, legacy };
}

/** Drill every mount on both cursors and compare the inner axes and folds. */
function expectEquivalentDrills(fresh: TimeTravel<Milestone>, legacy: TimeTravel): number {
  let drilled = 0;
  for (const mount of fresh.stops.filter((s) => s.kind === 'mount')) {
    const a = fresh.drill(mount.runtimeStageId);
    const b = legacy.drill(mount.runtimeStageId);
    expect(a !== undefined).toBe(b !== undefined);
    if (a === undefined || b === undefined) continue;
    expectSameAxis(a.stops, b.stops);
    expectSameFolds(a, b);
    drilled += 1;
  }
  return drilled;
}

// ─── the fixtures ────────────────────────────────────────────────────

describe('9.89.0 milestoneStops is 9.88.0 milestoneStops, on every recorded fixture', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: system + tool — same stops, same folds; meta and prologue present and right`, async () => {
      const snapshot = await record(reactMode, (a) => a.system('s').tool(tool('alpha_tool')));
      const { fresh } = expectEquivalent(snapshot);
      expect(fresh.stops.length).toBeGreaterThan(2);
      // A real agent seeds before the first milestone, so the start absorbed
      // stages on both shapes — the flag 9.18 added is there.
      expect(fresh.stops[0]!.prologue).toBe(true);
    });

    it(`${reactMode}: skill graph — same stops, same folds`, async () => {
      const snapshot = await record(reactMode, (a) => a.system('s').skillGraph(graph()));
      const { fresh } = expectEquivalent(snapshot);
      expect(fresh.stops.length).toBeGreaterThan(2);
    });
  }

  it('dynamic-grouped: every drilled inner history agrees too', async () => {
    const snapshot = await record('dynamic-grouped', (a) => a.system('s').skillGraph(graph()));
    const { fresh, legacy } = expectEquivalent(snapshot);
    expect(expectEquivalentDrills(fresh, legacy)).toBeGreaterThanOrEqual(2);
  });

  it('a log the classifier recognises nothing in — two bookends, start folds it all, prologue on', async () => {
    const snapshot = await record('dynamic', (a) => a.system('s').tool(tool('alpha_tool')));
    const plumbing = snapshot.commitLog.filter(
      (b) => milestoneFor((b as { runtimeStageId: string }).runtimeStageId) === null,
    );
    expect(plumbing.length).toBeGreaterThan(0);
    const { fresh } = expectEquivalent({ commitLog: plumbing });
    expect(fresh.stops.map((s) => s.kind)).toEqual(['start', 'end']);
    expect(fresh.stops[0]!.prologue).toBe(true);
  });

  it('an empty log — [] on both sides', () => {
    expect(milestoneStops([])).toEqual([]);
    expect(legacyMilestoneStops([])).toEqual([]);
  });

  it('a paused-then-resumed run — both snapshots agree, and so does the chained axis', async () => {
    const { paused, resumed } = await recordPausedAndResumed('dynamic');
    const atPause = expectEquivalent(paused);
    const afterResume = expectEquivalent(resumed);
    expect(atPause.fresh.stops.map((s) => s.label)).toContain('LLM turn');
    expect(afterResume.fresh.stops[1]!.label).toBe('Tool call');

    // 9.18's chain reads the two legs as one axis; the strategy is called once
    // per leg with that leg's own log, so the two implementations must agree
    // there as well — every stop, every fold, seam included.
    const fresh = timeTravel([paused, resumed], { strategy: milestoneStopsStrategy });
    const legacy = timeTravel([paused, resumed], { strategy: legacyMilestoneStopsStrategy });
    expectSameAxis(fresh.stops, legacy.stops);
    expectSameFolds(fresh, legacy);
    expect(fresh.stops.length).toBe(
      atPause.fresh.stops.length + afterResume.fresh.stops.length - 2,
    );
  });
});

describe('what a stop from ANOTHER strategy gets', () => {
  it('milestoneOf falls back to the classifier when a stop carries no meta', async () => {
    const snapshot = await record('dynamic', (a) => a.system('s').tool(tool('alpha_tool')));
    const perStage = commitStops(snapshot.commitLog, snapshot.executionTree);
    for (const stop of perStage) {
      expect('meta' in stop).toBe(false);
      expect(milestoneOf(stop)).toEqual(legacyMilestoneOf(stop));
    }
  });

  it('a meta of some other vocabulary is not mistaken for a milestone', () => {
    const foreign: Stop<{ beat: string }> = {
      step: 1,
      runtimeStageId: 'call-llm#1',
      commitIdx: 0,
      lastCommitIdx: 0,
      stageId: 'call-llm',
      label: 'x',
      kind: 'commit',
      meta: { beat: 'verse' },
    };
    expect(milestoneOf(foreign)).toEqual(milestoneFor('call-llm#1'));
    expect(milestoneOf(foreign)).not.toBe(foreign.meta);
  });
});
