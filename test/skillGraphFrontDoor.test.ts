/**
 * The skill graph's front door (SG-A) — four things a graph author asked for at
 * the point where a turn ENTERS the graph:
 *
 *   1. **`scopeTools` on the FLAT arm.** `skillGraph({ skills, start, steps,
 *      scopeTools: true })` stamps `autoActivate: 'currentSkill'` on every WIRED
 *      skill, exactly as a decision `.tree()` already stamps its leaves — tools
 *      follow the cursor instead of landing in the always-on registry. Default
 *      `false` (today's bytes; 10.0.0 flips the default). A skill's own explicit
 *      `autoActivate` always wins — the graph level is a default, not an override.
 *   2. **Matchers as DATA.** A start rule may say `match: /refund/i` or
 *      `match: { keywords: [...] }` instead of an opaque `when` predicate —
 *      exactly one of the two per rule. Data can be compared, drawn and stored:
 *      the check-up gets two new pairwise checks, `toMermaid()` captions the
 *      entry edge, and the compiled skill's provenance carries the matcher.
 *   3. **Check-up additions.** `rule-id-exists` (ERROR, thrown at build — a rule
 *      naming an unknown skill cannot compile under any `check` mode),
 *      `overlapping-rules` + `rules-shadowed-by-order` (WARNINGS, only for what
 *      the data PROVES; `when` predicates are opaque and the messages say so).
 *      Plus the pin: a rule-router where EVERY entry carries a `when` or `match`
 *      never trips `multi-entry-fanout`.
 *   4. **`knownTools` becomes automatic.** A graph built WITHOUT `knownTools`
 *      defers its body-contract checks (it cannot tell a typo from a baseline
 *      tool the agent registers later); the note rides the graph AND each
 *      compiled skill's metadata, so Agent build runs them once against the full
 *      registry whichever door the skills arrive through — `.skillGraph(graph)`
 *      or `.skills({ list: () => graph.skills })`. One problem, one report —
 *      never both build points. `graph.checkup()` is untouched.
 *
 * 7 test types per Convention 3: unit (each behavior alone), functional
 * (byte-identical-when-unused), integration (through a real Agent + the tool
 * registry), property (disjoint routers never trip the new codes), security
 * (keywords are literals, never patterns), performance/load (a 200-rule router).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { defineTool, Agent } from '../src/index.js';
import {
  skillGraph,
  decideSkill,
  defineSkill,
  keywordScorer,
  type Injection,
  type GraphProblemCode,
  type SkillMatchData,
  type SkillRouting,
} from '../src/doors/context.js';
import { mock } from '../src/doors/providers.js';
import { buildToolRegistry } from '../src/core/agent/buildToolRegistry.js';
import type { InjectionContext } from '../src/lib/injection-engine/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

const skill = (id: string, body = `${id} body`): Injection =>
  defineSkill({ id, description: `use ${id}`, body, tools: [tool(`${id}_tool`)] });

/** A skill with NO tools — bodies under test name tools on purpose. */
const bareSkill = (id: string, body: string): Injection =>
  defineSkill({ id, description: `use ${id}`, body });

const ctx = (over: Partial<InjectionContext> = {}): InjectionContext => ({
  iteration: 1,
  userMessage: 'q',
  history: [],
  activatedInjectionIds: [],
  ...over,
});

const codesOf = (g: {
  checkup(): { problems: readonly { code: GraphProblemCode }[] };
}): GraphProblemCode[] => g.checkup().problems.map((p) => p.code);

const problemsOf = (
  g: { checkup(): { problems: readonly { code: GraphProblemCode; message: string }[] } },
  code: GraphProblemCode,
) => g.checkup().problems.filter((p) => p.code === code);

const autoOf = (inj: { metadata?: Record<string, unknown> }) => inj.metadata?.autoActivate;

const matchOf = (inj: { metadata?: Record<string, unknown> }): SkillMatchData | undefined =>
  (inj.metadata?.skillGraph as SkillRouting | undefined)?.match;

afterEach(() => {
  disableDevMode();
  vi.restoreAllMocks();
});

// ═══ 1. scopeTools on the flat arm ═══════════════════════════════════════════

