/**
 * `.toolsFromActiveSkill()` — the agent-level tool posture (9.36.0).
 *
 * THE DEFECT IT FIXES. A skill's `tools` land in the agent's STATIC tool list
 * at build time, so the model can see and call them from iteration 1 whether
 * or not the skill is ever activated. Narrowing that used to be a field on
 * EVERY skill (`autoActivate: 'currentSkill'`), and the one you forgot leaked
 * for the life of the agent with nothing saying so.
 *
 * The tests below are written against THE WIRE — the `tools` array the
 * provider actually receives, per iteration — because that is the only place
 * the claim "only the active skill's tools are on the wire" can be true or
 * false. A metadata assertion would pass on an implementation that stamped the
 * field and never held anything out.
 *
 * Test types (Convention 3): unit · functional · integration · property ·
 * security · performance · ROI. "Refusal" rides with functional.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../../src/index.js';
import { defineSkill, skillGraph } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import { scopeToolsToActiveSkill } from '../../../src/core/agent/toolsFromActiveSkill.js';
import type { Injection } from '../../../src/lib/injection-engine/types.js';
import type { LLMProvider, LLMRequest } from '../../../src/adapters/types.js';

// ─── Fixtures ──────────────────────────────────────────────────────

const tool = (name: string) =>
  defineTool<Record<string, never>, string>({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${name} ran`,
  });

const issueRefund = tool('issue_refund');
const trackParcel = tool('track_parcel');

const billing = (over: Record<string, unknown> = {}): Injection =>
  defineSkill({
    id: 'billing',
    description: 'Refunds and charges.',
    body: 'Confirm identity first.',
    tools: [issueRefund] as never,
    ...over,
  });

const shipping = (over: Record<string, unknown> = {}): Injection =>
  defineSkill({
    id: 'shipping',
    description: 'Delivery questions.',
    body: 'Check the label.',
    tools: [trackParcel] as never,
    ...over,
  });

/**
 * A provider that records the tool NAMES it was sent on each iteration.
 * Everything the wire-level assertions below rest on comes from here.
 */
function spy(replies: Parameters<typeof mock>[0]): {
  provider: LLMProvider;
  offers: string[][];
} {
  const inner = mock(replies);
  const offers: string[][] = [];
  const provider: LLMProvider = {
    ...inner,
    complete: async (req: LLMRequest) => {
      offers.push((req.tools ?? []).map((t) => t.name).sort());
      return inner.complete(req);
    },
  };
  return { provider, offers };
}

