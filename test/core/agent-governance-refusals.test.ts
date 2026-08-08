/**
 * Governance never silently drops — the build/create refusals (8.13.0).
 *
 * Five settings could be configured and then never consulted, each of them
 * indistinguishable from working: a watcher whose id another watcher already
 * claimed, a cost budget with no prices to measure it against, an
 * authorization mode with no credential provider to authorize through, a
 * `.checkIn()` with nothing that declares one, a drivers scorer under an
 * evidence pack that has no drivers.
 *
 * Every one of them is REFUSED at the moment it becomes decidable, with a
 * message that names the fix — because a governance rule you can only discover
 * is inert by reading a quiet run is worse than one that never compiled.
 *
 * The negative half of every test matters as much as the positive one: these
 * refusals must not catch the correct spelling. Each `describe` pairs the
 * refusal with the wiring it must leave alone.
 *
 * 7-pattern coverage: unit (each refusal throws, and names the fix) · scenario
 * (a built agent still runs) · integration (the real drop the refusal replaces,
 * from the audit probes) · property (identity, not the id, decides #1) · edge
 * (same reference twice; provider-supplied tools) · security (a consent gate
 * that can never fire is refused, never defaulted) · regression (the probe
 * cases as literal tests).
 */

import { describe, expect, it } from 'vitest';

import { Agent, LLMCall, defineTool, type Watcher } from '../../src/index.js';
import { defineSkill } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { staticTokens } from '../../src/identity.js';
import { staticTools } from '../../src/tool-providers/index.js';

const provider = () => mock({ reply: 'ok' });
const base = () => Agent.create({ provider: provider(), model: 'm' });

const plainTool = (name = 'refund') =>
  defineTool({
    name,
    description: 'Refund a customer',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: async () => 'refunded',
  });

const consentingTool = (name = 'refund') =>
  defineTool({
    name,
    description: 'Refund a customer',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    checkIn: 'always',
    execute: async () => 'refunded',
  });

const watcher = (id: string): Watcher => ({ id, onEmit: () => undefined } as Watcher);

// ─── #1 — two observers, one id ───────────────────────────────────────

describe('#1 — two different observers may not share one id', () => {
  it('unit — build() refuses, naming the id and what would have been lost', () => {
    let a = 0;
    let b = 0;
    const builder = base()
      .watch({ id: 'audit', onEmit: () => void a++ } as Watcher)
      .watch({ id: 'audit', onEmit: () => void b++ } as Watcher);

    expect(() => builder.build()).toThrow(/two different observers were given the id 'audit'/);
    expect(() => builder.build()).toThrow(/Only the LAST one ever fires/);
    expect(() => builder.build()).toThrow(/Rename one of them/);
    expect(a + b).toBe(0);
  });

  it('property — OBJECT IDENTITY decides, not the id: the same reference twice is fine', async () => {
    let fired = 0;
    const observer = { id: 'audit', onEmit: () => void fired++ } as Watcher;
    const agent = base().watch(observer).watch(observer).build();

    await agent.run({ message: 'hi' });
    expect(fired).toBeGreaterThan(0);
  });

  it('edge — the same reference through .watch() AND agent.attach() stays one attachment', async () => {
    let fired = 0;
    const observer = { id: 'audit', onEmit: () => void fired++ } as Watcher;
    const agent = base().watch(observer).build();
    agent.attach(observer);

    await agent.run({ message: 'hi' });
    // Two doors, one object, one attachment — the build-time check passes on
    // object identity and footprintjs's runtime dedupe finishes the job.
    expect(fired).toBeGreaterThan(0);
  });

  it('regression — the check is on the LIST, so several .watch() calls collide too', () => {
    // 8.13.0 wrote this rule when `.watch()` and the then-deprecated
    // `.recorder()` both fed one list. 9.0.0 removed `.recorder()`, so the
    // list has one door — and the rule is unchanged, because it was never
    // about which door: it is about two DIFFERENT objects under one id.
    const builder = base().watch(watcher('audit')).watch(watcher('audit'));
    expect(() => builder.build()).toThrow(/two different observers were given the id 'audit'/);
  });

  it('edge — distinct ids build and both observe', async () => {
    let a = 0;
    let b = 0;
    const agent = base()
      .watch({ id: 'audit-a', onEmit: () => void a++ } as Watcher)
      .watch({ id: 'audit-b', onEmit: () => void b++ } as Watcher)
      .build();

    await agent.run({ message: 'hi' });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // The audit probe measured 0 vs 9 here. Both halves now report.
    expect(a).toBe(b);
  });

  it('edge — an id in the agentfootprint.* namespace is NOT reserved', () => {
    // `agentfootprint/observe` ships factories with ids in that namespace and
    // consumers are meant to watch them; refusing the prefix would break that.
    expect(() => base().watch(watcher('agentfootprint.my-bridge')).build()).not.toThrow();
  });
});

