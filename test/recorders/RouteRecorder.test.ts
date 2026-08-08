/**
 * routeRecorder — records the skill-graph route a run took, by composing the
 * shipped `context.evaluated` + `skill.rejected` events. Unit tests feed synthetic
 * events for precise path/governor coverage; one integration test confirms wiring.
 */

import { describe, it, expect } from 'vitest';
import { routeRecorder, formatRouteHop } from '../../src/observe.js';
import { defineTool, Agent } from '../../src/index.js';
import { skillGraph, defineSkill } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';

// ── synthetic event helpers ────────────────────────────────────────────────
type Routing = { injectionId: string; via: string; from?: string; label?: string };
const ctxEval = (rt: string, iteration: number, routing: Routing[]) =>
  ({
    name: 'agentfootprint.context.evaluated',
    runtimeStageId: rt,
    payload: { iteration, routing },
  } as never);
const rejected = (
  rt: string,
  iteration: number,
  requestedId: string,
  currentSkillId: string,
  allowed: string[],
) =>
  ({
    name: 'agentfootprint.skill.rejected',
    runtimeStageId: rt,
    payload: { iteration, requestedId, currentSkillId, allowed },
  } as never);
/** `context.evaluated` carrying the graph's own account of the hop (8.5.0). */
const ctxEvalWhy = (
  rt: string,
  iteration: number,
  routing: Routing[],
  cursorMove: { from?: string; to?: string; by: string },
) =>
  ({
    name: 'agentfootprint.context.evaluated',
    runtimeStageId: rt,
    payload: { iteration, routing, cursorMove },
  } as never);
const toolStart = (rt: string, toolName: string) =>
  ({
    name: 'agentfootprint.stream.tool_start',
    runtimeStageId: rt,
    payload: { toolName },
  } as never);
const runStart = (runId: string) => ({ traversalContext: { runId } } as never);