/** Two iterations: the model opens `billing`, then answers. */
const activateThenAnswer = {
  replies: [
    { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
    { content: 'done' },
  ],
} as const;

// ─── Unit — the fold itself ────────────────────────────────────────

describe('toolsFromActiveSkill — unit (the stamp)', () => {
  it('stamps autoActivate on a tool-carrying skill that declared none', () => {
    const [stamped] = scopeToolsToActiveSkill([billing()]);
    expect((stamped?.metadata as { autoActivate?: string }).autoActivate).toBe('currentSkill');
  });

  it('LAW: a skill that declared its own keeps it — a default, never an override', () => {
    const declared = billing({ autoActivate: 'currentSkill' });
    const [stamped] = scopeToolsToActiveSkill([declared]);
    // Same object: nothing to change, so nothing was copied.
    expect(stamped).toBe(declared);
  });

  it('LAW: a declared VALUE is preserved verbatim, not just the object identity', () => {
    // The identity pin above cannot fail on a value override today, because
    // `'currentSkill'` is the only legal `autoActivate` and an override would
    // write back the same string. `AutoActivateMode` names two reserved future
    // values (`'always'`, `'group'`), and the day one ships, "a default, never
    // an override" has to still hold. This pin is what will catch it: a skill
    // carrying a DIFFERENT declared mode must come out carrying that mode.
    const reserved = defineSkill({
      id: 'billing',
      description: 'Refunds and charges.',
      body: 'Confirm identity first.',
      tools: [issueRefund] as never,
      autoActivate: 'always' as never,
    });
    const [stamped] = scopeToolsToActiveSkill([reserved]);
    expect((stamped?.metadata as { autoActivate?: string }).autoActivate).toBe('always');
  });

  it('leaves a tool-less skill alone — autoActivate says where TOOLS appear', () => {
    const prose = defineSkill({ id: 'faq', description: 'FAQ.', body: 'Answer plainly.' });
    const [stamped] = scopeToolsToActiveSkill([prose]);
    expect(stamped).toBe(prose);
    expect((stamped?.metadata as { autoActivate?: string }).autoActivate).toBeUndefined();
  });

  it('leaves non-skill injections alone (steering, facts, instructions)', () => {
    const steering: Injection = Object.freeze({
      id: 'tone',
      description: 'tone',
      flavor: 'steering',
      trigger: { kind: 'always' },
      inject: { systemPrompt: 'Be brief.' },
    }) as unknown as Injection;
    const [stamped] = scopeToolsToActiveSkill([steering]);
    expect(stamped).toBe(steering);
  });

  it('the copy is frozen, and every other metadata field survives', () => {
    const withMeta = billing({ surfaceMode: 'both' });
    const [stamped] = scopeToolsToActiveSkill([withMeta]);
    expect(Object.isFrozen(stamped)).toBe(true);
    expect(Object.isFrozen(stamped?.metadata)).toBe(true);
    expect((stamped?.metadata as { surfaceMode?: string }).surfaceMode).toBe('both');
    expect(stamped?.inject.tools).toBe(withMeta.inject.tools);
  });
});

// ─── Functional — the wire, with and without the posture ───────────

describe('toolsFromActiveSkill — functional (what reaches the wire)', () => {
  it('DEFAULT UNCHANGED: without the call, a skill tool is offered from iteration 1', async () => {
    // The 9.x pin. If this ever goes green with `issue_refund` ABSENT, the
    // default flipped and every existing consumer's tool list changed.
    const { provider, offers } = spy(activateThenAnswer);
    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => [billing(), shipping()] })
      .build();

    await agent.run({ message: 'refund please' });

    expect(offers[0]).toEqual(['issue_refund', 'read_skill', 'track_parcel']);
  });

  it('with the posture, iteration 1 offers read_skill and nothing else', async () => {
    const { provider, offers } = spy(activateThenAnswer);
    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => [billing(), shipping()] })
      .toolsFromActiveSkill()
      .build();

    await agent.run({ message: 'refund please' });

    expect(offers[0]).toEqual(['read_skill']);
  });

  it("…and the ACTIVE skill's tool arrives the iteration after activation", async () => {
    const { provider, offers } = spy(activateThenAnswer);
    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => [billing(), shipping()] })
      .toolsFromActiveSkill()
      .build();

    await agent.run({ message: 'refund please' });

    // billing is active; shipping never was, so its tool never appears.
    expect(offers[1]).toEqual(['issue_refund', 'read_skill']);
    expect(offers.flat()).not.toContain('track_parcel');
  });

  it('the baseline .tool() registry is NEVER scoped — it is the escape hatch', async () => {
    const escapeHatch = tool('escalate_to_human');
    const { provider, offers } = spy(activateThenAnswer);
    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .tool(escapeHatch)
      .skills({ list: () => [billing()] })
      .toolsFromActiveSkill()
      .build();

    await agent.run({ message: 'refund please' });

    expect(offers[0]).toContain('escalate_to_human');
    expect(offers[1]).toContain('escalate_to_human');
  });

  it('REFUSAL: a second call is refused, and the message names the door', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' })
        .toolsFromActiveSkill()
        .toolsFromActiveSkill(),
    ).toThrow(/AgentBuilder\.toolsFromActiveSkill: already set/);
  });
});

// ─── Integration — the two other homes of the same field ───────────

describe('toolsFromActiveSkill — integration (per-skill flag + graph scopeTools)', () => {
  it('the per-skill flag alone still works exactly as it did', async () => {
    const { provider, offers } = spy(activateThenAnswer);
    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => [billing({ autoActivate: 'currentSkill' }), shipping()] })
      .build();

    await agent.run({ message: 'refund please' });

    // billing scoped by its own flag; shipping additive because nobody scoped it.
    expect(offers[0]).toEqual(['read_skill', 'track_parcel']);
    expect(offers[1]).toEqual(['issue_refund', 'read_skill', 'track_parcel']);
  });

  it('LAW: flag + posture agree — a flagged skill behaves identically either way', async () => {
    const run = async (posture: boolean): Promise<string[][]> => {
      const { provider, offers } = spy(activateThenAnswer);
      let builder = Agent.create({ provider, model: 'mock' })
        .system('S')
        .skills({ list: () => [billing({ autoActivate: 'currentSkill' })] });
      if (posture) builder = builder.toolsFromActiveSkill();
      await builder.build().run({ message: 'refund please' });
      return offers;
    };

    expect(await run(true)).toEqual(await run(false));
  });

  it("the posture picks up what a graph's scopeTools cannot see: the skills it does not wire", async () => {
    // `scopeTools: true` scopes only WIRED skills. `shipping` is listed and
    // never routed — an OPEN skill — so the graph leaves it additive. The
    // agent-level posture is the only thing that reaches it.
    const graph = skillGraph({
      skills: [billing(), shipping()],
      start: 'billing',
      scopeTools: true,
      check: 'off',
    });

    const offersFor = async (posture: boolean): Promise<string[][]> => {
      const { provider, offers } = spy({ replies: [{ content: 'done' }] });
      let builder = Agent.create({ provider, model: 'mock' }).system('S').skillGraph(graph);
      if (posture) builder = builder.toolsFromActiveSkill();
      await builder.build().run({ message: 'hello' });
      return offers;
    };

    // Without the posture: shipping's tool is on the wire on iteration 1.
    expect((await offersFor(false))[0]).toContain('track_parcel');
    // With it: it is not.
    expect((await offersFor(true))[0]).not.toContain('track_parcel');
  });
});

