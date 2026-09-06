/**
 * `read_skill` offers what the gate will actually grant (8.5.0).
 *
 * The tool enumerated EVERY registered skill — in its enum and in the catalog inside
 * its description — while the skill-graph gate admitted only
 * `reachableSkills(cursor) ∪ open`. So a route target the cursor cannot reach was
 * advertised on every iteration and refused on every call: the model was being asked
 * to choose from a menu the library already knew it would reject, and could spend a
 * whole run re-asking.
 *
 * The ENUM stays the full catalog, deliberately. `toolArgValidation` defaults to
 * `'enforce'` and runs BEFORE the gate; an off-enum id is rejected with a generic
 * schema error and `error = true`, which makes the gate skip entirely. Narrowing the
 * enum would therefore retire the gate's teaching refusal, the `skill.rejected`
 * event, `routeRecorder`'s rejection hops and the rejected-cap governor's only input
 * — four honesty mechanisms traded for one. The DESCRIPTION carries the offer
 * instead, which is what the model reads to choose.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../src/index.js';
import {
  decideSkill,
  defineSkill,
  skillGraph,
  buildReadSkillTool,
} from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';
import { unprovable, GRAPH_TOOL_DESCRIPTION } from './helpers/modelFacingClaims.js';

const t = (name: string) =>
  defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name}:ran`,
  });

const skill = (id: string) =>
  defineSkill({
    id,
    description: `${id} does things`,
    body: `${id}_BODY`,
    tools: [t(`${id}_tool`)],
  });

/** The three-skill graph used across these tests: alpha → beta, plus a loose gamma. */
function graph() {
  const alpha = skill('alpha');
  const beta = skill('beta');
  const gamma = skill('gamma');
  return skillGraph({
    skills: [alpha, beta, gamma],
    start: 'alpha',
    steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
    check: 'off',
  });
}

/** The two catalog sections of a scoped `read_skill` description, by id. */
function splitMenu(description: string): { reachable: string[]; refusable: string[] } {
  const [head, tail] = description.split('Not reachable from here');
  const ids = (block: string) =>
    [...(block ?? '').matchAll(/^ {2}- ([^:]+):/gm)].map((m) => m[1]!.trim());
  return { reachable: ids(head ?? ''), refusable: ids(tail ?? '') };
}

/** The cursor the description NAMES, if any (9.84.0's positive signal). */
function namedCursor(description: string): string | undefined {
  return /You are in '([^']+)'\./.exec(description)?.[1];
}

