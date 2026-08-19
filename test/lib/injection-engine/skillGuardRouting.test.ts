/**
 * Guards-as-data on skill route edges + the SkillMap vocabulary (9.51.0).
 *
 * The SkillWalker's third mover becomes data: `guard:` beside the code
 * `when` on `SkillRouteOptions` — at most one of the two, refused at build
 * naming both. Pinned here:
 *
 *   • ONE compilation: the predicate that routes, the `SkillEdge.guard`
 *     data the map carries, and the per-condition evidence on the move
 *     (`cursorMove.guard` taken / `cursorMove.guardsClosed` refused);
 *   • a guard edge is DETERMINISTIC (kind `'guard'` alone; composed with
 *     `onToolReturn`/`onToolStatus` it keeps that kind and rides beside);
 *   • `toMermaid()` captions a guard-only edge in plain words;
 *   • the check-up proves contradictions (`guard-unsatisfiable`, ERROR);
 *   • `skill.graph_declared` carries the guard data into every recording;
 *   • `defineSkillMap` is a permanent reference-equal alias of `skillGraph`.
 *
 * Sections follow Convention 3: Unit · Functional · Integration · Property.
 */

import { describe, it, expect } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import {
  defineSkill,
  defineSkillMap,
  skillGraph,
  SKILL_GRAPH_METADATA_KEY,
  type SkillGuardData,
  type SkillMap,
  type SkillRouting,
} from '../../../src/injection-engine.js';
import type { InjectionContext } from '../../../src/injection-engine.js';
import {
  defineSkillMap as doorDefineSkillMap,
  skillGraph as doorSkillGraph,
} from '../../../src/doors/skill-graph.js';
import { mock } from '../../../src/llm-providers.js';

const skill = (id: string) => defineSkill({ id, description: `use ${id}`, body: `${id} body` });

const ctxWith = (
  results: ReadonlyArray<{
    toolName: string;
    result: string;
    toolCallId?: string;
    status?: string;
  }>,
  currentSkillId = 'a',
  iteration = 2,
): InjectionContext =>
  ({
    iteration,
    userMessage: 'go',
    history: [],
    activatedInjectionIds: [],
    currentSkillId,
    toolResults: results,
  } as InjectionContext);

// ─────────────────────────────────────────────────────────────────────────────
// Unit — declaration: refusals, edge data, kinds, mermaid
// ─────────────────────────────────────────────────────────────────────────────

