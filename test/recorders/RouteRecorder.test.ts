/**
 * routeRecorder — records the skill-graph route a run took, by composing the
 * shipped `context.evaluated` + `skill.rejected` events. Unit tests feed synthetic
 * events for precise path/governor coverage; one integration test confirms wiring.
 */

import { describe, it, expect } from 'vitest';
import { routeRecorder, formatRouteHop } from '../../src/observe.js';
import { defineTool, Agent } from '../../src/index.js'
import { skillGraph, defineSkill } from '../../src/injection-engine.js'
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

  it('resets on a new runId (Convention 4)', () => {
    const r = routeRecorder();
    r.onRunStart(runStart('run-1'));
    r.onEmit(ctxEval('s#1', 1, [{ injectionId: 'a', via: 'entry' }]));
    expect(r.getPath()).toEqual(['a']);
    r.onRunStart(runStart('run-2'));
    expect(r.getPath()).toEqual([]); // fresh run
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
      .recorder(routes)
      .build();
    await agent.run({ message: 'go' });

    expect(routes.getPath()).toContain('b'); // the agent routed a → b on the probe result
    expect(routes.getHops().some((h) => h.outcome === 'route' && h.toSkill === 'b')).toBe(true);
  });
});
