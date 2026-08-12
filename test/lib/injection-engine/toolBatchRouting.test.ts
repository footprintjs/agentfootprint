/**
 * Ordered tool-outcome batch routing + `skill.route_conflict` (9.16.0).
 *
 * The L1 fix: when the model calls several tools in ONE message, every
 * result of the batch drives routing — in call order — instead of only the
 * last call's. Semantics pinned here:
 *
 *   • results are evaluated in CALL order; per result, edges in DECLARATION
 *     order (the D1 law, unchanged); the first result with a match wins the
 *     cursor move;
 *   • two results matching edges to DIFFERENT targets → the first wins AND
 *     `agentfootprint.skill.route_conflict` is emitted with
 *     `{ winner, losers: [{ toolCallId, toolName, target }] }` — the
 *     suppressed hops are on the record, never silent;
 *   • same-target matches are not a conflict; a batch of one (and the
 *     singular `lastToolResult` fallback) is byte-identical to pre-9.16.0.
 *
 * Sections follow Convention 3 (test types): Unit · Functional ·
 * Integration · Property · Security · Performance.
 */

import { describe, it, expect } from 'vitest';
import { defineTool, Agent } from '../../../src/index.js';
import {
  skillGraph,
  defineSkill,
  evaluateInjections,
  toolResultsOf,
} from '../../../src/injection-engine.js';
import type { Injection, InjectionContext } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';

const skill = (id: string, body = `${id} body`) =>
  defineSkill({ id, description: `use ${id}`, body });