describe('guard declaration on a route edge', () => {
  it('refuses when + guard on one edge, naming both (code or data, never both)', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() =>
      skillGraph()
        .entry(a)
        .route(a, b, { when: () => true, guard: { riskLevel: { gte: 'high' } } })
        .build(),
    ).toThrowError(/sets both 'when' and 'guard'/);
  });

  it('a malformed guard is refused at the route that declared it', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() => skillGraph().entry(a).route(a, b, { guard: {} }).build()).toThrowError(
      /route a→b.*guard/s,
    );
  });

  it('a guard-only edge is kind "guard" and carries its data (a deterministic edge, not a model one)', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { guard: { riskLevel: { gte: 'high' } } })
      .build();
    const edge = g.edges.find((e) => e.from === 'a' && e.to === 'b')!;
    expect(edge.kind).toBe('guard');
    expect(edge.guard).toEqual({
      conditions: [{ key: 'riskLevel', op: 'gte', value: 'high' }],
    });
    // Deterministic: the target is reachable in the check-up's BFS, so no
    // model-edge-only / unreachable-skill warning names it.
    expect(g.checkup().problems.filter((p) => p.skill === 'b' || p.to === 'b')).toEqual([]);
  });

  it('a guard composed with onToolReturn/onToolStatus keeps that kind, folds the caption, rides as data', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'probe', guard: { score: { gte: 0.8 } } })
      .route(a, c, { onToolStatus: 'denied', guard: { iteration: { lte: 3 } } })
      .build();
    const toB = g.edges.find((e) => e.to === 'b')!;
    const toC = g.edges.find((e) => e.to === 'c')!;
    expect(toB.kind).toBe('on-tool-return');
    expect(toB.label).toBe('on probe when score ≥ 0.8');
    expect(toB.guard).toEqual({ conditions: [{ key: 'score', op: 'gte', value: 0.8 }] });
    expect(toC.kind).toBe('on-tool-status');
    expect(toC.label).toBe('on status=denied when iteration ≤ 3');
  });

  it('toMermaid captions a guard-only edge in plain words', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { guard: { riskLevel: { gte: 'high' } } })
      .build();
    expect(g.toMermaid()).toContain('n_a -->|when riskLevel ≥ high| n_b');
  });

  it('an explicit label wins unchanged; the guard data still rides the edge', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { guard: { riskLevel: { gte: 'high' } }, label: 'escalate' })
      .build();
    const edge = g.edges.find((e) => e.to === 'b')!;
    expect(edge.label).toBe('escalate');
    expect(edge.guard).toBeDefined();
    expect(g.toMermaid()).toContain('|escalate|');
  });

  it('the route provenance on the compiled skill carries the guard (the `match` twin)', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { guard: { riskLevel: { gte: 'high' } } })
      .build();
    const compiled = g.skills.find((s) => s.id === 'b')!;
    const routing = (compiled.metadata as Record<string, unknown>)[
      SKILL_GRAPH_METADATA_KEY
    ] as SkillRouting;
    expect(routing.via).toBe('route');
    expect(routing.guard).toEqual({
      conditions: [{ key: 'riskLevel', op: 'gte', value: 'high' }],
    });
  });

  it('the object-literal form takes guard on steps and compiles identically', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph({
      skills: [a, b],
      start: 'a',
      steps: [{ from: 'a', to: 'b', guard: { riskLevel: { gte: 'high' } } }],
    });
    const edge = g.edges.find((e) => e.to === 'b')!;
    expect(edge.kind).toBe('guard');
    expect(edge.guard).toEqual({
      conditions: [{ key: 'riskLevel', op: 'gte', value: 'high' }],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit — the check-up proves contradictions (guard-unsatisfiable, ERROR)
// ─────────────────────────────────────────────────────────────────────────────

describe('checkup: guard-unsatisfiable', () => {
  it('a self-contradictory guard is an ERROR naming the edge and the contradiction — and build() refuses', () => {
    const a = skill('a');
    const b = skill('b');
    const declare = () =>
      skillGraph()
        .entry(a)
        .route(a, b, { guard: { score: { gt: 5, lt: 3 } } });
    expect(() => declare().build()).toThrowError(/guard-unsatisfiable/);
    const report = declare().build({ check: 'off' }).checkup();
    expect(report.ok).toBe(false);
    const problem = report.problems.find((p) => p.code === 'guard-unsatisfiable')!;
    expect(problem.kind).toBe('error');
    expect(problem.from).toBe('a');
    expect(problem.to).toBe('b');
    expect(problem.message).toMatch(/score > 5 AND score < 3/);
  });

  it("a guard contradicting the edge's own onToolStatus is caught (two declarations, one must be wrong)", () => {
    const a = skill('a');
    const b = skill('b');
    const report = skillGraph()
      .entry(a)
      .route(a, b, { onToolStatus: 'success', guard: { status: { eq: 'denied' } } })
      .build({ check: 'off' })
      .checkup();
    expect(report.problems.some((p) => p.code === 'guard-unsatisfiable')).toBe(true);
  });

  it('a status typo (outside the closed vocabulary) is caught', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() =>
      skillGraph()
        .entry(a)
        .route(a, b, { guard: { status: { eq: 'sucess' } } })
        .build(),
    ).toThrowError(/not a result status/);
  });

  it('a satisfiable guard passes the check-up clean', () => {
    const a = skill('a');
    const b = skill('b');
    const report = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'probe', guard: { riskLevel: { gte: 'high' } } })
      .build()
      .checkup();
    expect(report.problems.filter((p) => p.code === 'guard-unsatisfiable')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Functional — the resolver: taken hops carry evidence, refusals are guardsClosed
// ─────────────────────────────────────────────────────────────────────────────

const guardedGraph = () => {
  const a = skill('a');
  const b = skill('b');
  return skillGraph()
    .entry(a)
    .route(a, b, { onToolReturn: 'probe', guard: { riskLevel: { gte: 'high' } } })
    .build();
};

describe('resolver: guard evidence on the move', () => {
  it('a passing guard fires the edge — by "route", with the full evaluation (verdict true)', () => {
    const g = guardedGraph();
    const move = g.explainNextSkill(
      ctxWith([{ toolName: 'probe', result: '{"riskLevel":"high"}', toolCallId: 't1' }]),
    );
    expect(move).toMatchObject({ from: 'a', to: 'b', by: 'route' });
    expect(move.guard).toEqual({
      from: 'a',
      to: 'b',
      toolName: 'probe',
      toolCallId: 't1',
      verdict: true,
      conditions: [
        { key: 'riskLevel', op: 'gte', value: 'high', actualSummary: 'high', passed: true },
      ],
    });
    expect(move.guardsClosed).toBeUndefined();
  });

  it('a refusing guard closes the hop — sticky stay, with guardsClosed naming conditions and values', () => {
    const g = guardedGraph();
    const move = g.explainNextSkill(
      ctxWith([{ toolName: 'probe', result: '{"riskLevel":"amber"}', toolCallId: 't1' }]),
    );
    expect(move).toMatchObject({ from: 'a', to: 'a', by: 'stay' });
    expect(move.guard).toBeUndefined();
    expect(move.guardsClosed).toEqual([
      {
        from: 'a',
        to: 'b',
        toolName: 'probe',
        toolCallId: 't1',
        verdict: false,
        conditions: [
          { key: 'riskLevel', op: 'gte', value: 'high', actualSummary: 'amber', passed: false },
        ],
      },
    ]);
  });

  it('an edge whose preconditions never matched leaves NO record — its guard never decided', () => {
    const g = guardedGraph();
    const move = g.explainNextSkill(
      ctxWith([{ toolName: 'other_tool', result: '{"riskLevel":"low"}' }]),
    );
    expect(move.by).toBe('stay');
    expect(move.guardsClosed).toBeUndefined();
  });

  it('one refusal per edge across a batch (first in call order), and the refusals ride a winning move too', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { guard: { riskLevel: { gte: 'high' } } })
      .route(a, c, { onToolReturn: 'always_route' })
      .build();
    const move = g.explainNextSkill(
      ctxWith([
        { toolName: 'p1', result: '{"riskLevel":"amber"}', toolCallId: 't1' },
        { toolName: 'always_route', result: 'ok', toolCallId: 't2' },
        { toolName: 'p3', result: '{"riskLevel":"amber"}', toolCallId: 't3' },
      ]),
    );
    // t2 routed to c; the guard on a→b refused t1 (and only t1 is recorded).
    expect(move).toMatchObject({ to: 'c', by: 'route' });
    expect(move.guardsClosed).toHaveLength(1);
    expect(move.guardsClosed![0]).toMatchObject({ to: 'b', toolCallId: 't1', verdict: false });
  });

  it('the guard gates the compiled trigger too — the target activates only when the guard passes', () => {
    const g = guardedGraph();
    // 'severe' ≥ 'high' lexicographically; 'amber' sorts below 'high' and stays.
    const hot = ctxWith([{ toolName: 'probe', result: '{"riskLevel":"severe"}' }]);
    const cold = ctxWith([{ toolName: 'probe', result: '{"riskLevel":"amber"}' }]);
    expect(g.nextSkill(hot)).toBe('b');
    expect(g.nextSkill(cold)).toBe('a');
  });

  it('D1 still wins over a same-turn model pick when the guard passes', () => {
    const g = guardedGraph();
    const move = g.explainNextSkill({
      ...ctxWith([{ toolName: 'probe', result: '{"riskLevel":"high"}' }]),
      pendingSkillPick: 'a',
    } as InjectionContext);
    expect(move.by).toBe('route');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit — the SkillMap vocabulary: permanent aliases, both doors
// ─────────────────────────────────────────────────────────────────────────────

describe('defineSkillMap / SkillMap — the official names, as permanent aliases', () => {
  it('defineSkillMap IS skillGraph (reference-equal — an alias, never a fork)', () => {
    expect(defineSkillMap).toBe(skillGraph);
  });

  it('the skill-graph door exports the same references', () => {
    expect(doorDefineSkillMap).toBe(skillGraph);
    expect(doorSkillGraph).toBe(skillGraph);
  });

  it('a SkillMap built by defineSkillMap routes exactly like a skillGraph one', () => {
    const a = skill('a');
    const b = skill('b');
    const map: SkillMap = defineSkillMap()
      .entry(a)
      .route(a, b, { guard: { riskLevel: { gte: 'high' } } })
      .build();
    expect(map.nextSkill(ctxWith([{ toolName: 'x', result: '{"riskLevel":"high"}' }]))).toBe('b');
    const data: SkillGuardData | undefined = map.edges.find((e) => e.to === 'b')?.guard;
    expect(data).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration — the real Agent loop: evidence on the record, map on the record
// ─────────────────────────────────────────────────────────────────────────────

const probeTool = (payload: string) =>
  defineTool({
    name: 'probe',
    description: 'probe tool',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => payload,
  });

const callProbeThenStop = () => {
  let i = 0;
  return mock({
    respond: () => {
      i++;
      return i === 1
        ? {
            content: 'probing',
            toolCalls: [{ id: 't1', name: 'probe', args: {} }],
            stopReason: 'tool_use' as const,
          }
        : { content: 'done', toolCalls: [], stopReason: 'stop' as const };
    },
  });
};

type MoveRecord = {
  to?: string;
  by?: string;
  guard?: { verdict: boolean; conditions: Array<Record<string, unknown>> };
  guardsClosed?: Array<{ to: string; verdict: boolean }>;
};

const runGuardedAgent = async (toolPayload: string) => {
  const moves: MoveRecord[] = [];
  let declared: Record<string, unknown> | undefined;
  const agent = Agent.create({ provider: callProbeThenStop(), model: 'mock', maxIterations: 4 })
    .system('')
    .tool(probeTool(toolPayload))
    .skillGraph(guardedGraph())
    .build();
  agent.on('agentfootprint.context.evaluated', (e) => {
    const m = (e.payload as { cursorMove?: MoveRecord }).cursorMove;
    if (m !== undefined) moves.push(m);
  });
  agent.on('agentfootprint.skill.graph_declared', (e) => {
    declared = e.payload as unknown as Record<string, unknown>;
  });
  await agent.run({ message: 'go' });
  return { moves, declared };
};

describe('integration: guard evidence and the declared map, through a real run', () => {
  it('a taken guarded hop puts the condition evaluation on context.evaluated.cursorMove.guard', async () => {
    const { moves, declared } = await runGuardedAgent('{"riskLevel":"high"}');
    const routed = moves.find((m) => m.by === 'route');
    expect(routed).toBeDefined();
    expect(routed!.to).toBe('b');
    expect(routed!.guard).toMatchObject({
      verdict: true,
      conditions: [
        { key: 'riskLevel', op: 'gte', value: 'high', actualSummary: 'high', passed: true },
      ],
    });

    // …and the recording's SkillMap shows its guard conditions.
    const edges = (declared as { edges: Array<Record<string, unknown>> }).edges;
    const guarded = edges.find((e) => e.to === 'b')!;
    expect(guarded.kind).toBe('on-tool-return');
    expect(guarded.guard).toEqual({
      conditions: [{ key: 'riskLevel', op: 'gte', value: 'high' }],
    });
  });

  it('a refused guarded hop puts the refusal on cursorMove.guardsClosed — and the cursor stays', async () => {
    const { moves } = await runGuardedAgent('{"riskLevel":"amber"}');
    const withClosed = moves.find((m) => m.guardsClosed !== undefined);
    expect(withClosed).toBeDefined();
    expect(withClosed!.by).toBe('stay');
    expect(withClosed!.guardsClosed).toEqual([
      expect.objectContaining({ to: 'b', verdict: false }),
    ]);
    expect(moves.some((m) => m.to === 'b')).toBe(false);
  });

  it('an unguarded agent run is byte-identical: no guard, no guardsClosed keys anywhere', async () => {
    const moves: MoveRecord[] = [];
    const a = skill('a');
    const b = skill('b');
    const agent = Agent.create({ provider: callProbeThenStop(), model: 'mock', maxIterations: 4 })
      .system('')
      .tool(probeTool('plain result'))
      .skillGraph(skillGraph().entry(a).route(a, b, { onToolReturn: 'probe' }).build())
      .build();
    agent.on('agentfootprint.context.evaluated', (e) => {
      const m = (e.payload as { cursorMove?: MoveRecord }).cursorMove;
      if (m !== undefined) moves.push(m);
    });
    await agent.run({ message: 'go' });
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect('guard' in m).toBe(false);
      expect('guardsClosed' in m).toBe(false);
    }
  });
});
