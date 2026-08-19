/**
 * The typed reachable set on every cursor move (9.50.0) —
 * `context.evaluated.cursorMove.reachable`.
 *
 * The gate has always KNOWN this set: it rebuilds `read_skill`'s description
 * from it every iteration and writes the refusal messages from it. But it was
 * on the record only as PROSE (the menu sentence) plus one exact-but-sparse
 * typed copy (`skill.rejected.allowed`, present only when the model was
 * refused). A view that wanted "what could the run do from here" on a normal
 * iteration had to parse sentences — the exact mistake typed routing events
 * exist to remove. Now the set rides the move itself, as data.
 *
 * THE ONE INVARIANT this file pins from three sides: the recorded set is the
 * SAME set the gate acts on — declared hops from the landed cursor plus the
 * open skills — composed from the same two resolvers, so it can never drift
 * from the offer prose or the refusal verdicts.
 *
 * Sections follow Convention 3:
 *   • Integration — the set on an entry move, after a hop, with open skills,
 *                   and `[]` at a dead end (a fact, not an omission);
 *   • Consistency — a refusal's `allowed` equals the standing move's
 *                   `reachable` (two events, one set);
 *   • Zero-delta  — a graph without `reachableSkills` records no key, and
 *                   non-graph agents record no `cursorMove` at all.
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { skillGraph, defineSkill } from '../../../src/injection-engine.js';
import { defineTool } from '../../../src/index.js';
import type { LLMResponse } from '../../../src/adapters/types.js';

const skill = (id: string, description = `use ${id}`) =>
  defineSkill({ id, description, body: `${id} body` });

const probe = defineTool({
  name: 'probe',
  description: 'the probe tool',
  execute: () => 'probe result',
});

const call = (id: string, name: string, args: Record<string, unknown> = {}): LLMResponse => ({
  content: 'calling',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use',
});

const script = (...steps: LLMResponse[]) => {
  let i = 0;
  return mock({
    respond: () =>
      steps[i++] ?? ({ content: 'done', toolCalls: [], stopReason: 'stop' } as LLMResponse),
  });
};

type CursorMove = {
  from?: string;
  to?: string;
  by?: string;
  reachable?: readonly string[];
};

const watchMoves = (agent: Agent) => {
  const moves: Array<{ iteration: number; cursorMove?: CursorMove }> = [];
  const refusals: Array<{ iteration: number; requestedId: string; allowed: readonly string[] }> =
    [];
  agent.on('agentfootprint.context.evaluated', (e) => {
    const p = e.payload as { iteration: number; cursorMove?: CursorMove };
    moves.push({ iteration: p.iteration, ...(p.cursorMove && { cursorMove: p.cursorMove }) });
  });
  agent.on('agentfootprint.skill.rejected', (e) => refusals.push(e.payload));
  return { moves, refusals };
};

// a → b (on probe's return); c is wired only FROM b, so it is out of reach at a.
const chainGraph = () => {
  const a = skill('a');
  const b = skill('b');
  const c = skill('c');
  return skillGraph()
    .entry(a)
    .route(a, b, { onToolReturn: 'probe' })
    .route(b, c, { onToolReturn: 'probe' })
    .build();
};

// ─── 1. INTEGRATION — the set, as data, on the move ─────────────────

describe('cursorMove.reachable — through the real Agent', () => {
  it('the entry move carries the hops reachable from the LANDED cursor', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('s')
      .tool(probe)
      .skillGraph(chainGraph())
      .build();
    const { moves } = watchMoves(agent);
    await agent.run({ message: 'go' });

    const entry = moves[0]!.cursorMove!;
    expect(entry.by).toBe('entry');
    expect(entry.to).toBe('a');
    // From 'a' the graph declares exactly one hop: 'b'. 'c' needs 'b' first.
    expect(entry.reachable).toEqual(['b']);
  });

  it('after a hop, the set is recomputed from the NEW cursor — each move states its own frontier', async () => {
    const agent = Agent.create({ provider: script(call('t1', 'probe')), model: 'mock' })
      .system('s')
      .tool(probe)
      .skillGraph(chainGraph())
      .build();
    const { moves } = watchMoves(agent);
    await agent.run({ message: 'go' });

    // iteration 1: entry at 'a' (frontier ['b']); iteration 2: route a→b on
    // the probe return. From 'b' the gate admits the declared successor 'c'
    // AND the entry 'a' (entries stay reachable from any cursor — the gate's
    // own semantics, and the recorded set must be the GATE's set, verbatim).
    expect(moves[0]!.cursorMove).toMatchObject({ to: 'a', reachable: ['b'] });
    expect(moves[1]!.cursorMove).toMatchObject({ by: 'route', to: 'b' });
    expect([...moves[1]!.cursorMove!.reachable!].sort()).toEqual(['a', 'c']);
  });

  it('OPEN skills (registered beside the graph) are in the set — it is the gate’s set, not just the edges', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('s')
      .tool(probe)
      .skillGraph(chainGraph())
      .skill(skill('helper')) // llm-activated, no incoming edge ⇒ open
      .build();
    const { moves } = watchMoves(agent);
    await agent.run({ message: 'go' });

    expect(moves[0]!.cursorMove!.reachable).toEqual(['b', 'helper']);
  });

  it('a dead end records [] — a fact about the graph, never an omitted key', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('s')
      .skillGraph(skillGraph().entry(skill('only')).build())
      .build();
    const { moves } = watchMoves(agent);
    await agent.run({ message: 'go' });

    expect(moves[0]!.cursorMove!.reachable).toEqual([]);
  });
});

// ─── 2. CONSISTENCY — one set, two events ────────────────────────────

describe('cursorMove.reachable — never drifts from the refusal', () => {
  it("a refused pick's `allowed` IS the standing move's `reachable`", async () => {
    // The model asks for 'c' from cursor 'a' — out of reach (only 'b' is).
    const agent = Agent.create({
      provider: script(call('t1', 'read_skill', { id: 'c' })),
      model: 'mock',
      maxIterations: 3,
    })
      .system('s')
      .tool(probe)
      .skillGraph(chainGraph())
      .build();
    const { moves, refusals } = watchMoves(agent);
    await agent.run({ message: 'go' });

    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.requestedId).toBe('c');
    // The refusal fired on iteration 1, judged from the cursor the iteration-1
    // move landed on — so the two lists are ONE set on the record twice.
    expect([...refusals[0]!.allowed].sort()).toEqual([...moves[0]!.cursorMove!.reachable!].sort());
  });
});

// ─── 3. ZERO-DELTA — absence stays absent ────────────────────────────

describe('cursorMove.reachable — zero-delta', () => {
  it('a graph without `reachableSkills` records NO reachable key (the 9.49.0 bytes)', async () => {
    // Structural graph: narrates its moves (explainNextSkill) but predates the
    // reachable resolver — the field must be absent, never [].
    const solo = skill('solo');
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('s')
      .skillGraph({
        skills: [solo],
        nextSkill: () => 'solo',
        explainNextSkill: (ctx) =>
          ctx.currentSkillId === undefined
            ? { to: 'solo', by: 'entry' }
            : { from: 'solo', to: 'solo', by: 'stay' },
      })
      .build();
    const { moves } = watchMoves(agent);
    await agent.run({ message: 'go' });

    const move = moves[0]!.cursorMove!;
    expect(move.by).toBe('entry');
    expect('reachable' in move).toBe(false);
  });

  it('a non-graph agent records no cursorMove at all — unchanged', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('s')
      .build();
    const { moves } = watchMoves(agent);
    await agent.run({ message: 'go' });
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m.cursorMove).toBeUndefined();
  });
});
