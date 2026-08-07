/**
 * A route handoff must END the source skill's turn (8.15.0).
 *
 * REPRODUCTION (pre-fix this file FAILS): an entry that carries a `when` compiles
 * to `when(ctx) || nextSkill(ctx) === id`. When such an entry S routes to T, the
 * iteration the edge fires has S's rule STILL matching (the rule reads the user's
 * message, which does not change mid-turn) — so S and T are both active: two skill
 * bodies in the system prompt and two tool sets on the wire, for a graph the author
 * drew as a single-file state machine.
 *
 * The module's own keystone sentence says otherwise ("clean handoff — B deactivates
 * the SAME step C activates — no double-active overlap"), and it is true for every
 * node in a flat graph EXCEPT an entry with a `when`.
 *
 * It is not a one-iteration blip either: on every later iteration the cursor sits on
 * T, S's rule still matches, and S comes back — so the overlap is the steady state,
 * not the transient.
 *
 * THE LAW (8.15.0): in a flat graph a skill is active iff the cursor is on it, or it
 * declared itself unconditional (`.entry(x)` with no `when` → `{ kind: 'always' }`,
 * which is untouched). A rule that matched while the cursor was elsewhere is a
 * SUPPRESSION, reported as `supersededIds` on `context.evaluated`.
 *
 * 7 test types per Convention 3: unit (trigger compilation), functional (the shapes
 * that must NOT change), integration (what the model is handed, end to end),
 * property (never two graph skills at once, over random chains), security (ids only —
 * no body text; one throw told as one story), performance (one resolver pass, O(E)
 * predicate calls), load (a 200-entry router).
 */

import { describe, expect, it } from 'vitest';
import { Agent, checkInApproved, defineTool, isPaused } from '../src/index.js';
import { defineSkill, skillGraph } from '../src/injection-engine.js';
import { evaluateInjections } from '../src/lib/injection-engine/index.js';
import { mock } from '../src/llm-providers.js';
import type { InjectionContext } from '../src/lib/injection-engine/types.js';

// ── helpers ──────────────────────────────────────────────────────────────

const ctx = (over: Partial<InjectionContext>): InjectionContext => ({
  iteration: 1,
  userMessage: 'where is my order',
  history: [],
  activatedInjectionIds: [],
  ...over,
});

