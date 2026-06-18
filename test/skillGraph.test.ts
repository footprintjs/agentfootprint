/**
 * skillGraph (proposal 002) — declarative skill-dependency graph.
 *
 * Covers: edge → trigger compilation (unit), activation through the REAL engine
 * evaluator (integration), the `toMermaid()` drawing, and guardrails.
 */

import { describe, it, expect, vi } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import {
  skillGraph,
  decide,
  defineSkill,
  defineInstruction,
  defineRelevanceHint,
  defineTool,
  Agent,
  mock,
  mockEmbedder,
} from '../src/index.js';
import type { Injection } from '../src/index.js';
import { softmax } from '../src/lib/injection-engine/softmax.js';
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

  it('route compiles to a cursor-gated rule (onToolReturn matches the tool name)', () => {
    // v2 keystone: route targets are `from`-gated against the cursor, so a single
    // bare onToolReturn is no longer the native `on-tool-return` trigger — it must
    // also check the cursor. The EDGE is still drawn as on-tool-return (provenance
    // unchanged); only the compiled trigger is a cursor-gated rule.
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 'lookup' }).build();

    const tb = g.skills.find((s) => s.id === 'b')!.trigger;
    expect(tb.kind).toBe('rule');
    const fire = (tb as { activeWhen: (c: InjectionContext) => boolean }).activeWhen;
    // from-gated: only fires while the cursor is on the edge's source 'a'
    expect(
      fire(ctx({ currentSkillId: 'a', lastToolResult: { toolName: 'lookup', result: 'x' } })),
    ).toBe(true);
    // cross-skill edge bleed PREVENTED: same tool result, cursor elsewhere
    expect(
      fire(ctx({ currentSkillId: 'd', lastToolResult: { toolName: 'lookup', result: 'x' } })),
    ).toBe(false);
    // sticky: stays active while it IS the cursor, even with no matching result
    expect(fire(ctx({ currentSkillId: 'b' }))).toBe(true);
    // right source, wrong tool name → no fire
    expect(
      fire(ctx({ currentSkillId: 'a', lastToolResult: { toolName: 'other', result: 'x' } })),
    ).toBe(false);
  });

  it('route when → cursor-gated rule over lastToolResult', () => {
    const a = skill('a');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, c, { when: (r) => r.toolName === 'probe' && r.result.includes('hit') })
      .build();

    const tc = g.skills.find((s) => s.id === 'c')!.trigger;
    expect(tc.kind).toBe('rule');
    const fire = (tc as { activeWhen: (c: InjectionContext) => boolean }).activeWhen;
    expect(
      fire(ctx({ currentSkillId: 'a', lastToolResult: { toolName: 'probe', result: 'a hit' } })),
    ).toBe(true);
    expect(
      fire(ctx({ currentSkillId: 'a', lastToolResult: { toolName: 'probe', result: 'miss' } })),
    ).toBe(false);
    expect(fire(ctx({ currentSkillId: 'a' }))).toBe(false); // no tool result yet
    // edge bleed prevented even when the predicate would match
    expect(
      fire(ctx({ currentSkillId: 'x', lastToolResult: { toolName: 'probe', result: 'a hit' } })),
    ).toBe(false);
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
  it('entry active at start; routed skill activates only when its from-gated predicate fires', () => {
    const triage = skill('triage');
    const sfp = skill('sfp', 'SFP DEEP DIVE');
    const g = skillGraph()
      .entry(triage)
      .route(triage, sfp, { when: (r) => r.toolName === 'probe' && JSON.parse(r.result).crc > 0 })
      .build();

    // iteration 1, cold start (no cursor, no tool result) → only the entry is active
    const e1 = evaluateInjections(g.skills, ctx({ iteration: 1 }));
    expect(e1.active.map((i) => i.id)).toEqual(['triage']);

    // cursor on triage + probe returns crc>0 → entry (always) + sfp (from-gated rule fired).
    // The cursor is set by the loop's cursor-update stage (Stage 2); here we thread it
    // directly to exercise the evaluator's new contract in isolation.
    const e2 = evaluateInjections(
      g.skills,
      ctx({
        iteration: 2,
        currentSkillId: 'triage',
        lastToolResult: { toolName: 'probe', result: '{"crc":5}' },
      }),
    );
    expect(e2.active.map((i) => i.id).sort()).toEqual(['sfp', 'triage']);
    // the activated skill carries its body into the slot
    expect(e2.active.find((i) => i.id === 'sfp')!.inject.systemPrompt).toContain('SFP DEEP DIVE');

    // crc==0 → sfp stays dormant (token-efficient: not loaded)
    const e3 = evaluateInjections(
      g.skills,
      ctx({
        iteration: 2,
        currentSkillId: 'triage',
        lastToolResult: { toolName: 'probe', result: '{"crc":0}' },
      }),
    );
    expect(e3.active.map((i) => i.id)).toEqual(['triage']);

    // EDGE BLEED PREVENTED: identical crc>0 result, but the cursor is on another
    // skill → sfp must NOT activate (the v1 bug this keystone fixes).
    const e4 = evaluateInjections(
      g.skills,
      ctx({
        iteration: 3,
        currentSkillId: 'other',
        lastToolResult: { toolName: 'probe', result: '{"crc":5}' },
      }),
    );
    expect(e4.active.map((i) => i.id)).toEqual(['triage']); // only the always-on entry base
  });
});

