/**
 * milestoneStops — the agent's own scrub stops, over REAL runs.
 *
 * Every run here is a real agent driven by the mock provider: a chart is built,
 * stages execute, commits land, and the cursor is opened over the finished
 * snapshot. Nothing is hand-built, because the claim under test is about what
 * an agent run actually commits — a fixture log would let the strategy agree
 * with a fiction.
 *
 * The claim, in one sentence: **the stops are exactly the committed
 * milestones, in commit order, and the cursor over them answers the questions a
 * reader actually asks** — where was the skill cursor at this turn, what
 * changed between these two turns, what is inside this iteration.
 *
 * Test types (Convention 3): unit (the strategy's partition) / functional (the
 * axis in both chart shapes) / integration (a skill graph along the commits,
 * and a drill) / regression (a miss never moves) / property (every commit
 * belongs to exactly one stop).
 */

import { describe, expect, it } from 'vitest';
import { commitStops, timeTravel } from 'footprintjs/trace';
import type { Stop, TimeTravel } from 'footprintjs/trace';
import {
  Agent,
  defineTool,
  isPaused,
  milestoneFor,
  milestoneOf,
  milestoneStops,
  milestoneStopsStrategy,
  pauseHere,
} from '../../../src/index.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';

type ReactMode = 'dynamic' | 'dynamic-grouped';

interface Recorded {
  readonly snapshot: NonNullable<ReturnType<Agent['getSnapshot']>>;
  /** What the model was actually served, one entry per turn — the WIRE witness. */
  readonly wire: ReadonlyArray<{ system: string; tools: readonly string[] }>;
  readonly answer: unknown;
}

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

const skill = (id: string) =>
  defineSkill({
    id,
    description: `${id} does things`,
    body: `${id.toUpperCase()}_BODY`,
    tools: [tool(`${id}_tool`)],
  } as never);

/** alpha → beta, the hop taken when `alpha_tool` returns. */
const graph = () =>
  skillGraph({
    skills: [skill('alpha'), skill('beta')],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });

/**
 * One real run. `script` is what the model says, turn by turn; `wire` is what
 * it was served, captured at the moment of the call.
 */
async function record(
  reactMode: ReactMode,
  script: ReadonlyArray<{
    content: string;
    toolCalls: Array<{ id: string; name: string; args: unknown }>;
  }>,
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
): Promise<Recorded> {
  const wire: Array<{ system: string; tools: readonly string[] }> = [];
  let i = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond: (req: {
      systemPrompt?: string;
      messages?: ReadonlyArray<{ role: string; content: string }>;
      tools?: ReadonlyArray<{ name: string }>;
    }) => {
      wire.push({
        system: req.systemPrompt ?? '',
        tools: (req.tools ?? []).map((t) => t.name),
      });
      return script[i++] ?? { content: 'done', toolCalls: [] };
    },
  });
  const agent = build(
    Agent.create({ provider, model: 'mock', maxIterations: 6, reactMode }),
  ).build();
  const answer = await agent.run({ message: 'go' });
  return { snapshot: agent.getSnapshot()!, wire, answer };
}

const TOOL_THEN_DONE = [
  { content: '', toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }] },
  { content: 'done', toolCalls: [] },
];

const cursorOver = (r: Recorded): TimeTravel =>
  timeTravel(r.snapshot, { strategy: milestoneStopsStrategy });

const kindsOf = (stops: readonly Stop[]): Array<string | undefined> =>
  stops.map((s) => milestoneOf(s)?.kind);