/** Capture the read_skill description the model saw on each iteration. */
async function menus(
  agentOf: (a: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  script: ReadonlyArray<{
    content: string;
    toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  }>,
): Promise<string[]> {
  const seen: string[] = [];
  let i = 0;
  const provider = mock({
    respond: (req: { tools?: ReadonlyArray<{ name: string; description: string }> }) => {
      const rs = (req.tools ?? []).find((x) => x.name === 'read_skill');
      seen.push(rs?.description ?? '(no read_skill)');
      return script[i++] ?? { content: 'done', toolCalls: [] };
    },
  });
  const agent = agentOf(Agent.create({ provider, model: 'mock', maxIterations: 5 })).build();
  await agent.run({ message: 'go' });
  return seen;
}

// ─── 1. UNIT — the builder splits the catalog, keeps the enum ────

describe('read_skill offer — the builder', () => {
  const skills = [skill('alpha'), skill('beta'), skill('gamma')];

  it('with no offer, the description is the full catalog (byte-identical path)', () => {
    const tool = buildReadSkillTool(skills)!;
    expect(tool.schema.description).toContain('Available skills:');
    expect(tool.schema.description).toContain('alpha');
    expect(tool.schema.description).toContain('gamma');
    expect(tool.schema.description).not.toContain('Not reachable');
  });

  it('with an offer, the catalog splits into reachable and refusable', () => {
    const tool = buildReadSkillTool(skills, { grantable: ['beta'] })!;
    const d = tool.schema.description;
    expect(d).toContain('Reachable from here:');
    expect(d).toContain('  - beta:');
    expect(d).toContain('Not reachable from here');
    expect(d).toContain('  - alpha:');
    expect(d).toContain('  - gamma:');
    // The split is by SECTION, not by omission — the reachable one comes first.
    expect(d.indexOf('Reachable from here:')).toBeLessThan(d.indexOf('Not reachable from here'));
  });

  it('the ENUM is the full catalog either way — the gate needs off-menu ids to reach it', () => {
    const plain = buildReadSkillTool(skills)!;
    const scoped = buildReadSkillTool(skills, { grantable: ['beta'] })!;
    const enumOf = (tool: typeof plain) =>
      (tool.schema.inputSchema as { properties: { id: { enum?: string[] } } }).properties.id.enum;
    expect(enumOf(plain)).toEqual(['alpha', 'beta', 'gamma']);
    expect(enumOf(scoped)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('an empty grantable set says so rather than showing a blank menu', () => {
    const d = buildReadSkillTool(skills, { grantable: [] })!.schema.description;
    expect(d).toContain('Nothing is reachable from here');
  });

  /**
   * OMIT, NEVER DENY — on the surface the model chooses from (9.86.0 fix pass).
   *
   * The refusal composer was taught to tell "the graph held nothing" from "the
   * role filter emptied it"; this description was not, and it is the sentence
   * the model reads BEFORE it picks. It computed its columns from an
   * already-filtered catalog, so a cursor whose only declared hop is hidden was
   * told "Nothing is reachable from here" while the graph was holding that
   * edge — a Lens denying what the Fold holds.
   */
  it('when the role filter empties the hop set, the negative sentence is OMITTED', () => {
    const d = buildReadSkillTool(skills, {
      grantable: ['beta'],
      hiddenIds: ['beta'],
      cursorId: 'alpha',
    })!.schema.description;
    // The graph holds alpha → beta. Saying nothing is reachable denies it.
    expect(d).not.toContain('Nothing is reachable from here');
    // Omission, not a leak: the hidden id is still named nowhere.
    expect(d).not.toContain('beta');
    // …and the description is still whole — the cursor and the instructions.
    expect(d).toContain("You are in 'alpha'.");
    expect(d).toContain("Pass the skill's id.");
    // No blank clause left where the sentence used to be.
    expect(d).not.toContain('\n\n\n');
    // The arm the omission leaves behind is still a sentence the checker clears
    // at this surface — a new arm of a registered producer is judged like any
    // other.
    expect(unprovable(d, GRAPH_TOOL_DESCRIPTION)).toEqual([]);
  });

  it('a graph that genuinely holds no hop still says so — the fix omits, it does not mute', () => {
    // The other half. `grantable: []` with nothing hidden is an absence this
    // description holds evidence for, so it may state it.
    const d = buildReadSkillTool(skills, { grantable: [], cursorId: 'alpha' })!.schema.description;
    expect(d).toContain('Nothing is reachable from here');
  });

  it('showRefusable:false hides the refusable half', () => {
    const d = buildReadSkillTool(skills, { grantable: ['beta'], showRefusable: false })!.schema
      .description;
    expect(d).toContain('  - beta:');
    expect(d).not.toContain('Not reachable from here');
  });
});

// ─── 1b. UNIT + SCENARIO — a decision TREE is offered nothing it would refuse ──

/**
 * ITEM 4 of "Offer, Not Dispatch" (9.86.0).
 *
 * 8.5.0's whole argument was that a menu the gate will reject is a menu the
 * model should never have been shown. Under a `.tree()` that rejection is
 * TOTAL: the tree routes by predicate and keeps no cursor, so
 * `reachableSkills()` is empty from every position and every routing pick is
 * refused. The offer was left standing there anyway, saying "Nothing is
 * reachable from here" on every single iteration — an invitation to a door
 * that is not a door.
 *
 * Two shapes, because a tree can still have OPEN skills registered beside it:
 * with none, the tool is not offered at all; with some, it is offered and its
 * description says what a pick can actually do. Dispatch is untouched in both
 * — `test/skillGraphTreePick.test.ts` drives a pick made anyway and reads the
 * gate's refusal.
 */
describe('read_skill offer — under a .tree()', () => {
  const leaf = (id: string) => defineSkill({ id, description: `${id} leaf`, body: `${id}_BODY` });

  it('with nothing open, the tool is WITHHELD — no menu at all beats a menu of one refusal', () => {
    const tool = buildReadSkillTool([leaf('leaf1'), leaf('leaf2')], {
      grantable: [],
      treeRouted: true,
    });
    expect(tool).toBeUndefined();
  });

  it('with open skills, it explains the tree and names exactly what a pick CAN open', () => {
    const d = buildReadSkillTool(
      [leaf('leaf1'), leaf('leaf2'), defineSkill({ id: 'helper', description: 'H', body: 'B' })],
      { grantable: ['helper'], treeRouted: true },
    )!.schema.description;
    expect(d).toContain('decision TREE');
    expect(d).toContain('keeps no cursor');
    expect(d).toContain('  - helper: H');
    // The leaves are NOT offered as picks — that is the whole refusal.
    expect(d).not.toContain('  - leaf1:');
    expect(d).not.toContain('Nothing is reachable from here');
  });

  it('a role that may not see the open skill leaves the tree with nothing to offer', () => {
    // The two filters compose: hidden first, then the tree's own emptiness
    // test. A role-hidden open skill cannot keep the tool on the wire, or the
    // offer would name a door only somebody else may use.
    const tool = buildReadSkillTool(
      [leaf('leaf1'), defineSkill({ id: 'helper', description: 'H', body: 'B' })],
      { grantable: ['helper'], treeRouted: true, hiddenIds: ['helper'] },
    );
    expect(tool).toBeUndefined();
  });

  it('END TO END: a tree agent never carries read_skill on the wire, and still dispatches it', async () => {
    const a = leaf('leaf1');
    const b = leaf('leaf2');
    const g = skillGraph({
      skills: [a, b],
      tree: decideSkill(() => true, a, b),
      check: 'throw',
    });
    const wire: string[][] = [];
    const results: string[] = [];
    let i = 0;
    const script = [
      { content: '', toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'leaf2' } }] },
      { content: 'done', toolCalls: [] },
    ];
    const provider = mock({
      respond: (req: {
        tools?: ReadonlyArray<{ name: string }>;
        messages?: ReadonlyArray<{ role: string; content: unknown }>;
      }) => {
        for (const m of req.messages ?? []) if (m.role === 'tool') results.push(String(m.content));
        wire.push((req.tools ?? []).map((x) => x.name));
        return script[i++] ?? { content: 'done', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('s')
      .skillGraph(g)
      .build();
    await agent.run({ message: 'go' });

    // The offer is gone…
    for (const call of wire) expect(call).not.toContain('read_skill');
    // …and the NAME still dispatches: a model working from a restored
    // transcript reaches the gate's teaching refusal, not a silent nothing.
    expect(results.join('\n')).toContain('this map is a decision tree');
  });
});

// ─── 2. SCENARIO — the menu tracks the cursor across a run ───────

describe('read_skill offer — per iteration', () => {
  it('the menu follows the cursor as the graph hops', async () => {
    const seen = await menus(
      (a) => a.system('s').skillGraph(graph()),
      [{ content: '', toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }] }],
    );
    // Split on the section header rather than regex across the whole string — a
    // greedy `[\s\S]*` would happily match an id sitting in the OTHER section, which
    // is precisely the confusion this feature exists to remove.
    const sections = seen.map(splitMenu);
    // Iteration 1 — cursor on alpha (the entry). Reachable: beta (successor) and
    // gamma (open — the graph wires no edge into it). alpha itself is in NEITHER
    // column (9.84.0): it is excluded from its own successor set because a move
    // to where you already are is not a move, and calling that "not reachable"
    // said the opposite of the truth about the one skill the model was holding.
    expect(sections[0]).toEqual({ reachable: ['beta', 'gamma'], refusable: [] });
    // Iteration 2 — the alpha_tool edge fired, cursor on beta. alpha is reachable
    // again (it is the entry), beta is now the one in neither column.
    expect(sections[1]).toEqual({ reachable: ['alpha', 'gamma'], refusable: [] });
    // The cursor is instead NAMED, which is what the model was missing — and it
    // still tracks the hop, which is what `refusable` used to prove here.
    expect(seen.slice(0, 2).map(namedCursor)).toEqual(['alpha', 'beta']);
  });

  // The cursor reaches the tools slot by a DIFFERENT key in each chart shape: the
  // flat chart's injection engine writes `currentSkillId` on the parent, while
  // inside `sf-llm-call` the advanced cursor lands under `nextSkillCursor` (the
  // boundary's own `currentSkillId` is a readonly input still holding the PREVIOUS
  // iteration's value). Reading the wrong one yields a menu that lags by one hop —
  // silently, and only in one of the two modes.
  it.each(['dynamic', 'dynamic-grouped'] as const)(
    'tracks the cursor under reactMode %s (both chart shapes)',
    async (reactMode) => {
      const alpha = skill('alpha');
      const beta = skill('beta');
      const g = skillGraph({
        skills: [alpha, beta],
        start: 'alpha',
        steps: [{ from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' }],
        check: 'throw',
      });
      const seen: Array<{ reachable: string[]; refusable: string[] }> = [];
      const descriptions: string[] = [];
      let i = 0;
      const provider = mock({
        respond: (req: { tools?: ReadonlyArray<{ name: string; description: string }> }) => {
          const rs = (req.tools ?? []).find((x) => x.name === 'read_skill');
          if (rs) descriptions.push(rs.description);
          if (rs) seen.push(splitMenu(rs.description));
          i++;
          if (i === 1)
            return { content: '', toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }] };
          return { content: 'done', toolCalls: [] };
        },
      });
      const agent = Agent.create({ provider, model: 'mock', maxIterations: 4, reactMode })
        .system('s')
        .skillGraph(g)
        .build();
      await agent.run({ message: 'go' });
      expect(seen[0]).toEqual({ reachable: ['beta'], refusable: [] });
      expect(seen[1]).toEqual({ reachable: ['alpha'], refusable: [] });
      // The cursor no longer shows up in the refusable column (9.84.0), so the
      // lag this test exists to catch is proved on the two signals that remain:
      // the reachable set above, and the sentence naming where the model is.
      expect(descriptions.map(namedCursor)).toEqual(['alpha', 'beta']);
    },
  );

  it('an OPEN skill is offered as reachable from every cursor', async () => {
    const seen = await menus(
      (a) => a.system('s').skillGraph(graph()),
      [{ content: '', toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }] }],
    );
    for (const menu of seen.slice(0, 2)) {
      expect(menu).toMatch(/Reachable from here:[\s\S]*- gamma:/);
    }
  });
});

// ─── 3. INTEGRATION — the gate still owns the verdict ────────────

describe('read_skill offer — the gate is untouched', () => {
  it('an off-menu but in-enum pick still reaches the GATE, not the arg validator', async () => {
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const toolResults: string[] = [];
    let calls = 0;
    const provider = mock({
      respond: (req: { messages?: ReadonlyArray<{ role: string; content: string }> }) => {
        for (const m of req.messages ?? []) if (m.role === 'tool') toolResults.push(m.content);
        calls++;
        if (calls === 1)
          // `beta` is NOT reachable from beta's own successor set... ask from cold
          // start for a skill only reachable later in the graph.
          return {
            content: '',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'delta' } }],
          };
        return { content: 'done', toolCalls: [] };
      },
    });
    const alpha = skill('alpha');
    const beta = skill('beta');
    const delta = skill('delta');
    const g = skillGraph({
      skills: [alpha, beta, delta],
      start: 'alpha',
      steps: [
        { from: 'alpha', to: 'beta', onToolReturn: 'alpha_tool' },
        { from: 'beta', to: 'delta', onToolReturn: 'beta_tool' },
      ],
      check: 'throw',
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
      .system('s')
      .skillGraph(g)
      .watch({
        id: 'w',
        onEmit: (e: { name: string; payload: Record<string, unknown> }) => {
          if (e.name.startsWith('agentfootprint.skill.') || e.name.includes('args_invalid'))
            events.push({ name: e.name, payload: e.payload });
        },
      })
      .build();
    await agent.run({ message: 'go' });

    // The gate's teaching refusal, NOT a schema error — this is the whole reason
    // the enum stayed the full catalog. The sentence is anchored to the call
    // the model made (9.86.0): "from here" became "from 'alpha'", because a
    // tool result is re-read after "here" has moved.
    expect(toolResults.join('\n')).toContain(
      "read_skill(\"delta\") was not granted on that call: 'delta' was not reachable from 'alpha'",
    );
    expect(toolResults.join('\n')).not.toContain('Invalid arguments');
    expect(events.some((e) => e.name === 'agentfootprint.skill.rejected')).toBe(true);
    expect(events.some((e) => e.name.includes('args_invalid'))).toBe(false);
  });

  it('an id in NO registry is still caught by the enum, before the gate', async () => {
    const toolResults: string[] = [];
    let calls = 0;
    const provider = mock({
      respond: (req: { messages?: ReadonlyArray<{ role: string; content: string }> }) => {
        for (const m of req.messages ?? []) if (m.role === 'tool') toolResults.push(m.content);
        calls++;
        if (calls === 1)
          return {
            content: '',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'ghost' } }],
          };
        return { content: 'done', toolCalls: [] };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
      .system('s')
      .skillGraph(graph())
      .build();
    await agent.run({ message: 'go' });
    expect(toolResults.join('\n')).toContain('Invalid arguments');
  });
});