describe('routeRecorder — path + hop derivation', () => {
  it('derives the route path: entry → stay → transition', () => {
    const r = routeRecorder();
    r.onRunStart(runStart('run-1'));
    r.onEmit(ctxEval('s0#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    r.onEmit(ctxEval('s1#2', 2, [{ injectionId: 'a', via: 'entry' }])); // cursor unchanged → stay
    r.onEmit(toolStart('t#2', 'get_wwn'));
    r.onEmit(ctxEval('s2#3', 3, [{ injectionId: 'b', via: 'route', from: 'a', label: 'has WWN' }]));

    expect(r.getPath()).toEqual(['a', 'b']);
    const hops = r.getHops();
    expect(hops.map((h) => h.outcome)).toEqual(['entry', 'stay', 'route']);
    expect(hops[0]!.why).toBe('entered "a"');
    expect(hops[1]!.why).toBe('stayed in "a"');
    expect(hops[2]!.why).toBe('"a" → "b" (has WWN) on get_wwn'); // edge label + driving tool
    expect(hops[2]!.fromSkill).toBe('a');
  });

  it('prefers a transitioned-into route over a co-active entry base', () => {
    const r = routeRecorder();
    // both an always-base entry AND a routed skill active this iteration → cursor is the route
    r.onEmit(
      ctxEval('s#1', 1, [
        { injectionId: 'base', via: 'entry' },
        { injectionId: 'b', via: 'route', from: 'base' },
      ]),
    );
    expect(r.getPath()).toEqual(['b']);
  });
});

describe('routeRecorder — rejections', () => {
  it('records an out-of-reach read_skill as a rejection hop', () => {
    const r = routeRecorder();
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    r.onEmit(rejected('s#1', 1, 'x', 'a', ['b', 'c']));
    const rej = r.getRejections();
    expect(rej).toHaveLength(1);
    expect(rej[0]!.requestedSkill).toBe('x');
    expect(rej[0]!.reachable).toEqual(['b', 'c']);
    expect(formatRouteHop(rej[0]!)).toContain('rejected');
    expect(formatRouteHop(rej[0]!)).toContain('b, c');
  });
});

describe('routeRecorder — governors', () => {
  it('trips on oscillation (A→B→A→B)', () => {
    const r = routeRecorder({ pingPongWindow: 4 });
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    r.onEmit(ctxEval('s#2', 2, [{ injectionId: 'b', via: 'route', from: 'a' }]));
    r.onEmit(ctxEval('s#3', 3, [{ injectionId: 'a', via: 'route', from: 'b' }]));
    r.onEmit(ctxEval('s#4', 4, [{ injectionId: 'b', via: 'route', from: 'a' }]));
    const trips = r.getTrips();
    expect(trips.some((t) => t.kind === 'ping-pong')).toBe(true);
    expect([...trips.find((t) => t.kind === 'ping-pong')!.skills].sort()).toEqual(['a', 'b']);
  });

  it('trips on a run of consecutive rejected jumps (rejected-cap)', () => {
    const r = routeRecorder({ maxRejectedRetries: 3 });
    for (let i = 1; i <= 3; i++) r.onEmit(rejected(`s#${i}`, i, 'x', 'a', ['b']));
    expect(r.getTrips().some((t) => t.kind === 'rejected-cap')).toBe(true);
  });

  it('a successful evaluation breaks the rejection run', () => {
    const r = routeRecorder({ maxRejectedRetries: 3 });
    r.onEmit(rejected('s#1', 1, 'x', 'a', ['b']));
    r.onEmit(rejected('s#2', 2, 'x', 'a', ['b']));
    r.onEmit(ctxEval('s#3', 3, [{ injectionId: 'a', via: 'entry' }])); // resets the streak
    r.onEmit(rejected('s#4', 4, 'x', 'a', ['b']));
    expect(r.getTrips().some((t) => t.kind === 'rejected-cap')).toBe(false); // never hit 3 in a row
  });

  // ── #9: the cap could never trip in a real run ───────────────────────────
  //
  // A rejection is followed by an evaluation on the NEXT iteration, always — so
  // resetting the counter on every evaluation meant it never passed 1, and
  // `maxRejectedRetries` was unreachable outside a parallel tool batch. The reset
  // now needs a real cursor MOVE, and a model stuck re-asking produces 'stay'.
  it('trips across iterations when the cursor never moves (the real loop shape)', () => {
    const r = routeRecorder({ maxRejectedRetries: 3 });
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }])); // enter a
    for (let i = 1; i <= 3; i++) {
      r.onEmit(rejected(`r#${i}`, i, 'x', 'a', ['b']));
      r.onEmit(ctxEval(`s#${i + 1}`, i + 1, [{ injectionId: 'a', via: 'entry' }])); // stay on a
    }
    const trip = r.getTrips().find((t) => t.kind === 'rejected-cap');
    expect(trip).toBeDefined();
    expect(trip!.detail).toContain('3 consecutive');
  });

  it('a real cursor MOVE still breaks the run', () => {
    const r = routeRecorder({ maxRejectedRetries: 3 });
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    r.onEmit(rejected('r#1', 1, 'x', 'a', ['b']));
    r.onEmit(rejected('r#2', 2, 'x', 'a', ['b']));
    r.onEmit(ctxEval('s#2', 3, [{ injectionId: 'b', via: 'route', from: 'a' }])); // moved
    r.onEmit(rejected('r#3', 3, 'x', 'b', ['c']));
    expect(r.getTrips().some((t) => t.kind === 'rejected-cap')).toBe(false);
  });

  it('trips ONCE per run of rejections, not once per iteration past the cap', () => {
    const r = routeRecorder({ maxRejectedRetries: 2 });
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    for (let i = 1; i <= 5; i++) {
      r.onEmit(rejected(`r#${i}`, i, 'x', 'a', ['b']));
      r.onEmit(ctxEval(`s#${i + 1}`, i + 1, [{ injectionId: 'a', via: 'entry' }]));
    }
    expect(r.getTrips().filter((t) => t.kind === 'rejected-cap')).toHaveLength(1);
  });

  it('re-arms after the cursor moves, so a SECOND run of rejections trips again', () => {
    const r = routeRecorder({ maxRejectedRetries: 2 });
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    r.onEmit(rejected('r#1', 1, 'x', 'a', ['b']));
    r.onEmit(ctxEval('s#2', 2, [{ injectionId: 'a', via: 'entry' }]));
    r.onEmit(rejected('r#2', 2, 'x', 'a', ['b'])); // trip 1
    r.onEmit(ctxEval('s#3', 3, [{ injectionId: 'b', via: 'route', from: 'a' }])); // move → re-arm
    r.onEmit(rejected('r#3', 3, 'y', 'b', ['c']));
    r.onEmit(ctxEval('s#4', 4, [{ injectionId: 'b', via: 'route', from: 'a' }])); // stay on b
    r.onEmit(rejected('r#4', 4, 'y', 'b', ['c'])); // trip 2
    expect(r.getTrips().filter((t) => t.kind === 'rejected-cap')).toHaveLength(2);
  });

  it('resets on a new runId (Convention 4)', () => {
    const r = routeRecorder();
    r.onRunStart(runStart('run-1'));
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    expect(r.getPath()).toEqual(['a']);
    r.onRunStart(runStart('run-2'));
    expect(r.getPath()).toEqual([]); // fresh run
  });
});