describe('skillGraph — nextSkill cursor resolver (the keystone, pin-table)', () => {
  const probe = (toolName: string, result = '') => ({ toolName, result });

  it('cold start → the first entry whose when passes (always-entry matches unconditionally)', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(b, { when: (x) => x.userMessage.includes('beta') })
      .entry(c, { when: (x) => x.userMessage.includes('gamma') })
      .entry(a) // always-entry, declared last
      .route(a, b, { onToolReturn: 'x' })
      .build();
    // declaration order: b(when) miss, c(when) hit
    expect(g.nextSkill(ctx({ userMessage: 'gamma path' }))).toBe('c');
    // no when-entry matches → fall through to the always-entry
    expect(g.nextSkill(ctx({ userMessage: 'nothing here' }))).toBe('a');
    // first matching when-entry wins
    expect(g.nextSkill(ctx({ userMessage: 'beta and gamma' }))).toBe('b');
  });

  it('transition: a from-gated edge whose predicate matches moves the cursor', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 'lookup' }).build();
    expect(g.nextSkill(ctx({ currentSkillId: 'a', lastToolResult: probe('lookup') }))).toBe('b');
  });

  it('sticky stay: no edge out of the current skill fires → cursor unchanged', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 'lookup' }).build();
    // cursor on b, b has no outgoing edge → stay on b regardless of the tool result
    expect(g.nextSkill(ctx({ currentSkillId: 'b', lastToolResult: probe('lookup') }))).toBe('b');
    // cursor on a but the tool didn't match → stay on a
    expect(g.nextSkill(ctx({ currentSkillId: 'a', lastToolResult: probe('other') }))).toBe('a');
  });

  it('edge bleed prevented: an edge a→b does NOT fire while the cursor is elsewhere', () => {
    const a = skill('a');
    const b = skill('b');
    const d = skill('d');
    const g = skillGraph().entry(a).entry(d).route(a, b, { onToolReturn: 'lookup' }).build();
    // cursor on d, the exact 'lookup' result a→b keys on → must NOT route to b
    expect(g.nextSkill(ctx({ currentSkillId: 'd', lastToolResult: probe('lookup') }))).toBe('d');
  });

  it('first-match by declaration order when two edges share a from', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { when: (r) => r.result.includes('x') })
      .route(a, c, { when: (r) => r.result.includes('x') }) // both match; b declared first
      .build();
    expect(g.nextSkill(ctx({ currentSkillId: 'a', lastToolResult: probe('t', 'has x') }))).toBe(
      'b',
    );
  });

  it('a throwing edge predicate is isolated (treated as no-match; siblings still evaluated)', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph()
      .entry(a)
      .route(a, b, {
        when: () => {
          throw new Error('boom');
        },
      }) // throws — must not block c
      .route(a, c, { when: (r) => r.result.includes('ok') })
      .build();
    expect(g.nextSkill(ctx({ currentSkillId: 'a', lastToolResult: probe('t', 'ok') }))).toBe('c');
  });

  it('tree-mode graphs have no cursor — nextSkill returns the unchanged currentSkillId', () => {
    const io = skill('io');
    const tri = skill('tri');
    const g = skillGraph()
      .tree(decide((c) => c.userMessage.includes('io'), io, tri))
      .build();
    expect(g.nextSkill(ctx({ currentSkillId: undefined }))).toBeUndefined();
    expect(g.nextSkill(ctx({ currentSkillId: 'io' }))).toBe('io');
  });
});