const t = (name: string) =>
  defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name}:ran`,
  });

/** `autoActivate: 'currentSkill'` holds a skill's tools back until it is active —
 *  so the tool MENU tracks the active set, which is what makes a double activation
 *  visible as two tool sets on the wire and not just two bodies. */
const skill = (id: string, toolName: string) =>
  defineSkill({
    id,
    description: `${id} skill`,
    body: `${id.toUpperCase()}_BODY`,
    tools: [t(toolName)],
    autoActivate: 'currentSkill',
  });

/** triage is an ENTRY with a `when`; a tool return routes it to refund. */
const handoffGraph = () => {
  const triage = skill('triage', 'lookup_order');
  const refund = skill('refund', 'issue_refund');
  return skillGraph()
    .entry(triage, { when: (c) => /order/.test(c.userMessage) })
    .route(triage, refund, { onToolReturn: 'lookup_order' })
    .build();
};

const fire = (g: ReturnType<typeof handoffGraph>, id: string, c: InjectionContext): boolean =>
  (
    g.skills.find((s) => s.id === id)!.trigger as {
      activeWhen: (c: InjectionContext) => boolean;
    }
  ).activeWhen(c);

const call = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
});

interface Turn {
  readonly active: readonly string[];
  readonly superseded: readonly string[];
  readonly system: string;
  readonly tools: readonly string[];
}

/** Run the graph against a scripted model and report, per iteration, what the
 *  model was actually handed: the active set, the system prompt, the tool menu. */
async function runTurns(script: readonly unknown[]): Promise<Turn[]> {
  const seen: Array<{ system: string; tools: string[] }> = [];
  const active: string[][] = [];
  const superseded: string[][] = [];
  let i = 0;
  const provider = mock({
    respond: (req: { systemPrompt?: string; tools?: ReadonlyArray<{ name: string }> }) => {
      seen.push({
        system: req.systemPrompt ?? '',
        tools: (req.tools ?? []).map((x) => x.name),
      });
      return (script[i++] ?? { content: 'done', toolCalls: [] }) as { content: string };
    },
  });
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
    .skillGraph(handoffGraph())
    .watch({
      id: 'handoff-watch',
      onEmit: (e: { name: string; payload: Record<string, unknown> }) => {
        if (e.name !== 'agentfootprint.context.evaluated') return;
        active.push(e.payload.activeIds as string[]);
        superseded.push((e.payload.supersededIds as string[] | undefined) ?? []);
      },
    })
    .build();
  await agent.run({ message: 'where is my order' });
  return seen.map((s, idx) => ({
    active: active[idx] ?? [],
    superseded: superseded[idx] ?? [],
    system: s.system,
    tools: s.tools,
  }));
}

// ── 1. UNIT — one trigger fires on the handoff iteration ─────────────────

describe('route handoff — trigger compilation', () => {
  it('the target activates and the source it handed off from does NOT', () => {
    const g = handoffGraph();
    const handoff = ctx({
      currentSkillId: 'triage',
      lastToolResult: { toolName: 'lookup_order', result: 'order 42' },
    });
    // The cursor moves — the graph agrees the turn is refund's now.
    expect(g.nextSkill(handoff)).toBe('refund');
    expect(g.explainNextSkill(handoff)).toMatchObject({
      from: 'triage',
      to: 'refund',
      by: 'route',
    });
    // The target activates …
    expect(fire(g, 'refund', handoff)).toBe(true);
    // … and the source it just handed off from does not (pre-8.15.0: `true` — its
    // rule still matched the user's message, so both bodies loaded).
    expect(fire(g, 'triage', handoff)).toBe(false);
  });

  it('the source does not come back on LATER iterations either', () => {
    // The half that makes a handoff-only fix untenable: with the cursor parked on
    // refund, triage's rule STILL matches, so pre-8.15.0 it re-activated here — the
    // overlap was the steady state, and a source suppressed for one iteration only
    // would flap on, off, on.
    const g = handoffGraph();
    const after = ctx({ currentSkillId: 'refund' }); // cursor parked on refund, no edge out
    expect(g.nextSkill(after)).toBe('refund');
    expect(fire(g, 'refund', after)).toBe(true);
    expect(fire(g, 'triage', after)).toBe(false);
    expect(g.supersededEntries(after)).toEqual(['triage']);
  });

  it('the entry still wins the cold start its rule was written for', () => {
    const g = handoffGraph();
    const cold = ctx({});
    expect(g.nextSkill(cold)).toBe('triage');
    expect(fire(g, 'triage', cold)).toBe(true);
    expect(fire(g, 'refund', cold)).toBe(false);
  });
});

// ── 2. INTEGRATION — what the model is actually handed ───────────────────

describe('route handoff — end to end', () => {
  it('the post-route iteration offers ONE body and ONE tool set', async () => {
    const turns = await runTurns([
      call('c1', 'lookup_order'), // iteration 1: triage's tool → fires the edge
      call('c2', 'issue_refund'), // iteration 2: refund's tool
      { content: 'done', toolCalls: [] }, // iteration 3
    ]);

    expect(turns.length).toBeGreaterThanOrEqual(2);

    // Iteration 1 — triage owns the turn.
    expect(turns[0]!.active).toEqual(['triage']);
    expect(turns[0]!.system).toContain('TRIAGE_BODY');
    expect(turns[0]!.system).not.toContain('REFUND_BODY');

    // Iteration 2 — the handoff. refund owns the turn; triage is finished.
    expect(turns[1]!.active).toEqual(['refund']);
    expect(turns[1]!.system).toContain('REFUND_BODY');
    expect(turns[1]!.system).not.toContain('TRIAGE_BODY');
    expect(turns[1]!.tools).toContain('issue_refund');
    expect(turns[1]!.tools).not.toContain('lookup_order');

    // Iteration 3 — still refund's turn; the source does not come back.
    if (turns[2]) {
      expect(turns[2].active).toEqual(['refund']);
      expect(turns[2].system).not.toContain('TRIAGE_BODY');
    }
  });

  it('the suppression is on the record, every iteration it holds', async () => {
    const turns = await runTurns([
      call('c1', 'lookup_order'),
      call('c2', 'issue_refund'),
      { content: 'done', toolCalls: [] },
    ]);
    // Iteration 1: triage IS the cursor — nothing suppressed.
    expect(turns[0]!.superseded).toEqual([]);
    // From the handoff on: triage's rule still matches the message, and the run says
    // out loud that the cursor law is what is keeping it off the wire.
    expect(turns[1]!.superseded).toEqual(['triage']);
    if (turns[2]) expect(turns[2].superseded).toEqual(['triage']);
  });
});

// ── 3. INTEGRATION — the suppression survives a pause on the handoff ─────

describe('route handoff — pause and resume', () => {
  it('a check-in pause on the handed-off iteration resumes with the same one skill', async () => {
    // The law is PURE over the iteration context — it reads `currentSkillId`,
    // `lastToolResult` and `pendingSkillPick`, all of which already round-trip
    // through the checkpoint as ordinary agent state. There is no latch to persist,
    // so a pause cannot resurrect the source skill on the other side.
    const triage = skill('triage', 'lookup_order');
    const refund = defineSkill({
      id: 'refund',
      description: 'refund skill',
      body: 'REFUND_BODY',
      tools: [
        defineTool({
          name: 'issue_refund',
          description: 'issue a refund',
          inputSchema: { type: 'object', properties: {} },
          // A tool that always asks a human — the pause lands on the handed-off
          // iteration, while refund owns the turn.
          checkIn: () => true,
          execute: async () => 'refunded',
        }),
      ],
      autoActivate: 'currentSkill',
    });
    const graph = skillGraph()
      .entry(triage, { when: (c) => /order/.test(c.userMessage) })
      .route(triage, refund, { onToolReturn: 'lookup_order' })
      .build();

    const active: string[][] = [];
    const script: unknown[] = [
      call('c1', 'lookup_order'),
      call('c2', 'issue_refund'),
      { content: 'done', toolCalls: [] },
    ];
    let i = 0;
    const agent = Agent.create({
      provider: mock({ respond: () => script[i++] ?? { content: 'done', toolCalls: [] } }),
      model: 'mock',
      maxIterations: 5,
    })
      .skillGraph(graph)
      .checkIn()
      .watch({
        id: 'pause-watch',
        onEmit: (e: { name: string; payload: Record<string, unknown> }) => {
          if (e.name === 'agentfootprint.context.evaluated')
            active.push(e.payload.activeIds as string[]);
        },
      })
      .build();

    const paused = await agent.run({ message: 'where is my order' });
    expect(isPaused(paused)).toBe(true);
    // Paused ON the handoff: refund owns the turn already, triage is finished.
    expect(active[1]).toEqual(['refund']);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const checkpoint = (paused as { checkpoint: unknown }).checkpoint!;
    const resumed = await agent.resume(checkpoint as never, checkInApproved({ by: 'tester' }));
    expect(isPaused(resumed)).toBe(false);
    // Every iteration after the resume is still one skill's turn — the source does
    // not come back across the checkpoint boundary.
    for (const ids of active.slice(1)) expect(ids).toEqual(['refund']);
  });
});

// ── 4. FUNCTIONAL — the shapes that must NOT change ──────────────────────

describe('route handoff — what stays exactly as it was', () => {
  const idsActive = (g: { skills: readonly unknown[] }, c: InjectionContext) =>
    evaluateInjections(g.skills as never, c)
      .active.map((i) => i.id)
      .sort();

  it('an unconditional entry is still `always` — a persistent base still co-activates', () => {
    const base = defineSkill({ id: 'base', description: 'base', body: 'BASE' });
    const step = defineSkill({ id: 'step', description: 'step', body: 'STEP' });
    const g = skillGraph().entry(base).route(base, step, { onToolReturn: 'probe' }).build();
    expect(g.skills.find((s) => s.id === 'base')!.trigger.kind).toBe('always');
    const handoff = ctx({
      currentSkillId: 'base',
      lastToolResult: { toolName: 'probe', result: 'r' },
    });
    expect(idsActive(g, handoff)).toEqual(['base', 'step']);
    expect(g.supersededEntries(handoff)).toEqual([]);
  });

  it('a route TARGET is unchanged — it was already cursor-gated', () => {
    const g = handoffGraph();
    expect(fire(g, 'refund', ctx({ currentSkillId: 'refund' }))).toBe(true);
    expect(fire(g, 'refund', ctx({ currentSkillId: 'triage' }))).toBe(false);
  });

  it('a graph with no conditional entry reports no suppression, ever', () => {
    const base = defineSkill({ id: 'base', description: 'base', body: 'BASE' });
    const g = skillGraph().entry(base).build();
    expect(g.supersededEntries(ctx({}))).toEqual([]);
    expect(g.supersededEntries(ctx({ currentSkillId: 'base' }))).toEqual([]);
  });

  it('a non-skill-graph run emits no `supersededIds` at all', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('plain agent')
      .watch({
        id: 'plain-watch',
        onEmit: (e: { name: string; payload: Record<string, unknown> }) => {
          if (e.name === 'agentfootprint.context.evaluated') payloads.push(e.payload);
        },
      })
      .build();
    await agent.run({ message: 'hi' });
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) expect(p.supersededIds).toBeUndefined();
  });
});

// ── 5. PROPERTY — never two graph skills at once ─────────────────────────

describe('route handoff — the invariant, over many shapes', () => {
  it('at most ONE conditional-entry graph skill is active on any iteration', () => {
    // A chain of rule entries, each routing onward, all of whose rules match at once —
    // the worst case for the old OR clause. Walked over every cursor position.
    for (let n = 2; n <= 8; n++) {
      const skills = Array.from({ length: n }, (_, i) =>
        defineSkill({ id: `s${i}`, description: `s${i}`, body: `BODY_${i}` }),
      );
      let b = skillGraph();
      for (const s of skills) b = b.entry(s, { when: () => true });
      for (let i = 0; i + 1 < n; i++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        b = b.route(skills[i]!, skills[i + 1]!, { onToolReturn: `t${i}` });
      }
      const g = b.build({ check: 'off' });
      const positions: InjectionContext[] = [ctx({})];
      for (let i = 0; i < n; i++) {
        positions.push(ctx({ currentSkillId: `s${i}` }));
        positions.push(
          ctx({ currentSkillId: `s${i}`, lastToolResult: { toolName: `t${i}`, result: 'r' } }),
        );
      }
      for (const c of positions) {
        const active = evaluateInjections(g.skills, c).active.map((i) => i.id);
        expect(active.length).toBe(1);
        // The active one is exactly where the cursor went…
        expect(active[0]).toBe(g.nextSkill(c));
        // …and active ∩ superseded is empty: a skill is never both on the wire and
        // reported as kept off it.
        const superseded = g.supersededEntries(c);
        expect(superseded).not.toContain(active[0]);
        // Every entry that is neither the cursor nor superseded had a false rule —
        // here all rules are true, so the two sets partition the graph.
        expect(new Set([...active, ...superseded]).size).toBe(n);
      }
    }
  });
});

// ── 6. SECURITY — the report says ids, and one throw is one story ────────

describe('route handoff — what the suppression report may carry', () => {
  it('carries ids only — never a skill body, description or predicate source', async () => {
    const turns = await runTurns([call('c1', 'lookup_order'), { content: 'x', toolCalls: [] }]);
    const reported = turns.flatMap((t) => t.superseded);
    expect(reported).toContain('triage');
    for (const value of reported) {
      expect(value).toBe('triage');
      expect(value).not.toContain('BODY');
    }
  });

  it('a throwing entry rule is told ONCE — as `predicate-threw`, not as a suppression', () => {
    const boom = defineSkill({ id: 'boom', description: 'boom', body: 'BOOM' });
    const ok = defineSkill({ id: 'ok', description: 'ok', body: 'OK' });
    const g = skillGraph()
      .entry(ok, { when: () => true })
      .entry(boom, {
        when: () => {
          throw new Error('predicate exploded');
        },
      })
      .build({ check: 'off' });
    const c = ctx({ currentSkillId: 'ok' });
    const out = evaluateInjections(g.skills, c);
    expect(out.active.map((i) => i.id)).toEqual(['ok']);
    expect(out.skipped).toMatchObject([{ id: 'boom', reason: 'predicate-threw' }]);
    // The same throw is NOT also reported as a suppression.
    expect(g.supersededEntries(c)).toEqual([]);
  });
});

// ── 7. PERFORMANCE + LOAD — the cost of asking ───────────────────────────

describe('route handoff — cost', () => {
  it('one evaluation pass = one resolver pass, however many triggers ask', () => {
    let routeChecks = 0;
    const a = defineSkill({ id: 'a', description: 'a', body: 'A' });
    const b = defineSkill({ id: 'b', description: 'b', body: 'B' });
    const c = defineSkill({ id: 'c', description: 'c', body: 'C' });
    const g = skillGraph()
      .entry(a, { when: () => true })
      .route(a, b, {
        when: () => {
          routeChecks += 1;
          return false;
        },
      })
      .route(a, c, {
        when: () => {
          routeChecks += 1;
          return false;
        },
      })
      .build({ check: 'off' });
    evaluateInjections(
      g.skills,
      ctx({ currentSkillId: 'a', lastToolResult: { toolName: 'probe', result: 'r' } }),
    );
    // Two edges out of `a`, walked once — not once per compiled trigger.
    expect(routeChecks).toBe(2);
  });

  it('the suppression report costs at most one predicate call per other entry', () => {
    let calls = 0;
    const n = 50;
    let b = skillGraph();
    for (let i = 0; i < n; i++) {
      b = b.entry(defineSkill({ id: `e${i}`, description: `e${i}`, body: `B${i}` }), {
        when: () => {
          calls += 1;
          return true;
        },
      });
    }
    const g = b.build({ check: 'off' });
    calls = 0;
    g.supersededEntries(ctx({ currentSkillId: 'e0' }));
    // The cursor's own entry is skipped; the rest are asked once each. O(E), not O(E²).
    expect(calls).toBe(n - 1);
  });

  it('load: a 200-entry rule router still loads exactly one skill', () => {
    const n = 200;
    let b = skillGraph();
    for (let i = 0; i < n; i++) {
      b = b.entry(defineSkill({ id: `e${i}`, description: `e${i}`, body: `B${i}` }), {
        when: (x) => x.userMessage.includes(`[k${i}]`),
      });
    }
    const g = b.build({ check: 'off' });
    const c = ctx({ userMessage: '[k7] [k11] [k42]' });
    const active = evaluateInjections(g.skills, c).active.map((i) => i.id);
    expect(active).toEqual(['e7']);
    // The two that also matched are named, not silently dropped.
    expect(g.supersededEntries(c)).toEqual(['e11', 'e42']);
  });
});
