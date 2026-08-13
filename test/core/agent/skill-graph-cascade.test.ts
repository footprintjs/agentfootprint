/**
 * The turn-start routing cascade through the REAL Agent loop (SG-C, 9.17.0):
 * classify verdicts on the record, the tier-3 menu envelope, strictness
 * postures, conversation continuity through checkpoint()/followUp(), and the
 * zero-delta guards that pin "absent option = byte-identical".
 *
 * Sections follow Convention 3: Functional (cold verdicts) · Integration
 * (envelope, postures, continuity) · Security (hidden skills) · Regression
 * (zero-delta).
 */

import { describe, it, expect } from 'vitest';
import { Agent, type SkillGraphOptions } from '../../../src/index.js';
import {
  skillGraph,
  decideSkill,
  defineSkill,
  defineMenuHint,
  keywordScorer,
  MENU_HINT_METADATA_KEY,
} from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import type { PermissionChecker } from '../../../src/adapters/types.js';

const skill = (id: string, description = `use ${id}`) =>
  defineSkill({ id, description, body: `${id} body` });

/** billing/shipping intents + a rule entry + a plain entry, one classifier.
 *  'my order' overlaps BOTH intents' examples (a keyword near-tie);
 *  'refund my order' / 'track my parcel delivery' are decisive. */
const supportGraph = () =>
  skillGraph()
    .entry(skill('vip', 'vip desk'), { match: { keywords: ['vip'] } })
    .entry(skill('billing', 'refunds and charges'), {
      match: { intent: 'customer wants a refund', examples: ['refund my order'] },
    })
    .entry(skill('shipping', 'parcel delivery'), {
      match: { intent: 'customer asks about delivery', examples: ['track my order delivery'] },
    })
    .entry(skill('other', 'everything else'), {
      match: { intent: 'anything else entirely', examples: ['completely different topic zone'] },
    })
    .classify(keywordScorer())
    .build();

/** Capture the typed emits the cascade writes. */
const capture = () => {
  const routed: Array<Record<string, unknown>> = [];
  const evaluated: Array<Record<string, unknown>> = [];
  const rejected: Array<Record<string, unknown>> = [];
  const llmStarts: Array<Record<string, unknown>> = [];
  const recorder = {
    id: 'capture-cascade',
    onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
      if (e.name === 'agentfootprint.skill.turn_routed') routed.push(e.payload ?? {});
      if (e.name === 'agentfootprint.context.evaluated') evaluated.push(e.payload ?? {});
      if (e.name === 'agentfootprint.skill.rejected') rejected.push(e.payload ?? {});
      if (e.name === 'agentfootprint.stream.llm_start') llmStarts.push(e.payload ?? {});
    },
  };
  return { routed, evaluated, rejected, llmStarts, recorder };
};

const answer = (content = 'done') => mock({ reply: content });

const pickThenAnswer = (id: string) => {
  let i = 0;
  return mock({
    respond: () => {
      i++;
      return i === 1
        ? {
            content: 'picking',
            toolCalls: [{ id: 't1', name: 'read_skill', args: { id } }],
            stopReason: 'tool_use' as const,
          }
        : { content: 'done', toolCalls: [], stopReason: 'stop' as const };
    },
  });
};

const buildAgent = (
  provider: ReturnType<typeof mock>,
  options?: SkillGraphOptions,
  graph = supportGraph(),
) => {
  const caps = capture();
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
    .system('You are support.')
    .skillGraph(graph, options)
    .watch(caps.recorder)
    .build();
  return { agent, ...caps };
};

const readSkillDesc = (llmStart: Record<string, unknown>): string => {
  const tools = (llmStart.tools ?? []) as ReadonlyArray<{ name: string; description?: string }>;
  return tools.find((t) => t.name === 'read_skill')?.description ?? '';
};

// ─────────────────────────────────────────────────────────────────────────────
// Functional — cold-start verdicts on the record
// ─────────────────────────────────────────────────────────────────────────────

