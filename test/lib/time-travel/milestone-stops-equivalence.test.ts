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
import { commitStops, filterStops, splitStageId, timeTravel } from 'footprintjs/trace';
import type { Stop, TimeTravel, TimeTravelStrategy } from 'footprintjs/trace';
import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import {
  Agent,
  LLMCall,
  MILESTONE_TAG_PREFIX,
  defineTool,
  isPaused,
  milestoneFor,
  milestoneFromTags,
  milestoneOf,
  milestoneStops,
  milestoneStopsStrategy,
  milestoneTags,
  milestoneTagsFor,
  pauseHere,
  type Milestone,
} from '../../../src/index.js';
import { STAGE_IDS, SUBFLOW_IDS } from '../../../src/conventions.js';
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

// ─── 9.90.0: the tag is the fact, the id is the fallback ─────────────
//
// footprintjs 9.21 lets a chart DECLARE a stage's tags at build time and stamps
// them on the stage's first commit bundle. agentfootprint's charts now declare
// every milestone the table in conventions.ts classifies, and `milestoneStops`
// reads the bundle first — `milestoneFor(id)` only for a bundle that carries no
// tags. What follows pins that: the TAG-ONLY axis (no id conventions at all) is
// the id axis on every fixture and the shipped reader took the fallback path
// ZERO times (footprintjs 9.21.1 tags branch mounts too, so every milestone
// stage is declared); a recording with its tags stripped is still the id axis;
// a mixed log reads each stop from wherever the fact is; and the Map lists the
// vocabulary.

/** The local segment of a stage id — what the milestone table is keyed by. */
function localIdOf(runtimeStageId: string): string {
  const beforeHash = runtimeStageId.includes('#')
    ? runtimeStageId.slice(0, runtimeStageId.indexOf('#'))
    : runtimeStageId;
  return splitStageId(beforeHash).localStageId;
}

/** The TAG-ONLY axis: what a reader with no id conventions at all sees. */
function taggedMilestoneStops(
  log: readonly CommitBundle[],
  tree?: StageSnapshot,
): Stop<Milestone>[] {
  return filterStops<Milestone>(commitStops(log, tree), (stop) => {
    const found = milestoneFromTags(log[stop.commitIdx]?.tags, stop.label);
    return found ? { label: found.label, meta: found } : null;
  });
}
const taggedStrategy: TimeTravelStrategy<Milestone> = { stopsFor: taggedMilestoneStops };

/** The ID-ONLY axis: 9.88.0's classifier as a `filterStops` keep rule, meta and label on. */
const idStrategy: TimeTravelStrategy<Milestone> = {
  stopsFor: (log, tree) =>
    filterStops<Milestone>(commitStops(log, tree), (stop) => {
      const found = milestoneFor(stop.runtimeStageId);
      return found ? { label: found.label, meta: found } : null;
    }),
};

const stripTags = (bundle: CommitBundle): CommitBundle => {
  const { tags: _tags, ...rest } = bundle as CommitBundle & { tags?: unknown };
  return rest as CommitBundle;
};

/**
 * How many milestone stops the SHIPPED reader classified from the id — the
 * fallback path. It must be ZERO on a 9.90.0 recording: every milestone stage
 * is declared, so a stop that only the id could explain is a forgotten
 * declaration, even where the fallback would have hidden it on the axis.
 */
function fallbackCount(log: readonly CommitBundle[], tree?: StageSnapshot): number {
  return milestoneStops(log, tree).filter(
    (s) =>
      s.kind !== 'start' && s.kind !== 'end' && milestoneFromTags(log[s.commitIdx]?.tags) === null,
  ).length;
}

/**
 * THE FORGOTTEN-TAG CATCH. Three readers over one log — tag-only, id-only and
 * the shipped `milestoneStops` — must produce the SAME stops (labels, kinds,
 * commit ranges, meta, whole) and the same fold at every stop; and the shipped
 * reader must have taken the fallback path zero times. A declaration site
 * without its tag makes the tag-only axis miss a stop the id axis has, or the
 * fallback count go positive — red either way.
 */