// ── #8: a model pick used to be recorded as a declared edge ────────────────
//
// The cursor's destination was known; its CAUSE was inferred from the drawn
// build-time provenance (`routing[]`), which answers "how is this skill reachable
// at all". So a `read_skill` pick into a skill that also has a declared edge was
// recorded as a `'route'` wearing that edge's label — the trace asserted an edge
// fired when it had not. The graph now reports the winning clause itself.
describe('routeRecorder — model-pick attribution', () => {
  it("records a pick as 'model-pick' and refuses to borrow the edge's caption", () => {
    const r = routeRecorder();
    r.onEmit(ctxEvalWhy('s#1', 1, [{ injectionId: 'a', via: 'entry' }], { to: 'a', by: 'entry' }));
    r.onEmit(toolStart('s#2', 'read_skill'));
    r.onEmit(
      ctxEvalWhy(
        's#2',
        2,
        // The DRAWN provenance still says "b is reachable via a declared a→b edge",
        // and it is — that edge just did not fire this turn.
        [{ injectionId: 'b', via: 'route', from: 'a', label: 'declared A→B' }],
        { from: 'a', to: 'b', by: 'model-pick' },
      ),
    );
    const hop = r.getHops()[1]!;
    expect(hop.outcome).toBe('model-pick');
    expect(hop.edgeLabel).toBeUndefined();
    expect(hop.why).toBe('read_skill("b") accepted from "a"');
  });

  it("a declared edge that really fired is still a 'route', label and all", () => {
    const r = routeRecorder();
    r.onEmit(ctxEvalWhy('s#1', 1, [{ injectionId: 'a', via: 'entry' }], { to: 'a', by: 'entry' }));
    r.onEmit(toolStart('s#2', 'probe'));
    r.onEmit(
      ctxEvalWhy('s#2', 2, [{ injectionId: 'b', via: 'route', from: 'a', label: 'declared A→B' }], {
        from: 'a',
        to: 'b',
        by: 'route',
      }),
    );
    const hop = r.getHops()[1]!;
    expect(hop.outcome).toBe('route');
    expect(hop.edgeLabel).toBe('declared A→B');
    expect(hop.lastTool).toBe('probe');
  });

  it('an edge and a pick naming the SAME skill resolve to route (D1 > D2)', () => {
    // The one case no outside observer can reconstruct — only the resolver knows
    // which clause it returned from, which is why it reports rather than is guessed.
    const r = routeRecorder();
    r.onEmit(ctxEvalWhy('s#1', 1, [{ injectionId: 'a', via: 'entry' }], { to: 'a', by: 'entry' }));
    r.onEmit(
      ctxEvalWhy('s#2', 2, [{ injectionId: 'b', via: 'route', from: 'a', label: 'L' }], {
        from: 'a',
        to: 'b',
        by: 'route',
      }),
    );
    expect(r.getHops()[1]!.outcome).toBe('route');
  });

  it('a cold-start pick reads as a pick, not as an entry', () => {
    const r = routeRecorder();
    r.onEmit(
      ctxEvalWhy('s#1', 1, [{ injectionId: 'a', via: 'entry' }], { to: 'a', by: 'model-pick' }),
    );
    const hop = r.getHops()[0]!;
    expect(hop.outcome).toBe('model-pick');
    expect(hop.why).toBe('read_skill("a") accepted at cold start');
  });

  it('a model-pick hop counts as a transition for oscillation detection', () => {
    const r = routeRecorder({ pingPongWindow: 4 });
    const pick = (rt: string, it: number, from: string, to: string) =>
      ctxEvalWhy(rt, it, [{ injectionId: to, via: 'model' }], { from, to, by: 'model-pick' });
    r.onEmit(ctxEvalWhy('s#1', 1, [{ injectionId: 'a', via: 'entry' }], { to: 'a', by: 'entry' }));
    r.onEmit(pick('s#2', 2, 'a', 'b'));
    r.onEmit(pick('s#3', 3, 'b', 'a'));
    r.onEmit(pick('s#4', 4, 'a', 'b'));
    expect(r.getTrips().some((t) => t.kind === 'ping-pong')).toBe(true);
  });

  it('without cursorMove the old inference stands (older graph, older recording)', () => {
    const r = routeRecorder();
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    r.onEmit(ctxEval('s#2', 2, [{ injectionId: 'b', via: 'route', from: 'a', label: 'L' }]));
    const hop = r.getHops()[1]!;
    expect(hop.outcome).toBe('route');
    expect(hop.edgeLabel).toBe('L');
  });

  it("formatRouteHop covers 'model-pick'", () => {
    expect(
      formatRouteHop({
        runtimeStageId: 's#1',
        iteration: 2,
        fromSkill: 'a',
        toSkill: 'b',
        outcome: 'model-pick',
        why: '',
      }),
    ).toBe('read_skill("b") accepted from "a"');
  });
});

