/**
 * The model's `read_skill` pick is HONOURED (8.3.0).
 *
 * `read_skill('id')` is gated to `graph.reachableSkills(cursor)` and answers
 * "Skill 'id' activated for the next iteration." Until 8.3.0 that sentence was
 * false for every skill whose activation was cursor-gated or rule-gated: the id
 * was appended to `activatedInjectionIds`, which only the `llm-activated` trigger
 * kind ever reads — so a rules-form entry, an exclusive entry and a route target
 * all ignored it. The agent was told a thing had happened that never happened,
 * and (for the rules form with no matching rule) no skill could EVER load.
 *
 * What this file pins:
 *   1. the five shapes of that lie, each fixed;
 *   2. the told-the-truth invariant — an accepted pick is in the NEXT iteration's
 *      active set, or the run says why not (`skill.reroute_superseded`);
 *   3. byte-identity for every path that already worked (a matching rule, an
 *      unconditional entry, a graph-less agent);
 *   4. the precedence: a declared edge beats a same-turn pick, and a pick never
 *      drags the cursor backwards afterwards.
 */

import { describe, it, expect } from 'vitest';
import { defineTool, Agent } from '../src/index.js';
import { skillGraph, defineSkill } from '../src/injection-engine.js';
import { mock } from '../src/llm-providers.js';
import { evaluateInjections } from '../src/lib/injection-engine/index.js';
import type { InjectionContext } from '../src/lib/injection-engine/types.js';

// ── helpers ──────────────────────────────────────────────────────────────

const ctx = (over: Partial<InjectionContext>): InjectionContext => ({
  iteration: 1,
  userMessage: 'q',
  history: [],
  activatedInjectionIds: [],
  ...over,
});

const tool = (name: string, result = `${name} result`) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => result });

const skillWithTool = (id: string, t: ReturnType<typeof tool>) =>
  defineSkill({
    id,
    description: `use ${id}`,
    body: `${id.toUpperCase()} BODY`,
    tools: [t],
    autoActivate: 'currentSkill',
  });

interface RunLog {
  /** activeIds per iteration, in order. */
  readonly active: Array<{ iteration: number; ids: readonly string[] }>;
  /** tool names offered to the model per iteration. */
  readonly offered: Array<{ iteration: number; names: readonly string[] }>;
  /** read_skill calls the model made: { iteration, id }. */
  readonly picks: Array<{ iteration: number; id: string }>;
  /** picks the gate refused. */
  readonly rejected: Array<{ iteration: number; id: string }>;
  /** accepted picks a declared edge outranked. */
  readonly superseded: Array<{ iteration: number; id: string; won?: string }>;
}

/** Attach the four listeners this file reasons over. */
function watch(agent: {
  on: (n: string, f: (e: { payload: unknown }) => void) => unknown;
}): RunLog {
  const log: RunLog = { active: [], offered: [], picks: [], rejected: [], superseded: [] };
  agent.on('agentfootprint.context.evaluated', (e) => {
    const p = e.payload as { iteration: number; activeIds: readonly string[] };
    log.active.push({ iteration: p.iteration, ids: [...p.activeIds] });
  });
  agent.on('agentfootprint.stream.llm_start', (e) => {
    const p = e.payload as { iteration: number; tools?: ReadonlyArray<{ name: string }> };
    log.offered.push({ iteration: p.iteration, names: (p.tools ?? []).map((t) => t.name) });
  });
  agent.on('agentfootprint.stream.tool_start', (e) => {
    const p = e.payload as { toolName: string; args: { id?: unknown }; iteration?: number };
    if (p.toolName === 'read_skill' && typeof p.args.id === 'string') {
      log.picks.push({ iteration: log.active.length, id: p.args.id });
    }
  });
  agent.on('agentfootprint.skill.rejected', (e) => {
    const p = e.payload as { requestedId: string; iteration: number };
    log.rejected.push({ iteration: p.iteration, id: p.requestedId });
  });
  agent.on('agentfootprint.skill.reroute_superseded', (e) => {
    const p = e.payload as { volunteeredId: string; wonId?: string; iteration: number };
    log.superseded.push({
      iteration: p.iteration,
      id: p.volunteeredId,
      ...(p.wonId !== undefined && { won: p.wonId }),
    });
  });
  return log;
}

