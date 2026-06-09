/**
 * skillGraph (proposal 002) — declarative skill-dependency graph.
 *
 * Covers: edge → trigger compilation (unit), activation through the REAL engine
 * evaluator (integration), the `toMermaid()` drawing, and guardrails.
 */

import { describe, it, expect } from 'vitest';
import { skillGraph, decide, defineSkill, defineInstruction } from '../src/index.js';
import { evaluateInjections } from '../src/lib/injection-engine/index.js';
import type { InjectionContext } from '../src/lib/injection-engine/types.js';

const skill = (id: string, body = `${id} body`) =>
  defineSkill({ id, description: `use ${id}`, body });

const ctx = (over: Partial<InjectionContext>): InjectionContext => ({
  iteration: 1,
  userMessage: 'q',
  history: [],
  activatedInjectionIds: [],
  ...over,
});

describe('skillGraph — edge → trigger compilation', () => {
  it('entry (no when) → always; entry (when) → rule', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .entry(b, { when: (c) => c.iteration === 1 })
      .build();
    expect(g.skills.find((s) => s.id === 'a')!.trigger.kind).toBe('always');
    expect(g.skills.find((s) => s.id === 'b')!.trigger.kind).toBe('rule');
  });

  it('route onToolReturn → on-tool-return trigger; route when → rule over lastToolResult', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'lookup' })
      .route(a, c, { when: (r) => r.toolName === 'probe' && r.result.includes('hit') })
      .build();

    const tb = g.skills.find((s) => s.id === 'b')!.trigger;
    expect(tb.kind).toBe('on-tool-return');
    expect((tb as { toolName: string }).toolName).toBe('lookup');

    const tc = g.skills.find((s) => s.id === 'c')!.trigger;
    expect(tc.kind).toBe('rule');
    const fire = (tc as { activeWhen: (c: InjectionContext) => boolean }).activeWhen;
    expect(fire(ctx({ lastToolResult: { toolName: 'probe', result: 'a hit' } }))).toBe(true);
    expect(fire(ctx({ lastToolResult: { toolName: 'probe', result: 'miss' } }))).toBe(false);
    expect(fire(ctx({}))).toBe(false); // no tool result yet
  });

  it('a skill with no deterministic incoming edge keeps its default llm-activated trigger', () => {
    const a = skill('a');
    const c = skill('c');
    const g = skillGraph().entry(a).route(a, c).build(); // bare route = model-reachable
    expect(g.skills.find((s) => s.id === 'c')!.trigger.kind).toBe('llm-activated');
  });

  it('guards: route with both when+onToolReturn throws; non-skill throws', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() => skillGraph().route(a, b, { when: () => true, onToolReturn: 'x' })).toThrow();
    const instr = defineInstruction({ id: 'i', prompt: 'p', activeWhen: () => true });
    expect(() => skillGraph().entry(instr as never)).toThrow(/not a skill/);
  });
});

describe('skillGraph — activation through the real evaluator', () => {
  it('entry active at start; routed skill activates only when its predicate fires', () => {
    const triage = skill('triage');
    const sfp = skill('sfp', 'SFP DEEP DIVE');
    const g = skillGraph()
      .entry(triage)
      .route(triage, sfp, { when: (r) => r.toolName === 'probe' && JSON.parse(r.result).crc > 0 })
      .build();

    // iteration 1, no tool result → only the entry is active
    const e1 = evaluateInjections(g.skills, ctx({ iteration: 1 }));
    expect(e1.active.map((i) => i.id)).toEqual(['triage']);

    // after probe returns crc>0 → entry (always) + sfp (rule fired)
    const e2 = evaluateInjections(
      g.skills,
      ctx({ iteration: 2, lastToolResult: { toolName: 'probe', result: '{"crc":5}' } }),
    );
    expect(e2.active.map((i) => i.id).sort()).toEqual(['sfp', 'triage']);
    // the activated skill carries its body into the slot
    expect(e2.active.find((i) => i.id === 'sfp')!.inject.systemPrompt).toContain('SFP DEEP DIVE');

    // crc==0 → sfp stays dormant (token-efficient: not loaded)
    const e3 = evaluateInjections(
      g.skills,
      ctx({ iteration: 2, lastToolResult: { toolName: 'probe', result: '{"crc":0}' } }),
    );
    expect(e3.active.map((i) => i.id)).toEqual(['triage']);
  });
});