// ─── 4. PROPERTY — offered ⊆ granted, every iteration ────────────

describe('read_skill offer — properties', () => {
  it('everything the menu calls reachable, the gate grants', () => {
    const g = graph();
    const openIds = ['gamma']; // the graph wires no edge into gamma
    for (const cursor of [undefined, 'alpha', 'beta', 'gamma']) {
      const grantable = [...new Set([...g.reachableSkills(cursor), ...openIds])];
      const d = buildReadSkillTool(g.skills, { grantable })!.schema.description;
      const reachableBlock = d.split('Not reachable from here')[0]!;
      for (const id of grantable) expect(reachableBlock).toContain(`- ${id}:`);
      // ...and nothing outside the grant set is in the reachable block.
      for (const s of g.skills) {
        if (!grantable.includes(s.id)) expect(reachableBlock).not.toContain(`- ${s.id}:`);
      }
    }
  });

  it('a graph-less agent keeps the original description exactly', async () => {
    const seen = await menus((a) => a.system('s').skill(skill('solo')), []);
    expect(seen[0]).toContain('Available skills:');
    expect(seen[0]).not.toContain('Reachable from here:');
  });
});

// ─── 5. SECURITY — the menu shows names, never bodies ────────────

describe('read_skill offer — security', () => {
  it('neither half of the split leaks a skill body', () => {
    const secret = defineSkill({
      id: 'beta',
      description: 'B does things',
      body: 'SECRET_PROCEDURE_BODY',
    });
    const d = buildReadSkillTool([skill('alpha'), secret], { grantable: ['alpha'] })!.schema
      .description;
    expect(d).not.toContain('SECRET_PROCEDURE_BODY');
    expect(d).toContain('B does things');
  });
});