/**
 * THE INVARIANT. Every `read_skill` the gate accepted claimed the skill would be
 * active on the next iteration — so it must be, unless the run emitted the one
 * event that admits otherwise.
 */
function assertToldTheTruth(log: RunLog): void {
  for (const pick of log.picks) {
    if (log.rejected.some((r) => r.id === pick.id && r.iteration === pick.iteration)) continue;
    const next = log.active.find((a) => a.iteration === pick.iteration + 1);
    if (next === undefined) continue; // the run ended; there was no next iteration to lie about
    const honoured = next.ids.includes(pick.id);
    const explained = log.superseded.some(
      (s) => s.id === pick.id && s.iteration === pick.iteration + 1,
    );
    expect(
      honoured || explained,
      `read_skill("${pick.id}") on iteration ${pick.iteration} answered "activated for the ` +
        `next iteration", but iteration ${pick.iteration + 1} was [${next.ids.join(', ')}] ` +
        `and nothing said why`,
    ).toBe(true);
  }
}

// ── 1. UNIT — trigger compilation ────────────────────────────────────────

describe('model pick — trigger compilation', () => {
  it('an unconditional entry stays `always` (the cursor can add nothing)', () => {
    const g = skillGraph()
      .entry(defineSkill({ id: 'a', description: 'a', body: 'A' }))
      .build();
    expect(g.skills.find((s) => s.id === 'a')!.trigger.kind).toBe('always');
  });

  it('an intent entry is active when its rule matches OR the cursor is on it', () => {
    const a = defineSkill({ id: 'a', description: 'a', body: 'A' });
    const b = defineSkill({ id: 'b', description: 'b', body: 'B' });
    const g = skillGraph()
      .entry(a, { when: (c) => /alpha/.test(c.userMessage) })
      .entry(b, { when: (c) => /beta/.test(c.userMessage) })
      .build();
    const fire = (id: string, c: InjectionContext) =>
      (
        g.skills.find((s) => s.id === id)!.trigger as {
          activeWhen: (c: InjectionContext) => boolean;
        }
      ).activeWhen(c);

    // rule matches → active (unchanged)
    expect(fire('a', ctx({ userMessage: 'alpha' }))).toBe(true);
    // rule doesn't match and nothing points here → inactive (unchanged)
    expect(fire('b', ctx({ userMessage: 'alpha' }))).toBe(false);
    // no rule matches, but the model picked it → active
    expect(fire('b', ctx({ userMessage: 'gamma', pendingSkillPick: 'b' }))).toBe(true);
    // a's rule still owns its own message: a matching rule outranks the pick,
    // so 'b' does not become the cursor and stays dark.
    expect(fire('b', ctx({ userMessage: 'alpha', pendingSkillPick: 'b' }))).toBe(false);
  });

  it('a matching rule short-circuits — the cursor resolver is never consulted', () => {
    let routeChecks = 0;
    const a = defineSkill({ id: 'a', description: 'a', body: 'A' });
    const b = defineSkill({ id: 'b', description: 'b', body: 'B' });
    const g = skillGraph()
      .entry(a, { when: () => true })
      .route(a, b, {
        when: () => {
          routeChecks += 1;
          return false;
        },
      })
      .build();
    const trig = g.skills.find((s) => s.id === 'a')!.trigger as {
      activeWhen: (c: InjectionContext) => boolean;
    };
    expect(
      trig.activeWhen(ctx({ currentSkillId: 'a', lastToolResult: { toolName: 't', result: 'r' } })),
    ).toBe(true);
    expect(routeChecks).toBe(0);
  });

  it('a throwing entry rule still surfaces as `predicate-threw` (unchanged)', () => {
    const a = defineSkill({ id: 'a', description: 'a', body: 'A' });
    const g = skillGraph()
      .entry(a, {
        when: () => {
          throw new Error('boom');
        },
      })
      .build();
    const out = evaluateInjections(g.skills, ctx({}));
    expect(out.active).toEqual([]);
    expect(out.skipped[0]).toMatchObject({ id: 'a', reason: 'predicate-threw' });
  });

  it('the resolver is memoized per evaluation pass (cost stays O(entries), not O(entries²))', () => {
    let ruleCalls = 0;
    const mk = (id: string) => defineSkill({ id, description: id, body: id });
    const g = skillGraph()
      .entry(mk('e1'), {
        when: () => {
          ruleCalls += 1;
          return false;
        },
      })
      .entry(mk('e2'), { when: () => false })
      .entry(mk('e3'), { when: () => false })
      .entry(mk('e4'), { when: () => false })
      .build();
    evaluateInjections(g.skills, ctx({}));
    // Once from e1's own trigger + once inside the single memoized cold-start scan.
    // Un-memoized this would be 1 + 4 (one scan per entry trigger).
    expect(ruleCalls).toBe(2);
  });
});