// ─── #7 — costBudget with no pricingTable ─────────────────────────────

describe('#7 — a cost budget needs prices to be measured against', () => {
  it('unit — Agent refuses, naming the missing half and what a pricingTable is', () => {
    expect(() => Agent.create({ provider: provider(), model: 'm', costBudget: 5 }).build()).toThrow(
      /costBudget was set without a pricingTable/,
    );
    expect(() => Agent.create({ provider: provider(), model: 'm', costBudget: 5 }).build()).toThrow(
      /pricePerToken\(model, kind\)/,
    );
  });

  it('unit — LLMCall refuses too: the same pair, and the same silence', () => {
    expect(() =>
      LLMCall.create({ provider: provider(), model: 'm', costBudget: 5 }).build(),
    ).toThrow(/LLMCall: costBudget was set without a pricingTable/);
  });

  it('scenario — the pair together builds and runs', async () => {
    const agent = Agent.create({
      provider: provider(),
      model: 'm',
      costBudget: 5,
      pricingTable: { name: 'test', pricePerToken: () => 0.000_001 },
    }).build();

    await expect(agent.run({ message: 'hi' })).resolves.toBe('ok');
  });

  it('edge — a pricingTable with no budget is fine (ticks, never a limit)', async () => {
    const agent = Agent.create({
      provider: provider(),
      model: 'm',
      pricingTable: { name: 'test', pricePerToken: () => 0.000_001 },
    }).build();

    await expect(agent.run({ message: 'hi' })).resolves.toBe('ok');
  });

  it('edge — costBudget: 0 is still a budget, and still needs prices', () => {
    expect(() => Agent.create({ provider: provider(), model: 'm', costBudget: 0 }).build()).toThrow(
      /costBudget was set without a pricingTable/,
    );
  });

  it('regression — neither option: nothing changes', async () => {
    await expect(base().build().run({ message: 'hi' })).resolves.toBe('ok');
  });
});

// ─── #20 — onAuthorizationRequired with no credentials provider ───────

describe('#20 — an authorization mode needs a provider to authorize through', () => {
  it('unit — refuses, naming the providers that satisfy it', () => {
    expect(() =>
      Agent.create({
        provider: provider(),
        model: 'm',
        onAuthorizationRequired: 'tell-model',
      }).build(),
    ).toThrow(/onAuthorizationRequired was set without a `credentials` provider/);
    // The refusal names the DOOR a `CredentialProvider` comes through. Until
    // 9.0.0 that sentence said `agentfootprint/identity`; that subpath is gone,
    // `agentfootprint/security` absorbed it, and an error message that sends a
    // reader to a path Node refuses is worse than no message at all.
    expect(() =>
      Agent.create({
        provider: provider(),
        model: 'm',
        onAuthorizationRequired: 'pause',
      }).build(),
    ).toThrow(/agentfootprint\/security/);
  });

  it('scenario — with a provider it builds and runs', async () => {
    const agent = Agent.create({
      provider: provider(),
      model: 'm',
      onAuthorizationRequired: 'tell-model',
      credentials: staticTokens({ stripe: 'sk-test' }),
    }).build();

    await expect(agent.run({ message: 'hi' })).resolves.toBe('ok');
  });

  it('edge — a credentials provider without the mode keeps the default', async () => {
    const agent = Agent.create({
      provider: provider(),
      model: 'm',
      credentials: staticTokens({ stripe: 'sk-test' }),
    }).build();

    await expect(agent.run({ message: 'hi' })).resolves.toBe('ok');
  });
});