function expectTagAxisIsIdAxis(source: Source): Stop<Milestone>[] {
  const log = source.commitLog;
  const tree = source.executionTree;
  const tagged = taggedMilestoneStops(log, tree);
  expect(tagged).toEqual(idStrategy.stopsFor(log, tree));
  expect(tagged).toEqual(milestoneStops(log, tree));
  expect(fallbackCount(log, tree)).toBe(0);

  // Every milestone stop's bundle declares exactly what the table says.
  for (const s of tagged) {
    if (s.kind === 'start' || s.kind === 'end') continue;
    expect(log[s.commitIdx]!.tags).toEqual(milestoneTags(milestoneFor(s.runtimeStageId)!));
  }

  const a = timeTravel(source, { strategy: taggedStrategy });
  const b = timeTravel(source, { strategy: idStrategy });
  expectSameFolds(a, b);
  return tagged;
}

/** A mount's own isolated log, as `drill()` reads it — the subflow's `history`. */
function innerSourceOf(snapshot: Snapshot, mountRuntimeStageId: string): Source {
  const hit = (snapshot.subflowResults as Record<string, { treeContext: { history: unknown[] } }>)[
    mountRuntimeStageId
  ];
  expect(hit, `subflowResults[${mountRuntimeStageId}]`).toBeDefined();
  return { commitLog: hit!.treeContext.history as CommitBundle[] };
}

async function recordLLMCall(): Promise<Snapshot> {
  const call = LLMCall.create({
    provider: mock({ chunkDelayMs: 0, respond: () => ({ content: 'done', toolCalls: [] }) }),
    model: 'mock',
  })
    .system('s')
    .build();
  await call.run({ message: 'go' });
  return call.getSnapshot()!;
}