describe('scopeTools on the flat arm — tools follow the cursor', () => {
  const flat = (scopeTools?: boolean) =>
    skillGraph({
      skills: [skill('triage'), skill('billing'), skill('refunds'), skill('lonely')],
      start: 'triage',
      steps: [{ from: 'triage', to: 'billing', onToolReturn: 'triage_tool' }],
      ...(scopeTools !== undefined && { scopeTools }),
      check: 'off',
    });

  it('unit: scopeTools:true stamps autoActivate on every WIRED skill (entry + both route ends)', () => {
    const g = flat(true);
    expect(autoOf(g.skills.find((s) => s.id === 'triage')!)).toBe('currentSkill');
    expect(autoOf(g.skills.find((s) => s.id === 'billing')!)).toBe('currentSkill');
  });

  it('unit: a listed-but-UNWIRED skill is not stamped — the graph does not route it, so it does not scope it', () => {
    const g = flat(true);
    expect(autoOf(g.skills.find((s) => s.id === 'lonely')!)).toBeUndefined();
  });

  it("unit: a skill's own explicit autoActivate is kept when the graph says scopeTools:false (default fills, never overrides)", () => {
    const explicit = defineSkill({
      id: 'stubborn',
      description: 'use stubborn',
      body: 'stubborn body',
      tools: [tool('stubborn_tool')],
      autoActivate: 'currentSkill',
    });
    const g = skillGraph({
      skills: [explicit, skill('open')],
      start: 'stubborn',
      steps: [{ from: 'stubborn', to: 'open', onToolReturn: 'stubborn_tool' }],
      scopeTools: false,
      check: 'off',
    });
    expect(autoOf(g.skills.find((s) => s.id === 'stubborn')!)).toBe('currentSkill');
    expect(autoOf(g.skills.find((s) => s.id === 'open')!)).toBeUndefined();
  });

  it('functional: omitted and scopeTools:false compile BYTE-IDENTICAL metadata (zero-cost-when-unused)', () => {
    const plain = flat();
    const explicitOff = flat(false);
    expect(plain.skills.map((s) => s.metadata)).toEqual(explicitOff.skills.map((s) => s.metadata));
    for (const s of plain.skills) {
      expect(Object.keys(s.metadata as object)).not.toContain('autoActivate');
    }
  });

  it('unit: the fluent form takes the same dial on .build({ scopeTools })', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'a_tool' })
      .build({ check: 'off', scopeTools: true });
    expect(autoOf(g.skills.find((s) => s.id === 'a')!)).toBe('currentSkill');
    expect(autoOf(g.skills.find((s) => s.id === 'b')!)).toBe('currentSkill');
  });

  it('refusal: .tree(...).build({ scopeTools }) is refused — one dial, one home (the tree declares it on .tree())', () => {
    expect(() =>
      skillGraph()
        .tree(decideSkill(() => true, skill('x'), skill('y')))
        .build({ scopeTools: false }),
    ).toThrow(/FLAT arm's dial[\s\S]*\.tree\(root, \{ scopeTools \}\)/);
  });

  it('integration: scoped tools stay OUT of the static registry and stay dispatchable by name', () => {
    const g = flat(true);
    const arts = buildToolRegistry([], g.skills);
    const staticNames = arts.augmentedRegistry.map((e) => e.name);
    // Wired skills' tools are held back for the tools slot…
    expect(staticNames).not.toContain('triage_tool');
    expect(staticNames).not.toContain('billing_tool');
    // …the unwired skill keeps today's additive behavior…
    expect(staticNames).toContain('lonely_tool');
    // …and every tool is still findable when the LLM calls it by name.
    expect(arts.registryByName.has('triage_tool')).toBe(true);
    expect(arts.registryByName.has('billing_tool')).toBe(true);
  });

  it('integration: an agent with a scoped flat graph still builds and answers', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .skillGraph(flat(true))
      .build();
    await expect(agent.run({ message: 'hello' })).resolves.toBe('done');
  });

  it('unit: the tree arm keeps its existing scopeTools semantics untouched', () => {
    const l1 = skill('l1');
    const l2 = skill('l2');
    const g = skillGraph({
      skills: [l1, l2],
      tree: decideSkill(() => true, l1, l2),
      check: 'off',
    });
    for (const s of g.skills) expect(autoOf(s)).toBe('currentSkill'); // tree default true, as before
  });
});

// ═══ 2. matchers as data ═════════════════════════════════════════════════════