describe('skillGraph — sticky lifecycle through the evaluator (enter, stay, clean handoff)', () => {
  it('enter B, stay in B across unrelated work, then hand off to C (B deactivates)', () => {
    const a = skill('a'); // always-on base entry
    const b = skill('b', 'B BODY');
    const c = skill('c', 'C BODY');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'toB' })
      .route(b, c, { onToolReturn: 'toC' })
      .build();

    // Simulate the real loop: evaluate with the current cursor, then advance the
    // cursor exactly as Stage 2's cursor-update stage will (currentSkillId = nextSkill).
    let cursor: string | undefined;
    const step = (over: Partial<InjectionContext>) => {
      const c0 = ctx({ ...over, currentSkillId: cursor });
      const active = evaluateInjections(g.skills, c0)
        .active.map((i) => i.id)
        .sort();
      cursor = g.nextSkill(c0);
      return { active, cursor };
    };

    // iter 1 — cold start: only the base entry, cursor lands on a
    expect(step({})).toEqual({ active: ['a'], cursor: 'a' });
    // a's tool returns toB → move to b; a (base) stays, b enters
    expect(step({ lastToolResult: { toolName: 'toB', result: '' } })).toEqual({
      active: ['a', 'b'],
      cursor: 'b',
    });
    // b does unrelated work → STICKY: stay in b
    expect(step({ lastToolResult: { toolName: 'other', result: '' } })).toEqual({
      active: ['a', 'b'],
      cursor: 'b',
    });
    // b's tool returns toC → CLEAN HANDOFF: c enters, b deactivates the same step
    expect(step({ lastToolResult: { toolName: 'toC', result: '' } })).toEqual({
      active: ['a', 'c'],
      cursor: 'c',
    });
  });
});