// ─── 6. PERFORMANCE — rebuilt per iteration, so it must stay cheap ──

describe('read_skill offer — performance', () => {
  it('building the offer is linear in the catalog', () => {
    const many = Array.from({ length: 300 }, (_, i) => skill(`s${i}`));
    const grantable = ['s1', 's2', 's3'];
    const start = Date.now();
    for (let i = 0; i < 300; i++) buildReadSkillTool(many, { grantable });
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});

// ─── 7. ROI — classic + a graph is refused at build (9.16.0) ─────

describe("read_skill offer — reactMode 'classic'", () => {
  it('the classic-fallback menu can no longer arise from .skillGraph(): the combination is a build-time teaching refusal', () => {
    const provider = mock({ respond: () => ({ content: 'done', toolCalls: [] }) });
    // Until 9.16.0 this combination built: the menu degraded to the honest
    // full catalog and dev mode warned. The degrade existed because the
    // combination was ALLOWED — and it was allowed while being un-honorable
    // (classic caches the system-prompt/tools slots after turn 1, so graph
    // routing advanced the trace but never the wire). It is now refused
    // outright at `.skillGraph()`, the same law as `.selfExplain()` under
    // classic. The full-catalog fallback in Agent.readSkillOfferFor stays in
    // place as defense for any future door that hands a reachable-set to a
    // classic agent.
    expect(() =>
      Agent.create({ provider, model: 'mock', maxIterations: 2, reactMode: 'classic' })
        .system('s')
        .skillGraph(graph()),
    ).toThrow(/classic/);
  });
});