describe('9.90.0: the tag is the fact — the tag-only axis is the id axis on every fixture', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: system + tool — forgotten-tag catch, fallback = 0`, async () => {
      const snapshot = await record(reactMode, (a) => a.system('s').tool(tool('alpha_tool')));
      const tagged = expectTagAxisIsIdAxis(snapshot);
      expect(tagged.filter((s) => s.meta?.kind === 'iteration').length).toBeGreaterThan(0);
      expect(tagged.filter((s) => s.meta?.kind === 'decision').length).toBeGreaterThan(0);
      expect(tagged.filter((s) => s.meta?.kind === 'tool-call').length).toBeGreaterThan(0);
      // The slots are selector-branch mounts: on the outer log in `dynamic`,
      // inside the drill in `dynamic-grouped` — tagged either way (9.21.1).
      if (reactMode === 'dynamic')
        expect(tagged.filter((s) => s.meta?.kind === 'slot').length).toBeGreaterThanOrEqual(3);
    });

    it(`${reactMode}: skill graph — forgotten-tag catch, fallback = 0`, async () => {
      const snapshot = await record(reactMode, (a) => a.system('s').skillGraph(graph()));
      expectTagAxisIsIdAxis(snapshot);
    });
  }

  it('dynamic-grouped: every drilled inner history — the llm-turn is tagged one drill down', async () => {
    const snapshot = await record('dynamic-grouped', (a) => a.system('s').skillGraph(graph()));
    const outer = timeTravel(snapshot, { strategy: taggedStrategy });
    let drilled = 0;
    for (const mount of outer.stops.filter((s) => s.kind === 'mount')) {
      if (!outer.drill(mount.runtimeStageId)) continue;
      const tagged = expectTagAxisIsIdAxis(innerSourceOf(snapshot, mount.runtimeStageId));
      // The slots are selector-branch mounts INSIDE the turn — tagged there too.
      expect(tagged.filter((s) => s.meta?.kind === 'slot').length).toBeGreaterThanOrEqual(3);
      expect(tagged.some((s) => s.meta?.kind === 'llm-turn')).toBe(true);
      drilled += 1;
    }
    expect(drilled).toBeGreaterThanOrEqual(2);
  });

  it('a paused-then-resumed run — both legs, and the chained axis', async () => {
    const { paused, resumed } = await recordPausedAndResumed('dynamic');
    expectTagAxisIsIdAxis(paused);
    expectTagAxisIsIdAxis(resumed);
    const chained = timeTravel([paused, resumed], { strategy: taggedStrategy });
    const idChained = timeTravel([paused, resumed], { strategy: idStrategy });
    expect(chained.stops).toEqual(idChained.stops);
    expectSameFolds(chained, idChained);
  });

  it('LLMCall (slots mounted with addSubFlowChartNext) — the tag axis IS the id axis, nothing missing', async () => {
    const snapshot = await recordLLMCall();
    const tagged = expectTagAxisIsIdAxis(snapshot);
    expect(tagged.map((s) => s.meta?.kind ?? s.kind)).toEqual(['start', 'iteration', 'end']);
    const innerTagged = expectTagAxisIsIdAxis(innerSourceOf(snapshot, tagged[1]!.runtimeStageId));
    expect(innerTagged.map((s) => s.meta?.kind ?? s.kind)).toEqual([
      'start',
      'slot',
      'slot',
      'llm-turn',
      'end',
    ]);
    expect(innerTagged.map((s) => s.label)).toEqual([
      'Run start',
      'System prompt',
      'Messages',
      'LLM turn',
      'Run end',
    ]);
  });
});

describe('9.90.0: the id is the fallback', () => {
  it('a stored recording with `tags` stripped from every bundle still yields the id axis', async () => {
    const snapshot = await record('dynamic', (a) => a.system('s').tool(tool('alpha_tool')));
    expect(snapshot.commitLog.some((b) => b.tags !== undefined)).toBe(true);
    const stripped: Source = {
      commitLog: snapshot.commitLog.map(stripTags),
      executionTree: snapshot.executionTree,
    };
    expect(stripped.commitLog.every((b) => b.tags === undefined)).toBe(true);
    // The tag-only reader sees nothing…
    expect(
      taggedMilestoneStops(stripped.commitLog, stripped.executionTree).map((s) => s.kind),
    ).toEqual(['start', 'end']);
    // …and milestoneStops sees the whole 9.88.0 axis, folds included — every
    // one of its milestone stops from the fallback path this time.
    const { fresh } = expectEquivalent(stripped);
    expect(fresh.stops.length).toBeGreaterThan(2);
    expect(fallbackCount(stripped.commitLog, stripped.executionTree)).toBe(fresh.stops.length - 2);
    expect(fresh.stops).toEqual(milestoneStops(snapshot.commitLog, snapshot.executionTree));
  });

  it('a mixed log reads the tag where present and the id where absent — same axis', async () => {
    const snapshot = await record('dynamic', (a) => a.system('s').skillGraph(graph()));
    let n = 0;
    const mixed: Source = {
      commitLog: snapshot.commitLog.map((b) =>
        b.tags !== undefined && n++ % 2 === 0 ? stripTags(b) : b,
      ),
      executionTree: snapshot.executionTree,
    };
    expect(mixed.commitLog.some((b) => b.tags !== undefined)).toBe(true);
    expect(mixed.commitLog.filter((b) => b.tags === undefined).length).toBeGreaterThan(
      snapshot.commitLog.filter((b) => b.tags === undefined).length,
    );
    const { fresh } = expectEquivalent(mixed);
    for (const stop of fresh.stops) {
      if (stop.kind === 'start' || stop.kind === 'end') continue;
      const bundle = mixed.commitLog[stop.commitIdx]!;
      if (bundle.tags !== undefined) expect(milestoneFromTags(bundle.tags)).toEqual(stop.meta);
      else expect(milestoneFor(stop.runtimeStageId)).toEqual(stop.meta);
    }
  });

  it('the tag is the fact: a bundle tagged as something ELSE is not a stop, however recognisable its id', async () => {
    const snapshot = await record('dynamic', (a) => a.system('s').tool(tool('alpha_tool')));
    const log = snapshot.commitLog;
    const idx = log.findIndex(
      (b) => localIdOf((b as { runtimeStageId: string }).runtimeStageId) === STAGE_IDS.CALL_LLM,
    );
    expect(idx).toBeGreaterThan(0);
    const retagged = log.map((b, i) =>
      i === idx ? ({ ...b, tags: ['audit'] } as CommitBundle) : b,
    );
    const fresh = milestoneStops(retagged, snapshot.executionTree);
    const legacy = legacyMilestoneStops(retagged, snapshot.executionTree);
    expect(legacy.some((s) => s.commitIdx === idx)).toBe(true);
    expect(fresh.some((s) => s.commitIdx === idx)).toBe(false);
    expect(fresh.length).toBe(legacy.length - 1);
  });

  it('milestoneFromTags: the vocabulary, read back', () => {
    expect(milestoneFromTags(milestoneTagsFor(STAGE_IDS.CALL_LLM))).toEqual({
      kind: 'llm-turn',
      label: 'LLM turn',
    });
    expect(milestoneFromTags([`${MILESTONE_TAG_PREFIX}decision`], 'Route')).toEqual({
      kind: 'decision',
      label: 'Route',
    });
    expect(milestoneFromTags([`${MILESTONE_TAG_PREFIX}decision`])).toEqual({
      kind: 'decision',
      label: 'decision',
    });
    expect(milestoneFromTags([`${MILESTONE_TAG_PREFIX}beat`])).toBeNull();
    expect(milestoneFromTags(['audit', 'milestone-label:LLM turn'])).toBeNull();
    expect(milestoneFromTags([42, null, `${MILESTONE_TAG_PREFIX}slot`], 'Tools')).toEqual({
      kind: 'slot',
      label: 'Tools',
    });
    expect(milestoneFromTags(undefined)).toBeNull();
    expect(milestoneFromTags([])).toBeNull();
    expect(() => milestoneTagsFor('seed')).toThrow(/not a milestone stage/);
  });
});

// ─── the Map advertises the vocabulary ───────────────────────────────

interface SpecNode {
  readonly id: string;
  readonly tags?: readonly string[];
  readonly children?: readonly SpecNode[];
  readonly next?: SpecNode;
  readonly subflowStructure?: SpecNode;
  /** A `loopTo` back-edge stub — the target's id twin, not a stage; carries no tags by design. */
  readonly isLoopReference?: boolean;
}

function walk(node: SpecNode | undefined, out: SpecNode[] = []): SpecNode[] {
  if (!node) return out;
  if (!node.isLoopReference) out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  walk(node.subflowStructure, out);
  walk(node.next, out);
  return out;
}

describe('9.90.0: the Map advertises the milestone vocabulary before any run', () => {
  const build = (reactMode: ReactMode) =>
    Agent.create({
      provider: mock({ chunkDelayMs: 0, respond: () => ({ content: 'done', toolCalls: [] }) }),
      model: 'mock',
      maxIterations: 6,
      reactMode,
    })
      .system('s')
      .tool(tool('alpha_tool'))
      .outputSchema(
        { safeParse: (v: unknown) => ({ ok: true, value: v }) } as never,
        {
          retries: 1,
        } as never,
      )
      .namesAndNumbersFromEvidence({ posture: 'guard' } as never)
      .build();

  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: every milestone node the table classifies is tagged from the table — slot branch mounts included`, () => {
      const nodes = walk(build(reactMode).getSpec().buildTimeStructure as unknown as SpecNode);
      const declared = new Map<string, readonly string[]>();
      for (const node of nodes) {
        const local = localIdOf(node.id);
        const classified = milestoneFor(local);
        if (classified === null) {
          expect(node.tags?.some((t) => t.startsWith(MILESTONE_TAG_PREFIX)) ?? false).toBe(false);
          continue;
        }
        expect(node.tags, `Map node ${node.id}`).toEqual(milestoneTagsFor(local));
        declared.set(local, node.tags!);
      }
      const expected = [
        SUBFLOW_IDS.INJECTION_ENGINE,
        SUBFLOW_IDS.SYSTEM_PROMPT,
        SUBFLOW_IDS.MESSAGES,
        SUBFLOW_IDS.TOOLS,
        STAGE_IDS.CALL_LLM,
        SUBFLOW_IDS.ROUTE,
        'tool-calls',
        STAGE_IDS.OUTPUT_RETRY,
        STAGE_IDS.EVIDENCE_RECHECK,
        STAGE_IDS.WRAP_UP,
        ...(reactMode === 'dynamic-grouped' ? [SUBFLOW_IDS.LLM_CALL] : []),
      ];
      for (const id of expected) expect(declared.has(id), `Map lists ${id}`).toBe(true);
    });
  }
});