/** The first commit of each distinct stage, in commit order — the raw axis. */
function firstCommitIds(r: Recorded): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const bundle of r.snapshot.commitLog) {
    const id = (bundle as { runtimeStageId: string }).runtimeStageId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// ─── (a) FUNCTIONAL — the stops ARE the milestones, in commit order ───

describe('the axis is exactly what the log committed and the domain classifies', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: every stop is a milestone, every milestone is a stop, labels come from milestoneFor`, async () => {
      const r = await record(reactMode, TOOL_THEN_DONE, (a) =>
        a.system('s').tool(tool('alpha_tool')),
      );
      const cursor = cursorOver(r);

      const expected = firstCommitIds(r).filter((id) => milestoneFor(id) !== null);
      expect(expected.length).toBeGreaterThan(0);

      const middle = cursor.stops.slice(1, -1);
      expect(middle.map((s) => s.runtimeStageId)).toEqual(expected);
      for (const stop of middle) expect(stop.label).toBe(milestoneFor(stop.runtimeStageId)!.label);

      // The bookends are the port's, kept: they are positions, not milestones.
      expect(cursor.stops[0]!.kind).toBe('start');
      expect(cursor.stops[cursor.stops.length - 1]!.kind).toBe('end');
      expect(milestoneOf(cursor.stops[0]!)).toBeNull();

      // Steps are renumbered over the SURVIVORS — the axis a slider indexes.
      expect(cursor.stops.map((s) => s.step)).toEqual(cursor.stops.map((_, i) => i));
    });
  }

  it('a non-milestone stage is on the per-stage axis and NOT on this one', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );
    const plumbing = firstCommitIds(r).filter((id) => milestoneFor(id) === null);
    expect(plumbing.length).toBeGreaterThan(0); // seed, context, sf-cache, sf-thinking …

    const ids = new Set(cursorOver(r).stops.map((s) => s.runtimeStageId));
    for (const id of plumbing) expect(ids.has(id)).toBe(false);
  });
});

// ─── PROPERTY — the survivors still partition the log ────────────────

describe('every commit belongs to exactly one stop', () => {
  it('the stops tile the log from end to end, with no gap and no overlap', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );
    const stops = milestoneStops(r.snapshot.commitLog, r.snapshot.executionTree);

    // `'start'` opens at -1 (the fold base, which no commit index reaches).
    expect(stops[0]!.commitIdx).toBe(-1);
    for (let i = 1; i < stops.length - 1; i++) {
      expect(stops[i]!.commitIdx).toBe(stops[i - 1]!.lastCommitIdx + 1);
      expect(stops[i]!.lastCommitIdx).toBeGreaterThanOrEqual(stops[i]!.commitIdx);
    }
    // The last MILESTONE stop runs to the end of the log; `'end'` folds it all.
    expect(stops[stops.length - 2]!.lastCommitIdx).toBe(r.snapshot.commitLog.length - 1);
    expect(stops[stops.length - 1]!.lastCommitIdx).toBe(r.snapshot.commitLog.length - 1);
  });

  it('an empty log has no stops at all — not two bookends around nothing', () => {
    expect(milestoneStops([])).toEqual([]);
  });
});

// ─── (b) REGRESSION — a jump that hits, and a miss that never moves ──

describe('jumping', () => {
  it('lands on the llm-turn stop for a call-llm id', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );
    const cursor = cursorOver(r);
    const turn = firstCommitIds(r).find((id) => milestoneFor(id)?.kind === 'llm-turn')!;

    const move = cursor.jumpTo(turn);
    expect(move.moved).toBe(true);
    expect(cursor.at()!.runtimeStageId).toBe(turn);
    expect(milestoneOf(cursor.at()!)!.kind).toBe('llm-turn');
    expect(cursor.at()!.label).toBe('LLM turn');
  });

  it('a jump to a stage that classifies null MISSES, names a nearest, and leaves the cursor put', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );
    const cursor = cursorOver(r);
    const turn = firstCommitIds(r).find((id) => milestoneFor(id)?.kind === 'llm-turn')!;
    cursor.jumpTo(turn);

    // A stage that really ran and really committed — and is still not a stop.
    const plumbing = firstCommitIds(r).find(
      (id) => milestoneFor(id) === null && id.includes('#') && id !== 'seed#0',
    )!;
    const move = cursor.jumpTo(plumbing);

    expect(move.moved).toBe(false);
    if (move.moved) throw new Error('unreachable');
    expect(move.reason).toBe('miss');
    expect(move.at!.runtimeStageId).toBe(turn);
    expect(move.nearest).toBeDefined();
    expect(cursor.at()!.runtimeStageId).toBe(turn); // the law: a miss never moves
  });
});

// ─── (c) INTEGRATION — the skill graph, read along the commits ───────

describe('the skill cursor, read off the axis', () => {
  it('dynamic: alpha at turn 1, beta at turn 2, and changedSince names currentSkillId', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) => a.system('s').skillGraph(graph()));
    const cursor = cursorOver(r);

    const turns = cursor.stops.filter((s) => milestoneOf(s)?.kind === 'llm-turn');
    expect(turns).toHaveLength(2);

    const at = (stop: Stop): string | undefined =>
      (cursor.stateAt(stop).state as { currentSkillId?: string }).currentSkillId;
    expect(at(turns[0]!)).toBe('alpha');
    expect(at(turns[1]!)).toBe('beta');
    expect(cursor.stateAt(turns[0]!).basis).toBe('initial+log');

    cursor.jumpTo(turns[1]!.step);
    expect(cursor.changedSince(turns[0]!)).toContain('currentSkillId');

    // And the fold agrees with what the model was actually served that turn.
    expect(r.wire[0]!.system).toContain('ALPHA_BODY');
    expect(r.wire[1]!.system).toContain('BETA_BODY');
  });

  it('grouped: the settled cursor is on the OUTER axis, at each iteration stop', async () => {
    const r = await record('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('s').skillGraph(graph()),
    );
    const cursor = cursorOver(r);

    // The turn itself is inside a subflow, so the outer log has no llm-turn
    // stop at all — the iteration mounts are the outer vocabulary.
    expect(kindsOf(cursor.stops)).not.toContain('llm-turn');
    const iterations = cursor.stops.filter((s) => milestoneOf(s)?.kind === 'iteration');
    expect(iterations).toHaveLength(2);

    const at = (stop: Stop): string | undefined =>
      (cursor.stateAt(stop).state as { currentSkillId?: string }).currentSkillId;
    expect(at(iterations[0]!)).toBe('alpha');
    expect(at(iterations[1]!)).toBe('beta');

    cursor.jumpTo(iterations[1]!.step);
    expect(cursor.changedSince(iterations[0]!)).toContain('currentSkillId');
  });

  it('grouped: INSIDE the turn, the move is `nextSkillCursor` — and that is the honest answer', async () => {
    const r = await record('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('s').skillGraph(graph()),
    );
    const cursor = cursorOver(r);
    const iterations = cursor.stops.filter((s) => milestoneOf(s)?.kind === 'iteration');

    // `currentSkillId` crosses the mount as a READ-ONLY input, so inside the
    // subflow it is the value the turn STARTED from (absent on turn 1, 'alpha'
    // on turn 2); the cursor this turn settled on is `nextSkillCursor`, which
    // the outputMapper merges back out as the outer `currentSkillId`. Both
    // logs are truthful about different questions, and a reader must be told
    // which one it is holding.
    const settled = iterations.map((mount) => {
      const inner = cursor.drill(mount.runtimeStageId)!;
      const turn = inner.stops.find((s) => milestoneOf(s)?.kind === 'llm-turn')!;
      const state = inner.stateAt(turn).state as {
        currentSkillId?: string;
        nextSkillCursor?: string;
      };
      return { entered: state.currentSkillId, settled: state.nextSkillCursor };
    });

    expect(settled).toEqual([
      { entered: undefined, settled: 'alpha' },
      { entered: 'alpha', settled: 'beta' },
    ]);
  });
});

// ─── (d) INTEGRATION — the drill, per iteration ──────────────────────

describe('drilling a grouped turn', () => {
  it('yields the llm-turn stops, per iteration, folded against the subflow’s own base', async () => {
    const r = await record('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('s').skillGraph(graph()),
    );
    const cursor = cursorOver(r);
    const iterations = cursor.stops.filter((s) => milestoneOf(s)?.kind === 'iteration');

    const turnsPerIteration = iterations.map((mount, k) => {
      const inner = cursor.drill(mount.runtimeStageId)!;
      expect(inner.parent).toBe(cursor);
      expect(inner.mountRuntimeStageId).toBe(mount.runtimeStageId);

      const turns = inner.stops.filter((s) => milestoneOf(s)?.kind === 'llm-turn');
      expect(turns).toHaveLength(1);
      const fold = inner.stateAt(turns[0]!);
      expect(fold.basis).toBe('initial+log'); // the subflow's own fold base

      // THE WITNESS: what the model was served on turn k+1. The skill whose
      // body rode that call is the skill this iteration's own log settled on.
      const settled = (fold.state as { nextSkillCursor?: string }).nextSkillCursor!;
      expect(r.wire[k]!.system).toContain(`${settled.toUpperCase()}_BODY`);
      return turns[0]!.runtimeStageId;
    });

    // Dual-keyed per iteration: two mounts, two different logs, two turns.
    expect(new Set(turnsPerIteration).size).toBe(2);
  });

  it('a mount id that is not in this run drills to undefined, and moving the inner cursor never moves the outer', async () => {
    const r = await record('dynamic-grouped', TOOL_THEN_DONE, (a) =>
      a.system('s').skillGraph(graph()),
    );
    const cursor = cursorOver(r);
    expect(cursor.drill('sf-llm-call#9999')).toBeUndefined();

    const mount = cursor.stops.find((s) => milestoneOf(s)?.kind === 'iteration')!;
    cursor.jumpTo(mount.step);
    const inner = cursor.drill(mount.runtimeStageId)!;
    inner.last();
    expect(cursor.at()!.runtimeStageId).toBe(mount.runtimeStageId);
  });
});

// ─── (e) FUNCTIONAL — no skill graph, same axis ──────────────────────

describe('an agent with no skill graph', () => {
  it('still stops on iteration, llm-turn and tool-call', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );
    const kinds = new Set(kindsOf(cursorOver(r).stops));

    expect(kinds).toContain('iteration');
    expect(kinds).toContain('llm-turn');
    expect(kinds).toContain('tool-call');
    expect(kinds).toContain('decision'); // the route that sent it to the tool
  });
});

// ─── (f) UNIT — marks are the reader's notes ─────────────────────────

describe('marks', () => {
  it('survive jumps, and never appear in the recording', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );
    const cursor = cursorOver(r);
    const turn = firstCommitIds(r).find((id) => milestoneFor(id)?.kind === 'llm-turn')!;

    cursor.jumpTo(turn);
    cursor.mark('the turn that called the tool');
    cursor.first();
    cursor.last();
    expect(cursor.at()!.kind).toBe('end');

    const back = cursor.jumpToMark('the turn that called the tool');
    expect(back.moved).toBe(true);
    expect(cursor.at()!.runtimeStageId).toBe(turn);
    expect(cursor.marks().map((m) => m.name)).toEqual(['the turn that called the tool']);

    // Beside the log, never in it.
    expect(JSON.stringify(r.snapshot)).not.toContain('the turn that called the tool');
  });
});

// ─── (g) FUNCTIONAL — what `'start'` MEANS on a milestone axis ───────

describe("the `'start'` bookend", () => {
  it('folds the stages that ran before the first milestone — the state the first milestone READ, not the run’s base', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );

    const milestone = milestoneStops(r.snapshot.commitLog, r.snapshot.executionTree);
    const perStage = commitStops(r.snapshot.commitLog, r.snapshot.executionTree);

    // The partition law at the one seam a reader is most likely to trust
    // blindly: start runs to just before the FIRST milestone begins.
    expect(milestone[0]!.commitIdx).toBe(-1);
    expect(milestone[0]!.lastCommitIdx).toBe(milestone[1]!.commitIdx - 1);

    // footprintjs's own `'start'` is the fold BASE — it reaches no commit at
    // all. Ours reaches every pre-milestone commit, so the same `kind` is a
    // different position, and a renderer keyed on `kind === 'start'` to show
    // "what the run began with" would be showing post-seed state.
    expect(perStage[0]!.lastCommitIdx).toBe(-1);
    expect(milestone[0]!.lastCommitIdx).toBeGreaterThan(perStage[0]!.lastCommitIdx);

    const cursor = timeTravel(r.snapshot, { strategy: milestoneStopsStrategy });
    const plain = timeTravel(r.snapshot); // commitStops — the port's default
    const base = Object.keys(plain.stateAt(plain.stops[0]!).state as object);
    const folded = Object.keys(cursor.stateAt(cursor.stops[0]!).state as object);

    expect(folded.length).toBeGreaterThan(base.length);
    expect(folded).toContain('userMessage'); // `seed`'s writes have already landed
    expect(base).not.toContain('userMessage');
  });
});

// ─── (h) REGRESSION — a log the classifier recognises nothing in ─────

describe('a non-empty log with no milestones in it', () => {
  it('yields the two bookends and nothing between them, and a jump to a real stage refuses', async () => {
    const r = await record('dynamic', TOOL_THEN_DONE, (a) =>
      a.system('s').tool(tool('alpha_tool')),
    );

    // Real bundles from a real run, keeping only the stages the classifier
    // returns `null` for — the shape any non-agent footprintjs chart handed
    // this strategy would have.
    const plumbing = r.snapshot.commitLog.filter(
      (b) => milestoneFor((b as { runtimeStageId: string }).runtimeStageId) === null,
    );
    expect(plumbing.length).toBeGreaterThan(0);

    const stops = milestoneStops(plumbing);
    // NOT `[]` — that is the answer for an EMPTY log, a different fact.
    expect(stops.map((s) => s.kind)).toEqual(['start', 'end']);
    expect(stops[0]!.commitIdx).toBe(-1);
    expect(stops[0]!.lastCommitIdx).toBe(plumbing.length - 1);
    expect(stops[1]!.commitIdx).toBe(plumbing.length - 1);

    const cursor = timeTravel({ commitLog: plumbing }, { strategy: milestoneStopsStrategy });
    const id = (plumbing[0] as { runtimeStageId: string }).runtimeStageId;
    const move = cursor.jumpTo(id);
    expect(move.moved).toBe(false);
    if (move.moved) throw new Error('unreachable');
    expect(move.reason).toBe('miss');
    // The bookends are still positions, so the cursor is not `'empty'` — it
    // opens on `'start'` and can walk to `'end'`. There is simply nothing
    // between them to scrub to.
    expect(cursor.at()!.kind).toBe('start');
    expect(cursor.last().moved).toBe(true);
    expect(cursor.at()!.kind).toBe('end');
  });
});

// ─── (i) INTEGRATION — a run that paused and was resumed ─────────────

describe('a resumed run', () => {
  it('gets an axis of its OWN: the resumed snapshot begins at the resumed stage, and the pre-pause milestones are in the PAUSED snapshot', async () => {
    const script = [
      { content: '', toolCalls: [{ id: 'c1', name: 'ask', args: {} }] },
      { content: 'done', toolCalls: [] },
    ];
    let i = 0;
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, respond: () => script[i++] ?? script[1]! }),
      model: 'mock',
      maxIterations: 6,
      reactMode: 'dynamic',
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

    const paused = await agent.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) throw new Error('unreachable');

    const atPause = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
    const beforeTheBreak = atPause.stops.map((s) => s.label);
    expect(beforeTheBreak).toContain('LLM turn');
    expect(beforeTheBreak).toContain('Tool call');

    await agent.resume(paused.checkpoint, 'approved');
    const afterTheBreak = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });

    // THE HONEST EDGE. `getSnapshot()` is the snapshot of the run that just
    // finished, and a resume is its own execution with its own log — so the
    // resumed axis STARTS at the tool call it resumed into and carries none of
    // the pre-pause turn. The cursor reads the snapshot it is handed; to read
    // the first half, open a cursor over the snapshot taken at the pause.
    expect(afterTheBreak.stops[1]!.label).toBe('Tool call');

    const turnBefore = atPause.stops.find((s) => s.label === 'LLM turn')!.runtimeStageId;
    const idsAfter = afterTheBreak.stops.map((s) => s.runtimeStageId);
    expect(idsAfter).not.toContain(turnBefore);

    // The strategy itself holds on both: the stops still tile each log.
    for (const cursor of [atPause, afterTheBreak]) {
      const stops = cursor.stops;
      expect(stops[0]!.commitIdx).toBe(-1);
      for (let k = 1; k < stops.length - 1; k++) {
        expect(stops[k]!.commitIdx).toBe(stops[k - 1]!.lastCommitIdx + 1);
      }
      expect(new Set(stops.slice(1, -1).map((s) => s.runtimeStageId)).size).toBe(stops.length - 2);
    }
  });
});