describe('skillGraph — cursor round-trip through the REAL Agent loop (mount mappers, per chart)', () => {
  // The Convention-2 integration tests the keystone needs. The unit tests above
  // thread `currentSkillId` into a hand-built ctx (or re-implement the cursor
  // advance manually), so they bypass the MOUNT MAPPERS that carry the cursor
  // across iterations. A broken mapper would reset the cursor every iteration →
  // every route behaves as cold-start → the v1 cross-skill edge-bleed bug returns
  // SILENTLY (full suite still green). These run the real loop and assert via the
  // `agentfootprint.context.evaluated` emit's `activeIds`, exercising the flat
  // (buildAgentChart) AND grouped (buildDynamicAgentChart + sf-llm-call) mappers.
  const probe = defineTool({
    name: 'probe',
    description: 'probe the thing',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ crc: 5 }),
  });

  /** A provider that calls `probe` on turn 1, then stops — drives two iterations. */
  const callThenStop = () => {
    let i = 0;
    return mock({
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
  };

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

  // 'dynamic' (default) and 'classic' share the flat chart (buildAgentChart) — its
  // mappers; 'dynamic-grouped' is the grouped chart (buildDynamicAgentChart) with
  // the extra sf-llm-call boundary. All three carry the cursor in the Injection
  // Engine (which runs every iteration in every mode, before any slot caching), so
  // the activeIds assertion is on the cursor mechanism, independent of the classic
  // slot-cache footgun.
  const MODES = ['dynamic', 'classic', 'dynamic-grouped'] as const;

  for (const reactMode of MODES) {
    it(`[${reactMode}] a route fires only after its from-gated tool returns`, async () => {
      const a = skill('a');
      const b = skill('b', 'B BODY');
      const graph = skillGraph().entry(a).route(a, b, { onToolReturn: 'probe' }).build();
      const { perIteration, recorder } = captureActiveIds();
      const agent = Agent.create({
        provider: callThenStop(),
        model: 'mock',
        maxIterations: 4,
        reactMode,
      })
        .system('')
        .tool(probe)
        .skillGraph(graph)
        .recorder(recorder)
        .build();

      await agent.run({ message: 'go' });

      expect(perIteration.length).toBeGreaterThanOrEqual(2);
      expect(perIteration[0]).toEqual(['a']); // cold start: entry only, b dormant
      expect(perIteration[1]).toContain('b'); // post-probe: the route fired, b active
      expect(perIteration[1]).toContain('a'); // the always-on entry base persists
    });

    it(`[${reactMode}] EDGE BLEED prevented: a→b stays dormant while the cursor is parked on an unrelated entry`, async () => {
      const d = skill('d'); // the cold-start cursor (the only entry)
      const a = skill('a');
      const b = skill('b');
      // a→b keys on 'probe', but the graph never ENTERS 'a' — the cursor stays on d.
      const graph = skillGraph().entry(d).route(a, b, { onToolReturn: 'probe' }).build();
      const { perIteration, recorder } = captureActiveIds();
      const agent = Agent.create({
        provider: callThenStop(),
        model: 'mock',
        maxIterations: 4,
        reactMode,
      })
        .system('')
        .tool(probe)
        .skillGraph(graph)
        .recorder(recorder)
        .build();

      await agent.run({ message: 'go' });

      expect(perIteration.length).toBeGreaterThanOrEqual(2);
      // 'probe' returns on iteration 2, matching a→b's predicate — but the cursor is
      // on d, not a, so b MUST stay dormant. v1 (un-gated) would have lit b here.
      for (const ids of perIteration) expect(ids).not.toContain('b');
      expect(perIteration[0]).toEqual(['d']);
    });
  }
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

describe('skillGraph — reachableSkills (the read_skill gate allowed set)', () => {
  it('cold start (no cursor) → the entry skills', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const g = skillGraph().entry(a).entry(b).route(a, c, { onToolReturn: 'x' }).build();
    expect([...g.reachableSkills(undefined)].sort()).toEqual(['a', 'b']);
  });

  it('from a skill → its direct successors ∪ entries, minus itself', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const d = skill('d');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'x' })
      .route(a, c, { when: (r) => r.result.includes('y') })
      .route(b, d, { onToolReturn: 'z' })
      .build();
    expect([...g.reachableSkills('a')].sort()).toEqual(['b', 'c']); // successors b,c (+entry a, minus a)
    expect([...g.reachableSkills('b')].sort()).toEqual(['a', 'd']); // successor d + entry a
    expect([...g.reachableSkills('c')].sort()).toEqual(['a']); // no successors → entry a only
  });

  it('includes bare (model) route targets as successors', () => {
    const a = skill('a');
    const c = skill('c');
    const g = skillGraph().entry(a).route(a, c).build(); // bare model edge a→c
    expect([...g.reachableSkills('a')].sort()).toEqual(['c']);
  });

  it('excludes the current skill (a deliberate stay is the ReAct stop, not self-read_skill)', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'x' })
      .route(b, a, { onToolReturn: 'y' })
      .build();
    expect(g.reachableSkills('a')).not.toContain('a');
    expect([...g.reachableSkills('b')].sort()).toEqual(['a']); // b→a successor (= entry a, deduped)
  });

  it('de-duplicates (a successor that is also an entry appears once)', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).entry(b).route(a, b, { onToolReturn: 'x' }).build();
    expect([...g.reachableSkills('a')].sort()).toEqual(['b']); // successor b + entries a,b minus a → [b]
  });

  it('tree mode → all leaf skills (read_skill stays a full escape hatch)', () => {
    const io = skill('io');
    const sfp = skill('sfp');
    const tri = skill('tri');
    const g = skillGraph()
      .tree(
        decide(
          (c) => /io/.test(c.userMessage),
          io,
          decide((c) => /sfp/.test(c.userMessage), sfp, tri, 's?'),
          'i?',
        ),
      )
      .build();
    expect([...g.reachableSkills('io')].sort()).toEqual(['io', 'sfp', 'tri']);
    expect([...g.reachableSkills(undefined)].sort()).toEqual(['io', 'sfp', 'tri']);
  });

  it('property: for ANY cursor, reachableSkills excludes the cursor and is a subset of declared skills', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const d = skill('d');
    const g = skillGraph()
      .entry(a)
      .entry(b)
      .route(a, b, { onToolReturn: 'x' })
      .route(a, c, { when: (r) => r.result.length > 0 })
      .route(b, c)
      .route(c, d, { onToolReturn: 'y' })
      .route(d, a, { onToolReturn: 'z' })
      .build();
    const declared = new Set(g.skills.map((s) => s.id));
    for (const cur of [undefined, 'a', 'b', 'c', 'd', 'phantom']) {
      const reach = g.reachableSkills(cur);
      if (cur !== undefined) expect(reach).not.toContain(cur); // never self
      for (const id of reach) expect(declared.has(id)).toBe(true); // subset of declared
    }
  });
});

