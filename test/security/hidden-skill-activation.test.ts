/**
 * Hidden means hidden on EVERY activation path.
 *
 * A skill the caller's role may not read (`skill_read`) must never become
 * active, whoever asked: model text and user text are untrusted, so a keyword
 * in the user message, a declared route, a tool's proposal or lease, a
 * `read_skill` pick and a cursor restored from an earlier conversation are all
 * attempts to reach the same place. The fix sits where activation is decided:
 * the Injection Engine resolves the hidden set FIRST on every pass, the cursor
 * resolver never moves onto a hidden skill, and the evaluator never activates
 * one (`types.ts` · `isHiddenSkill`, read by both).
 *
 *   Unit        — the evaluator refuses a hidden skill whatever its trigger or
 *                 lease; the resolver never names a hidden destination
 *   Scenario    — the keyword path, in a direct run (no cascade, the cold
 *                 walk) and in the turn-start cascade (tier 1), on both chart
 *                 shapes, and inside a composition member
 *   Security    — every other activation path: a declared route, a tool
 *                 proposal, a tool lease, a `read_skill` pick, a restored cursor
 *   Control     — a VISIBLE keyword rule still activates, so the gate hides
 *                 and does not mute
 */

import { describe, expect, it } from 'vitest';

import { Agent, Sequence, defineTool } from '../../src/index.js';
import {
  defineSkill,
  evaluateInjections,
  keywordScorer,
  skillGraph,
} from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import type { PermissionChecker } from '../../src/provider-contract/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const SECRET = 'VIP-SECRET-PLAYBOOK';

const skill = (id: string) =>
  defineSkill({
    id,
    description: `${id} desk`,
    body: id === 'vip' ? `${SECRET}: waive all fees` : `${id.toUpperCase()}_BODY`,
  });

/** Hides `vip` from every caller, or only from callers other than `alice`. */
function hideVip(opts: { allowPrincipal?: string } = {}): PermissionChecker {
  return {
    name: 'hide-vip',
    governs: ['skill_read'],
    check: (req) =>
      req.capability === 'skill_read' &&
      req.target === 'skill:vip' &&
      (opts.allowPrincipal === undefined || req.identity?.principal !== opts.allowPrincipal)
        ? { result: 'deny', rationale: 'not for this role' }
        : { result: 'allow' },
  };
}

type Turn = { content: string; toolCalls: { id: string; name: string; args: unknown }[] };
const final: Turn = { content: 'done', toolCalls: [] };
const call = (name: string, args: unknown = {}, id = 'c1'): Turn => ({
  content: '',
  toolCalls: [{ id, name, args }],
});

/** A scripted provider that records every request it was sent. */
function scripted(script: readonly Turn[] = [final]) {
  const requests: string[] = [];
  const toolResults: string[] = [];
  let i = 0;
  const provider = mock({
    respond: (req: { messages?: ReadonlyArray<{ role: string; content: unknown }> }) => {
      requests.push(JSON.stringify(req));
      for (const m of req.messages ?? []) {
        if (m.role === 'tool') toolResults.push(String(m.content));
      }
      return (script[i++] ?? final) as never;
    },
  });
  return { provider, requests, toolResults };
}

/** The events that say what was routed and what was active. */
function recorder() {
  const routed: Array<Record<string, unknown>> = [];
  const evaluated: Array<{
    activeIds?: readonly string[];
    skippedDetails?: ReadonlyArray<{ id: string; reason: string }>;
    cursorMove?: { to?: string; by?: string };
  }> = [];
  return {
    routed,
    evaluated,
    watch: {
      id: 'hidden-activation',
      onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.skill.turn_routed') routed.push(e.payload ?? {});
        if (e.name === 'agentfootprint.context.evaluated') {
          evaluated.push((e.payload ?? {}) as (typeof evaluated)[number]);
        }
      },
    },
  };
}

/** `vip` is a keyword rule; `billing` is the fallback (an intent under classify). */
function keywordGraph(cascade: boolean) {
  const g = skillGraph().entry(skill('vip'), { match: { keywords: ['vip'] } });
  return cascade
    ? g
        .entry(skill('billing'), {
          match: { intent: 'customer wants a refund', examples: ['refund my order'] },
        })
        .classify(keywordScorer())
        .build()
    : g.entry(skill('billing')).build();
}

/** Nothing the model was sent carries the hidden skill's body, and it was never active. */
function expectNeverActivated(
  requests: readonly string[],
  evaluated: ReturnType<typeof recorder>['evaluated'],
) {
  expect(requests.length).toBeGreaterThan(0);
  for (const r of requests) expect(r).not.toContain(SECRET);
  expect(evaluated.length).toBeGreaterThan(0);
  for (const e of evaluated) {
    expect(e.activeIds ?? []).not.toContain('vip');
    expect(e.cursorMove?.to).not.toBe('vip');
  }
}

// ─── Unit — the two readers of the one rule ─────────────────────────

