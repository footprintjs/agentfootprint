/**
 * Per-skill model switching through the REAL Agent loop (9.19.0): "the
 * cursor picks the brain" — the precedence chain in BOTH chart shapes (the
 * correction-3 pin: which provider served the hop iteration), escalation on
 * recorded refusals (truth table + rest-of-turn + de-escalation), the
 * tier-3 decider over an outstanding menu (move / stay / decline, rails
 * admitted, guard×decider-stay), and the build-time check-up refusals.
 *
 * Sections follow Convention 3: Functional (precedence) · Integration
 * (escalation, decider) · Security/containment (postures) · Regression
 * (zero-delta, refusals).
 */

import { describe, it, expect } from 'vitest';
import { Agent, type SkillGraphOptions } from '../../../src/index.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { Injection } from '../../../src/lib/injection-engine/types.js';
import type { IntentScorer } from '../../../src/lib/injection-engine/intentScorer.js';
import type { LLMProvider } from '../../../src/adapters/types.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

const skill = (id: string, over: Partial<Parameters<typeof defineSkill>[0]> = {}) =>
  defineSkill({ id, description: `use ${id}`, body: `${id} body`, ...over });

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});

const final = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

/** A tool the model can call to fire an on-tool-return route. */
import { defineTool } from '../../../src/index.js';
const tool = (name: string) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${name} ran`,
  });

type Ev = Record<string, unknown>;
const capture = () => {
  const llmStarts: Ev[] = [];
  const routed: Ev[] = [];
  const escalated: Ev[] = [];
  const rejected: Ev[] = [];
  const evaluated: Ev[] = [];
  const recorder = {
    id: 'capture-brains',
    onEmit: (e: { name: string; payload?: Ev }) => {
      if (e.name === 'agentfootprint.stream.llm_start') llmStarts.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.turn_routed') routed.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.escalated') escalated.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.rejected') rejected.push(e.payload ?? {});
      if (e.name === 'agentfootprint.context.evaluated') evaluated.push(e.payload ?? {});
    },
  };
  return { llmStarts, routed, escalated, rejected, evaluated, recorder };
};

/** entry(triage) → model edge to billing → model edge to vault. From
 *  triage, `vault` is REGISTERED (on read_skill's enum) but UNREACHABLE —
 *  exactly the pick that earns a recorded gate refusal (an off-catalog id
 *  never reaches the gate at all: args validation refuses it first, and
 *  that evidence class deliberately does not count toward escalation). */
const hopGraph = () => {
  const triage = skill('triage');
  const billing = skill('billing');
  return skillGraph().entry(triage).route(triage, billing).route(billing, skill('vault')).build();
};

const sharedStateOf = (agent: Agent): Record<string, unknown> =>
  agent.getLastSnapshot()?.sharedState as Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────
// Functional — the precedence chain ("the cursor picks the brain")
// ─────────────────────────────────────────────────────────────────────────

describe('functional: per-skill brains + the precedence chain', () => {
  const runHop = async (reactMode?: 'dynamic-grouped') => {
    // triage (no brain) --on 'go'--> billing (its own provider + model).
    const brainProvider = mock({ replies: [final('answered by the billing brain')] });
    const billing = skill('billing', { provider: brainProvider, model: 'billing-model' });
    const triage = skill('triage');
    const graph = skillGraph().entry(triage).route(triage, billing, { onToolReturn: 'go' }).build();
    const caps = capture();
    const agent = Agent.create({
      provider: mock({ replies: [call('go', 't1')] }),
      model: 'agent-model',
      maxIterations: 4,
      ...(reactMode && { reactMode }),
    })
      .system('route well')
      .tool(tool('go'))
      .skillGraph(graph)
      .watch(caps.recorder)
      .build();
    const out = await agent.run({ message: 'help' });
    return { out, ...caps };
  };

  it('the hop iteration runs on the skill brain — provider AND model — and llm_start says why (flat chart)', async () => {
    const { out, llmStarts } = await runHop();
    // Iteration 1: triage has no brain — the agent's own configuration, and
    // NO additive `brain` field (zero-delta inside a brained agent).
    expect(llmStarts[0]!.model).toBe('agent-model');
    expect(llmStarts[0]!.brain).toBeUndefined();
    // Iteration 2: the cursor advanced to billing on THIS iteration (the
    // declared edge fired on iteration 1's batch) — the brain serves it,
    // not one iteration late (the correction-3 pin).
    expect(llmStarts[1]!.model).toBe('billing-model');
    expect(llmStarts[1]!.brain).toEqual({ via: 'skill', skillId: 'billing' });
    // WHICH complete() answered: only the brain provider carries this reply.
    expect(out).toBe('answered by the billing brain');
  });

  it('the same pin holds in the dynamic-grouped chart (nextSkillCursor ?? currentSkillId)', async () => {
    const { out, llmStarts } = await runHop('dynamic-grouped');
    expect(llmStarts[0]!.brain).toBeUndefined();
    expect(llmStarts[1]!.model).toBe('billing-model');
    expect(llmStarts[1]!.brain).toEqual({ via: 'skill', skillId: 'billing' });
    expect(out).toBe('answered by the billing brain');
  });

  it('a brain naming only a MODEL keeps the agent provider (same brain, other model)', async () => {
    const caps = capture();
    const billing = skill('billing', { model: 'small-model' });
    const agent = Agent.create({
      provider: mock({ replies: [final('one provider, two models')] }),
      model: 'agent-model',
    })
      .system('s')
      .skillGraph(skillGraph().entry(billing).build())
      .watch(caps.recorder)
      .build();
    const out = await agent.run({ message: 'hi' });
    // The always-entry puts the cursor on billing from iteration 1.
    expect(caps.llmStarts[0]!.model).toBe('small-model');
    expect(caps.llmStarts[0]!.provider).toBe('mock');
    expect(caps.llmStarts[0]!.brain).toEqual({ via: 'skill', skillId: 'billing' });
    expect(out).toBe('one provider, two models');
  });

  it("a same-provider brain with no model inherits `.configure()`'s resolvedModel (the chain's run rung)", async () => {
    const brainProvider = mock({ replies: [final('brain instance answered')] });
    const caps = capture();
    const billing = skill('billing', { provider: brainProvider });
    const agent = Agent.create({ provider: mock({ replies: [] }), model: 'build-model' })
      .system('s')
      .configure(() => ({ model: 'run-model' }))
      .skillGraph(skillGraph().entry(billing).build())
      .watch(caps.recorder)
      .build();
    const out = await agent.run({ message: 'hi' });
    // provider = the brain's instance; model = the run's configured model.
    expect(out).toBe('brain instance answered');
    expect(caps.llmStarts[0]!.model).toBe('run-model');
    expect(caps.llmStarts[0]!.brain).toEqual({ via: 'skill', skillId: 'billing' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — escalate-on-evidence
// ─────────────────────────────────────────────────────────────────────────

describe('integration: escalation truth table', () => {
  const escalationAgent = (args: {
    afterRefusals: number;
    primaryReplies: readonly unknown[];
    escalationReplies: readonly unknown[];
    reactMode?: 'dynamic-grouped';
  }) => {
    const escalationProvider = mock({ replies: args.escalationReplies as never });
    const caps = capture();
    const agent = Agent.create({
      provider: mock({ replies: args.primaryReplies as never }),
      model: 'agent-model',
      maxIterations: 6,
      ...(args.reactMode && { reactMode: args.reactMode }),
    })
      .system('s')
      .tool(tool('calc'))
      .skillGraph(hopGraph(), {
        escalation: {
          provider: escalationProvider,
          model: 'esc-model',
          afterRefusals: args.afterRefusals,
        },
      })
      .watch(caps.recorder)
      .build();
    return { agent, ...caps };
  };

  it('N recorded gate refusals in one turn flip the REST of the turn onto the escalation brain, once, on the record', async () => {
    const { agent, llmStarts, escalated, rejected } = escalationAgent({
      afterRefusals: 2,
      primaryReplies: [
        call('read_skill', 't1', { id: 'vault' }),
        call('read_skill', 't2', { id: 'vault' }),
      ],
      escalationReplies: [call('calc', 't3'), final('escalated answer')],
    });
    const out = await agent.run({ message: 'help' });
    expect(rejected).toHaveLength(2);
    // The flip: once, with the evidence and the honest from/to.
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({
      afterRefusals: 2,
      refusals: 2,
      from: { provider: 'mock', model: 'agent-model' },
      to: { provider: 'mock', model: 'esc-model' },
    });
    // Iterations 1–2 ran on the agent's own brain; 3 AND 4 (rest of turn)
    // on the escalation brain — the very next call, not one late.
    expect(llmStarts[0]!.brain).toBeUndefined();
    expect(llmStarts[1]!.brain).toBeUndefined();
    expect(llmStarts[2]!.brain).toEqual({ via: 'escalation' });
    expect(llmStarts[2]!.model).toBe('esc-model');
    expect(llmStarts[3]!.brain).toEqual({ via: 'escalation' });
    expect(out).toBe('escalated answer');
  });

  it('below the threshold nothing flips — no event, no brain field', async () => {
    const { agent, escalated, llmStarts } = escalationAgent({
      afterRefusals: 2,
      primaryReplies: [call('read_skill', 't1', { id: 'vault' }), final('primary answer')],
      escalationReplies: [],
    });
    const out = await agent.run({ message: 'help' });
    expect(escalated).toHaveLength(0);
    expect(llmStarts.every((s) => s.brain === undefined)).toBe(true);
    expect(out).toBe('primary answer');
  });

  it('de-escalation is the next seed: the following run starts on the agent brain', async () => {
    const { agent, llmStarts, escalated } = escalationAgent({
      afterRefusals: 1,
      primaryReplies: [
        call('read_skill', 't1', { id: 'vault' }),
        // run 2 starts here — the primary serves it again.
        final('fresh turn answer'),
      ],
      escalationReplies: [final('escalated answer')],
    });
    await agent.run({ message: 'first' });
    expect(escalated).toHaveLength(1);
    const out2 = await agent.run({ message: 'second' });
    expect(out2).toBe('fresh turn answer');
    const run2Start = llmStarts.at(-1)!;
    expect(run2Start.brain).toBeUndefined();
    expect(run2Start.model).toBe('agent-model');
  });

  it('dynamic-grouped: the flip crosses the sf-llm-call boundary (the correction-3 escalation pin)', async () => {
    const { agent, llmStarts, escalated } = escalationAgent({
      afterRefusals: 1,
      primaryReplies: [call('read_skill', 't1', { id: 'vault' })],
      escalationReplies: [final('escalated answer')],
      reactMode: 'dynamic-grouped',
    });
    const out = await agent.run({ message: 'help' });
    expect(escalated).toHaveLength(1);
    expect(llmStarts[1]!.brain).toEqual({ via: 'escalation' });
    expect(out).toBe('escalated answer');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the tier-3 decider
// ─────────────────────────────────────────────────────────────────────────

/** A tier-2 that can never decide (all zeros at floor 0) — every turn ends
 *  in a menu, which is exactly what the decider exists to resolve. */
const undecidedScorer: IntentScorer = {
  name: 'undecided',
  floor: 0,
  categorical: false,
  score: async (_input, candidates) => candidates.map((c) => ({ id: c.id, score: 0 })),
};

/** billing decisive on 'refund', otherwise all zeros (menu / stay material). */
const refundOnlyScorer: IntentScorer = {
  name: 'refund-only',
  floor: 0,
  categorical: true,
  score: async (input, candidates) =>
    candidates.map((c) => ({
      id: c.id,
      score: c.id === 'billing' && /refund/.test(input.message) ? 1 : 0,
    })),
};

const intentEntry = (id: string, intent: string, example: string) =>
  [skill(id), { match: { intent, examples: [example] } }] as const;

const menuGraph = (scorer: IntentScorer) => {
  const [billing, billingOpts] = intentEntry('billing', 'refunds', 'refund my order');
  const [shipping, shippingOpts] = intentEntry('shipping', 'parcels', 'track my parcel');
  return skillGraph()
    .entry(billing, billingOpts)
    .entry(shipping, shippingOpts)
    .route(billing, shipping)
    .classify(scorer)
    .build();
};

const deciderPick = (skillId: string) => ({
  content: '',
  toolCalls: [{ id: 'd1', name: 'pick_skill', args: { skill: skillId } }],
  stopReason: 'tool_use' as const,
});

const deciderAgent = (args: {
  scorer: IntentScorer;
  deciderReplies: readonly unknown[];
  primaryReplies: readonly unknown[];
  options?: Partial<SkillGraphOptions>;
}) => {
  const deciderProvider = mock({ replies: args.deciderReplies as never });
  const caps = capture();
  const agent = Agent.create({
    provider: mock({ replies: args.primaryReplies as never }),
    model: 'agent-model',
    maxIterations: 4,
  })
    .system('s')
    .skillGraph(menuGraph(args.scorer), {
      decider: { provider: deciderProvider, model: 'decider-model' },
      ...args.options,
    })
    .watch(caps.recorder)
    .build();
  return { agent, ...caps };
};

describe('integration: the tier-3 decider', () => {
  it("a decisive pick starts the turn: by:'decider' on the event, cursorMove 'decider', the menu closed on scope", async () => {
    const { agent, routed, evaluated } = deciderAgent({
      scorer: undecidedScorer,
      deciderReplies: [deciderPick('billing')],
      primaryReplies: [final('handled')],
    });
    await agent.run({ message: 'zzz' });
    expect(routed[0]).toMatchObject({
      by: 'decider',
      to: 'billing',
      decider: { provider: 'mock', model: 'decider-model', picked: 'billing' },
    });
    // The EVENT keeps the full offered set (what happened)…
    expect(routed[0]!.offered).toEqual(expect.arrayContaining(['billing', 'shipping']));
    // …while the POJO the loop acts on carries none (resolved = not
    // outstanding). The billing entry is active from iteration 1.
    const turnRoute = sharedStateOf(agent).turnRoute as Record<string, unknown>;
    expect(turnRoute).toMatchObject({ by: 'decider', to: 'billing' });
    expect(turnRoute.offered).toBeUndefined();
    expect(evaluated[0]!.activeIds).toContain('billing');
    expect((evaluated[0] as { cursorMove?: { by?: string } }).cursorMove?.by).toBe('decider');
  });

  it("a declined decider ('none') leaves the in-band menu standing, consult recorded", async () => {
    const { agent, routed } = deciderAgent({
      scorer: undecidedScorer,
      deciderReplies: [deciderPick('none')],
      primaryReplies: [final('answered on the base prompt')],
    });
    await agent.run({ message: 'zzz' });
    expect(routed[0]!.by).toBe('menu');
    expect(routed[0]!.decider).toEqual({ provider: 'mock', model: 'decider-model' });
    // The menu is still the loop's to resolve.
    const turnRoute = sharedStateOf(agent).turnRoute as Record<string, unknown>;
    expect(turnRoute.offered).toEqual(expect.arrayContaining(['billing', 'shipping']));
  });

  it('rails × decider is ADMITTED — the sanctioned resolver for rails menus', async () => {
    const { agent, routed, evaluated } = deciderAgent({
      scorer: undecidedScorer,
      deciderReplies: [deciderPick('shipping')],
      primaryReplies: [final('routed on rails')],
      options: { strictness: 'rails' },
    });
    await agent.run({ message: 'zzz' });
    expect(routed[0]).toMatchObject({ by: 'decider', to: 'shipping' });
    expect(evaluated[0]!.activeIds).toContain('shipping');
  });

  it("decider-stay clears the outstanding menu (nice-6): by:'continuity', no offered on scope, guard refuses a late pick", async () => {
    const deciderProvider = mock({ replies: [deciderPick('stay')] });
    const caps = capture();
    const agent = Agent.create({
      provider: mock({
        replies: [
          final('billing turn answered'),
          call('read_skill', 't1', { id: 'shipping' }),
          final('stayed and answered'),
        ],
      }),
      model: 'agent-model',
      maxIterations: 4,
    })
      .system('s')
      .skillGraph(menuGraph(refundOnlyScorer), {
        continuity: 'conversation',
        strictness: 'guard',
        decider: { provider: deciderProvider, model: 'decider-model' },
      })
      .watch(caps.recorder)
      .build();
    // Turn 1: decisive intent → billing (no menu, decider never consulted).
    await agent.run({ message: 'refund my order' });
    expect(caps.routed[0]).toMatchObject({ by: 'intent', to: 'billing' });
    // Turn 2: unmatched mid-conversation → menu with STAY — the decider
    // picks 'stay': the incumbent holds AND the menu closes.
    await agent.followUp('zzz qqq www');
    expect(caps.routed[1]).toMatchObject({
      by: 'continuity',
      to: 'billing',
      decider: { picked: 'stay' },
    });
    expect(caps.routed[1]!.offered).toEqual(expect.arrayContaining(['billing', 'shipping']));
    const turnRoute = sharedStateOf(agent).turnRoute as Record<string, unknown>;
    expect(turnRoute.offered).toBeUndefined();
    // …so guard's menuOutstanding is FALSE: the model's later pick against
    // the already-answered menu is refused, on the record.
    expect(caps.rejected.at(-1)).toMatchObject({ requestedId: 'shipping', posture: 'guard' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — build-time refusals + zero-delta
// ─────────────────────────────────────────────────────────────────────────

describe('regression: the brains check-up', () => {
  const foreign: LLMProvider = {
    name: 'other-vendor',
    complete: async () => ({
      content: '',
      toolCalls: [],
      usage: { input: 0, output: 0 },
      stopReason: 'stop',
    }),
  };

  it('same id in BOTH homes with different choices is refused naming both', () => {
    const brainy = skill('billing', { model: 'model-a' });
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .system('s')
        .skillGraph(skillGraph().entry(brainy).build(), {
          providers: { billing: { provider: mock({ reply: 'x' }), model: 'model-b' } },
        })
        .build(),
    ).toThrow(/BOTH homes/);
  });

  it('a providers key that is not a graph node is refused', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .system('s')
        .skillGraph(skillGraph().entry(skill('billing')).build(), {
          providers: { 'not-a-node': { provider: mock({ reply: 'x' }), model: 'm2' } },
        })
        .build(),
    ).toThrow(/no node with that id/);
  });

  it('a defineSkill brain on an agent with NO graph is refused — the cursor picks the brain', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .system('s')
        .injection(skill('lonely', { provider: mock({ reply: 'x' }), model: 'm2' }))
        .build(),
    ).toThrow(/no skill graph is mounted/);
  });

  it('a FOREIGN provider without a model is refused at build (correction 4), everywhere it can appear', () => {
    const graph = () => skillGraph().entry(skill('billing')).build();
    const base = () => Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).system('s');
    expect(() =>
      base()
        .skillGraph(graph(), { providers: { billing: { provider: foreign } } })
        .build(),
    ).toThrow(/names provider 'other-vendor' without a model/);
    expect(() =>
      base()
        .skillGraph(graph(), { escalation: { provider: foreign, afterRefusals: 1 } })
        .build(),
    ).toThrow(/without a model/);
    // Same-name providers keep inheriting down the chain (the legal case).
    expect(() =>
      base()
        .skillGraph(graph(), { providers: { billing: { provider: mock({ reply: 'x' }) } } })
        .build(),
    ).not.toThrow();
  });

  it('afterRefusals below 1 (or fractional) is refused', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() =>
        Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
          .system('s')
          .skillGraph(skillGraph().entry(skill('billing')).build(), {
            escalation: { provider: mock({ reply: 'x' }), model: 'big', afterRefusals: bad },
          })
          .build(),
      ).toThrow(/afterRefusals must be an integer/);
    }
  });

  it('a decider on a mount that never runs the cascade is refused — no menu could ever reach it', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .system('s')
        .skillGraph(skillGraph().entry(skill('billing')).build(), {
          decider: { provider: mock({ reply: 'x' }), model: 'd' },
        })
        .build(),
    ).toThrow(/never runs the turn-start cascade/);
  });

  it('brains on a structurally-typed graph without `nodes` are refused (nothing to validate against)', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .system('s')
        .skillGraph(
          { skills: [skill('billing')], nextSkill: () => undefined },
          { providers: { billing: { provider: mock({ reply: 'x' }), model: 'm2' } } },
        )
        .build(),
    ).toThrow(/carries no `nodes`/);
  });

  it('zero-delta: an agent without brains emits llm_start without a `brain` field and seeds no escalation keys', async () => {
    const caps = capture();
    const agent = Agent.create({ provider: mock({ reply: 'plain' }), model: 'm' })
      .system('s')
      .skillGraph(skillGraph().entry(skill('billing')).build())
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'hi' });
    expect(caps.llmStarts[0]!.brain).toBeUndefined();
    const state = sharedStateOf(agent);
    expect('skillEscalated' in state).toBe(false);
    expect('skillRefusalsThisTurn' in state).toBe(false);
  });
});