describe('match — start rules declared as data', () => {
  const rulesGraph = () =>
    skillGraph({
      skills: [skill('refunds'), skill('billing'), skill('triage')],
      start: {
        rules: [
          { match: /refund/i, use: 'refunds' },
          { match: { keywords: ['charge', 'billing statement'] }, use: 'billing' },
          { when: (c) => c.userMessage.includes('escalate'), use: 'triage' },
        ],
      },
      check: 'off',
    });

  it('unit: a RegExp matcher routes the cold start by testing the user message', () => {
    const g = rulesGraph();
    expect(g.nextSkill(ctx({ userMessage: 'I want a REFUND now' }))).toBe('refunds');
    // The author's regex is a substring test unless the author anchors it:
    expect(g.nextSkill(ctx({ userMessage: 'refunds please' }))).toBe('refunds');
    expect(g.nextSkill(ctx({ userMessage: 'nothing relevant' }))?.length).toBeUndefined();
  });

  it('unit: keywords match ANY keyword, case-insensitively, whole-word at word edges', () => {
    const g = rulesGraph();
    expect(g.nextSkill(ctx({ userMessage: 'a CHARGE appeared' }))).toBe('billing');
    // multi-word keyword matches as a phrase
    expect(g.nextSkill(ctx({ userMessage: 'my billing statement is wrong' }))).toBe('billing');
    // whole-word: 'charge' must not fire inside 'charger'
    expect(g.nextSkill(ctx({ userMessage: 'my charger broke' }))).toBeUndefined();
    // …and `when` rules still work beside data rules
    expect(g.nextSkill(ctx({ userMessage: 'please escalate' }))).toBe('triage');
  });

  it('unit: a /g regex cannot alternate — stateful flags are dropped at compile time', () => {
    const g = skillGraph({
      skills: [skill('a')],
      start: { rules: [{ match: /pay/gi, use: 'a' }] },
      check: 'off',
    });
    const m = ctx({ userMessage: 'pay pay' });
    expect(g.nextSkill(m)).toBe('a');
    expect(g.nextSkill(ctx({ userMessage: 'pay pay' }))).toBe('a'); // same answer, always
    expect(matchOf(g.skills[0]!)).toEqual({ kind: 'regex', source: 'pay', flags: 'i' });
  });

  it('refusal: a rule with BOTH match and when names the rule and the fix', () => {
    expect(() =>
      skillGraph({
        skills: [skill('a')],
        start: {
          rules: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { match: /x/, when: () => true, use: 'a' } as any,
          ],
        },
      }),
    ).toThrow(/start\.rules\[0\] \(use: "a"\) sets both `match` and `when`[\s\S]*exactly one/);
  });

  it('refusal: a rule with NEITHER match nor when names the rule and the unconditional alternative', () => {
    expect(() =>
      skillGraph({
        skills: [skill('a')],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        start: { rules: [{ use: 'a' } as any] },
      }),
    ).toThrow(/sets neither `match` nor `when`[\s\S]*start: 'a'/);
  });

  it('refusal: a matcher shape the library cannot honor names the forms that ARE supported', () => {
    expect(() =>
      skillGraph({
        skills: [skill('a')],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        start: { rules: [{ match: { intent: 'refund' } as any, use: 'a' }] },
      }),
    ).toThrow(/cannot honor[\s\S]*RegExp[\s\S]*keywords/);
    expect(() =>
      skillGraph({
        skills: [skill('a')],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        start: { rules: [{ match: { keywords: [] } as any, use: 'a' }] },
      }),
    ).toThrow(/cannot honor/);
  });

  it('refusal: the fluent .entry() takes match too, and refuses match+when the same way', () => {
    const a = skill('a');
    const g = skillGraph()
      .entry(a, { match: { keywords: ['refund'] } })
      .build({ check: 'off' });
    expect(g.nextSkill(ctx({ userMessage: 'refund me' }))).toBe('a');
    expect(() => skillGraph().entry(skill('b'), { match: /x/, when: () => true })).toThrow(
      /entry "b" sets both `match` and `when`/,
    );
  });

  it('provenance: the compiled skill and the entry edge both carry the matcher DATA', () => {
    const g = rulesGraph();
    expect(matchOf(g.skills.find((s) => s.id === 'refunds')!)).toEqual({
      kind: 'regex',
      source: 'refund',
      flags: 'i',
    });
    expect(matchOf(g.skills.find((s) => s.id === 'billing')!)).toEqual({
      kind: 'keywords',
      keywords: ['charge', 'billing statement'],
    });
    // `when` rules stay opaque — no fabricated match data.
    expect(matchOf(g.skills.find((s) => s.id === 'triage')!)).toBeUndefined();
    const edge = g.edges.find((e) => e.to === 'refunds' && e.kind === 'entry');
    expect(edge?.match).toEqual({ kind: 'regex', source: 'refund', flags: 'i' });
  });

  it('toMermaid: entry edges are captioned with the matcher; an explicit label still wins', () => {
    const g = rulesGraph();
    const m = g.toMermaid();
    expect(m).toContain('__start__ -->|/refund/i| n_refunds');
    expect(m).toContain('__start__ -->|charge, billing statement| n_billing');
    // the `when` rule's edge keeps no caption — the predicate is opaque
    expect(m).toContain('__start__ --> n_triage');

    const labeled = skillGraph()
      .entry(skill('x'), { match: /pay/, label: 'payments' })
      .build({ check: 'off' })
      .toMermaid();
    expect(labeled).toContain('|payments|');
    expect(labeled).not.toContain('/pay/');
  });

  it('toMermaid: a `|` inside a regex or keyword becomes a mermaid entity, never a broken label', () => {
    const g = skillGraph({
      skills: [skill('a')],
      start: { rules: [{ match: /refund|billing/, use: 'a' }] },
      check: 'off',
    });
    const m = g.toMermaid();
    expect(m).toContain('|/refund#124;billing/|');
    expect(m).not.toContain('|/refund|billing/|');
  });

  it('toMermaid: a wide keyword list is shortened to three + a count', () => {
    const g = skillGraph()
      .entry(skill('k'), { match: { keywords: ['a', 'b', 'c', 'd', 'e'] } })
      .build({ check: 'off' });
    expect(g.toMermaid()).toContain('|a, b, c, +2 more|');
  });

  it('functional: supersededEntries reports a match rule suppressed by the cursor, like any conditional entry', () => {
    const g = rulesGraph();
    expect(
      g.supersededEntries(ctx({ currentSkillId: 'billing', userMessage: 'refund please' })),
    ).toEqual(['refunds']);
  });
});