describe('unit: the activation gate', () => {
  const base = { iteration: 1, userMessage: 'I am a vip', history: [], activatedInjectionIds: [] };

  it('the evaluator refuses a hidden skill whatever its trigger or lease says', () => {
    const vip = skill('vip');
    const always = {
      ...skill('billing'),
      id: 'always-skill',
      trigger: { kind: 'always' } as const,
    };
    const out = evaluateInjections([vip, always], {
      ...base,
      activatedInjectionIds: ['vip'], // a pick
      leaseActiveIds: ['vip'], // a lease
      hiddenSkillIds: ['vip', 'always-skill'],
    });
    expect(out.active).toEqual([]);
    expect(out.skipped.map((s) => [s.id, s.reason])).toEqual([
      ['vip', 'hidden'],
      ['always-skill', 'hidden'],
    ]);
  });

  it('without a hidden set the evaluation is unchanged', () => {
    const out = evaluateInjections([skill('vip')], { ...base, activatedInjectionIds: ['vip'] });
    expect(out.active.map((i) => i.id)).toEqual(['vip']);
    expect(out.skipped).toEqual([]);
  });

  it('the cursor resolver never names a hidden destination, on any clause', () => {
    const vip = skill('vip');
    const billing = skill('billing');
    const g = skillGraph()
      .entry(vip, { match: { keywords: ['vip'] } })
      .entry(billing)
      .route(billing, vip, { onToolReturn: 'escalate' })
      .build();
    const hidden = { hiddenSkillIds: ['vip'] };
    // The keyword (cold walk): the walk skips vip and enters billing.
    expect(g.explainNextSkill!({ ...base, ...hidden })).toMatchObject({ to: 'billing' });
    // The route edge: it never fires, the cursor stays.
    const routed = {
      ...base,
      ...hidden,
      iteration: 2,
      currentSkillId: 'billing',
      toolResults: [{ toolName: 'escalate', result: 'ok', toolCallId: 't1' }],
    };
    expect(g.explainNextSkill!(routed)).toMatchObject({ to: 'billing', by: 'stay' });
    // A pick and a proposal: refused as destinations.
    expect(
      g.explainNextSkill!({
        ...routed,
        toolResults: [],
        pendingSkillPick: 'vip',
        pendingToolTransition: { targetSkillId: 'vip' },
      }),
    ).toMatchObject({ to: 'billing', by: 'stay' });
    // A cursor already on a hidden skill is no cursor: the turn re-enters cold.
    expect(
      g.explainNextSkill!({ ...base, ...hidden, iteration: 2, currentSkillId: 'vip' }),
    ).toMatchObject({ to: 'billing', by: 'entry' });
    // Without the hidden set the same inputs route to vip — the rule is the only difference.
    expect(g.explainNextSkill!(base)).toMatchObject({ to: 'vip' });
  });
});

// ─── Scenario — the keyword path ────────────────────────────────────

describe('the keyword path: user text never surfaces a hidden skill', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`a direct run (no cascade — the cold walk) [${reactMode}]`, async () => {
      const { provider, requests } = scripted();
      const rec = recorder();
      const agent = Agent.create({
        provider,
        model: 'mock',
        maxIterations: 3,
        permissionChecker: hideVip(),
      })
        .system('s')
        .skillGraph(keywordGraph(false), { reactMode } as never)
        .watch(rec.watch)
        .build();
      await agent.run({ message: 'I am a vip customer' });
      expectNeverActivated(requests, rec.evaluated);
      expect(rec.routed).toEqual([]); // no cascade ran
      // The turn entered the next visible entry instead.
      expect(rec.evaluated[0]!.cursorMove).toMatchObject({ to: 'billing', by: 'entry' });
      expect(rec.evaluated[0]!.skippedDetails).toContainEqual(
        expect.objectContaining({ id: 'vip', reason: 'hidden' }),
      );
    });

    it(`the turn-start cascade's tier 1 [${reactMode}]`, async () => {
      const { provider, requests } = scripted();
      const rec = recorder();
      const agent = Agent.create({
        provider,
        model: 'mock',
        maxIterations: 3,
        permissionChecker: hideVip(),
      })
        .system('s')
        .skillGraph(keywordGraph(true), { reactMode } as never)
        .watch(rec.watch)
        .build();
      await agent.run({ message: 'I am a vip customer' });
      expectNeverActivated(requests, rec.evaluated);
      expect(rec.routed).toHaveLength(1);
      expect(rec.routed[0]!.to).not.toBe('vip');
      expect(rec.routed[0]!.by).not.toBe('entry');
    });
  }

  it('control: the same keyword still activates a skill the role MAY read', async () => {
    const { provider, requests } = scripted();
    const rec = recorder();
    const agent = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 3,
      permissionChecker: hideVip({ allowPrincipal: 'alice' }),
    })
      .system('s')
      .skillGraph(keywordGraph(true))
      .watch(rec.watch)
      .build();
    await agent.run({
      message: 'I am a vip customer',
      identity: { principal: 'alice', conversationId: 'c-alice' },
    });
    expect(rec.routed[0]).toMatchObject({ by: 'entry', to: 'vip' });
    expect(rec.evaluated[0]!.activeIds).toContain('vip');
    expect(requests.some((r) => r.includes(SECRET))).toBe(true);
  });

  it('inside a composition, the member run is judged by ITS caller', async () => {
    const { provider, requests } = scripted();
    const agent = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 3,
      permissionChecker: hideVip({ allowPrincipal: 'alice' }),
    })
      .system('s')
      .skillGraph(keywordGraph(false))
      .build();
    // Alice ran it directly first; Bob's composition run must not inherit her answer.
    await agent.run({
      message: 'hello',
      identity: { principal: 'alice', conversationId: 'c-alice' },
    });
    const flow = Sequence.create({ id: 'wrap' }).step('desk', agent).build();
    requests.length = 0;
    await flow.run({
      message: 'I am a vip customer',
      identity: { principal: 'bob', conversationId: 'c-bob' },
    });
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r).not.toContain(SECRET);
  });
});

