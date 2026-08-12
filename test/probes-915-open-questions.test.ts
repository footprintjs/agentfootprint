/**
 * Verification probes — 9.15.0 open questions, FLIPPED at 9.16.0.
 *
 * The pre-implementation round pinned then-current behavior; the header said
 * which assertions pinned bugs and had to flip when the fixes landed. 9.16.0
 * landed them, and this file now pins the FIXED behavior:
 *
 *  L1 (FIXED in 9.16.0 — assertions flipped as instructed):
 *     `scope.toolResults` carries EVERY tool result of the iteration's batch
 *     in call order (`lastToolResult` stays its last entry, unchanged for
 *     existing readers). `on-tool-return` triggers and skill-graph routes
 *     evaluate the whole batch, so the SAME two calls now route identically
 *     whatever their batch order — both orderings of the old smoking-gun
 *     probe fire the route. Conflicting matches inside one batch emit
 *     `agentfootprint.skill.route_conflict` (covered in
 *     test/lib/injection-engine/toolBatchRouting.test.ts).
 *
 *  L2 (SETTLED — this is the designed behavior, pinned here; unchanged):
 *     an open (non-graph-wired) skill picked via read_skill NEVER ends within
 *     the turn. `activatedInjectionIds` is append-only, reset only by seed at
 *     the start of the NEXT run, and the `llm-activated` evaluator arm
 *     re-admits it every iteration. No deactivation path exists in the
 *     library (`skill.deactivated` is consumer-emitted transport only).
 *     Now documented on `defineSkill`'s docstring and the skills docs page.
 *
 *  L5 (FIXED in 9.16.0 — the pinned `.not.toThrow()` flipped to a refusal):
 *     `.skillGraph()` + `reactMode: 'classic'` is refused at BUILD time with
 *     a teaching error (AgentBuilder.skillGraph), because classic caches the
 *     system-prompt/tools slots after turn 1 while the injection engine keeps
 *     routing — the trace would report activations the wire never saw. The
 *     old runtime probe that demonstrated that split can no longer be
 *     constructed, which is the point; classic WITHOUT a graph still builds
 *     (pinned below), and the dynamic control still delivers the body.
 */

import { describe, it, expect } from 'vitest';
import { defineTool, Agent } from '../src/index.js';
import { skillGraph, defineSkill } from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';
import type { LLMRequest } from '../src/adapters/types.js';

const skill = (id: string, body = `${id} body`) =>
  defineSkill({ id, description: `use ${id}`, body });