// ═══ 3. check-up additions + the fan-out pin ═════════════════════════════════

describe('rule-id-exists — a start rule naming an unknown skill is refused, with every bad id listed', () => {
  it('unit: throws at build with the code, ALL unknown ids, and the known catalog', () => {
    let message = '';
    try {
      skillGraph({
        skills: [skill('real')],
        start: {
          rules: [
            { match: /x/, use: 'ghost' },
            { when: () => true, use: 'phantom' },
          ],
        },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('rule-id-exists');
    expect(message).toContain('start.rules[0] routes to skill "ghost"');
    expect(message).toContain('start.rules[1] routes to skill "phantom"');
    expect(message).toContain('Known skill ids: "real"');
  });

  it("unit: refused under check:'off' too — a rule that cannot compile is never silently dropped", () => {
    expect(() =>
      skillGraph({
        skills: [skill('real')],
        start: { rules: [{ match: /x/, use: 'ghost' }] },
        check: 'off',
      }),
    ).toThrow(/rule-id-exists/);
  });
});

describe('overlapping-rules / rules-shadowed-by-order — only what the data proves', () => {
  const rules = (
    list: ReadonlyArray<{ id: string; match?: RegExp | { keywords: string[] } }>,
    exclusive = false,
  ) => {
    const g = skillGraph().entry(
      skill(list[0]!.id),
      list[0]!.match ? { match: list[0]!.match } : undefined,
    );
    for (const item of list.slice(1)) {
      g.entry(skill(item.id), item.match ? { match: item.match } : undefined);
    }
    if (exclusive) g.entryBy(keywordScorer());
    return g.build({ check: 'off' });
  };

  it('unit: two keyword rules sharing a keyword → overlapping-rules, naming the shared keyword and the honesty boundary', () => {
    const g = rules([
      { id: 'a', match: { keywords: ['refund', 'money'] } },
      { id: 'b', match: { keywords: ['refund', 'card'] } },
    ]);
    const [p] = problemsOf(g, 'overlapping-rules');
    expect(p).toBeDefined();
    expect(p!.message).toContain('"refund"');
    expect(p!.message).toContain('"a" wins');
    expect(p!.message).toMatch(/`when` predicates are opaque and were NOT checked/);
    expect(codesOf(g)).not.toContain('rules-shadowed-by-order'); // overlap, not shadow — b can win on "card"
  });

  it('unit: an earlier keyword-SUPERSET shadows the later rule (any-keyword matching)', () => {
    const g = rules([
      { id: 'a', match: { keywords: ['Refund', 'card'] } },
      { id: 'b', match: { keywords: ['refund'] } }, // ⊆ a, case-insensitively
    ]);
    const [p] = problemsOf(g, 'rules-shadowed-by-order');
    expect(p).toBeDefined();
    expect(p!.message).toContain('"b" can never be chosen');
    expect(p!.message).toContain('declaration');
    // a shadowed pair is reported once, as the stronger claim — never also as overlap
    expect(codesOf(g)).not.toContain('overlapping-rules');
  });

  it('unit: the identical regex earlier shadows; different flags or sources prove nothing and stay silent', () => {
    const shadowed = rules([
      { id: 'a', match: /pay/i },
      { id: 'b', match: /pay/i },
    ]);
    expect(problemsOf(shadowed, 'rules-shadowed-by-order')[0]!.message).toContain(
      'identical regex /pay/i',
    );

    const flagsDiffer = rules([
      { id: 'a', match: /pay/ },
      { id: 'b', match: /pay/i },
    ]);
    expect(codesOf(flagsDiffer)).not.toContain('rules-shadowed-by-order');
    expect(codesOf(flagsDiffer)).not.toContain('overlapping-rules');

    const sourcesDiffer = rules([
      { id: 'a', match: /pay|refund/ },
      { id: 'b', match: /payment/ },
    ]);
    expect(codesOf(sourcesDiffer)).not.toContain('rules-shadowed-by-order');
    expect(codesOf(sourcesDiffer)).not.toContain('overlapping-rules');
  });

  it('unit: unlike kinds (regex vs keywords) and opaque `when` predicates are never compared', () => {
    const mixed = rules([
      { id: 'a', match: /refund/ },
      { id: 'b', match: { keywords: ['refund'] } },
    ]);
    expect(codesOf(mixed)).not.toContain('overlapping-rules');
    expect(codesOf(mixed)).not.toContain('rules-shadowed-by-order');

    const samePredicate = (c: InjectionContext) => c.userMessage.includes('refund');
    const opaque = skillGraph()
      .entry(skill('a'), { when: samePredicate })
      .entry(skill('b'), { when: samePredicate }) // literally the same fn — still opaque
      .build({ check: 'off' });
    expect(codesOf(opaque)).not.toContain('overlapping-rules');
    expect(codesOf(opaque)).not.toContain('rules-shadowed-by-order');
  });

  it('unit: silent under exclusive entries — a scorer ranks ALL matching candidates, order does not shadow', () => {
    const g = rules(
      [
        { id: 'a', match: { keywords: ['refund'] } },
        { id: 'b', match: { keywords: ['refund'] } },
      ],
      true,
    );
    expect(codesOf(g)).not.toContain('overlapping-rules');
    expect(codesOf(g)).not.toContain('rules-shadowed-by-order');
  });
});

describe('multi-entry-fanout — the pin: rule-routers are a supported design', () => {
  it('functional: a menu where EVERY entry carries a when or a match never warns', () => {
    const allWhen = skillGraph({
      skills: [skill('a'), skill('b')],
      start: {
        rules: [
          { when: (c) => c.userMessage.includes('x'), use: 'a' },
          { when: (c) => c.userMessage.includes('y'), use: 'b' },
        ],
      },
      check: 'off',
    });
    expect(codesOf(allWhen)).not.toContain('multi-entry-fanout');

    const allMatch = skillGraph({
      skills: [skill('a'), skill('b'), skill('c')],
      start: {
        rules: [
          { match: /x/, use: 'a' },
          { match: { keywords: ['y'] }, use: 'b' },
          { match: /z/, use: 'c' },
        ],
      },
      check: 'off',
    });
    expect(codesOf(allMatch)).not.toContain('multi-entry-fanout');
  });

  it('functional: one unconditional entry beside the rules still warns, naming only the unconditional one', () => {
    const g = skillGraph()
      .entry(skill('base')) // no when, no match — always-on
      .entry(skill('a'), { match: /x/ })
      .build({ check: 'off' });
    const [p] = problemsOf(g, 'multi-entry-fanout');
    expect(p).toBeDefined();
    expect(p!.skill).toBe('base');
    expect(p!.message).toContain('"base"');
  });
});

// ═══ 4. knownTools becomes automatic ═════════════════════════════════════════

describe('deferred body-contract checks — the graph waits for the one build point that can see the registry', () => {
  const lookupOrder = tool('lookup_order');

  it('unit: built WITHOUT knownTools → the graph carries the note, and its own pass reports no body-contract problem', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lookup_order(id), then answer.')],
      start: 's',
    });
    expect(g.deferredBodyContract).toEqual({ mode: 'throw' });
    expect(warn.mock.calls.flat().join('\n')).not.toContain('body-unknown-tool');
  });

  it('unit: built WITH knownTools → the checks run at graph build (the override stays an override), no note is left', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lokup_order(id).')],
      start: 's',
      knownTools: ['lookup_order'],
    });
    expect(g.deferredBodyContract).toBeUndefined();
    expect(warn.mock.calls.flat().join('\n')).toContain('body-unknown-tool');
  });

  it("unit: check:'off' leaves no note — the opt-out is respected at BOTH build points", () => {
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lokup_order(id).')],
      start: 's',
      check: 'off',
    });
    expect(g.deferredBodyContract).toBeUndefined();
  });

  it("unit: check:'warn' defers with its own severity", () => {
    const g = skillGraph({
      skills: [bareSkill('s', 's body')],
      start: 's',
      check: 'warn',
    });
    expect(g.deferredBodyContract).toEqual({ mode: 'warn' });
  });

  it('unit: the note RIDES each compiled skill (metadata), so it survives doors that never see the graph object', () => {
    const noteOf = (inj: { metadata?: Record<string, unknown> }) =>
      inj.metadata?.skillGraphDeferredBodyContract;
    const deferred = skillGraph({ skills: [bareSkill('s', 's body')], start: 's' });
    expect(noteOf(deferred.skills[0]!)).toEqual({ mode: 'throw' });
    const ran = skillGraph({
      skills: [bareSkill('s', 's body')],
      start: 's',
      knownTools: ['lookup_order'],
    });
    expect(noteOf(ran.skills[0]!)).toBeUndefined(); // checks already ran — no stamp
    const off = skillGraph({ skills: [bareSkill('s', 's body')], start: 's', check: 'off' });
    expect(noteOf(off.skills[0]!)).toBeUndefined(); // opted out — no stamp
  });

  it('integration: the .skills({ list: () => graph.skills }) door — the OTHER documented attachment — still runs the deferred checks at agent build', () => {
    // The docstring on SkillGraph.skills names two doors; this is the one that
    // never sees the graph object, so only the per-skill note can serve it.
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lookup_order(id) first; on failure call lokup_order(id).')],
      start: 's',
    });
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .tool(lookupOrder)
      .skills({ list: () => g.skills })
      .build();
    const out = warn.mock.calls.flat().join('\n');
    expect(out).not.toMatch(/body-unknown-tool[^\n]*"lookup_order"/); // baseline resolved
    expect(out).toMatch(/body-unknown-tool[^\n]*"lokup_order"/); // the typo, found
    expect(out.match(/body-unknown-tool/g)).toHaveLength(1); // exactly once
  });

  it('integration: NO double report when the same skills carry the note AND the graph note arrives via .skillGraph() (dedup by id)', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lokup_order(id).')],
      start: 's',
    });
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .skillGraph(g)
      .build();
    // .skillGraph() supplies BOTH sources — the per-skill metadata and the captured
    // graph-level note. One problem, one report.
    expect(
      warn.mock.calls
        .flat()
        .join('\n')
        .match(/body-unknown-tool/g),
    ).toHaveLength(1);
  });

  it('functional: graph-only linting is NOT worse — graph.checkup() still reports with what it can see', () => {
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lookup_order(id).')],
      start: 's',
    });
    // The explicit lint call cannot see the agent, says so by reporting the name…
    expect(problemsOf(g, 'body-unknown-tool')).toHaveLength(1);
    // …and takes the manual override exactly as before.
    expect(g.checkup({ knownTools: ['lookup_order'] }).problems).toHaveLength(0);
  });

  it('integration: agent build DISCOVERS a real typo the graph build could not see — and clears the baseline tool it also could not see', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lookup_order(id) first; on failure call lokup_order(id).')],
      start: 's',
    });
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .tool(lookupOrder)
      .skillGraph(g)
      .build();
    const out = warn.mock.calls.flat().join('\n');
    // The registered baseline tool is known — NOT a typo…
    expect(out).not.toMatch(/body-unknown-tool[^\n]*"lookup_order"/);
    // …the real typo is reported, exactly once, at the agent build point.
    expect(out).toMatch(/body-unknown-tool[^\n]*"lokup_order"/);
    expect(out.match(/body-unknown-tool/g)).toHaveLength(1);
  });

  it('integration: NO double report — a graph that ran its checks (knownTools given) is never re-checked at agent build', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lokup_order(id).')],
      start: 's',
      knownTools: ['lookup_order'],
    });
    const graphBuildReports = warn.mock.calls
      .flat()
      .join('\n')
      .match(/body-unknown-tool/g);
    expect(graphBuildReports).toHaveLength(1); // reported at graph build…
    warn.mockClear();
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .tool(lookupOrder)
      .skillGraph(g)
      .build();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('body-unknown-tool'); // …never again
  });

  it('integration: a clean body stays silent at agent build (no warning invented from the union)', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lookup_order(id), or hand off with read_skill(other).')],
      start: 's',
    });
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .tool(lookupOrder)
      .skillGraph(g)
      .build();
    // read_skill is auto-attached whenever a skill exists — a hand-off hint is not a typo.
    expect(warn.mock.calls.flat().join('\n')).not.toContain('body-unknown-tool');
  });

  it("integration: a NON-graph skill's tools exist on the agent — a graph body naming one is not 'nonexistent'", () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sideSkill = skill('side'); // carries side_tool
    const g = skillGraph({
      skills: [bareSkill('s', 'If side work is needed, use side_tool(x).')],
      start: 's',
    });
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .skillGraph(g)
      .skill(sideSkill)
      .build();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('body-unknown-tool');
  });

  it('functional: a graph object from an older build (no note) changes nothing at agent build', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .skillGraph({
        skills: [bareSkill('legacy', 'Call lokup_order(id).')],
        nextSkill: () => undefined,
      })
      .build();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('body-unknown-tool');
  });

  it("functional: outside dev mode the deferred run is silent (warnings honor the graph's 'throw'/'warn' surface exactly like graph build)", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = skillGraph({
      skills: [bareSkill('s', 'Call lokup_order(id).')],
      start: 's',
    });
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
        .skillGraph(g)
        .build(),
    ).not.toThrow(); // contract problems are warnings — 'throw' mode throws only on errors
    expect(warn.mock.calls.flat().join('\n')).not.toContain('body-unknown-tool');
  });
});