const noopTool = (name: string) =>
  defineTool({
    name,
    description: `${name} probe tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: name }),
  });

const baseCtx: InjectionContext = {
  iteration: 2,
  userMessage: 'go',
  history: [],
  activatedInjectionIds: [],
};

/** a --alpha--> b declared FIRST, a --beta--> c declared SECOND. */
const twoEdgeGraph = () => {
  const a = skill('a');
  const b = skill('b');
  const c = skill('c');
  return skillGraph()
    .entry(a)
    .route(a, b, { onToolReturn: 'alpha' })
    .route(a, c, { onToolReturn: 'beta' })
    .build();
};

const res = (toolName: string, toolCallId: string, result = `${toolName} out`) => ({
  toolName,
  result,
  toolCallId,
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit — the cursor resolver over a batch (public graph API)
// ─────────────────────────────────────────────────────────────────────────────

describe('unit: explainNextSkill over a tool batch', () => {
  it('call order wins ACROSS results; declaration order only tiebreaks PER result', () => {
    // beta was CALLED first and matches the SECOND-declared edge (a→c);
    // alpha was called second and matches the FIRST-declared edge (a→b).
    // Call order across results wins: the cursor goes to c, and b is the
    // reported loser. (Declaration order still decides when ONE result
    // could match several edges — the D1 law, tested below.)
    const g = twoEdgeGraph();
    const move = g.explainNextSkill({
      ...baseCtx,
      currentSkillId: 'a',
      toolResults: [res('beta', 'c1'), res('alpha', 'c2')],
    });
    expect(move.to).toBe('c');
    expect(move.by).toBe('route');
    expect(move.conflict).toEqual({
      winner: { toolCallId: 'c1', toolName: 'beta', target: 'c' },
      losers: [{ toolCallId: 'c2', toolName: 'alpha', target: 'b' }],
    });
  });

  it('declaration order decides when ONE result matches several edges (D1 unchanged, no conflict)', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    // BOTH edges match the same single result — first-declared wins, and a
    // one-result batch can never conflict with itself.
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'alpha' })
      .route(a, c, { onToolReturn: /alph/ })
      .build();
    const move = g.explainNextSkill({
      ...baseCtx,
      currentSkillId: 'a',
      toolResults: [res('alpha', 'c1')],
    });
    expect(move.to).toBe('b');
    expect(move.conflict).toBeUndefined();
  });

  it('two results matching edges to the SAME target: not a conflict', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'alpha' })
      .route(a, b, { onToolReturn: 'beta' })
      .build();
    const move = g.explainNextSkill({
      ...baseCtx,
      currentSkillId: 'a',
      toolResults: [res('alpha', 'c1'), res('beta', 'c2')],
    });
    expect(move.to).toBe('b');
    expect(move.by).toBe('route');
    expect(move.conflict).toBeUndefined();
  });

  it('one matching result routes wherever it sits in the batch (no conflict when siblings match nothing)', () => {
    const g = twoEdgeGraph();
    const move = g.explainNextSkill({
      ...baseCtx,
      currentSkillId: 'a',
      toolResults: [res('noise', 'c1'), res('alpha', 'c2')],
    });
    expect(move.to).toBe('b');
    expect(move.conflict).toBeUndefined();
  });

  it('singular lastToolResult fallback is byte-identical to pre-9.16.0 (no toolResults supplied)', () => {
    const g = twoEdgeGraph();
    const move = g.explainNextSkill({
      ...baseCtx,
      currentSkillId: 'a',
      lastToolResult: { toolName: 'beta', result: 'beta out' },
    });
    expect(move).toEqual({ from: 'a', to: 'c', by: 'route' }); // no conflict key at all
    expect(g.nextSkill({ ...baseCtx, currentSkillId: 'a', lastToolResult: { toolName: 'beta', result: '' } })).toBe('c');
  });

  it('empty batch → sticky stay (same as no tool result ever)', () => {
    const g = twoEdgeGraph();
    const move = g.explainNextSkill({ ...baseCtx, currentSkillId: 'a', toolResults: [] });
    expect(move).toEqual({ from: 'a', to: 'a', by: 'stay' });
  });

  it('nextSkill stays the .to projection of explainNextSkill under a conflicted batch', () => {
    const g = twoEdgeGraph();
    const ctx: InjectionContext = {
      ...baseCtx,
      currentSkillId: 'a',
      toolResults: [res('beta', 'c1'), res('alpha', 'c2')],
    };
    expect(g.nextSkill(ctx)).toBe(g.explainNextSkill(ctx).to);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit — the evaluator's on-tool-return arm over a batch
// ─────────────────────────────────────────────────────────────────────────────

describe('unit: on-tool-return triggers see the whole batch', () => {
  const onReturn = (id: string, toolName: string | RegExp): Injection => ({
    id,
    flavor: 'instruction',
    trigger: { kind: 'on-tool-return', toolName },
    inject: { systemPrompt: `${id} guidance` },
  });

  it('an EARLIER batch call activates the trigger (the pre-9.16.0 drop)', () => {
    const { active } = evaluateInjections([onReturn('i1', 'alpha')], {
      ...baseCtx,
      toolResults: [res('alpha', 'c1'), res('beta', 'c2')],
      lastToolResult: { toolName: 'beta', result: 'beta out' }, // the old singular view
    });
    expect(active.map((i) => i.id)).toEqual(['i1']);
  });

  it('falls back to the singular lastToolResult when no batch was supplied', () => {
    const { active } = evaluateInjections([onReturn('i1', /^alp/)], {
      ...baseCtx,
      lastToolResult: { toolName: 'alpha', result: 'x' },
    });
    expect(active.map((i) => i.id)).toEqual(['i1']);
  });

  it('toolResultsOf applies exactly that fallback (helper contract)', () => {
    expect(toolResultsOf({ ...baseCtx })).toEqual([]);
    expect(
      toolResultsOf({ ...baseCtx, lastToolResult: { toolName: 'a', result: 'r' } }),
    ).toEqual([{ toolName: 'a', result: 'r' }]);
    const batch = [res('a', 'c1'), res('b', 'c2')];
    expect(toolResultsOf({ ...baseCtx, toolResults: batch })).toBe(batch);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration — the real Agent loop end to end
// ─────────────────────────────────────────────────────────────────────────────

/** Model emits the named tools in ONE message on turn 1, then stops. */
const batchThenStop = (...names: string[]) => {
  let i = 0;
  return mock({
    respond: () => {
      i++;
      return i === 1
        ? {
            content: 'batching',
            toolCalls: names.map((name, n) => ({ id: `t${n + 1}`, name, args: {} })),
            stopReason: 'tool_use' as const,
          }
        : { content: 'done', toolCalls: [], stopReason: 'stop' as const };
    },
  });
};

/** Capture per-iteration activeIds + every skill.route_conflict payload. */
const captureRouting = () => {
  const perIteration: string[][] = [];
  const conflicts: unknown[] = [];
  const recorder = {
    id: 'capture-routing',
    onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
      if (e.name === 'agentfootprint.context.evaluated') {
        perIteration.push([...((e.payload?.activeIds as readonly string[] | undefined) ?? [])].sort());
      }
      if (e.name === 'agentfootprint.skill.route_conflict') {
        conflicts.push(e.payload);
      }
    },
  };
  return { perIteration, conflicts, recorder };
};

describe('integration: parallel batch through the real Agent loop', () => {
  const buildAgent = (
    provider: ReturnType<typeof mock>,
    graph = twoEdgeGraph(),
  ) => {
    const { perIteration, conflicts, recorder } = captureRouting();
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('')
      .tool(noopTool('alpha'))
      .tool(noopTool('beta'))
      .tool(noopTool('noise'))
      .skillGraph(graph)
      .watch(recorder)
      .build();
    return { agent, perIteration, conflicts };
  };

  it('two tools matching DIFFERENT edges: first in call order wins the cursor AND route_conflict is emitted', async () => {
    const { agent, perIteration, conflicts } = buildAgent(batchThenStop('alpha', 'beta'));
    await agent.run({ message: 'go' });

    expect(perIteration.length).toBeGreaterThanOrEqual(2);
    expect(perIteration[0]).toEqual(['a']);
    // alpha (t1) was first: cursor moved to b; c was suppressed and reported.
    expect(perIteration[1]).toContain('b');
    expect(perIteration[1]).not.toContain('c');
    expect(conflicts).toEqual([
      {
        iteration: 2,
        fromSkillId: 'a',
        winner: { toolCallId: 't1', toolName: 'alpha', target: 'b' },
        losers: [{ toolCallId: 't2', toolName: 'beta', target: 'c' }],
      },
    ]);
  });

  it('the same conflict is observable on the typed dispatcher (agent.on)', async () => {
    const { agent } = buildAgent(batchThenStop('beta', 'alpha'));
    const seen: Array<{ winner: { target: string }; losers: readonly { target: string }[] }> = [];
    agent.on('agentfootprint.skill.route_conflict', (e) => {
      seen.push(e.payload);
    });
    await agent.run({ message: 'go' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.winner.target).toBe('c'); // beta first this time
    expect(seen[0]!.losers.map((l) => l.target)).toEqual(['b']);
  });

  it('two tools, ONE matching: routes regardless of its position in the batch, and NO conflict is emitted', async () => {
    const { agent, perIteration, conflicts } = buildAgent(batchThenStop('noise', 'alpha'));
    await agent.run({ message: 'go' });

    expect(perIteration[1]).toContain('b');
    expect(conflicts).toEqual([]);
  });

  it('single-tool iteration: byte-identical routing, no conflict event (zero cost when unused)', async () => {
    const { agent, perIteration, conflicts } = buildAgent(batchThenStop('alpha'));
    await agent.run({ message: 'go' });

    expect(perIteration[1]).toContain('b');
    expect(conflicts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property — call order is the ONLY thing that decides between two matches
// ─────────────────────────────────────────────────────────────────────────────

describe('property: batch order determines the winner, deterministically', () => {
  it('for every rotation of a 3-result batch, the first matching result wins and the other match is the loser', () => {
    const g = twoEdgeGraph();
    const matching = [res('alpha', 'A'), res('beta', 'B')];
    const noise = res('noise', 'N');
    const expectedTarget = { alpha: 'b', beta: 'c' } as const;

    for (let pos = 0; pos < 3; pos++) {
      for (const [first, second] of [
        [matching[0]!, matching[1]!],
        [matching[1]!, matching[0]!],
      ] as const) {
        const batch = [first, second];
        batch.splice(pos, 0, noise); // noise at every position
        const move = g.explainNextSkill({ ...baseCtx, currentSkillId: 'a', toolResults: batch });
        expect(move.to).toBe(expectedTarget[first.toolName as 'alpha' | 'beta']);
        expect(move.conflict?.winner.toolCallId).toBe(first.toolCallId);
        expect(move.conflict?.losers.map((l) => l.toolCallId)).toEqual([second.toolCallId]);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security/robustness — a throwing predicate cannot block its siblings
// ─────────────────────────────────────────────────────────────────────────────

describe('robustness: throwing route predicates', () => {
  it('a predicate that throws on one result is a no-match for THAT (edge, result) only', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, {
        when: (r) => {
          if (r.toolName === 'bomb') throw new Error('predicate exploded');
          return r.toolName === 'alpha';
        },
      })
      .route(a, c, { onToolReturn: 'beta' })
      .build();
    // bomb throws inside edge 1 for result 1, but result 1 still matches
    // edge 2? No — bomb matches nothing else; result 2 (alpha) matches edge 1.
    const move = g.explainNextSkill({
      ...baseCtx,
      currentSkillId: 'a',
      toolResults: [res('bomb', 'c1'), res('alpha', 'c2')],
    });
    expect(move.to).toBe('b');
    expect(move.by).toBe('route');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Performance — O(results × edges), no quadratic surprise
// ─────────────────────────────────────────────────────────────────────────────

describe('performance: large batches resolve in linear time', () => {
  it('a 500-result batch over 2 edges resolves in well under 100ms', () => {
    const g = twoEdgeGraph();
    const batch = Array.from({ length: 500 }, (_, i) =>
      res(i === 499 ? 'alpha' : 'noise', `c${i}`),
    );
    const start = performance.now();
    const move = g.explainNextSkill({ ...baseCtx, currentSkillId: 'a', toolResults: batch });
    const elapsed = performance.now() - start;
    expect(move.to).toBe('b');
    expect(elapsed).toBeLessThan(100);
  });
});