const noopTool = (name: string) =>
  defineTool({
    name,
    description: `${name} probe tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: name }),
  });

/** Capture activeIds per `context.evaluated` emit (one per ReAct iteration). */
const captureActiveIds = () => {
  const perIteration: string[][] = [];
  const recorder = {
    id: 'capture-active',
    onEmit: (e: { name: string; payload?: { activeIds?: readonly string[] } }) => {
      if (e.name === 'agentfootprint.context.evaluated') {
        perIteration.push([...(e.payload?.activeIds ?? [])].sort());
      }
    },
  };
  return { perIteration, recorder };
};

// ─────────────────────────────────────────────────────────────────────────────
// L1 — parallel tool batch: only the LAST call's result drives routing
// ─────────────────────────────────────────────────────────────────────────────

describe('L1 probe — FLIPPED at 9.16.0: the whole batch routes, in call order', () => {
  /** Model emits BOTH tools in ONE message on turn 1, then stops. */
  const batchThenStop = (first: string, second: string) => {
    let i = 0;
    return mock({
      respond: () => {
        i++;
        return i === 1
          ? {
              content: 'batching',
              toolCalls: [
                { id: 't1', name: first, args: {} },
                { id: 't2', name: second, args: {} },
              ],
              stopReason: 'tool_use' as const,
            }
          : { content: 'done', toolCalls: [], stopReason: 'stop' as const };
      },
    });
  };

  const buildAgent = (provider: ReturnType<typeof mock>) => {
    const a = skill('a');
    const b = skill('b', 'B BODY');
    // The route keys on 'alpha' returning while the cursor sits on 'a'.
    const graph = skillGraph().entry(a).route(a, b, { onToolReturn: 'alpha' }).build();
    const { perIteration, recorder } = captureActiveIds();
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('')
      .tool(noopTool('alpha'))
      .tool(noopTool('beta'))
      .skillGraph(graph)
      .watch(recorder)
      .build();
    return { agent, perIteration };
  };

  it("batch [alpha, beta]: alpha's return routes even though beta came after it (FLIPPED — this used to pin the drop)", async () => {
    const { agent, perIteration } = buildAgent(batchThenStop('alpha', 'beta'));
    await agent.run({ message: 'go' });

    expect(perIteration.length).toBeGreaterThanOrEqual(2);
    expect(perIteration[0]).toEqual(['a']); // cold start: entry only
    // alpha ran and returned this iteration; since 9.16.0 the batch is
    // evaluated in call order, so the a→b route fires regardless of alpha's
    // position. Before the fix this asserted .not.toContain('b').
    expect(perIteration[1]).toContain('b');
  });

  it('batch [beta, alpha]: same two calls, reversed order — the route fires identically. Routing no longer depends on batch ORDER', async () => {
    const { agent, perIteration } = buildAgent(batchThenStop('beta', 'alpha'));
    await agent.run({ message: 'go' });

    expect(perIteration.length).toBeGreaterThanOrEqual(2);
    expect(perIteration[0]).toEqual(['a']);
    // Identical calls, identical results — identical routing, both orders.
    expect(perIteration[1]).toContain('b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L2 — open-skill activation lifetime: until turn end, never within-turn
// ─────────────────────────────────────────────────────────────────────────────

describe('L2 probe — an open skill picked via read_skill stays active until the turn ends (and not into the next turn)', () => {
  it('activation persists across every later iteration of the run, and the next run starts clean', async () => {
    const entry = skill('a');
    const helper = skill('helper', 'HELPER BODY'); // registered beside the graph, no incoming edge → OPEN
    const graph = skillGraph().entry(entry).build();

    let i = 0;
    const provider = mock({
      respond: () => {
        i++;
        if (i === 1) {
          return {
            content: 'reading',
            toolCalls: [{ id: 'r1', name: 'read_skill', args: { id: 'helper' } }],
            stopReason: 'tool_use' as const,
          };
        }
        if (i === 2) {
          return {
            content: 'probing',
            toolCalls: [{ id: 'p1', name: 'probe', args: {} }],
            stopReason: 'tool_use' as const,
          };
        }
        return { content: 'done', toolCalls: [], stopReason: 'stop' as const };
      },
    });

    const { perIteration, recorder } = captureActiveIds();
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 6 })
      .system('')
      .tool(noopTool('probe'))
      .skillGraph(graph)
      .skill(helper)
      .watch(recorder)
      .build();

    await agent.run({ message: 'go' });

    // Run 1 = three iterations = three evaluations.
    expect(perIteration.length).toBe(3);
    // Iteration 1: not yet picked.
    expect(perIteration[0]).not.toContain('helper');
    // Iteration 2: the accepted pick activated it (the read_skill append in toolCalls).
    expect(perIteration[1]).toContain('helper');
    // Iteration 3: STILL active — an unrelated tool turn passed, nothing
    // deactivated it. There is no within-turn end to an open-skill activation.
    expect(perIteration[2]).toContain('helper');

    // Run 2 on the same agent (provider script now answers 'done' immediately):
    // seed resets activatedInjectionIds (seed.ts:326) — the activation ended
    // WITH the turn and does not leak into the next one.
    await agent.run({ message: 'again' });
    expect(perIteration.length).toBe(4);
    expect(perIteration[3]).not.toContain('helper');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L5 — skillGraph + reactMode 'classic': builds today, trace-vs-wire split
// ─────────────────────────────────────────────────────────────────────────────

describe("L5 probe — FLIPPED at 9.16.0: skillGraph + reactMode 'classic' is a build-time teaching refusal", () => {
  const probeTool = noopTool('probe');

  const routeGraph = () => {
    const a = skill('a', 'A BODY MARKER');
    const b = skill('b', 'B BODY MARKER');
    return skillGraph().entry(a).route(a, b, { onToolReturn: 'probe' }).build();
  };

  /** Calls `probe` on turn 1 then stops, capturing each request's systemPrompt. */
  const captureSystems = (systems: string[]) => {
    let i = 0;
    return mock({
      respond: (req: LLMRequest) => {
        systems.push(req.systemPrompt ?? '');
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

  it('REFUSES at .skillGraph() (flipped from the pinned .not.toThrow — the split can no longer be built)', () => {
    // The old probe demonstrated the 'accepted-and-silently-wrong' split at
    // runtime: routes fired in the trace while the cached system-prompt slot
    // never carried the activated body to the model. That agent is now
    // unconstructible, which is the fix.
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'mock', reactMode: 'classic' })
        .tool(probeTool)
        .skillGraph(routeGraph())
        .build(),
    ).toThrow(/classic/);
  });

  it('the refusal TEACHES: it names what breaks, the fix, and what IS still allowed', () => {
    try {
      Agent.create({ provider: mock({ reply: 'x' }), model: 'mock', reactMode: 'classic' })
        .tool(probeTool)
        .skillGraph(routeGraph());
      expect.unreachable('skillGraph() should have refused under classic');
    } catch (err) {
      const msg = String(err);
      expect(msg).toContain('caches the system-prompt and tools slots'); // what breaks
      expect(msg).toContain("'dynamic'"); // the fix
      expect(msg).toContain('WITHOUT a graph'); // what is allowed
    }
  });

  it("classic WITHOUT a graph still builds — the refusal is scoped to what can't be honored", () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'mock', reactMode: 'classic' })
        .tool(probeTool)
        .system('fixed prompt, fixed tools — classic is fine here')
        .build(),
    ).not.toThrow();
  });

  it('dynamic (control): the same graph delivers the activated body on the next request', async () => {
    const systems: string[] = [];
    const agent = Agent.create({
      provider: captureSystems(systems),
      model: 'mock',
      maxIterations: 4,
      reactMode: 'dynamic',
    })
      .system('')
      .tool(probeTool)
      .skillGraph(routeGraph())
      .build();

    await agent.run({ message: 'go' });

    expect(systems.length).toBeGreaterThanOrEqual(2);
    expect(systems[1]).toContain('B BODY MARKER');
  });
});