describe('routeRecorder — through the real Agent loop (wiring)', () => {
  it('records the route an agent actually took', async () => {
    const probe = defineTool({
      name: 'probe',
      description: 'probe',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    });
    const a = defineSkill({ id: 'a', description: 'start', body: 'a' });
    const b = defineSkill({ id: 'b', description: 'next', body: 'b' });
    const graph = skillGraph().entry(a).route(a, b, { onToolReturn: 'probe' }).build();

    let i = 0;
    const provider = mock({
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
    const routes = routeRecorder();
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('')
      .skillGraph(graph)
      .watch(routes)
      .build();
    await agent.run({ message: 'go' });

    expect(routes.getPath()).toContain('b'); // the agent routed a → b on the probe result
    expect(routes.getHops().some((h) => h.outcome === 'route' && h.toSkill === 'b')).toBe(true);
  });

  it('a real read_skill hop is recorded as a pick, under no edge label', async () => {
    const a = defineSkill({ id: 'a', description: 'start', body: 'a' });
    const b = defineSkill({ id: 'b', description: 'next', body: 'b' });
    // `b` carries a DECLARED edge whose predicate never fires (probe is never
    // called). Before 8.5.0 the pick below was recorded under this edge's label.
    const graph = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'probe', label: 'declared A→B' })
      .build();

    let i = 0;
    const provider = mock({
      respond: () => {
        i++;
        return i === 1
          ? {
              content: '',
              toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'b' } }],
              stopReason: 'tool_use' as const,
            }
          : { content: 'done', toolCalls: [], stopReason: 'stop' as const };
      },
    });
    const routes = routeRecorder();
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('')
      .skillGraph(graph)
      .watch(routes)
      .build();
    await agent.run({ message: 'go' });

    const hop = routes.getHops().find((h) => h.toSkill === 'b')!;
    expect(hop.outcome).toBe('model-pick');
    expect(hop.edgeLabel).toBeUndefined();
    expect(hop.why).toContain('read_skill("b") accepted');
    // The route is still recorded — only its stated cause changed.
    expect(routes.getPath()).toEqual(['a', 'b']);
  });
});
