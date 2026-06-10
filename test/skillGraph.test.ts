/**
 * skillGraph (proposal 002) — declarative skill-dependency graph.
 *
 * Covers: edge → trigger compilation (unit), activation through the REAL engine
 * evaluator (integration), the `toMermaid()` drawing, and guardrails.
 */

import { describe, it, expect, vi } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { skillGraph, decide, defineSkill, defineInstruction, Agent, mock } from '../src/index.js';
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

describe('tree() — the same skill as MULTIPLE leaves (shared-leaf merge)', () => {
  // Neo's regression: an intent tree routed BOTH "ESXi questions" and "io
  // questions" to the same io-profile skill — two leaves, one injection id.
  // The compiler must merge them (OR'd predicates), not emit a duplicate that
  // explodes in Agent.injection()'s duplicate-id guard.
  const shared = defineSkill({
    id: 'io-profile',
    description: 'io profile bundle',
    body: 'profile the io',
  });
  const other = defineSkill({ id: 'triage', description: 'default', body: 'triage it' });
  const tree = decide(
    (ctx) => /esxi/.test(ctx.userMessage),
    shared,
    decide((ctx) => /\bio\b/.test(ctx.userMessage), shared, other, 'io?'),
    'esxi?',
  );

  it('compiles the shared leaf ONCE, with OR-of-paths activation', () => {
    const graph = skillGraph().tree(tree).build();
    const ids = graph.skills.map((s) => s.id);
    expect(ids.filter((id) => id === 'io-profile').length).toBe(1);

    const compiled = graph.skills.find((s) => s.id === 'io-profile')!;
    const activeWhen = (compiled.trigger as { activeWhen: (ctx: unknown) => boolean }).activeWhen;
    const ctx = (msg: string) => ({ userMessage: msg } as never);
    expect(activeWhen(ctx('which esxi host owns this wwpn?'))).toBe(true); // path 1
    expect(activeWhen(ctx('io trend for the port'))).toBe(true); // path 2
    expect(activeWhen(ctx('something else entirely'))).toBe(false);

    // provenance: both paths recorded; node deduped; both edges kept
    const routing = (compiled.metadata as Record<string, never>)['skillGraph'] as unknown as {
      paths?: unknown[];
    };
    expect(routing.paths?.length).toBe(2);
    expect(graph.nodes.filter((n) => n.id === 'io-profile').length).toBe(1);
    expect(graph.edges.filter((e) => e.to === 'io-profile').length).toBe(2);
  });

  it('builds into an Agent without the duplicate-id throw', () => {
    const graph = skillGraph().tree(tree).build();
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' })
        .skillGraph(graph)
        .build(),
    ).not.toThrow();
  });
});

describe('tree() — dev-mode "exactly one leaf fires" monitor (B11)', () => {
  // The tree is exhaustive by construction; the invariant only breaks when a
  // decide() predicate is impure (answers differently across the per-leaf
  // re-evaluations). The monitor tallies fires per evaluator pass in dev mode.
  const a = skill('leaf-a');
  const b = skill('leaf-b');

  /** decide() predicate that returns a scripted sequence of answers. */
  const scripted = (answers: boolean[]) => {
    let i = 0;
    return () => answers[i++ % answers.length]!;
  };

  const withDevWarnSpy = async (fn: (warn: ReturnType<typeof vi.spyOn>) => void) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    try {
      fn(warn);
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  };

  it('warns when an impure predicate fires BOTH leaves (overlap)', async () => {
    // leaf-a evaluates p()=true, leaf-b evaluates ¬p() with p()=false → both fire
    const g = skillGraph()
      .tree(decide(scripted([true, false]), a, b, 'flaky?'))
      .build();
    await withDevWarnSpy((warn) => {
      const { active } = evaluateInjections(g.skills, ctx({}));
      expect(active.map((s) => s.id)).toEqual(['leaf-a', 'leaf-b']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/2 leaves fired simultaneously/);
      expect(warn.mock.calls[0]![0]).toContain('leaf-a');
      expect(warn.mock.calls[0]![0]).toContain('leaf-b');
    });
  });

  it('warns when an impure predicate fires NO leaf (gap)', async () => {
    // leaf-a evaluates p()=false, leaf-b evaluates ¬p() with p()=true → neither fires
    const g = skillGraph()
      .tree(decide(scripted([false, true]), a, b, 'flaky?'))
      .build();
    await withDevWarnSpy((warn) => {
      const { active } = evaluateInjections(g.skills, ctx({}));
      expect(active).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/NO leaf fired/);
    });
  });

  it('stays silent for pure predicates (exactly one leaf fires)', async () => {
    const g = skillGraph()
      .tree(decide((c) => c.userMessage.includes('io'), a, b, 'io?'))
      .build();
    await withDevWarnSpy((warn) => {
      evaluateInjections(g.skills, ctx({ userMessage: 'io trend' }));
      evaluateInjections(g.skills, ctx({ userMessage: 'something else' }));
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('stays silent (and costs nothing) in production mode, even for impure predicates', () => {
    const g = skillGraph()
      .tree(decide(scripted([true, false]), a, b))
      .build();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { active } = evaluateInjections(g.skills, ctx({}));
      expect(active.length).toBe(2); // behavior unchanged — monitor observes, never alters
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not double-report a THROWING predicate (the evaluator already reports it)', async () => {
    const g = skillGraph()
      .tree(
        decide(
          () => {
            throw new Error('boom');
          },
          a,
          b,
        ),
      )
      .build();
    await withDevWarnSpy((warn) => {
      const { active, skipped } = evaluateInjections(g.skills, ctx({}));
      expect(active).toEqual([]);
      expect(skipped.map((s) => s.reason)).toEqual(['predicate-threw', 'predicate-threw']);
      expect(warn).not.toHaveBeenCalled(); // pass never completes — no gap false-positive
    });
  });

  it('a merged shared leaf counts ONCE — no false warn', async () => {
    const sharedLeaf = skill('shared');
    const other = skill('other');
    const g = skillGraph()
      .tree(
        decide(
          (c) => c.userMessage.includes('esxi'),
          sharedLeaf,
          decide((c) => c.userMessage.includes('io'), sharedLeaf, other, 'io?'),
          'esxi?',
        ),
      )
      .build();
    await withDevWarnSpy((warn) => {
      const viaEsxi = evaluateInjections(g.skills, ctx({ userMessage: 'esxi host?' }));
      const viaIo = evaluateInjections(g.skills, ctx({ userMessage: 'io trend' }));
      const viaNeither = evaluateInjections(g.skills, ctx({ userMessage: 'hello' }));
      expect(viaEsxi.active.map((s) => s.id)).toEqual(['shared']);
      expect(viaIo.active.map((s) => s.id)).toEqual(['shared']);
      expect(viaNeither.active.map((s) => s.id)).toEqual(['other']);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('a reused ctx object starts a fresh pass (warns per pass, not once)', async () => {
    const g = skillGraph()
      .tree(decide(scripted([true, false]), a, b))
      .build();
    await withDevWarnSpy((warn) => {
      const sameCtx = ctx({});
      evaluateInjections(g.skills, sameCtx);
      evaluateInjections(g.skills, sameCtx);
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });
});