// ── 2. UNIT — the cursor resolver's precedence table ─────────────────────

describe('model pick — nextSkill precedence', () => {
  const a = defineSkill({ id: 'a', description: 'a', body: 'A' });
  const b = defineSkill({ id: 'b', description: 'b', body: 'B' });
  const c = defineSkill({ id: 'c', description: 'c', body: 'C' });
  const graph = () =>
    skillGraph({
      skills: [a, b, c],
      start: {
        rules: [
          { when: (x) => /alpha/.test(x.userMessage ?? ''), use: 'a' },
          { when: (x) => /beta/.test(x.userMessage ?? ''), use: 'b' },
        ],
      },
      steps: [{ from: 'a', to: 'c', onToolReturn: 'probe' }],
      check: 'throw',
    });

  it('cold start: a matching rule WINS over a same-turn pick', () => {
    expect(graph().nextSkill(ctx({ userMessage: 'alpha', pendingSkillPick: 'b' }))).toBe('a');
  });

  it('cold start: no rule matches → the pick becomes the starting cursor', () => {
    expect(graph().nextSkill(ctx({ userMessage: 'nothing matches', pendingSkillPick: 'b' }))).toBe(
      'b',
    );
  });

  it('cold start: a pick that is not an entry cannot start a turn', () => {
    // (the gate never offers one at cold start; belt-and-braces at the resolver)
    expect(
      graph().nextSkill(ctx({ userMessage: 'nothing matches', pendingSkillPick: 'c' })),
    ).toBeUndefined();
  });

  it('mid-run: a declared edge that fires BEATS the same-turn pick (D1 > D2)', () => {
    expect(
      graph().nextSkill(
        ctx({
          userMessage: 'alpha',
          currentSkillId: 'a',
          lastToolResult: { toolName: 'probe', result: 'r' },
          pendingSkillPick: 'b',
        }),
      ),
    ).toBe('c');
  });

  it('mid-run: no edge fires → the pick moves the cursor', () => {
    expect(
      graph().nextSkill(
        ctx({
          userMessage: 'alpha',
          currentSkillId: 'a',
          lastToolResult: { toolName: 'read_skill', result: 'ok' },
          pendingSkillPick: 'b',
        }),
      ),
    ).toBe('b');
  });

  it('the pick is one-shot: with none pending the cursor stays put (no backwards bounce)', () => {
    // iteration N+1 after an edge moved the cursor to c: the earlier pick of 'b'
    // is gone from scope, so nothing pulls the cursor back.
    expect(graph().nextSkill(ctx({ userMessage: 'alpha', currentSkillId: 'c' }))).toBe('c');
  });

  it('picking the CURRENT skill is a stay, not a hop', () => {
    expect(
      graph().nextSkill(ctx({ userMessage: 'alpha', currentSkillId: 'a', pendingSkillPick: 'a' })),
    ).toBe('a');
  });
});

// ── 3. INTEGRATION — the five shapes, through the real evaluator ─────────