describe('softmax', () => {
  it('sums to 1 and preserves the ranking order', () => {
    const out = softmax([1, 2, 3]);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(out[2]!).toBeGreaterThan(out[1]!);
    expect(out[1]!).toBeGreaterThan(out[0]!);
  });
  it('empty → empty; uniform input → uniform output', () => {
    expect(softmax([])).toEqual([]);
    softmax([5, 5, 5]).forEach((v) => expect(v).toBeCloseTo(1 / 3, 10));
  });
  it('higher temperature flattens the distribution', () => {
    const sharp = softmax([1, 5], 0.5);
    const flat = softmax([1, 5], 5);
    expect(flat[0]!).toBeGreaterThan(sharp[0]!); // the loser keeps more share when flatter
  });
  it('is numerically stable for large values', () => {
    const out = softmax([1000, 1001]);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('skillGraph — entryByRelevance / scoreEntries (LLM-free relevance entry)', () => {
  const emb = mockEmbedder(); // deterministic char-frequency embedding

  it('picks the entry whose description best matches the message; relevance sums to ~1', async () => {
    const billing = defineSkill({ id: 'billing', description: 'payments and refunds', body: 'b' });
    const incident = defineSkill({ id: 'incident', description: 'zzz qqq', body: 'b' });
    const g = skillGraph().entry(billing).entry(incident).entryByRelevance(emb).build();
    expect(g.scoreEntries).toBeDefined();

    const res = await g.scoreEntries!(ctx({ userMessage: 'i need a refund for my payment' }));
    expect(res.chosen).toBe('billing'); // shares far more characters with the message
    expect(res.ranked.map((r) => r.id).sort()).toEqual(['billing', 'incident']);
    expect(res.ranked.reduce((s, r) => s + r.relevance, 0)).toBeCloseTo(1, 5);
  });

  it('only when-passing entries are candidates', async () => {
    const a = defineSkill({ id: 'a', description: 'alpha', body: 'b' });
    const b = defineSkill({ id: 'b', description: 'beta', body: 'b' });
    const g = skillGraph()
      .entry(a, { when: () => false })
      .entry(b)
      .entryByRelevance(emb)
      .build();
    const res = await g.scoreEntries!(ctx({ userMessage: 'anything' }));
    expect(res.ranked.map((r) => r.id)).toEqual(['b']); // a gated out by its when
    expect(res.chosen).toBe('b');
  });

  it('no candidates → chosen undefined + empty ranked (agent falls back to cold-start)', async () => {
    const a = defineSkill({ id: 'a', description: 'alpha', body: 'b' });
    const g = skillGraph()
      .entry(a, { when: () => false })
      .entryByRelevance(emb)
      .build();
    expect(await g.scoreEntries!(ctx({ userMessage: 'x' }))).toEqual({
      chosen: undefined,
      ranked: [],
    });
  });

  it('scoreEntries is absent without .entryByRelevance(), and on tree-mode graphs', () => {
    const a = defineSkill({ id: 'a', description: 'alpha', body: 'b' });
    expect(skillGraph().entry(a).build().scoreEntries).toBeUndefined();
    const t = skillGraph()
      .tree(decide((c) => /x/.test(c.userMessage), skill('p'), skill('q')))
      .entryByRelevance(emb)
      .build();
    expect(t.scoreEntries).toBeUndefined();
  });
});

describe('skillGraph — entryByRelevance through the REAL Agent loop (PickEntry mount)', () => {
  const emb = mockEmbedder();

  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`[${reactMode}] picks the relevant entry as the start skill; the others stay dormant`, async () => {
      // Under entryByRelevance the entries are EXCLUSIVE — only the relevance pick
      // (here billing, which shares characters with the message) should activate.
      const billing = defineSkill({
        id: 'billing',
        description: 'payments and refunds',
        body: 'BILLING',
      });
      const incident = defineSkill({
        id: 'incident',
        description: 'zzz qqq outage',
        body: 'INCIDENT',
      });
      const graph = skillGraph().entry(billing).entry(incident).entryByRelevance(emb).build();

      const activeIds: string[][] = [];
      const recorder = {
        id: 'cap',
        onEmit: (e: { name: string; payload?: { activeIds?: string[] } }) => {
          if (e.name === 'agentfootprint.context.evaluated') {
            activeIds.push([...(e.payload?.activeIds ?? [])].sort());
          }
        },
      };
      const agent = Agent.create({
        provider: mock({ reply: 'done' }),
        model: 'mock',
        maxIterations: 3,
        reactMode,
      })
        .system('')
        .skillGraph(graph)
        .recorder(recorder)
        .build();
      await agent.run({ message: 'i need a refund for my payment' });

      const everActive = new Set(activeIds.flat());
      expect(everActive.has('billing')).toBe(true); // the relevance pick activated
      expect(everActive.has('incident')).toBe(false); // dormant — entries are exclusive here
    });
  }

  it('exposes the relevance ranking on the snapshot (entryScores)', async () => {
    const billing = defineSkill({ id: 'billing', description: 'payments and refunds', body: 'b' });
    const incident = defineSkill({ id: 'incident', description: 'zzz qqq outage', body: 'b' });
    const graph = skillGraph().entry(billing).entry(incident).entryByRelevance(emb).build();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('')
      .skillGraph(graph)
      .build();
    await agent.run({ message: 'i need a refund for my payment' });

    const scores = (
      agent.getLastSnapshot()?.sharedState as {
        entryScores?: Array<{ id: string; relevance: number }>;
      }
    )?.entryScores;
    expect(scores?.map((s) => s.id).sort()).toEqual(['billing', 'incident']);
    expect(scores!.reduce((sum, s) => sum + s.relevance, 0)).toBeCloseTo(1, 5);
  });
});

describe('skillGraph — checkup (build-time validation)', () => {
  it('a clean flat graph → ok, no problems', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 'x' }).build();
    expect(g.checkup()).toEqual({ ok: true, problems: [] });
  });

  it('no entry → ERROR (ok:false)', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skillGraph().route(a, b, { onToolReturn: 'x' }).build({ check: 'off' }).checkup();
    expect(c.ok).toBe(false);
    expect(c.problems.map((p) => p.code)).toContain('no-entry');
  });

  it('unreachable skill → WARNING (not an error)', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const d = skill('d');
    // a→b is reachable; c→d is a separate island unreachable from the entry `a`.
    const ck = skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'x' })
      .route(c, d, { onToolReturn: 'y' })
      .build({ check: 'off' })
      .checkup();
    const unreachable = ck.problems
      .filter((p) => p.code === 'unreachable-skill')
      .map((p) => p.skill);
    expect(unreachable).toContain('c');
    expect(ck.ok).toBe(true); // warnings don't fail ok
  });

  it('ambiguous routes (≥2 predicates from one skill) → WARNING', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const amb = skillGraph()
      .entry(a)
      .route(a, b, { when: () => true })
      .route(a, c, { when: () => true })
      .build({ check: 'off' })
      .checkup()
      .problems.filter((p) => p.code === 'ambiguous-routes');
    expect(amb).toHaveLength(1);
    expect(amb[0]!.from).toBe('a');
  });

  it('self-loop → WARNING', () => {
    const a = skill('a');
    const g = skillGraph().entry(a).route(a, a, { onToolReturn: 'x' }).build({ check: 'off' });
    expect(g.checkup().problems.some((p) => p.code === 'self-loop')).toBe(true);
  });

  it('build({check:"throw"}) throws on an error; build({check:"off"}) never throws', () => {
    const a = skill('a');
    const b = skill('b');
    expect(() => skillGraph().route(a, b, { onToolReturn: 'x' }).build({ check: 'throw' })).toThrow(
      /no-entry/,
    );
    expect(() =>
      skillGraph().route(a, b, { onToolReturn: 'x' }).build({ check: 'off' }),
    ).not.toThrow();
  });

  it('build({check:"warn"}) warns in dev mode, silent otherwise', () => {
    const a = skill('a');
    const b = skill('b');
    const c = skill('c');
    const mk = () =>
      skillGraph()
        .entry(a)
        .route(a, b, { when: () => true })
        .route(a, c, { when: () => true });

    const warn1 = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mk().build({ check: 'warn' });
      expect(warn1).not.toHaveBeenCalled(); // silent without dev mode
    } finally {
      warn1.mockRestore();
    }

    const warn2 = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    try {
      mk().build({ check: 'warn' });
      expect(warn2).toHaveBeenCalledTimes(1);
      expect(warn2.mock.calls[0]![0]).toMatch(/ambiguous-routes/);
    } finally {
      disableDevMode();
      warn2.mockRestore();
    }
  });

  it('tree-mode graph → ok (exhaustive by construction)', () => {
    const io = skill('io');
    const tri = skill('tri');
    const g = skillGraph()
      .tree(decide((c) => /io/.test(c.userMessage), io, tri))
      .build();
    expect(g.checkup().ok).toBe(true);
  });
});