// ─── #19 — .checkIn() with nothing that declares one ──────────────────

describe('#19 — .checkIn() configures an ask that something has to MAKE', () => {
  it('unit — refuses when no registered tool declares checkIn', () => {
    const builder = base().tool(plainTool()).checkIn({ evidence: 'standard' });
    expect(() => builder.build()).toThrow(/no registered tool declares `checkIn`/);
    expect(() => builder.build()).toThrow(/never pause for consent/);
    expect(() => builder.build()).toThrow(/checkIn: 'always'/);
  });

  it('security — an agent with NO tools at all is refused too', () => {
    expect(() => base().checkIn().build()).toThrow(/no registered tool declares `checkIn`/);
  });

  it('scenario — a declaring tool builds', () => {
    expect(() =>
      base().tool(consentingTool()).checkIn({ evidence: 'minimal' }).build(),
    ).not.toThrow();
  });

  it('edge — a SKILL-supplied tool declaring checkIn counts (it reaches the dispatch map)', () => {
    const skill = defineSkill({
      id: 'refunds',
      description: 'How to refund a customer.',
      body: 'How to refund.',
      tools: [consentingTool('skill_refund')],
    });
    expect(() => base().skill(skill).checkIn({ evidence: 'minimal' }).build()).not.toThrow();
  });

  it('edge — a .toolProvider() is never refused: its tools arrive per iteration', () => {
    // Build time cannot know what a provider will serve, and refusing what it
    // cannot know would break a correct agent.
    expect(() =>
      base()
        .toolProvider(staticTools([plainTool()]))
        .checkIn({ evidence: 'standard' })
        .build(),
    ).not.toThrow();
  });

  it('regression — a declaring tool with NO .checkIn() call still works (the default)', () => {
    expect(() => base().tool(consentingTool()).build()).not.toThrow();
  });
});

// ─── #31 — a scorer under an evidence pack with no drivers ────────────

describe("#31 — `scorer` has nothing to rank under evidence: 'minimal'", () => {
  it('unit — refuses, naming what the scorer ranks and both ways out', () => {
    const make = () =>
      base()
        .tool(consentingTool())
        .checkIn({ evidence: 'minimal', scorer: () => [] })
        .build();

    expect(make).toThrow(/`scorer` has no effect with `evidence: 'minimal'`/);
    expect(make).toThrow(/ranks the `drivers` field/);
    expect(make).toThrow(/evidence: 'standard'/);
  });

  it('edge — the standard pack DOES have drivers, so the pair is accepted', () => {
    expect(() =>
      base()
        .tool(consentingTool())
        .checkIn({ evidence: 'standard', scorer: () => [] })
        .build(),
    ).not.toThrow();
  });

  it("edge — evidence: 'minimal' alone is fine; it is the pairing that is inert", () => {
    expect(() =>
      base().tool(consentingTool()).checkIn({ evidence: 'minimal' }).build(),
    ).not.toThrow();
  });

  it('edge — a CUSTOM assembler + scorer is not judged: it may call the scorer itself', () => {
    expect(() =>
      base()
        .tool(consentingTool())
        .checkIn({
          evidence: async (input) => ({
            willDo: input.tool.name,
            drivers: await input.scorer({ tool: { name: input.tool.name, text: '' }, units: [] }),
          }),
          scorer: () => [],
        })
        .build(),
    ).not.toThrow();
  });

  it('regression — a scorer with the DEFAULT evidence (standard) is accepted', () => {
    expect(() =>
      base()
        .tool(consentingTool())
        .checkIn({ scorer: () => [] })
        .build(),
    ).not.toThrow();
  });
});