// ─── Property — monotone, and idempotent ───────────────────────────

describe('toolsFromActiveSkill — property', () => {
  it('MONOTONE: the posture can only ever remove names from the static list', async () => {
    const skills = [billing(), shipping(), defineSkill({ id: 'faq', description: 'f', body: 'b' })];
    const offersFor = async (posture: boolean): Promise<string[]> => {
      const { provider, offers } = spy({ replies: [{ content: 'done' }] });
      let builder = Agent.create({ provider, model: 'mock' })
        .system('S')
        .skills({ list: () => skills });
      if (posture) builder = builder.toolsFromActiveSkill();
      await builder.build().run({ message: 'hello' });
      return offers[0] ?? [];
    };

    const off = await offersFor(false);
    const on = await offersFor(true);
    expect(on.every((name) => off.includes(name))).toBe(true);
    expect(on.length).toBeLessThan(off.length);
  });

  it('IDEMPOTENT: stamping an already-stamped list changes nothing', () => {
    const once = scopeToolsToActiveSkill([billing(), shipping()]);
    const twice = scopeToolsToActiveSkill(once);
    expect(twice[0]).toBe(once[0]);
    expect(twice[1]).toBe(once[1]);
  });
});

// ─── Security — what the posture does and does NOT promise ─────────

describe('toolsFromActiveSkill — security', () => {
  it("an activated skill's tool still DISPATCHES — the gate is the offer, not execution", async () => {
    const { provider } = spy({
      replies: [
        { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
        { toolCalls: [{ id: 't2', name: 'issue_refund', args: {} }] },
        { content: 'refunded' },
      ],
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => [billing()] })
      .toolsFromActiveSkill()
      .build();

    expect(await agent.run({ message: 'refund please' })).toBe('refunded');
  });

  it('STATED: dispatch is deliberately NOT gated, and the docstring says so', async () => {
    // A held-out tool stays resolvable by name (the split `autoActivate` has
    // always had), so a model that names one from a restored transcript still
    // runs it. That is a real boundary of this feature, and the boundary is
    // documented rather than implied — anyone reading `.toolsFromActiveSkill()`
    // as an execution gate would trust it for the one thing it does not do.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../src/core/agent/AgentBuilder.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('It governs the OFFER, not dispatch.');
  });

  it("a never-activated skill's tool reaches the wire on no iteration of the run", async () => {
    const { provider, offers } = spy({
      replies: [
        { toolCalls: [{ id: 't1', name: 'read_skill', args: { id: 'billing' } }] },
        { toolCalls: [{ id: 't2', name: 'issue_refund', args: {} }] },
        { content: 'refunded' },
      ],
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('S')
      .skills({ list: () => [billing(), shipping()] })
      .toolsFromActiveSkill()
      .build();

    await agent.run({ message: 'refund please' });

    expect(offers.flat()).not.toContain('track_parcel');
  });
});

// ─── Performance — zero cost when unused ───────────────────────────

describe('toolsFromActiveSkill — performance', () => {
  it('ZERO COST: an agent that never asks never walks the list', () => {
    // The fold is behind the flag, so the only honest measurement is that the
    // untouched list is REFERENCE-identical to what the builder collected — no
    // copies, no stamps, no allocation for a feature nobody asked for.
    const skills = [billing(), shipping()];
    const agent = Agent.create({ provider: mock({ reply: 'x' }), model: 'mock' })
      .system('S')
      .skills({ list: () => skills })
      .build();

    const registered = (agent as unknown as { injections: readonly Injection[] }).injections;
    expect(registered[0]).toBe(skills[0]);
    expect(registered[1]).toBe(skills[1]);
  });
});

// ─── ROI — one line instead of N ───────────────────────────────────

describe('toolsFromActiveSkill — ROI', () => {
  it('one call equals writing autoActivate on every skill, by hand', async () => {
    const byHand = [
      billing({ autoActivate: 'currentSkill' }),
      shipping({ autoActivate: 'currentSkill' }),
    ];
    const byPosture = scopeToolsToActiveSkill([billing(), shipping()]);

    expect(byPosture.map((s) => s.metadata)).toEqual(byHand.map((s) => s.metadata));

    // …and the same holds on the wire, which is what the author actually cares about.
    const offersFor = async (skills: readonly Injection[], posture: boolean) => {
      const { provider, offers } = spy(activateThenAnswer);
      let builder = Agent.create({ provider, model: 'mock' })
        .system('S')
        .skills({ list: () => skills });
      if (posture) builder = builder.toolsFromActiveSkill();
      await builder.build().run({ message: 'refund please' });
      return offers;
    };

    expect(await offersFor([billing(), shipping()], true)).toEqual(await offersFor(byHand, false));
  });
});