// ═══ property / security / performance / load ════════════════════════════════

describe('front door — property, security, performance, load', () => {
  it('property: routers with pairwise-DISJOINT keywords never trip the new codes (30 random graphs)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const n = 2 + (seed % 4);
      const ruleList = Array.from({ length: n }, (_, i) => ({
        match: { keywords: [`kw${seed}x${i}a`, `kw${seed}x${i}b`] },
        use: `s${i}`,
      }));
      const g = skillGraph({
        skills: Array.from({ length: n }, (_, i) => skill(`s${i}`)),
        start: { rules: ruleList },
        check: 'off',
      });
      const found = codesOf(g);
      expect(found).not.toContain('overlapping-rules');
      expect(found).not.toContain('rules-shadowed-by-order');
      expect(found).not.toContain('multi-entry-fanout');
    }
  });

  it('security: keywords are LITERALS — regex metacharacters never become patterns', () => {
    const g = skillGraph({
      skills: [skill('a')],
      start: { rules: [{ match: { keywords: ['a.*b'] }, use: 'a' }] },
      check: 'off',
    });
    expect(g.nextSkill(ctx({ userMessage: 'axxxxb' }))).toBeUndefined(); // not a pattern
    expect(g.nextSkill(ctx({ userMessage: 'use a.*b here' }))).toBe('a'); // the literal
  });

  it('load: a 200-rule keyword router builds, checks pairwise, and finds exactly the one seeded overlap', () => {
    const started = Date.now();
    const n = 200;
    const ruleList = Array.from({ length: n }, (_, i) => ({
      match: { keywords: [`only${i}`, ...(i === 0 || i === n - 1 ? ['shared'] : [])] },
      use: `s${i}`,
    }));
    const g = skillGraph({
      skills: Array.from({ length: n }, (_, i) => bareSkill(`s${i}`, `s${i} body`)),
      start: { rules: ruleList },
      check: 'off',
    });
    const overlaps = problemsOf(g, 'overlapping-rules');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.message).toContain('"shared"');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
