/**
 * Dead skills are REFUSED (8.4.0).
 *
 * Four combinations the library used to accept and then silently gut. Each one
 * killed a declaration at build time and said nothing — the author read code that
 * could not run, and `checkup()` reported `{ ok: true, problems: [] }` for two of
 * them. They are now refusals, and every message names the fix.
 *
 *   1. `.tree()` + `.entry()`/`.route()`      — the tree wins; the flat wiring is dropped
 *   2. `skillGraph({ tree, start | steps })`  — same trap in the config vocabulary
 *   3. a skill in `skills[]` that is not a leaf of the `tree` — compiled out entirely
 *   4. a second `.skillGraph()` on one agent  — replaces the routing, keeps the skills
 *   5. two different skills claiming one id   — last (or first) write won, silently
 *
 * What this file pins: the exact message text (a refusal that doesn't teach is a
 * worse error than the silence it replaced), the NEGATIVE side of every guard (the
 * legitimate shapes that must keep compiling), and byte-identity of the compiled
 * graph for valid declarations.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../src/index.js';
import {
  skillGraph,
  decideSkill,
  defineSkill,
  defineInstruction,
} from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';
import type { InjectionContext } from '../src/lib/injection-engine/types.js';

const skill = (id: string, description = `use ${id}`) =>
  defineSkill({ id, description, body: `${id} body` });

const yes = () => true;
const agent = () => Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' });

// ── 1. tree() + entry()/route() — the fluent form ────────────────────────────

describe('skillGraph refusals — .tree() owns the graph (fluent)', () => {
  it('refuses .tree() + .entry(), naming what would have been dropped', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    expect(() =>
      skillGraph().entry(a).tree(decideSkill(yes, b, c)).build({ check: 'off' }),
    ).toThrow(
      'skillGraph: .tree() and .entry()/.route() both declare the routing and only one ' +
        'can compile — the tree wins, so the 1 entry declared here would be silently ' +
        'dropped. tree() owns the graph: remove the .entry()/.route() calls, or drop ' +
        '.tree() and route with the flat entry/route form.',
    );
  });

  it('refuses .tree() + .route(), and counts both kinds when both are present', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    expect(() =>
      skillGraph()
        .route(a, b, { onToolReturn: 't' })
        .tree(decideSkill(yes, b, c))
        .build({ check: 'off' }),
    ).toThrow(/so the 1 route declared here would be silently dropped/);

    expect(() =>
      skillGraph()
        .entry(a)
        .entry(c, { when: yes })
        .route(a, b, { onToolReturn: 't' })
        .tree(decideSkill(yes, b, c))
        .build({ check: 'off' }),
    ).toThrow(/so the 2 entries and 1 route declared here would be silently dropped/);
  });

  it('refuses regardless of `check` — a contradiction is not a check-up finding', () => {
    const a = skill('a');
    const b = skill('b');
    const build = (check: 'off' | 'warn' | 'throw') =>
      skillGraph().entry(a).tree(decideSkill(yes, a, b)).build({ check });
    for (const check of ['off', 'warn', 'throw'] as const) {
      expect(() => build(check)).toThrow(/tree\(\) owns the graph/);
    }
  });

  it('a tree-only fluent graph still compiles (the negative side of the guard)', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .tree(decideSkill((c: InjectionContext) => /a/.test(c.userMessage), a, b, 'a?'))
      .build({ check: 'off' });
    expect(g.skills.map((s) => s.id)).toEqual(['a', 'b']);
    // Both leaves compile; neither is read_skill-jumpable (8.5.0 — a tree has no
    // cursor, so `reachableSkills` is empty rather than advertising a pick the
    // resolver would discard).
    expect(g.reachableSkills()).toEqual([]);
  });
});

// ── 2. config form: { tree, start } / { tree, steps } ────────────────────────

describe('skillGraph refusals — .tree() owns the graph (config form)', () => {
  it('refuses { tree, start } in the config vocabulary', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() =>
      // @ts-expect-error the union type already refuses this pair at compile time
      skillGraph({ skills: [a, b], tree: decideSkill(yes, a, b), start: 'a', check: 'off' }),
    ).toThrow(
      'skillGraph({ tree, start }): `start` declares the routing that `tree` already owns, ' +
        'so it would be silently ignored — a tree routes by predicate on every iteration ' +
        'and has no entry menu and no cursor. Remove `start`, or drop `tree` and route ' +
        'with the flat form.',
    );
  });

  it('refuses { tree, steps }, and names both keys when both are present', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() =>
      // @ts-expect-error the union type already refuses this pair at compile time
      skillGraph({
        skills: [a, b],
        tree: decideSkill(yes, a, b),
        steps: [{ from: 'a', to: 'b', onToolReturn: 't' }],
      }),
    ).toThrow(/^skillGraph\(\{ tree, steps \}\): `steps` declares the routing/);

    expect(() =>
      // @ts-expect-error the union type already refuses this pair at compile time
      skillGraph({
        skills: [a, b],
        tree: decideSkill(yes, a, b),
        start: 'a',
        steps: [{ from: 'a', to: 'b', onToolReturn: 't' }],
      }),
    ).toThrow(
      /^skillGraph\(\{ tree, start, steps \}\): `start` and `steps` declare the routing that `tree` already owns, so they would be silently ignored/,
    );
  });

  it('a tree-only config still compiles unchanged', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph({
      skills: [a, b],
      tree: decideSkill((c: InjectionContext) => /a/.test(c.userMessage), a, b),
      check: 'throw',
    });
    expect(g.skills.map((s) => s.id)).toEqual(['a', 'b']);
    expect(g.checkup().ok).toBe(true);
  });
});

// ── 3. a skill listed under a tree that is not a leaf ────────────────────────

describe('skillGraph refusals — a tree routes only to its leaves', () => {
  it('refuses a skills[] entry that is not a leaf, and points at the escape hatch', () => {
    const stranded = skill('alpha');
    const b = skill('b');
    const c = skill('c');
    expect(() =>
      skillGraph({ skills: [stranded, b, c], tree: decideSkill(yes, b, c), check: 'off' }),
    ).toThrow(
      'skillGraph({ tree }): skill "alpha" is listed in skills[] but is not a leaf of the ' +
        'tree, so it would never load — a tree routes only to its leaves. Add it to the ' +
        'tree as a leaf, drop it from skills[], or register it on the agent with ' +
        '.skill(alpha) to keep it read_skill-reachable.',
    );
  });

  it('skills[] listing exactly the leaves compiles (the common, correct shape)', () => {
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph({ skills: [b, c], tree: decideSkill(yes, b, c), check: 'throw' });
    expect(g.skills.map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('a leaf missing from skills[] is fine — the tree owns its leaves', () => {
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph({ skills: [], tree: decideSkill(yes, b, c), check: 'off' });
    expect(g.skills.map((s) => s.id)).toEqual(['b', 'c']);
  });
});

// ── 4. two .skillGraph() calls on one agent ──────────────────────────────────

describe('Agent.skillGraph refusals — one agent, one graph', () => {
  const g1 = () => skillGraph({ skills: [skill('a'), skill('b')], start: 'a', check: 'off' });
  const g2 = () => skillGraph({ skills: [skill('c'), skill('d')], start: 'c', check: 'off' });

  it('refuses the second mount', () => {
    expect(() => agent().skillGraph(g1()).skillGraph(g2())).toThrow(
      'Agent.skillGraph(): a skill graph is already mounted, and one agent routes with ' +
        'ONE graph. The second call replaces the cursor, the reachable set and the entry ' +
        "scorer — the first graph's skills stay registered and active, so its own routes " +
        'could never fire again. Merge the two graphs into one skillGraph(...) ' +
        'declaration, or build one agent per graph.',
    );
  });

  it('refuses re-mounting the SAME graph twice (a duplicate is still a second graph)', () => {
    const g = g1();
    expect(() => agent().skillGraph(g).skillGraph(g)).toThrow(/one agent routes with ONE graph/);
  });

  it('one graph plus ordinary .skill() registrations still builds', () => {
    const built = agent()
      .skillGraph(g1())
      .skill(skill('helper'))
      .skills({ list: () => [skill('other')] })
      .build();
    expect(built).toBeDefined();
  });
});

// ── 5. duplicate skill id inside one graph ───────────────────────────────────

describe('skillGraph refusals — two skills, one id', () => {
  it('refuses a duplicate in the config skills[] (naming both by description)', () => {
    const first = skill('alpha', 'Alpha skill about refunds');
    const second = skill('alpha', 'DIFFERENT alpha');
    expect(() => skillGraph({ skills: [first, second], start: 'alpha', check: 'off' })).toThrow(
      'skillGraph: two different skills claim the id "alpha" — "Alpha skill about refunds" ' +
        'and "DIFFERENT alpha". Skill ids must be unique (read_skill dispatches by id, and ' +
        'every edge routes by id); rename one, or pass the SAME skill object to both places.',
    );
  });

  it('refuses a duplicate arriving through the fluent entry/route calls', () => {
    const first = skill('a', 'FIRST');
    const second = skill('a', 'SECOND');
    const b = skill('b');
    expect(() =>
      skillGraph().entry(first).route(second, b, { onToolReturn: 't' }).build({ check: 'off' }),
    ).toThrow(/two different skills claim the id "a" — "FIRST" and "SECOND"/);
  });

  it('refuses a duplicate arriving as two tree leaves', () => {
    const first = skill('leaf', 'FIRST');
    const second = skill('leaf', 'SECOND');
    expect(() =>
      skillGraph().tree(decideSkill(yes, first, second)).build({ check: 'off' }),
    ).toThrow(/two different skills claim the id "leaf" — "FIRST" and "SECOND"/);
  });

  it('falls back to a placeholder when a skill has no description', () => {
    const bare = { ...skill('x'), description: undefined };
    const other = skill('x', 'OTHER');
    expect(() => skillGraph({ skills: [bare, other], start: 'x', check: 'off' })).toThrow(
      /claim the id "x" — "\(no description\)" and "OTHER"/,
    );
  });

  it('the SAME object re-registered is not a duplicate (entry + route)', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 't' }).build({ check: 'off' });
    expect(g.skills.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('the SAME object at two tree leaves still merges into ONE ORed leaf', () => {
    const shared = skill('shared');
    const other = skill('other');
    const g = skillGraph()
      .tree(
        decideSkill(
          (c: InjectionContext) => /x/.test(c.userMessage),
          shared,
          decideSkill((c: InjectionContext) => /y/.test(c.userMessage), shared, other, 'y?'),
          'x?',
        ),
      )
      .build({ check: 'off' });
    expect(g.skills.map((s) => s.id)).toEqual(['shared', 'other']);
    const routing = g.skills.find((s) => s.id === 'shared')!.metadata as {
      skillGraph: { paths?: unknown[] };
    };
    expect(routing.skillGraph.paths).toHaveLength(2);
  });

  it('still refuses a non-skill leaf with the leaf-specific message', () => {
    const ok = skill('ok');
    const instr = defineInstruction({ id: 'i', prompt: 'p', activeWhen: yes });
    expect(() =>
      skillGraph()
        .tree(decideSkill(yes, ok, instr as never))
        .build({ check: 'off' }),
    ).toThrow(/skillGraph\.tree: leaf "i" is not a skill/);
  });
});

// ── byte-identity for valid declarations ─────────────────────────────────────

describe('skillGraph refusals — valid graphs compile exactly as before', () => {
  it('a flat graph compiles to the same skills, edges, nodes, triggers and drawing', () => {
    const triage = skill('triage');
    const lookup = skill('lookup');
    const audit = skill('audit');
    const g = skillGraph({
      skills: [triage, lookup, audit],
      start: 'triage',
      steps: [
        { from: 'triage', to: 'lookup', onToolReturn: 'probe', label: 'on probe' },
        { from: 'lookup', to: 'audit', when: (r) => r.result.includes('ok') },
      ],
      check: 'throw',
    });
    expect(g.skills.map((s) => [s.id, s.trigger.kind])).toEqual([
      ['triage', 'always'],
      ['lookup', 'rule'],
      ['audit', 'rule'],
    ]);
    expect(g.edges).toEqual([
      { from: null, to: 'triage', kind: 'entry', label: undefined },
      { from: 'triage', to: 'lookup', kind: 'on-tool-return', label: 'on probe' },
      { from: 'lookup', to: 'audit', kind: 'predicate', label: undefined },
    ]);
    expect(g.nodes).toEqual([
      { id: 'triage', kind: 'skill', label: 'triage' },
      { id: 'lookup', kind: 'skill', label: 'lookup' },
      { id: 'audit', kind: 'skill', label: 'audit' },
    ]);
    // successors ∪ entries, minus the cursor itself — unchanged by 8.4.0.
    expect(g.reachableSkills('triage')).toEqual(['lookup']);
    expect(g.reachableSkills('lookup')).toEqual(['audit', 'triage']);
    expect(g.reachableSkills()).toEqual(['triage']);
    expect(g.toMermaid()).toBe(
      [
        'flowchart TD',
        '  __start__([▶ start])',
        '  n_triage["triage"]',
        '  n_lookup["lookup"]',
        '  n_audit["audit"]',
        '  __start__ --> n_triage',
        '  n_triage -->|on probe| n_lookup',
        '  n_lookup --> n_audit',
      ].join('\n'),
    );
  });

  it('a tree graph compiles to the same leaves, edges and drawing', () => {
    const io = skill('io');
    const tri = skill('tri');
    const g = skillGraph({
      skills: [io, tri],
      tree: decideSkill((c: InjectionContext) => /io/.test(c.userMessage), io, tri, 'io?'),
      check: 'throw',
    });
    expect(g.skills.map((s) => [s.id, s.trigger.kind])).toEqual([
      ['io', 'rule'],
      ['tri', 'rule'],
    ]);
    expect(g.nodes).toEqual([
      { id: 'd0', kind: 'predicate', label: 'io?' },
      { id: 'io', kind: 'skill', label: 'io' },
      { id: 'tri', kind: 'skill', label: 'tri' },
    ]);
    expect(g.toMermaid()).toBe(
      [
        'flowchart TD',
        '  __start__([▶ start])',
        '  d0{"io?"}',
        '  n_io["io"]',
        '  n_tri["tri"]',
        '  __start__ --> d0',
        '  d0 -->|yes| n_io',
        '  d0 -->|no| n_tri',
      ].join('\n'),
    );
  });

  it('a fluent .tree() now runs the skill-contract checks it always skipped', () => {
    // Until 8.4.0 the fluent form never registered its leaves, so `checkup()`
    // answered `{ ok: true, problems: [] }` for a body calling a tool that exists
    // nowhere — while the byte-identical config form reported it.
    const bad = defineSkill({
      id: 'bad',
      description: 'b',
      body: 'First call not_a_real_tool(id) then answer.',
    });
    const other = skill('other');
    const fluent = skillGraph().tree(decideSkill(yes, bad, other)).build({ check: 'off' });
    const config = skillGraph({
      skills: [bad, other],
      tree: decideSkill(yes, bad, other),
      check: 'off',
    });
    expect(fluent.checkup().problems.map((p) => p.code)).toEqual(['body-unknown-tool']);
    expect(fluent.checkup()).toEqual(config.checkup());
    expect(fluent.checkup().ok).toBe(true); // a contract finding is a WARNING
  });
});

// ── 5. viaToolName: a door that was never built (8.7.0) ──────────────────────

describe('viaToolName other than read_skill is refused at mount', () => {
  const custom = () =>
    defineSkill({
      id: 'custom',
      description: 'use custom',
      body: 'b',
      viaToolName: 'open_playbook',
    });

  it('unit: .skill() refuses it, naming the field and the fix', () => {
    expect(() => agent().skill(custom())).toThrow(/viaToolName is 'open_playbook'/);
    expect(() => agent().skill(custom())).toThrow(/removed in 9\.0\.0/);
  });

  it('unit: every mounting door funnels through injection(), so all of them refuse', () => {
    const make = agent;
    expect(() => make().injection(custom())).toThrow(/read_skill/);
    expect(() => make().skills({ list: () => [custom()] })).toThrow(/read_skill/);
    // An UNWIRED graph skill keeps the trigger it arrived with, so it still refuses.
    const unwired = skillGraph({
      skills: [skill('a'), custom()],
      start: 'a',
      check: 'off',
    });
    expect(() => make().skillGraph(unwired)).toThrow(/read_skill/);
  });

  it('functional: a graph that COMPILES the trigger away has nothing left to refuse', () => {
    // `.entry()` replaces the trigger with `always`, so `viaToolName` is not merely
    // unread there — it is gone. Refusing would be refusing a field that no longer
    // exists on the injection the agent receives.
    const asEntry = skillGraph({ skills: [custom()], start: 'custom', check: 'off' });
    expect(asEntry.skills[0]!.trigger.kind).toBe('always');
    expect(() => agent().skillGraph(asEntry).build()).not.toThrow();
  });

  it("functional: the default 'read_skill' is untouched, explicit or not", () => {
    const implicit = defineSkill({ id: 'a', description: 'use a', body: 'a' });
    const explicit = defineSkill({
      id: 'b',
      description: 'use b',
      body: 'b',
      viaToolName: 'read_skill',
    });
    expect(() => agent().skill(implicit).skill(explicit).build()).not.toThrow();
  });

  it('functional: non-skill flavors are unaffected (they have no llm-activated trigger)', () => {
    expect(() =>
      agent()
        .instruction(defineInstruction({ id: 'i', when: yes, prompt: 'x' }))
        .build(),
    ).not.toThrow();
  });

  it('security: the refusal quotes the offending name, and nothing from the body', () => {
    const secret = defineSkill({
      id: 'x',
      description: 'd',
      body: 'INTERNAL ESCALATION PROCEDURE',
      viaToolName: 'open_x',
    });
    try {
      agent().skill(secret);
      expect.unreachable('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('open_x');
      expect(message).not.toContain('INTERNAL ESCALATION PROCEDURE');
    }
  });
});