describe('model pick — the five shapes, through the real evaluator', () => {
  const active = (skills: readonly unknown[], c: InjectionContext) =>
    evaluateInjections(skills as never, c).active.map((i) => i.id);

  it('shape 1 — rules form, no rule matched: the picked entry activates', () => {
    const esxi = defineSkill({ id: 'esxi', description: 'esxi', body: 'ESXI' });
    const g = skillGraph({
      skills: [esxi],
      start: { rules: [{ when: (c) => /esxi/i.test(c.userMessage ?? ''), use: 'esxi' }] },
      check: 'throw',
    });
    const miss = ctx({ userMessage: 'why is my storage slow' });
    expect(active(g.skills, miss)).toEqual([]);
    expect(active(g.skills, { ...miss, pendingSkillPick: 'esxi' })).toEqual(['esxi']);
  });

  it('shape 2 — a matching rule is unaffected (byte-identical)', () => {
    const esxi = defineSkill({ id: 'esxi', description: 'esxi', body: 'ESXI' });
    const g = skillGraph({
      skills: [esxi],
      start: { rules: [{ when: (c) => /esxi/i.test(c.userMessage ?? ''), use: 'esxi' }] },
      check: 'throw',
    });
    const hit = ctx({ userMessage: 'list esxi hosts' });
    expect(active(g.skills, hit)).toEqual(['esxi']);
    expect(g.nextSkill(hit)).toBe('esxi');
  });

  it('shape 3 — a route target the model picked activates', () => {
    const triage = defineSkill({ id: 'triage', description: 'triage', body: 'T' });
    const vol = defineSkill({ id: 'volume-lookup', description: 'vol', body: 'V' });
    const g = skillGraph().entry(triage).route(triage, vol, { onToolReturn: 'get_volume' }).build();
    expect(g.reachableSkills('triage')).toContain('volume-lookup');
    const onTriage = ctx({ currentSkillId: 'triage' });
    expect(active(g.skills, onTriage)).toEqual(['triage']);
    // `triage` is an unconditional entry (`always`), so it stays on as the base —
    // the point is that the picked route target now joins it instead of never
    // loading until its edge predicate happened to fire.
    expect(active(g.skills, { ...onTriage, pendingSkillPick: 'volume-lookup' })).toEqual([
      'triage',
      'volume-lookup',
    ]);
  });

  it('shape 4 — a second entry pick mid-run switches the exclusive entry', () => {
    const billing = defineSkill({ id: 'billing', description: 'payments', body: 'B' });
    const incident = defineSkill({ id: 'incident', description: 'outage', body: 'I' });
    const g = skillGraph({
      skills: [billing, incident],
      start: { entries: ['billing', 'incident'] },
      check: 'throw',
    });
    const onBilling = ctx({ currentSkillId: 'billing', activatedInjectionIds: ['billing'] });
    expect(active(g.skills, onBilling)).toEqual(['billing']);
    expect(
      active(g.skills, {
        ...onBilling,
        activatedInjectionIds: ['billing', 'incident'],
        pendingSkillPick: 'incident',
      }),
    ).toEqual(['incident']);
  });

  it('shape 5 — a declared step INTO a rule-entry skill finally activates it', () => {
    // The latent one: `volume-lookup` is both an intent entry and the target of a
    // step out of `esxi`. The step moved the cursor and the skill stayed dark,
    // because its compiled trigger was its own entry rule (written for the user's
    // message, not for the hop) — the graph's cursor and its active set disagreed.
    const esxi = defineSkill({ id: 'esxi', description: 'esxi', body: 'E' });
    const vol = defineSkill({ id: 'volume-lookup', description: 'vol', body: 'V' });
    const g = skillGraph({
      skills: [esxi, vol],
      start: {
        rules: [
          { when: (c) => /vm|esxi/i.test(c.userMessage ?? ''), use: 'esxi' },
          { when: (c) => /naa\./i.test(c.userMessage ?? ''), use: 'volume-lookup' },
        ],
      },
      steps: [{ from: 'esxi', to: 'volume-lookup', onToolReturn: 'get_vm_storage' }],
      check: 'throw',
    });
    const hop = ctx({
      userMessage: 'show vm storage',
      currentSkillId: 'esxi',
      lastToolResult: { toolName: 'get_vm_storage', result: '{"array_wwn":"naa.6000"}' },
    });
    expect(g.nextSkill(hop)).toBe('volume-lookup'); // the cursor always moved …
    expect(active(g.skills, hop)).toContain('volume-lookup'); // … now the skill follows it
  });
});

// ── 4. E2E — the reported repro, end to end ──────────────────────────────