describe('skillGraph — toMermaid (declared === drawn)', () => {
  it('renders nodes, a start, solid deterministic edges and dashed model edges', () => {
    const a = skill('mds-interface-issues');
    const b = skill('sfp');
    const c = skill('io-profile');
    const m = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'get_counters', label: 'CRC>0' })
      .route(a, c) // model edge
      .build()
      .toMermaid();

    expect(m).toContain('flowchart TD');
    expect(m).toContain('__start__');
    expect(m).toContain('["mds-interface-issues"]'); // original id as label
    expect(m).toContain('|CRC>0|'); // edge caption
    expect(m).toContain('-->'); // deterministic edge solid
    expect(m).toContain('-.->'); // model edge dashed
  });
});

describe('skillGraph — decision tree (v3): predicate nodes route', () => {
  const has = (re: RegExp) => (c: InjectionContext) => re.test(c.userMessage);

  // tree: io? → io-profile : (sfp? → sfp-audit : triage)
  const buildTree = () => {
    const io = skill('io-profile', 'IO PROFILE');
    const sfp = skill('sfp-audit', 'SFP AUDIT');
    const triage = skill('triage', 'TRIAGE');
    const g = skillGraph()
      .tree(
        decide(
          has(/io|iops/),
          io,
          decide(has(/sfp|optic/), sfp, triage, 'sfp intent?'),
          'io intent?',
        ),
      )
      .build();
    return { g, io, sfp, triage };
  };

  it('each leaf compiles to a rule trigger (path conjunction)', () => {
    const { g } = buildTree();
    expect(g.skills.map((s) => s.id).sort()).toEqual(['io-profile', 'sfp-audit', 'triage']);
    for (const s of g.skills) expect(s.trigger.kind).toBe('rule');
  });

  it('exactly one leaf activates per question, through the real evaluator', () => {
    const { g } = buildTree();
    const fired = (msg: string) =>
      evaluateInjections(g.skills, ctx({ userMessage: msg }))
        .active.map((i) => i.id)
        .sort();

    expect(fired('what is the io profile of fc1/5?')).toEqual(['io-profile']); // true branch
    expect(fired('check the sfp optic power')).toEqual(['sfp-audit']); // false→true
    expect(fired('port is flapping')).toEqual(['triage']); // false→false (default)
  });

  it('the chosen leaf carries its body into the slot; the others stay dormant', () => {
    const { g } = buildTree();
    const e = evaluateInjections(g.skills, ctx({ userMessage: 'iops spike' }));
    expect(e.active).toHaveLength(1);
    expect(e.active[0]!.inject.systemPrompt).toContain('IO PROFILE');
  });

  it('toMermaid draws predicate diamonds, skill boxes and yes/no branch labels', () => {
    const { g } = buildTree();
    const m = g.toMermaid();
    expect(m).toContain('flowchart TD');
    expect(m).toContain('{"io intent?"}'); // root predicate diamond
    expect(m).toContain('{"sfp intent?"}'); // nested predicate diamond
    expect(m).toContain('["io-profile"]'); // skill leaf box
    expect(m).toContain('|yes|'); // true-branch caption
    expect(m).toContain('|no|'); // false-branch caption
  });

  it('a single-skill tree (no predicate) compiles to one always-true rule leaf', () => {
    const only = skill('only');
    const g = skillGraph().tree(only).build();
    expect(g.skills).toHaveLength(1);
    expect(g.skills[0]!.trigger.kind).toBe('rule');
    expect(evaluateInjections(g.skills, ctx({})).active.map((i) => i.id)).toEqual(['only']);
    expect(g.nodes).toEqual([{ id: 'only', kind: 'skill', label: 'only' }]);
  });

  it('guard: a non-skill leaf throws', () => {
    const instr = defineInstruction({ id: 'i', prompt: 'p', activeWhen: () => true });
    const ok = skill('ok');
    expect(() =>
      skillGraph()
        .tree(decide(() => true, ok, instr as never))
        .build(),
    ).toThrow(/not a skill/);
  });
});