describe('skillGraph — object-literal config form', () => {
  it('builds a graph equivalent to the fluent form', () => {
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph({
      skills: [a, b],
      start: 'a',
      steps: [{ from: 'a', to: 'b', onToolReturn: 'x' }],
    });
    expect(g.skills.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect([...g.reachableSkills('a')]).toEqual(['b']);
    expect(
      g.nextSkill(ctx({ currentSkillId: 'a', lastToolResult: { toolName: 'x', result: '' } })),
    ).toBe('b');
  });

  it("the check-up flags a listed-but-unwired skill (the object form's value)", () => {
    const a = skill('a');
    const b = skill('b');
    const orphan = skill('orphan');
    const g = skillGraph({
      skills: [a, b, orphan],
      start: 'a',
      steps: [{ from: 'a', to: 'b', onToolReturn: 'x' }],
      check: 'off',
    });
    const unreachable = g
      .checkup()
      .problems.filter((p) => p.code === 'unreachable-skill')
      .map((p) => p.skill);
    expect(unreachable).toContain('orphan');
  });

  it('default check "throw" rejects a step to an unknown skill id', () => {
    const a = skill('a');
    expect(() =>
      skillGraph({ skills: [a], start: 'a', steps: [{ from: 'a', to: 'b', onToolReturn: 'x' }] }),
    ).toThrow(/not in skills/);
  });

  it('start: { rules } → conditional entries; start: { entries, byRelevance } → relevance entry', () => {
    const a = defineSkill({ id: 'a', description: 'alpha', body: 'b' });
    const b = defineSkill({ id: 'b', description: 'beta', body: 'b' });
    const ruled = skillGraph({
      skills: [a, b],
      start: {
        rules: [
          { when: (c) => /b/.test(c.userMessage), use: 'b' },
          { when: () => true, use: 'a' },
        ],
      },
      check: 'off',
    });
    expect([...ruled.reachableSkills(undefined)].sort()).toEqual(['a', 'b']); // both are entries

    const rel = skillGraph({
      skills: [a, b],
      start: { entries: ['a', 'b'], byRelevance: mockEmbedder() },
      check: 'off',
    });
    expect(rel.scoreEntries).toBeDefined();
  });

  it('tree config compiles', () => {
    const io = skill('io');
    const tri = skill('tri');
    const g = skillGraph({
      skills: [io, tri],
      tree: decide((c) => /io/.test(c.userMessage), io, tri),
    });
    expect(g.skills.map((s) => s.id).sort()).toEqual(['io', 'tri']);
    expect(g.checkup().ok).toBe(true);
  });
});

describe('defineRelevanceHint — advisory note on an ambiguous entry', () => {
  const fire = (hint: Injection, over: Partial<InjectionContext>) =>
    (hint.trigger as { activeWhen: (c: InjectionContext) => boolean }).activeWhen(ctx(over));

  it('fires only on turn start (iteration 1) when the top entries are a near-tie', () => {
    const hint = defineRelevanceHint({ threshold: 0.15 });
    const nearTie = [
      { id: 'a', cosine: 0.5, relevance: 0.34 },
      { id: 'b', cosine: 0.49, relevance: 0.33 },
      { id: 'c', cosine: 0.4, relevance: 0.33 },
    ];
    expect(fire(hint, { iteration: 1, entryScores: nearTie })).toBe(true);
    expect(fire(hint, { iteration: 2, entryScores: nearTie })).toBe(false); // only turn start
    const clear = [
      { id: 'a', cosine: 0.9, relevance: 0.8 },
      { id: 'b', cosine: 0.2, relevance: 0.2 },
    ];
    expect(fire(hint, { iteration: 1, entryScores: clear })).toBe(false); // not a tie
    expect(fire(hint, { iteration: 1 })).toBe(false); // no scores (no entryByRelevance)
  });

  it('the note is advisory (anti-anchoring), not an instruction', () => {
    const hint = defineRelevanceHint();
    expect(hint.inject.systemPrompt).toMatch(/weak hint|judgment|not an instruction/i);
    expect(hint.flavor).toBe('instructions');
  });

  it('activates in a real entryByRelevance run when the entries tie (mockEmbedder is flat)', async () => {
    const a = defineSkill({ id: 'a', description: 'alpha topic', body: 'a' });
    const b = defineSkill({ id: 'b', description: 'beta topic', body: 'b' });
    const graph = skillGraph().entry(a).entry(b).entryByRelevance(mockEmbedder()).build();
    const activeIds: string[][] = [];
    const recorder = {
      id: 'cap',
      onEmit: (e: { name: string; payload?: { activeIds?: string[] } }) => {
        if (e.name === 'agentfootprint.context.evaluated')
          activeIds.push([...(e.payload?.activeIds ?? [])]);
      },
    };
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('')
      .skillGraph(graph)
      .instruction(defineRelevanceHint())
      .recorder(recorder)
      .build();
    await agent.run({ message: 'something genuinely ambiguous' });

    expect(activeIds[0]).toContain('relevance-hint'); // fired at turn start on the tie
  });
});

describe('skillGraph — scoped read_skill gate (real Agent loop)', () => {
  // From entry `a`, reachable = its successors {b (route), m (bare model edge)}.
  // `x` is reachable only from `b` (b→x), so a read_skill('x') while the cursor is
  // on `a` must be REJECTED. read_skill('m') (a model-reachable bare edge from a)
  // is ALLOWED and actually activates (m keeps its llm-activated trigger).
  const mkGraph = () => {
    const a = skill('a');
    const b = skill('b', 'B BODY');
    const m = skill('m', 'M BODY');
    const x = skill('x', 'X BODY');
    return skillGraph()
      .entry(a)
      .route(a, b, { onToolReturn: 'go' }) // deterministic → cursor-gated
      .route(a, m) //                          bare model edge → read_skill-reachable from a
      .route(b, x, { onToolReturn: 'go2' }) //  x reachable only from b, NOT from a
      .build();
  };

  const capture = () => {
    const activeIds: string[][] = [];
    const rejected: Array<{
      requestedId: string;
      currentSkillId?: string;
      allowed: readonly string[];
    }> = [];
    const recorder = {
      id: 'cap',
      onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.context.evaluated') {
          activeIds.push([...((e.payload?.activeIds as string[]) ?? [])].sort());
        }
        if (e.name === 'agentfootprint.skill.rejected') {
          rejected.push(e.payload as never);
        }
      },
    };
    return { activeIds, rejected, recorder };
  };

  it('rejects a read_skill jump outside the reachable set; accepts an in-set one', async () => {
    const graph = mkGraph();
    const { activeIds, rejected, recorder } = capture();
    let i = 0;
    const provider = mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'jump to x',
            toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'x' } }],
            stopReason: 'tool_use' as const,
          };
        if (i === 2)
          return {
            content: 'jump to m',
            toolCalls: [{ id: 't2', name: 'read_skill', args: { id: 'm' } }],
            stopReason: 'tool_use' as const,
          };
        return { content: 'done', toolCalls: [], stopReason: 'stop' as const };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 6 })
      .system('')
      .skillGraph(graph)
      .recorder(recorder)
      .build();
    await agent.run({ message: 'go' });

    // 'x' was rejected — cursor on 'a', reachable = {b, m}
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.requestedId).toBe('x');
    expect(rejected[0]!.currentSkillId).toBe('a');
    expect([...rejected[0]!.allowed].sort()).toEqual(['b', 'm']);

    const everActive = new Set(activeIds.flat());
    expect(everActive.has('x')).toBe(false); // rejected jump never activated
    expect(everActive.has('m')).toBe(true); // in-set model jump activated
  });

  it('plain read_skill agent (no skillGraph) is ungated — any skill activates', async () => {
    const billing = defineSkill({ id: 'billing', description: 'billing', body: 'BILLING' });
    const { activeIds, rejected, recorder } = capture();
    let i = 0;
    const provider = mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'use billing',
            toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }],
            stopReason: 'tool_use' as const,
          };
        return { content: 'done', toolCalls: [], stopReason: 'stop' as const };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .system('')
      .skills({ list: () => [billing] }) // skills but NO skillGraph → gate off
      .recorder(recorder)
      .build();
    await agent.run({ message: 'go' });

    expect(rejected).toHaveLength(0); // gate off → no rejection
    expect(new Set(activeIds.flat()).has('billing')).toBe(true); // activates normally
  });
});
