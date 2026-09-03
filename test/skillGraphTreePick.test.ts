/**
 * A decision `tree()` cannot be jumped by `read_skill` — and now says so (8.5.0).
 *
 * Tree mode leaves the cursor resolver as the identity, so `pendingSkillPick` was
 * never honoured. But `reachableSkills()` answered ALL the leaves, so the gate
 * accepted every leaf pick, `read_skill` replied "Skill 'x' activated for the next
 * iteration", the tree re-decided by predicate, the leaf never activated, and
 * `reroute_superseded` fired naming a winner that did not exist (tree mode never
 * writes a cursor at all, so the payload had neither `wonId` nor `fromSkillId`).
 *
 * Honouring the pick was the other option and it loses on the tree's own terms:
 *   • exactly ONE leaf fires per iteration — the library ships a dev-mode monitor
 *     that warns otherwise, so an extra active leaf makes it warn about itself;
 *   • each leaf's tools are scoped on that same basis (`TreeOptions.scopeTools`);
 *   • `toMermaid()` draws diamonds → leaves, and a model lever over predicate
 *     routing is not on the drawing (declared === drawn).
 * And 8.4.0 already settled the general rule: a pick may only be admitted for a
 * trigger `read_skill` can actually fire — `llm-activated`. A leaf's trigger is a
 * `rule`. Tree mode was the one set that had escaped that rule.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../src/index.js';
import { defineSkill, skillGraph, decideSkill } from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';

const t = (name: string) =>
  defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name}:ran`,
  });

const leaf = (id: string) =>
  defineSkill({ id, description: `${id} skill`, body: `${id.toUpperCase()}_BODY`, tools: [t(id)] });

/** Drive an agent that immediately tries to read_skill its way somewhere. */
async function jump(
  build: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  wanted: string,
) {
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const active: string[][] = [];
  const toolResults: string[] = [];
  let calls = 0;
  const provider = mock({
    respond: (req: { messages?: ReadonlyArray<{ role: string; content: string }> }) => {
      for (const m of req.messages ?? []) if (m.role === 'tool') toolResults.push(m.content);
      calls++;
      if (calls === 1)
        return { content: '', toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: wanted } }] };
      return { content: 'done', toolCalls: [] };
    },
  });
  const agent = build(Agent.create({ provider, model: 'mock', maxIterations: 4 }))
    .watch({
      id: 'w',
      onEmit: (e: { name: string; payload: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.context.evaluated')
          active.push(e.payload.activeIds as string[]);
        if (e.name.startsWith('agentfootprint.skill.'))
          events.push({ name: e.name, ...{ payload: e.payload } });
      },
    })
    .build();
  await agent.run({ message: 'hi' });
  return { events, active, toolResults };
}

// ─── 1. UNIT — the reachable set is empty, from every cursor ─────

describe('tree pick — reachableSkills', () => {
  it('is empty from cold start and from any leaf', () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({ skills: [a, b], tree: decideSkill(() => true, a, b), check: 'throw' });
    expect(g.reachableSkills()).toEqual([]);
    expect(g.reachableSkills('leaf1')).toEqual([]);
    expect(g.reachableSkills('nonsense')).toEqual([]);
  });

  it('every leaf compiles to a rule trigger — the reason a pick cannot fire one', () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({ skills: [a, b], tree: decideSkill(() => true, a, b), check: 'throw' });
    for (const s of g.skills) expect(s.trigger.kind).toBe('rule');
  });
});

// ─── 2. SCENARIO — the pick is refused, with a teaching message ──

describe('tree pick — the gate refuses', () => {
  it('refuses the leaf, and the refusal explains the tree rather than the cursor', async () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({
      skills: [a, b],
      tree: decideSkill(() => true, a, b, 'always leaf1'),
      check: 'throw',
    });
    const { events, active, toolResults } = await jump((x) => x.system('s').skillGraph(g), 'leaf2');

    // The refusal reached the model, and it names the reason.
    expect(toolResults.join('\n')).toContain('cannot move a decision tree');
    expect(toolResults.join('\n')).toContain('routes by predicate');
    // The tool never claims an activation it cannot deliver.
    expect(toolResults.join('\n')).not.toContain('activated for the next iteration');
    // The tree's own routing is untouched: leaf1 every iteration, leaf2 never.
    expect(active.every((ids) => ids.includes('leaf1'))).toBe(true);
    expect(active.some((ids) => ids.includes('leaf2'))).toBe(false);
    // Recorded as a rejection.
    expect(events.filter((e) => e.name === 'agentfootprint.skill.rejected')).toHaveLength(1);
  });

  it('the empty, winnerless reroute_superseded is gone', async () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({ skills: [a, b], tree: decideSkill(() => true, a, b), check: 'throw' });
    const { events } = await jump((x) => x.system('s').skillGraph(g), 'leaf2');
    // It used to fire with volunteeredId and NOTHING else — "superseded by nothing,
    // from nowhere". The pick is refused at the gate now, so it is never set, so the
    // misleading honesty event cannot happen.
    expect(events.filter((e) => e.name === 'agentfootprint.skill.reroute_superseded')).toEqual([]);
  });
});

// ─── 3. INTEGRATION — the escape hatch that survives ─────────────

