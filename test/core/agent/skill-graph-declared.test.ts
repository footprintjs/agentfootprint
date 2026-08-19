/**
 * The declared skill map on the record (9.50.0) —
 * `agentfootprint.skill.graph_declared`: ONE event per run, right after the
 * run manifest, carrying the AUTHOR'S nodes and edges as DATA.
 *
 * The failure this closes was measured in the field: a debugger drawing the
 * graph from a recording could only reconstruct edges from per-hop `routing[]`
 * provenance — which names an edge once it FIRES — so every topology view had
 * to caption itself "partial" or make the consumer pass the built graph in by
 * hand. The declared map is a build-time fact; a recording should carry it.
 *
 * Sections follow Convention 3:
 *   • Functional  — the pure projection (`buildSkillGraphDeclared`): verbatim
 *                   nodes/edges, descriptions joined from the compiled skills,
 *                   and the refusals to guess;
 *   • Integration — the real Agent loop: once per run, fresh per resume-style
 *                   second run, joined by runId, on the recording;
 *   • Zero-delta  — no graph ⇒ no event; a map-less structural graph ⇒ no
 *                   event; an unwatched agent pays one map lookup.
 */

import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { skillGraph, defineSkill } from '../../../src/injection-engine.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { buildSkillGraphDeclared } from '../../../src/core/agent/skillGraphDeclared.js';
import type { AgentfootprintEventMap } from '../../../src/events/registry.js';
import type { Injection } from '../../../src/lib/injection-engine/types.js';

type DeclaredEvent = AgentfootprintEventMap['agentfootprint.skill.graph_declared'];

const skill = (id: string, description?: string) =>
  defineSkill({ id, ...(description !== undefined && { description }), body: `${id} body` });

const twoSkillGraph = () => {
  const a = defineSkill({ id: 'triage', description: 'first look at the request', body: 'a' });
  const b = defineSkill({ id: 'billing', description: 'refunds and charges', body: 'b' });
  return skillGraph()
    .entry(a)
    .route(a, b, { onToolReturn: 'probe', label: 'probe says billing' })
    .build();
};

const watchDeclared = (agent: Agent) => {
  const events: DeclaredEvent[] = [];
  agent.on('agentfootprint.skill.graph_declared', (e) => events.push(e));
  return events;
};

// ─── 1. FUNCTIONAL — the pure projection ─────────────────────────────

describe('buildSkillGraphDeclared — the projection', () => {
  it('projects the built graph verbatim: skill boxes, entry edge from null, route edge with kind + label', () => {
    const graph = twoSkillGraph();
    const map = buildSkillGraphDeclared(graph, graph.skills)!;
    expect(map).toBeDefined();

    const ids = map.nodes.map((n) => n.id);
    expect(ids).toContain('triage');
    expect(ids).toContain('billing');
    // Descriptions are the catalog text, verbatim — the words the model reads.
    expect(map.nodes.find((n) => n.id === 'billing')?.description).toBe('refunds and charges');

    const entry = map.edges.find((e) => e.from === null);
    expect(entry).toMatchObject({ from: null, to: 'triage', kind: 'entry' });
    const route = map.edges.find((e) => e.from === 'triage');
    expect(route).toMatchObject({
      from: 'triage',
      to: 'billing',
      kind: 'on-tool-return',
      label: 'probe says billing',
    });
  });

  it('a node with no catalog description carries NO description key — absent, never "(no description)"', () => {
    // `defineSkill` requires a description, so absence only arises for nodes
    // no skill describes (predicate diamonds, hand-built injections). The
    // projection must keep that absence rather than print a placeholder.
    const map = buildSkillGraphDeclared({ nodes: [{ id: 'bare', kind: 'skill' }] }, [])!;
    const node = map.nodes.find((n) => n.id === 'bare')!;
    expect('description' in node).toBe(false);
  });

  it('answers undefined for a graph that cannot state its map (no nodes) — never invented from skills', () => {
    const skills: Injection[] = [skill('x', 'desc')];
    expect(buildSkillGraphDeclared({}, skills)).toBeUndefined();
    expect(buildSkillGraphDeclared({ edges: [{ to: 'x' }] }, skills)).toBeUndefined();
  });

  it("skips an edge that does not state its own from/kind — 'from: null' is a claim, not a default", () => {
    const map = buildSkillGraphDeclared(
      {
        nodes: [{ id: 'x', kind: 'skill' }],
        edges: [
          { to: 'x' }, // the pre-9.50.0 structural shape: routable, not declarable
          { to: 'x', from: null, kind: 'entry' },
        ],
      },
      [],
    )!;
    expect(map.edges).toEqual([{ from: null, to: 'x', kind: 'entry' }]);
  });

  it('a decision tree projects predicate diamonds with their captions', () => {
    // A tree's nodes carry kind 'predicate' + label — the projection must keep
    // both so a consumer can draw the diamond the author drew.
    const map = buildSkillGraphDeclared(
      {
        nodes: [
          { id: 'd1', kind: 'predicate', label: 'io intent?' },
          { id: 'writer', kind: 'skill' },
        ],
        edges: [{ from: 'd1', to: 'writer', kind: 'predicate', label: 'yes' }],
      },
      [skill('writer', 'writes things')],
    )!;
    expect(map.nodes).toContainEqual({ id: 'd1', kind: 'predicate', label: 'io intent?' });
    expect(map.nodes).toContainEqual({ id: 'writer', kind: 'skill', description: 'writes things' });
    expect(map.edges).toEqual([{ from: 'd1', to: 'writer', kind: 'predicate', label: 'yes' }]);
  });
});