describe('model pick — end to end', () => {
  it('THE REPRO: rules form + a message no rule matches → read_skill → tools arrive', async () => {
    const listHosts = tool('esxi_list_hosts', '{"hosts":["esxi-01"]}');
    const esxi = skillWithTool('esxi-inventory', listHosts);
    const graph = skillGraph({
      skills: [esxi],
      start: {
        rules: [
          { when: (c) => /esxi|inventory/i.test(c.userMessage ?? ''), use: 'esxi-inventory' },
        ],
      },
      check: 'throw',
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'esxi-inventory' } }] },
          { toolCalls: [{ id: 'c2', name: 'esxi_list_hosts', args: {} }] },
          { content: 'ESXi hosts: esxi-01.' },
        ],
      }),
      model: 'mock',
      maxIterations: 6,
    })
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    const answer = await agent.run({ message: 'why is my storage slow today' });

    // iteration 1: nothing matched, so nothing is active and only read_skill is offered
    expect(log.active[0]!.ids).toEqual([]);
    expect(log.offered[0]!.names).toEqual(['read_skill']);
    // iteration 2: the pick took effect — body AND the skill's tools are on the wire
    expect(log.active[1]!.ids).toEqual(['esxi-inventory']);
    expect(log.offered[1]!.names).toContain('esxi_list_hosts');
    expect(log.rejected).toEqual([]);
    expect(answer).toBe('ESXi hosts: esxi-01.');
    assertToldTheTruth(log);
  });

  it("reactMode 'dynamic-grouped' honours the pick too (the other chart's mappers)", async () => {
    // The grouped chart carries the pick across an extra subflow boundary
    // (tool-calls writes it on the OUTER chart; the injection engine reads it
    // INSIDE sf-llm-call), so it needs its own pin — two mapper pairs, one rule.
    const listHosts = tool('esxi_list_hosts', 'hosts');
    const esxi = skillWithTool('esxi-inventory', listHosts);
    const graph = skillGraph({
      skills: [esxi],
      start: { rules: [{ when: (c) => /esxi/i.test(c.userMessage ?? ''), use: 'esxi-inventory' }] },
      check: 'throw',
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'esxi-inventory' } }] },
          { toolCalls: [{ id: 'c2', name: 'esxi_list_hosts', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'mock',
      maxIterations: 6,
      reactMode: 'dynamic-grouped',
    })
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'nothing the rules anticipated' });

    expect(log.active[0]!.ids).toEqual([]);
    expect(log.active[1]!.ids).toEqual(['esxi-inventory']);
    expect(log.offered[1]!.names).toContain('esxi_list_hosts');
    assertToldTheTruth(log);
  });

  it("the cursor lands on the picked entry, so the graph's own steps then fire", async () => {
    const vmStorage = tool('get_vm_storage', '{"array_wwn":"naa.6000"}');
    const lookup = tool('resolve_volume', 'LUN-42');
    const esxi = skillWithTool('esxi', vmStorage);
    const vol = skillWithTool('volume-lookup', lookup);
    const graph = skillGraph({
      skills: [esxi, vol],
      start: { rules: [{ when: (c) => /esxi/i.test(c.userMessage ?? ''), use: 'esxi' }] },
      steps: [{ from: 'esxi', to: 'volume-lookup', onToolReturn: 'get_vm_storage' }],
      check: 'throw',
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'esxi' } }] },
          { toolCalls: [{ id: 'c2', name: 'get_vm_storage', args: {} }] },
          { toolCalls: [{ id: 'c3', name: 'resolve_volume', args: {} }] },
          { content: 'LUN-42.' },
        ],
      }),
      model: 'mock',
      maxIterations: 8,
    })
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'something no rule anticipated' });

    expect(log.active[1]!.ids).toEqual(['esxi']); // the pick entered the graph …
    expect(log.active[2]!.ids).toEqual(['volume-lookup']); // … and the declared step then ran
    expect(log.offered[2]!.names).toContain('resolve_volume');
    assertToldTheTruth(log);
  });

  it('a declared edge outranks a same-turn pick, and the run SAYS the pick was dropped', async () => {
    const probe = tool('probe', 'probed');
    const triage = defineSkill({ id: 'triage', description: 'triage', body: 'T' });
    const found = skillWithTool('found', tool('read_found'));
    const other = skillWithTool('other', tool('read_other'));
    const graph = skillGraph()
      .entry(triage)
      .route(triage, found, { onToolReturn: 'probe' })
      .route(triage, other, { when: (r) => r.toolName === 'never' })
      .build();
    // from `triage`: its declared successors, minus itself — both are legal picks
    expect(graph.reachableSkills('triage')).toEqual(['found', 'other']);

    const agent = Agent.create({
      provider: mock({
        replies: [
          // one message, two calls: the model volunteers a jump AND runs a tool
          // whose result fires a declared edge. The edge wins; the pick is dropped.
          {
            toolCalls: [
              { id: 'c1', name: 'read_skill', args: { id: 'other' } },
              { id: 'c2', name: 'probe', args: {} },
            ],
          },
          { content: 'done' },
        ],
      }),
      model: 'mock',
      maxIterations: 6,
    })
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'go' });

    // the author's edge won the cursor; `other` never loaded ('triage' is the
    // always-on base entry, unrelated to the contested hop)
    expect(log.active[1]!.ids).toEqual(['triage', 'found']);
    expect(log.superseded).toEqual([{ iteration: 2, id: 'other', won: 'found' }]);
    assertToldTheTruth(log); // the exception is ON the record, so the invariant holds
  });

  it('an out-of-reach pick is still rejected, and rejection is not a broken promise', async () => {
    const triage = defineSkill({ id: 'triage', description: 'triage', body: 'T' });
    const deep = skillWithTool('deep', tool('deep_tool'));
    const mid = defineSkill({ id: 'mid', description: 'mid', body: 'M' });
    const graph = skillGraph()
      .entry(triage)
      .route(triage, mid, { onToolReturn: 'x' })
      .route(mid, deep, { onToolReturn: 'y' })
      .build();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'deep' } }] },
          { content: 'ok' },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'go' });

    expect(log.rejected).toEqual([{ iteration: 1, id: 'deep' }]);
    expect(log.active[1]!.ids).toEqual(['triage']); // cursor stayed put
    expect(log.superseded).toEqual([]); // nothing was promised, so nothing to explain
    assertToldTheTruth(log);
  });
});