describe('functional: classify cold start', () => {
  it('a tier-1 rule wins decisively → by:"entry", and the entry is active on iteration 1', async () => {
    const { agent, routed, evaluated } = buildAgent(answer());
    await agent.run({ message: 'I am a vip customer' });
    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({ by: 'entry', to: 'vip' });
    expect(routed[0]!.policy).toMatchObject({ nearTieMargin: 0.15, menuSize: 3, floor: 0 });
    expect(evaluated[0]!.activeIds).toContain('vip');
    expect((evaluated[0] as { cursorMove?: { by?: string } }).cursorMove?.by).toBe('entry');
  });

  it('a decisive intent match → by:"intent" with scorer + ranked scores, body active on iteration 1', async () => {
    const { agent, routed, evaluated } = buildAgent(answer());
    await agent.run({ message: 'please refund my order' });
    expect(routed[0]).toMatchObject({ by: 'intent', to: 'billing', scorer: 'keyword' });
    expect(routed[0]!.decisive).toBe(true);
    const scores = routed[0]!.scores as ReadonlyArray<{ id: string }>;
    expect(scores.map((s) => s.id)).toContain('shipping'); // the losers, ranked
    expect(evaluated[0]!.activeIds).toContain('billing');
    expect((evaluated[0] as { cursorMove?: { by?: string } }).cursorMove?.by).toBe('intent');
  });

  it('a menu verdict loads NO intent entry on iteration 1 (the cold-walk suppression pin)', async () => {
    const { agent, routed, evaluated } = buildAgent(answer());
    // 'my order' overlaps billing and shipping examples equally → near-tie.
    await agent.run({ message: 'my order' });
    expect(routed[0]!.by).toBe('menu');
    const offered = routed[0]!.offered as readonly string[];
    expect(offered).toEqual(expect.arrayContaining(['billing', 'shipping']));
    // Iteration 1's active set contains NO intent entry — never the
    // first-declared one by declaration-order accident.
    const active = evaluated[0]!.activeIds as readonly string[];
    for (const id of ['billing', 'shipping', 'other', 'vip']) expect(active).not.toContain(id);
    // …but the auto-registered menu hint IS on the wire, telling the model
    // where the menu lives.
    expect(active).toContain('skill-menu-hint');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration — the tier-3 envelope + menu resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('integration: the menu envelope and its resolution', () => {
  it("read_skill's description LEADS with the menu while it is outstanding, then stops", async () => {
    const { agent, llmStarts } = buildAgent(pickThenAnswer('billing'));
    await agent.run({ message: 'my order' });
    const first = readSkillDesc(llmStarts[0]!);
    expect(first).toMatch(/routing choice/);
    expect(first).toContain('billing: refunds and charges');
    expect(first).toMatch(/relevance ~\d+%/);
    // Iteration 2: the pick landed, the menu is resolved — no more lead.
    const second = readSkillDesc(llmStarts[1]!);
    expect(second).not.toMatch(/routing choice/);
  });

  it('an ON-menu pick resolves it: cursorMove carries offered, no declinedOffer', async () => {
    const { agent, evaluated } = buildAgent(pickThenAnswer('billing'));
    await agent.run({ message: 'my order' });
    const move = (
      evaluated[1] as {
        cursorMove?: { by?: string; to?: string; offered?: string[]; declinedOffer?: boolean };
      }
    ).cursorMove;
    expect(move?.by).toBe('model-pick');
    expect(move?.to).toBe('billing');
    expect(move?.offered).toEqual(expect.arrayContaining(['billing', 'shipping']));
    expect(move?.declinedOffer).toBeUndefined();
  });

  it("an OFF-menu but reachable pick is ACCEPTED under 'assist' and stamped declinedOffer", async () => {
    const { agent, evaluated, rejected } = buildAgent(pickThenAnswer('other'));
    await agent.run({ message: 'my order' });
    expect(rejected).toEqual([]); // assist = today's gate — no refusal
    const move = (
      evaluated[1] as {
        cursorMove?: { to?: string; declinedOffer?: boolean; offered?: string[] };
      }
    ).cursorMove;
    expect(move?.to).toBe('other');
    expect(move?.declinedOffer).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration — strictness postures
// ─────────────────────────────────────────────────────────────────────────────

describe('integration: strictness postures', () => {
  it("'guard' admits an on-menu pick and refuses an off-menu one with posture on the record", async () => {
    const onMenu = buildAgent(pickThenAnswer('billing'), { strictness: 'guard' });
    await onMenu.agent.run({ message: 'my order' });
    expect(onMenu.rejected).toEqual([]);

    const offMenu = buildAgent(pickThenAnswer('other'), { strictness: 'guard' });
    await offMenu.agent.run({ message: 'my order' });
    expect(offMenu.rejected).toHaveLength(1);
    expect(offMenu.rejected[0]).toMatchObject({ requestedId: 'other', posture: 'guard' });
  });

  it("'guard' refuses a routing pick when NO menu is outstanding (decisive turn), teaching who routes", async () => {
    const { agent, rejected } = buildAgent(pickThenAnswer('shipping'), { strictness: 'guard' });
    await agent.run({ message: 'please refund my order' }); // decisive → billing
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ requestedId: 'shipping', posture: 'guard' });
  });

  it("'rails' refuses every hop, admits OPEN skills, and a menu proceeds on the base prompt as by:'none'", async () => {
    // Hop pick under rails → refused with the rails teaching message.
    const hop = buildAgent(pickThenAnswer('shipping'), { strictness: 'rails' });
    await hop.agent.run({ message: 'please refund my order' });
    expect(hop.rejected).toHaveLength(1);
    expect(hop.rejected[0]).toMatchObject({ requestedId: 'shipping', posture: 'rails' });

    // An OPEN skill (registered beside the graph, unwired) stays admitted.
    const capsOpen = capture();
    const openAgent = Agent.create({
      provider: pickThenAnswer('helper'),
      model: 'mock',
      maxIterations: 4,
    })
      .system('')
      .skillGraph(supportGraph(), { strictness: 'rails' })
      .skill(skill('helper', 'open helper'))
      .watch(capsOpen.recorder)
      .build();
    await openAgent.run({ message: 'please refund my order' });
    expect(capsOpen.rejected).toEqual([]);

    // Rails × menu: recorded as by:'none' WITH the offer on the event; the
    // loop gets no envelope (no menu lead, no hint) and no entry loads.
    const menu = buildAgent(answer(), { strictness: 'rails' });
    await menu.agent.run({ message: 'my order' });
    expect(menu.routed[0]!.by).toBe('none');
    expect(menu.routed[0]!.offered).toEqual(expect.arrayContaining(['billing', 'shipping']));
    expect(readSkillDesc(menu.llmStarts[0]!)).not.toMatch(/routing choice/);
    const active = menu.evaluated[0]!.activeIds as readonly string[];
    expect(active).not.toContain('skill-menu-hint');
    for (const id of ['billing', 'shipping', 'other', 'vip']) expect(active).not.toContain(id);
  });

  it("'rails' × .entryByRead() is refused at mount, teaching the alternatives", () => {
    const g = skillGraph().entry(skill('a')).entry(skill('b')).entryByRead().build();
    expect(() =>
      Agent.create({ provider: answer(), model: 'mock' })
        .skillGraph(g, { strictness: 'rails' })
        .build(),
    ).toThrow(/rails.*cannot honor \.entryByRead/s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration — conversation continuity (checkpoint → followUp)
// ─────────────────────────────────────────────────────────────────────────────

describe('integration: continuity across turns', () => {
  it("continuity:'conversation' — checkpoint carries the cursor; followUp stays with by:'continuity'", async () => {
    const { agent, routed } = buildAgent(answer('billing answer'), {
      continuity: 'conversation',
    });
    await agent.run({ message: 'please refund my order' });
    const cp = agent.checkpoint();
    expect(cp?.skillCursor).toBe('billing');

    // The follow-up mentions the refund again — the incumbent wins (stay).
    await agent.followUp('thanks — one more refund question');
    expect(routed).toHaveLength(2);
    expect(routed[1]).toMatchObject({ by: 'continuity', from: 'billing', to: 'billing' });
  });

  it('a decisively different follow-up BEATS the inherited cursor (sticky default, not a lock)', async () => {
    const { agent, routed, evaluated } = buildAgent(answer(), { continuity: 'conversation' });
    await agent.run({ message: 'please refund my order' });
    await agent.followUp('now track my parcel delivery');
    expect(routed[1]).toMatchObject({ by: 'intent', from: 'billing', to: 'shipping' });
    const turn2FirstEval = evaluated.at(-1) as { activeIds?: readonly string[] };
    expect(turn2FirstEval.activeIds).toContain('shipping');
  });

  it('an unmatched follow-up opens the FULL menu with STAY first-class', async () => {
    const { agent, routed } = buildAgent(answer(), { continuity: 'conversation' });
    await agent.run({ message: 'please refund my order' });
    await agent.followUp('zzz qqq www');
    expect(routed[1]!.by).toBe('menu');
    expect(routed[1]!.stayOffered).toBe(true);
    expect(routed[1]!.offered).toEqual(
      expect.arrayContaining(['vip', 'billing', 'shipping', 'other']),
    );
  });

  it('an inherited cursor the mounted graph does not know is DROPPED and recorded', async () => {
    const { agent, routed } = buildAgent(answer(), { continuity: 'conversation' });
    await agent.run({ message: 'please refund my order' });
    const cp = agent.checkpoint()!;
    const stale = { ...cp, skillCursor: 'retired-skill' };
    await agent.run({ message: 'please refund my order', continueFrom: stale });
    const second = routed[1]!;
    expect(second.droppedResume).toEqual({ id: 'retired-skill', reason: 'unknown-skill' });
    // The turn started COLD and the cascade still routed it decisively.
    expect(second).toMatchObject({ by: 'intent', to: 'billing' });
    expect(second.from).toBeUndefined();
  });

  it("continuity:'conversation' on a decision tree is refused at mount", () => {
    const g = skillGraph()
      .tree(decideSkill((ctx) => ctx.userMessage.includes('a'), skill('leafA'), skill('leafB')))
      .build();
    expect(() =>
      Agent.create({ provider: answer(), model: 'mock' })
        .skillGraph(g, { continuity: 'conversation' })
        .build(),
    ).toThrow(/tree.*has no cursor/s);
  });

  it('an ENTRY-SCORER graph that opts into continuity runs the cascade with the scorer as tier 2', async () => {
    // No classifier: tier 2 is the description-ranking entry scorer — the
    // same table, the same verdicts, `entryScores` still written.
    const caps = capture();
    const g = skillGraph()
      .entry(skill('billing', 'refunds charges invoices'))
      .entry(skill('shipping', 'parcel tracking delivery'))
      .entryBy(keywordScorer())
      .build();
    const agent = Agent.create({ provider: answer(), model: 'mock', maxIterations: 3 })
      .system('')
      .skillGraph(g, { continuity: 'conversation' })
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'refunds and charges please' });
    expect(caps.routed[0]).toMatchObject({ by: 'intent', to: 'billing', scorer: 'keyword' });
    expect(agent.checkpoint()?.skillCursor).toBe('billing');
    await agent.followUp('same charges question again');
    expect(caps.routed[1]).toMatchObject({ by: 'continuity', from: 'billing', to: 'billing' });
  });

  it('a cold NEAR-TIE on a scorer-cascade graph opens the menu — never the declaration-order walk', async () => {
    // The scorer-as-tier-2 arm of the cold-walk suppression pin: an entry-scorer
    // graph compiles with llmReadEntry FALSE (no classify, no entryByRead), and
    // only the MOUNT opts it into the cascade — so suppression must follow the
    // VERDICT, not the compile-time flag. Identical descriptions score within
    // the pairwise margin → a cold 'menu' verdict; the first-declared entry
    // must NOT load by declaration-order accident.
    const caps = capture();
    const g = skillGraph()
      .entry(skill('first', 'alpha topic zone'))
      .entry(skill('second', 'alpha topic zone'))
      .entryBy(keywordScorer())
      .build();
    const agent = Agent.create({
      provider: pickThenAnswer('second'),
      model: 'mock',
      maxIterations: 4,
    })
      .system('')
      .skillGraph(g, { continuity: 'conversation' })
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'alpha topic zone' });
    expect(caps.routed[0]!.by).toBe('menu');
    expect(caps.routed[0]!.offered).toEqual(expect.arrayContaining(['first', 'second']));
    // Iteration 1: NO entry body ships — the record, the hint and the routing agree.
    const active = caps.evaluated[0]!.activeIds as readonly string[];
    expect(active).not.toContain('first');
    expect(active).not.toContain('second');
    expect(active).toContain('skill-menu-hint');
    const move1 = (caps.evaluated[0] as { cursorMove?: { by?: string; to?: string } }).cursorMove;
    expect(move1?.by).toBe('none');
    expect(move1?.to).toBeUndefined();
    // The envelope reaches the model: read_skill leads with the menu.
    expect(readSkillDesc(caps.llmStarts[0]!)).toMatch(/routing choice/);
    // The model resolves the menu via the ordinary gated pick (D2).
    const move2 = (
      caps.evaluated[1] as {
        cursorMove?: { by?: string; to?: string; offered?: string[]; declinedOffer?: boolean };
      }
    ).cursorMove;
    expect(move2).toMatchObject({ by: 'model-pick', to: 'second' });
    expect(move2?.offered).toEqual(expect.arrayContaining(['first', 'second']));
    expect(move2?.declinedOffer).toBeUndefined();
    expect(caps.evaluated[1]!.activeIds).toContain('second');
  });

  it('a THROWING entry scorer on a cascade graph falls through to the FULL menu — never the walk', async () => {
    // "Scorers are a tier, never a correctness dependency": the recorded
    // fallback is the menu (every entry offered), and the loop honors it —
    // no first-declared entry loads behind the record's back.
    const caps = capture();
    const boom = {
      name: 'boom',
      score: (): never => {
        throw new Error('scorer down');
      },
    };
    const g = skillGraph()
      .entry(skill('first', 'alpha desk'))
      .entry(skill('second', 'beta desk'))
      .entryBy(boom)
      .build();
    const agent = Agent.create({ provider: answer(), model: 'mock', maxIterations: 3 })
      .system('')
      .skillGraph(g, { continuity: 'conversation' })
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'anything at all' });
    expect(caps.routed[0]!.by).toBe('menu');
    expect(caps.routed[0]!.offered).toEqual(['first', 'second']);
    const active = caps.evaluated[0]!.activeIds as readonly string[];
    expect(active).not.toContain('first');
    expect(active).not.toContain('second');
  });

  it('a dropped resume on a graph with NO tier 2 stays a TRUE cold start — the walk still decides', async () => {
    // The other half of verdict-follows-suppression: when the cascade decided
    // NOTHING (droppedResume only, no rules, no scorer), the loop must behave
    // exactly like a fresh cold run — declaration-order walk, first entry loads.
    const caps = capture();
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).entry(b).build();
    const agent = Agent.create({ provider: answer(), model: 'mock', maxIterations: 3 })
      .system('')
      .skillGraph(g, { continuity: 'conversation' })
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'hello' });
    const cp = agent.checkpoint()!;
    const stale = { ...cp, skillCursor: 'retired-skill' };
    await agent.run({ message: 'hello again', continueFrom: stale });
    const second = caps.routed.at(-1)!;
    expect(second.droppedResume).toEqual({ id: 'retired-skill', reason: 'unknown-skill' });
    expect(second.by).toBe('none');
    // Fresh-run parity: the cold walk entered the first-declared entry.
    const lastEval = caps.evaluated.at(-1) as {
      activeIds?: readonly string[];
      cursorMove?: { by?: string; to?: string };
    };
    expect(lastEval.activeIds).toContain('a');
    expect(lastEval.cursorMove).toMatchObject({ by: 'entry', to: 'a' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security — role-hidden skills never surface in the cascade
// ─────────────────────────────────────────────────────────────────────────────

describe('security: hidden skills are neither scored, offered, nor named', () => {
  const hideShipping: PermissionChecker = {
    name: 'hide-shipping',
    governs: ['skill_read'],
    check: (req) =>
      req.capability === 'skill_read' && req.target === 'skill:shipping'
        ? { result: 'deny', rationale: 'not for this role' }
        : { result: 'allow' },
  };

  it('a hidden intent entry appears in no scores, no offered set, no envelope text', async () => {
    const caps = capture();
    const agent = Agent.create({
      provider: answer(),
      model: 'mock',
      maxIterations: 3,
      permissionChecker: hideShipping,
    })
      .system('')
      .skillGraph(supportGraph())
      .watch(caps.recorder)
      .build();
    // 'my order' would be a billing/shipping near-tie — with shipping hidden
    // it is a decisive billing turn instead.
    await agent.run({ message: 'my order' });
    expect(caps.routed[0]).toMatchObject({ by: 'intent', to: 'billing' });
    const scores = (caps.routed[0]!.scores ?? []) as ReadonlyArray<{ id: string }>;
    expect(scores.some((s) => s.id === 'shipping')).toBe(false);
    expect(readSkillDesc(caps.llmStarts[0]!)).not.toContain('shipping');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — the zero-delta guards
// ─────────────────────────────────────────────────────────────────────────────

describe('regression: absent options = byte-identical behavior AND events', () => {
  it('a scorer-only graph keeps PickEntry semantics: argmax entry, entryScores, NO turn_routed', async () => {
    const caps = capture();
    const g = skillGraph()
      .entry(skill('billing', 'refunds and charges'))
      .entry(skill('shipping', 'parcel delivery'))
      .entryBy(keywordScorer())
      .build();
    const agent = Agent.create({ provider: answer(), model: 'mock', maxIterations: 3 })
      .system('')
      .skillGraph(g)
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'refunds please' });
    expect(caps.routed).toEqual([]); // the cascade never ran
    expect(caps.evaluated[0]!.activeIds).toContain('billing'); // argmax, as shipped
    const snapshot = agent.getLastSnapshot()?.sharedState as {
      entryScores?: unknown;
      turnRoute?: unknown;
    };
    expect(snapshot.entryScores).toBeDefined();
    expect(snapshot.turnRoute).toBeUndefined(); // no cascade key on scope
  });

  it('a plain graph emits no turn_routed and its checkpoint carries no skillCursor', async () => {
    const caps = capture();
    const a = skill('a');
    const b = skill('b');
    const g = skillGraph().entry(a).route(a, b, { onToolReturn: 'noop' }).build();
    const agent = Agent.create({ provider: answer(), model: 'mock', maxIterations: 3 })
      .system('')
      .skillGraph(g)
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'hello' });
    expect(caps.routed).toEqual([]);
    const cp = agent.checkpoint()!;
    expect('skillCursor' in cp).toBe(false);
  });

  it("continuity:'turn' (explicit) still writes no skillCursor — the default span, named", async () => {
    const { agent, routed } = buildAgent(answer(), { continuity: 'turn' });
    await agent.run({ message: 'please refund my order' });
    // classify graphs always run the cascade — the verdict is recorded…
    expect(routed).toHaveLength(1);
    // …but the conversation carrier stays byte-identical to a 9.16 checkpoint.
    expect('skillCursor' in agent.checkpoint()!).toBe(false);
  });

  it('a consumer-registered menu hint stands the auto-registration down (marker, not id)', () => {
    // Two hints with one id would throw at injection registration — the
    // marker detection is what prevents the auto-add from double-mounting.
    const custom = defineMenuHint({ id: 'my-own-hint' });
    expect(custom.metadata?.[MENU_HINT_METADATA_KEY]).toBe(true);
    const agent = Agent.create({ provider: answer(), model: 'mock' })
      .system('')
      .skillGraph(supportGraph())
      .injection(custom)
      .build();
    expect(agent).toBeDefined();
  });
});