// ─── 2. INTEGRATION — the real Agent loop ────────────────────────────

describe('skill.graph_declared — through the real Agent', () => {
  const build = () =>
    Agent.create({ provider: mock({ reply: 'done' }), model: 'mock', maxIterations: 3 })
      .system('You are support.')
      .skillGraph(twoSkillGraph())
      .build();

  it('fires exactly ONCE per run, with the declared map and the stated pseudo-stage', async () => {
    const agent = build();
    const declared = watchDeclared(agent);
    await agent.run({ message: 'hello' });

    expect(declared).toHaveLength(1);
    const e = declared[0]!;
    expect(e.type).toBe('agentfootprint.skill.graph_declared');
    expect(e.meta.runtimeStageId).toBe('graph-declared#0');
    expect(e.payload.nodes.map((n) => n.id).sort()).toEqual(['billing', 'triage']);
    expect(e.payload.edges).toContainEqual({
      from: 'triage',
      to: 'billing',
      kind: 'on-tool-return',
      label: 'probe says billing',
    });
    expect(e.payload.edges).toContainEqual({ from: null, to: 'triage', kind: 'entry' });
  });

  it('is stamped with the SAME runId every other event of the run carries — the join key', async () => {
    const agent = build();
    const declared = watchDeclared(agent);
    const runIds: string[] = [];
    agent.on('agentfootprint.agent.turn_end', (e) => runIds.push(e.meta.runId));
    await agent.run({ message: 'hello' });
    expect(declared[0]!.meta.runId).toBe(runIds[0]);
  });

  it('every run files its own copy — two runs, two events, two runIds', async () => {
    const agent = build();
    const declared = watchDeclared(agent);
    await agent.run({ message: 'one' });
    await agent.run({ message: 'two' });
    expect(declared).toHaveLength(2);
    expect(declared[0]!.meta.runId).not.toBe(declared[1]!.meta.runId);
    // The map itself is the same authored fact both times.
    expect(declared[0]!.payload).toEqual(declared[1]!.payload);
  });

  it('lands in a recordRun recording (the * subscription), before any stage event needs it', async () => {
    const agent = build();
    const rec = recordRun(agent);
    await agent.run({ message: 'hello' });
    const recording = rec.toRecording();
    rec.stop();
    const rows = recording.events.filter((e) => e.type === 'agentfootprint.skill.graph_declared');
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload as DeclaredEvent['payload'];
    expect(payload.nodes.length).toBeGreaterThan(0);
    // …and the manifest is still the FIRST event of the run (its stated law);
    // the declared map follows it.
    const types = recording.events.map((e) => e.type);
    expect(types.indexOf('agentfootprint.agent.run_configured')).toBeLessThan(
      types.indexOf('agentfootprint.skill.graph_declared'),
    );
  });
});

// ─── 3. ZERO-DELTA — absence stays absent ────────────────────────────

describe('skill.graph_declared — zero-delta', () => {
  it('an agent WITHOUT a graph files nothing', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('plain')
      .build();
    const declared = watchDeclared(agent);
    await agent.run({ message: 'hello' });
    expect(declared).toHaveLength(0);
  });

  it('a structurally-typed graph that cannot state its map files nothing — absent, never guessed', async () => {
    const a = skill('solo', 'the only skill');
    // A minimal structural graph: routable (nextSkill) but map-less (no nodes).
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .system('s')
      .skillGraph({ skills: [a], nextSkill: () => 'solo' })
      .build();
    const declared = watchDeclared(agent);
    await agent.run({ message: 'hello' });
    expect(declared).toHaveLength(0);
  });
});