// ─── Security — every other activation path ─────────────────────────

describe('every other activation path refuses a hidden skill', () => {
  const tool = (name: string, result: unknown) =>
    defineTool({
      name,
      description: `${name} tool`,
      inputSchema: { type: 'object', properties: {} },
      execute: () => result as never,
    });

  function build(opts: {
    graph: ReturnType<typeof skillGraph>['build'] extends () => infer G ? G : never;
    script: readonly Turn[];
    tools?: ReturnType<typeof tool>[];
  }) {
    const { provider, requests, toolResults } = scripted(opts.script);
    const rec = recorder();
    let b = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 4,
      permissionChecker: hideVip(),
    }).system('s');
    for (const t of opts.tools ?? []) b = b.tool(t);
    const agent = b.skillGraph(opts.graph).watch(rec.watch).build();
    return { agent, requests, toolResults, ...rec };
  }

  it('a declared route into a hidden skill never fires', async () => {
    const triage = skill('triage');
    const graph = skillGraph()
      .entry(triage)
      .route(triage, skill('vip'), { onToolReturn: 'escalate' })
      .build();
    const run = build({
      graph,
      script: [call('escalate'), final],
      tools: [tool('escalate', 'escalated')],
    });
    await run.agent.run({ message: 'escalate me' });
    expectNeverActivated(run.requests, run.evaluated);
    expect(run.evaluated.at(-1)!.cursorMove).toMatchObject({ to: 'triage' });
  });

  it("a tool's proposal of a hidden skill never moves the cursor", async () => {
    const triage = skill('triage');
    const graph = skillGraph()
      .entry(triage)
      .route(triage, skill('vip'), { onToolReturn: 'never_called' })
      .build();
    const run = build({
      graph,
      script: [call('diagnose'), final],
      tools: [
        tool('diagnose', {
          content: 'looked',
          effects: [{ kind: 'propose-transition', targetSkillId: 'vip', reason: 'data' }],
        }),
      ],
    });
    await run.agent.run({ message: 'help' });
    expectNeverActivated(run.requests, run.evaluated);
  });

  it("a tool's lease on a hidden skill never delivers its body", async () => {
    const graph = skillGraph()
      .entry(skill('triage'))
      .entry(skill('vip'), {
        match: { keywords: ['never-said'] },
      })
      .build();
    const run = build({
      graph,
      script: [call('fetch'), final],
      tools: [
        tool('fetch', {
          content: 'ok',
          effects: [
            { kind: 'require-instruction', instructionId: 'vip', deliveryLease: 'next-call' },
          ],
        }),
      ],
    });
    await run.agent.run({ message: 'help' });
    expectNeverActivated(run.requests, run.evaluated);
  });

  it('a read_skill pick of a hidden skill is refused and never activates', async () => {
    const graph = skillGraph()
      .entry(skill('triage'))
      .entry(skill('vip'), {
        match: { keywords: ['never-said'] },
      })
      .build();
    const run = build({
      graph,
      script: [call('read_skill', { id: 'vip' }), final],
    });
    await run.agent.run({ message: 'help' });
    expectNeverActivated(run.requests, run.evaluated);
    expect(run.toolResults.some((r) => r.includes('permission denied'))).toBe(true);
  });

  it('a cursor restored from a conversation the caller may no longer read is dropped', async () => {
    const graph = keywordGraph(true);
    const { provider, requests } = scripted();
    const rec = recorder();
    const agent = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 3,
      permissionChecker: hideVip({ allowPrincipal: 'alice' }),
    })
      .system('s')
      .skillGraph(graph, { continuity: 'conversation' })
      .watch(rec.watch)
      .build();
    // Alice may read vip; her conversation's cursor stands on it.
    await agent.run({
      message: 'I am a vip customer',
      identity: { principal: 'alice', conversationId: 'c-1' },
    });
    const cp = agent.checkpoint()!;
    expect(cp.skillCursor).toBe('vip');
    // The same conversation, continued by a caller who may not.
    requests.length = 0;
    rec.evaluated.length = 0;
    await agent.run({
      message: 'one more thing',
      continueFrom: cp,
      identity: { principal: 'bob', conversationId: 'c-1' },
    });
    expectNeverActivated(requests, rec.evaluated);
  });
});