describe('skillGraph — tree tool-scoping (on-demand tools)', () => {
  const has = (re: RegExp) => (c: InjectionContext) => re.test(c.userMessage);
  const autoOf = (inj: { metadata?: Record<string, unknown> }) => inj.metadata?.autoActivate;

  it('every tree leaf is tool-scoped (autoActivate=currentSkill) by default', () => {
    const io = skill('io');
    const sfp = skill('sfp');
    const triage = skill('triage');
    const g = skillGraph()
      .tree(decide(has(/io/), io, decide(has(/sfp/), sfp, triage, 'sfp?'), 'io?'))
      .build();
    expect(g.skills.map(autoOf)).toEqual(['currentSkill', 'currentSkill', 'currentSkill']);
  });

  it('scopeTools:false restores the legacy additive behavior (no autoActivate)', () => {
    const io = skill('io');
    const triage = skill('triage');
    const g = skillGraph()
      .tree(decide(has(/io/), io, triage, 'io?'), { scopeTools: false })
      .build();
    expect(g.skills.map(autoOf)).toEqual([undefined, undefined]);
  });

  it("respects a leaf's explicit autoActivate even when scopeTools:false", () => {
    const io = defineSkill({
      id: 'io',
      description: 'io',
      body: 'b',
      autoActivate: 'currentSkill',
    });
    const triage = skill('triage');
    const g = skillGraph()
      .tree(decide(has(/io/), io, triage, 'io?'), { scopeTools: false })
      .build();
    const byId = Object.fromEntries(g.skills.map((s) => [s.id, autoOf(s)]));
    expect(byId.io).toBe('currentSkill'); // explicit choice preserved
    expect(byId.triage).toBeUndefined(); // opt-out applies to the rest
  });

  it('flat entry/route graphs are NOT auto-scoped (back-compat)', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 'x' }).build();
    expect(g.skills.map(autoOf)).toEqual([undefined, undefined]);
  });
});

describe('skillGraph — routing provenance (metadata.skillGraph)', () => {
  const has = (re: RegExp) => (c: InjectionContext) => re.test(c.userMessage);
  type Routing = {
    via: string;
    path?: { label: string; branch: string }[];
    label?: string;
    from?: string;
    triggerKind?: string;
  };
  const routingOf = (inj: { metadata?: Record<string, unknown> }) =>
    inj.metadata?.skillGraph as Routing | undefined;

  it('a tree leaf carries via:tree + the full root→leaf decision path', () => {
    const io = skill('io-profile');
    const sfp = skill('sfp-audit');
    const triage = skill('triage');
    const g = skillGraph()
      .tree(decide(has(/io/), io, decide(has(/sfp/), sfp, triage, 'sfp intent?'), 'io intent?'))
      .build();

    expect(routingOf(g.skills.find((s) => s.id === 'io-profile')!)).toEqual({
      via: 'tree',
      path: [{ label: 'io intent?', branch: 'yes' }],
    });
    expect(routingOf(g.skills.find((s) => s.id === 'sfp-audit')!)).toEqual({
      via: 'tree',
      path: [
        { label: 'io intent?', branch: 'no' },
        { label: 'sfp intent?', branch: 'yes' },
      ],
    });
    expect(routingOf(g.skills.find((s) => s.id === 'triage')!)).toEqual({
      via: 'tree',
      path: [
        { label: 'io intent?', branch: 'no' },
        { label: 'sfp intent?', branch: 'no' },
      ],
    });
  });

  it('preserves the skill’s existing metadata (surfaceMode/cache) alongside skillGraph', () => {
    const only = skill('only');
    const g = skillGraph().tree(only).build();
    const meta = g.skills[0]!.metadata!;
    expect(meta.skillGraph).toEqual({ via: 'tree', path: [] }); // single-skill tree = empty path
    // defineSkill stamps surfaceMode + cache; routing must not clobber them.
    expect(meta).toHaveProperty('surfaceMode');
    expect(meta).toHaveProperty('cache');
  });

  it('flat entry → via:entry with the entry label', () => {
    const a = skill('a');
    const g = skillGraph()
      .entry(a, { when: () => true, label: 'always on' })
      .build();
    expect(routingOf(g.skills.find((s) => s.id === 'a')!)).toEqual({
      via: 'entry',
      label: 'always on',
    });
  });

  it('flat route (onToolReturn / when) → via:route with from + triggerKind', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'lookup', label: 'after lookup' })
      .route(a, c, { when: (r) => r.toolName === 'probe' })
      .build();
    expect(routingOf(g.skills.find((s) => s.id === 'b')!)).toEqual({
      via: 'route',
      from: 'a',
      label: 'after lookup',
      triggerKind: 'on-tool-return',
    });
    expect(routingOf(g.skills.find((s) => s.id === 'c')!)).toEqual({
      via: 'route',
      from: 'a',
      triggerKind: 'rule',
    });
  });

  it('a bare route (model-reachable) → via:model', () => {
    const a = skill('a');
    const c = skill('c');
    const g = skillGraph().entry(a).route(a, c).build();
    expect(routingOf(g.skills.find((s) => s.id === 'c')!)).toEqual({ via: 'model' });
  });
});