// ── 5. BYTE-IDENTITY — what already worked keeps working ─────────────────

describe('model pick — byte-identity for paths that already worked', () => {
  it('a matching-rule run offers exactly what it always did', async () => {
    const listHosts = tool('esxi_list_hosts', 'hosts');
    const esxi = skillWithTool('esxi-inventory', listHosts);
    const graph = skillGraph({
      skills: [esxi],
      start: {
        rules: [
          { when: (c) => /esxi|inventory/i.test(c.userMessage ?? ''), use: 'esxi-inventory' },
        ],
      },
      check: 'throw',
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'esxi_list_hosts', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'mock',
      maxIterations: 6,
    })
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'list esxi hosts' });

    expect(log.active.map((a) => a.ids)).toEqual([['esxi-inventory'], ['esxi-inventory']]);
    expect(log.offered[0]!.names).toEqual(['read_skill', 'esxi_list_hosts']);
    expect(log.superseded).toEqual([]);
  });

  it('a graph-less read_skill agent is untouched (no pick is ever recorded)', async () => {
    const helper = defineSkill({
      id: 'helper',
      description: 'a helper',
      body: 'HELPER BODY',
      tools: [tool('helper_tool')],
      autoActivate: 'currentSkill',
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'helper' } }] },
          { content: 'done' },
        ],
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .skill(helper)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'help me' });

    // The plain `llm-activated` path — which always worked — is unchanged, and the
    // gate/pick machinery never engages without a skillGraph.
    expect(log.active[1]!.ids).toEqual(['helper']);
    expect(
      (agent.getLastSnapshot()?.sharedState as { pendingSkillPick?: string }).pendingSkillPick,
    ).toBeUndefined();
    assertToldTheTruth(log);
  });

  it('a decision tree() routes as before — and is not read_skill-jumpable (8.5.0)', async () => {
    const io = defineSkill({ id: 'io', description: 'io', body: 'IO' });
    const cap = defineSkill({ id: 'cap', description: 'cap', body: 'CAP' });
    const { decideSkill } = await import('../src/injection-engine.js');
    const graph = skillGraph({
      tree: decideSkill((c) => /slow/.test(c.userMessage), io, cap),
      skills: [io, cap],
      check: 'throw',
    });
    const agent = Agent.create({
      provider: mock({ replies: [{ content: 'answered' }] }),
      model: 'mock',
      maxIterations: 3,
    })
      .skillGraph(graph)
      .build();
    const log = watch(agent);

    await agent.run({ message: 'why is it slow' });

    // The tree's own routing is untouched — the predicate still picks `io`.
    expect(log.active[0]!.ids).toEqual(['io']);
    // But nothing is read_skill-reachable: a tree re-decides by predicate every
    // iteration and has no cursor to move, so a leaf pick could only be accepted and
    // then dropped. Empty since 8.5.0; the escape hatch under a tree is the OPEN
    // skills the agent's gate admits (anything registered beside the graph).
    expect(graph.reachableSkills(undefined)).toEqual([]);
    expect(graph.reachableSkills('io')).toEqual([]);
  });
});