describe('tree pick — open skills are still the escape hatch', () => {
  it('a skill registered BESIDE the tree still activates from any cursor', async () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({ skills: [a, b], tree: decideSkill(() => true, a, b), check: 'throw' });
    const helper = defineSkill({ id: 'helper', description: 'H', body: 'HELPER_BODY' });
    const { active, toolResults } = await jump(
      (x) => x.system('s').skillGraph(g).skill(helper),
      'helper',
    );
    expect(toolResults.join('\n')).toContain('activated for the next iteration');
    expect(active.some((ids) => ids.includes('helper'))).toBe(true);
    // ...and it did NOT displace the tree's routing.
    expect(active.every((ids) => ids.includes('leaf1'))).toBe(true);
  });

  it('with open skills present the refusal names them instead of the tree message', async () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({ skills: [a, b], tree: decideSkill(() => true, a, b), check: 'throw' });
    const helper = defineSkill({ id: 'helper', description: 'H', body: 'H' });
    const { toolResults } = await jump((x) => x.system('s').skillGraph(g).skill(helper), 'leaf2');
    expect(toolResults.join('\n')).toContain('Reachable skills: helper');
  });
});

// ─── 4. PROPERTY — a flat graph is untouched ─────────────────────

describe('tree pick — flat graphs are unchanged', () => {
  it('a flat graph still honours an accepted pick (8.3.0 behaviour intact)', async () => {
    const a = leaf('alpha');
    const b = leaf('beta');
    const g = skillGraph({
      skills: [a, b],
      start: 'alpha',
      steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha' }],
      check: 'throw',
    });
    const { active, toolResults } = await jump((x) => x.system('s').skillGraph(g), 'beta');
    expect(toolResults.join('\n')).toContain('activated for the next iteration');
    expect(active.some((ids) => ids.includes('beta'))).toBe(true);
  });

  it('a flat graph at a dead end never gets the TREE message — it gets the self-call one', async () => {
    const a = leaf('alpha');
    const g = skillGraph({ skills: [a], start: 'alpha', check: 'off' });
    const { toolResults } = await jump((x) => x.system('s').skillGraph(g), 'alpha');
    const text = toolResults.join('\n');
    // This pick is a SELF-CALL (cursor alpha, picks alpha), which is why the
    // original assertion had to be guarded by `if (text.includes(...))` — and why
    // that guard turned the test vacuous the moment the self-call stopped being
    // reported as unreachable. Assert the branch it actually takes.
    expect(text).not.toContain('cannot move a decision tree'); // the point of the test
    expect(text).not.toContain('is not reachable from here');
    expect(text).toContain('named the skill you were already standing in');
    // A one-node graph has nowhere else to go — and neither does any other, as
    // far as this message is concerned. The notice names no destination at all
    // now (see `selfCallNotice`): a tool result is re-read on every later call
    // of the turn, so an id named as reachable is a prediction the budget, the
    // posture arm or a cursor move can falsify after the sentence is written.
    // The `read_skill` description owns that list, and is recomposed per call.
    expect(text).not.toContain('reachable from here');
    expect(text).not.toContain('MOVES you');
  });
});

// ─── 5. SECURITY — a refused pick changes nothing ────────────────

describe('tree pick — a refused pick has no side effects', () => {
  it('does not activate, does not appear in the active set, does not move a cursor', async () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({ skills: [a, b], tree: decideSkill(() => true, a, b), check: 'throw' });
    const events: Array<{ name: string }> = [];
    let calls = 0;
    const provider = mock({
      respond: () => {
        calls++;
        if (calls <= 2)
          return {
            content: '',
            toolCalls: [{ id: `c${calls}`, name: 'read_skill', args: { id: 'leaf2' } }],
          };
        return { content: 'done', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('s')
      .skillGraph(g)
      .watch({
        id: 'w',
        onEmit: (e: { name: string }) => {
          if (e.name.startsWith('agentfootprint.skill.')) events.push({ name: e.name });
        },
      })
      .build();
    await agent.run({ message: 'hi' });
    const snap = agent.getLastSnapshot()?.sharedState as {
      activatedInjectionIds?: readonly string[];
      pendingSkillPick?: string;
      currentSkillId?: string;
    };
    expect(snap.activatedInjectionIds ?? []).not.toContain('leaf2');
    expect(snap.pendingSkillPick).toBeUndefined();
    expect(events.every((e) => e.name === 'agentfootprint.skill.rejected')).toBe(true);
  });
});

// ─── 6. PERFORMANCE — the empty set costs nothing ────────────────

describe('tree pick — performance', () => {
  it('reachableSkills is O(1) for a tree of any size', () => {
    const leaves = Array.from({ length: 200 }, (_, i) => leaf(`l${i}`));
    let node: Parameters<typeof decideSkill>[1] = leaves[0]!;
    for (let i = 1; i < leaves.length; i++) node = decideSkill(() => true, leaves[i]!, node);
    const g = skillGraph().tree(node).build({ check: 'off' });
    const start = Date.now();
    for (let i = 0; i < 100_000; i++) g.reachableSkills(`l${i % 200}`);
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});

// ─── 7. ROI — the drawing and the routing still agree ────────────

describe('tree pick — declared === drawn', () => {
  it('the mermaid has no model edge, matching a graph the model cannot jump', () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({
      skills: [a, b],
      tree: decideSkill(() => true, a, b, 'q?'),
      check: 'throw',
    });
    const mermaid = g.toMermaid();
    // `-.->` is the dashed MODEL edge. A tree draws only predicate branches, which is
    // exactly the claim the empty reachable set makes true.
    expect(mermaid).not.toContain('-.->');
    expect(g.edges.every((e) => e.kind === 'predicate')).toBe(true);
  });
});
