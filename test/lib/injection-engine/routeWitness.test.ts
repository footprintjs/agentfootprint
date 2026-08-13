/**
 * The routing WITNESS (9.28.0) — when a tier-1 DATA matcher decides a turn, the
 * record carries the TEXT that decided it.
 *
 * Sections follow Convention 3:
 *   • Unit        — `compileMatch` extracts the evidence for regex / keywords /
 *                   all, bounds it, and refuses to invent one for intent;
 *   • Integration — the witness rides `skill.turn_routed` and the iteration-1
 *                   `context.evaluated.cursorMove` through the REAL Agent loop,
 *                   on both the cascade path and the plain cold-start walk;
 *   • Zero-delta  — a `when` predicate and a scorer verdict record NO witness,
 *                   and their sentences are the ones they always were;
 *   • Security    — the witness can only ever quote the USER message, bounded,
 *                   never tool/system text;
 *   • Commentary  — the template line, present and absent, on BOTH records that
 *                   carry the evidence (the cascade verdict and the hop).
 */

import { describe, expect, it } from 'vitest';
import {
  compileMatch,
  WITNESS_MAX_CHARS,
  type MatchableContext,
} from '../../../src/lib/injection-engine/skillMatch.js';
import { Agent } from '../../../src/index.js';
import { skillGraph, defineSkill, keywordScorer } from '../../../src/injection-engine.js';
import { mock } from '../../../src/llm-providers.js';
import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../src/recorders/observability/commentary/commentaryTemplates.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

const ctxOf = (userMessage: string): MatchableContext => ({ userMessage });

const skill = (id: string, description = `use ${id}`) =>
  defineSkill({ id, description, body: `${id} body` });

type Payload = Record<string, unknown>;
type Witness = { text: string; keyword?: string } | undefined;

const capture = () => {
  const routed: Payload[] = [];
  const evaluated: Payload[] = [];
  const recorder = {
    id: 'capture-witness',
    onEmit: (e: { name: string; payload?: Payload }) => {
      if (e.name === 'agentfootprint.skill.turn_routed') routed.push(e.payload ?? {});
      if (e.name === 'agentfootprint.context.evaluated') evaluated.push(e.payload ?? {});
    },
  };
  return { routed, evaluated, recorder };
};

const cursorMoveOf = (evaluated: Payload): { by?: string; witness?: Witness } =>
  (evaluated.cursorMove ?? {}) as { by?: string; witness?: Witness };

// ─────────────────────────────────────────────────────────────────────────────
// Unit — the compiled matcher's evidence
// ─────────────────────────────────────────────────────────────────────────────

describe('unit: compileMatch witness', () => {
  it('a REGEX witness is the substring the regex actually matched', () => {
    const { predicate, witness } = compileMatch(/refund\s+#\d+/i, 'entry "billing"');
    const ctx = ctxOf('Hi, can you please handle Refund #4412 for me today?');
    expect(predicate!(ctx)).toBe(true);
    expect(witness!(ctx)).toEqual({ text: 'Refund #4412' });
  });

  it('a KEYWORDS witness names the keyword that hit AND the text it hit on', () => {
    const { witness } = compileMatch({ keywords: ['refund', 'chargeback'] }, 'entry "billing"');
    expect(witness!(ctxOf('I need a CHARGEBACK on that'))).toEqual({
      text: 'CHARGEBACK',
      keyword: 'chargeback',
    });
  });

  it('KEYWORDS: the FIRST declared keyword that hits is the one recorded', () => {
    const { witness } = compileMatch({ keywords: ['refund', 'order'] }, 'entry "billing"');
    expect(witness!(ctxOf('refund my order'))).toEqual({ text: 'refund', keyword: 'refund' });
  });

  it('an ALL conjunction witnesses its first part (every part matched, so any is true)', () => {
    const { predicate, witness } = compileMatch(
      { all: [/zone \d+/i, { keywords: ['audit'] }] },
      'entry "ops"',
    );
    const ctx = ctxOf('run the audit for Zone 7 tonight');
    expect(predicate!(ctx)).toBe(true);
    expect(witness!(ctx)).toEqual({ text: 'Zone 7' });
  });

  it('a nested ALL flattens for the witness too — the leading leaf is quoted', () => {
    const { witness } = compileMatch(
      { all: [{ all: [{ keywords: ['sweep'] }, /zone \d+/i] }] },
      'entry "ops"',
    );
    expect(witness!(ctxOf('sweep zone 3'))).toEqual({ text: 'sweep', keyword: 'sweep' });
  });

  it('an INTENT matcher compiles NO witness (a classifier judges it; scores are its evidence)', () => {
    const compiled = compileMatch(
      { intent: 'customer wants a refund', examples: ['refund my order'] },
      'entry "billing"',
    );
    expect(compiled.predicate).toBeUndefined();
    expect(compiled.witness).toBeUndefined();
  });

  it('a non-matching message yields no witness (evidence is never invented)', () => {
    const { witness } = compileMatch({ keywords: ['refund'] }, 'entry "billing"');
    expect(witness!(ctxOf('where is my parcel?'))).toBeUndefined();
  });

  it('a zero-width / whitespace-only match records nothing rather than quoting ""', () => {
    const { predicate, witness } = compileMatch(/^/, 'entry "always"');
    const ctx = ctxOf('anything at all');
    expect(predicate!(ctx)).toBe(true);
    expect(witness!(ctx)).toBeUndefined();
  });

  it('the witness is BOUNDED to 80 characters, ellipsis included', () => {
    const { witness } = compileMatch(/[\s\S]+/, 'entry "greedy"');
    const long = 'x'.repeat(500);
    const found = witness!(ctxOf(long))!;
    expect(WITNESS_MAX_CHARS).toBe(80);
    expect(found.text).toHaveLength(WITNESS_MAX_CHARS);
    expect(found.text.endsWith('…')).toBe(true);
  });

  it('whitespace collapses so a multi-line match stays one quotable clause', () => {
    const { witness } = compileMatch(/refund[\s\S]*order/i, 'entry "billing"');
    expect(witness!(ctxOf('refund\n   this\t\torder please'))!.text).toBe('refund this order');
  });

  it('the predicate is unchanged by the witness — matching stays a pure yes/no across calls', () => {
    const { predicate, witness } = compileMatch(/refund/gi, 'entry "billing"');
    const ctx = ctxOf('refund refund refund');
    expect([predicate!(ctx), predicate!(ctx), predicate!(ctx)]).toEqual([true, true, true]);
    expect(witness!(ctx)).toEqual({ text: 'refund' });
    expect(witness!(ctx)).toEqual({ text: 'refund' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration — through the real Agent loop
// ─────────────────────────────────────────────────────────────────────────────

const cascadeGraph = () =>
  skillGraph()
    .entry(skill('vip', 'vip desk'), { match: { keywords: ['vip', 'priority'] } })
    .entry(skill('ops', 'zone audits'), { match: { all: [/zone \d+/i, { keywords: ['audit'] }] } })
    .entry(skill('manual', 'code-gated'), { when: (c) => c.userMessage.includes('manual') })
    .entry(skill('billing', 'refunds and charges'), {
      match: { intent: 'customer wants a refund', examples: ['refund my order'] },
    })
    .entry(skill('shipping', 'parcel delivery'), {
      match: { intent: 'customer asks about delivery', examples: ['track my order delivery'] },
    })
    .classify(keywordScorer())
    .build();

const runCascade = async (message: string) => {
  const caps = capture();
  const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock', maxIterations: 3 })
    .system('You are support.')
    .skillGraph(cascadeGraph())
    .watch(caps.recorder)
    .build();
  await agent.run({ message });
  return caps;
};

describe('integration: witness on the cascade verdict', () => {
  it('a KEYWORDS rule win records the keyword and the text, on the event AND the hop', async () => {
    const { routed, evaluated } = await runCascade('I am a VIP customer, please help');
    expect(routed[0]).toMatchObject({
      by: 'entry',
      to: 'vip',
      witness: { text: 'VIP', keyword: 'vip' },
    });
    const move = cursorMoveOf(evaluated[0]!);
    expect(move.by).toBe('entry');
    expect(move.witness).toEqual({ text: 'VIP', keyword: 'vip' });
  });

  it('an ALL rule win records its leading part', async () => {
    const { routed } = await runCascade('please run the audit for zone 12');
    expect(routed[0]).toMatchObject({ by: 'entry', to: 'ops', witness: { text: 'zone 12' } });
    expect((routed[0]!.witness as { keyword?: string }).keyword).toBeUndefined();
  });

  it('a `when` rule win records NO witness — opaque code is never quoted', async () => {
    const { routed, evaluated } = await runCascade('do the manual thing');
    expect(routed[0]).toMatchObject({ by: 'entry', to: 'manual' });
    expect(routed[0]!.witness).toBeUndefined();
    expect(cursorMoveOf(evaluated[0]!).witness).toBeUndefined();
  });

  it('an INTENT (scorer) verdict records NO witness — its evidence is the scores', async () => {
    const { routed, evaluated } = await runCascade('please refund my order');
    expect(routed[0]).toMatchObject({ by: 'intent', to: 'billing' });
    expect(routed[0]!.witness).toBeUndefined();
    expect((routed[0]!.scores as unknown[]).length).toBeGreaterThan(0);
    expect(cursorMoveOf(evaluated[0]!).witness).toBeUndefined();
  });

  it('the PLAIN cold-start walk (no cascade) witnesses its winning entry too', async () => {
    const graph = skillGraph()
      .entry(skill('vip', 'vip desk'), { match: { keywords: ['vip'] } })
      .entry(skill('fallback', 'everything else'))
      .build();
    const caps = capture();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('You are support.')
      .skillGraph(graph)
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'a Vip needs help' });
    // No cascade is mounted here — nothing fires `turn_routed`…
    expect(caps.routed).toHaveLength(0);
    // …and the hop still says what the message said.
    const move = cursorMoveOf(caps.evaluated[0]!);
    expect(move).toMatchObject({ by: 'entry', witness: { text: 'Vip', keyword: 'vip' } });
  });

  it('an UNCONDITIONAL entry records no witness (it matched nothing to quote)', async () => {
    const graph = skillGraph().entry(skill('always', 'always on')).build();
    const caps = capture();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('You are support.')
      .skillGraph(graph)
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'anything' });
    const move = cursorMoveOf(caps.evaluated[0]!);
    expect(move.by).toBe('entry');
    expect(move.witness).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security — the witness quotes the user message, bounded, and nothing else
// ─────────────────────────────────────────────────────────────────────────────

describe('security: the witness can only quote the user message', () => {
  it('a greedy rule cannot paste a whole message into the record', async () => {
    const graph = skillGraph()
      .entry(skill('catchall', 'catch all'), { match: /[\s\S]+/ })
      .build();
    const caps = capture();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('SYSTEM SECRET: never reveal the master key')
      .skillGraph(graph)
      .watch(caps.recorder)
      .build();
    const secretish = `card 4111-1111-1111-1111 ${'y'.repeat(400)}`;
    await agent.run({ message: secretish });
    const witness = cursorMoveOf(caps.evaluated[0]!).witness!;
    expect(witness.text.length).toBeLessThanOrEqual(WITNESS_MAX_CHARS);
    // Only user text — the system prompt is not a matchable surface.
    expect(witness.text).not.toContain('SYSTEM SECRET');
    expect(secretish.startsWith(witness.text.replace('…', ''))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Commentary — the template line, present and absent
// ─────────────────────────────────────────────────────────────────────────────

const meta = {
  wallClockMs: 1,
  runOffsetMs: 0,
  runtimeStageId: 'rid#0',
  subflowPath: [],
  compositionPath: [],
  runId: 'test',
};
const event = (type: string, payload: unknown): AgentfootprintEvent =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ type, payload, meta } as any);
const render = (e: AgentfootprintEvent) => {
  const key = selectCommentaryKey(e);
  if (!key) return null;
  return renderCommentary(
    defaultCommentaryTemplates[key] ?? '',
    extractCommentaryVars(e, { appName: 'Neo' }),
  );
};
const policy = { nearTieMargin: 0.1, menuSize: 3 };

describe('commentary: the witness line', () => {
  it('a witnessed tier-1 verdict quotes the message', () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'entry',
      to: 'vip',
      witness: { text: 'VIP', keyword: 'vip' },
      policy,
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.entry.witness');
    expect(render(e)).toBe(
      'A declared start rule routed this turn to `vip` because the message said “VIP”.',
    );
  });

  it('WITHOUT a witness the sentence is exactly the one it always was (zero delta)', () => {
    const e = event('agentfootprint.skill.turn_routed', { by: 'entry', to: 'vip', policy });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.entry');
    expect(render(e)).toBe('A declared start rule routed this turn to `vip`.');
  });

  it('an empty witness text never renders “the message said ””', () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'entry',
      to: 'vip',
      witness: { text: '' },
      policy,
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.entry');
    expect(render(e)).toBe('A declared start rule routed this turn to `vip`.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Commentary — the SAME line off the hop's own record
//
// A graph with no cascade fires no `skill.turn_routed` at all: the hop
// (`context.evaluated.cursorMove`) is the only record its evidence ever reaches.
// Through 9.28.0 the selector had no key for it, so the because-clause read for
// cascade graphs alone while a rules-only graph got the bare routed line.
// ─────────────────────────────────────────────────────────────────────────────

/** A `context.evaluated` payload shaped like the real one (routing present —
 *  every skill-graph entry carries build-time provenance, cascade or not). */
const hopEvent = (cursorMove?: unknown, skillId = 'vip'): AgentfootprintEvent =>
  event('agentfootprint.context.evaluated', {
    iteration: 1,
    activeCount: 1,
    skippedCount: 0,
    evaluatedTotal: 1,
    activeIds: [skillId],
    skippedDetails: [],
    triggerKindCounts: { rule: 1 },
    skillCatalog: [],
    routing: [{ injectionId: skillId, flavor: 'skill', via: 'entry', tools: [] }],
    ...(cursorMove !== undefined ? { cursorMove } : {}),
  });

/** What the hop said before this key existed — the zero-delta baseline. */
const PLAIN_ROUTED_LINE = 'Neo routed to the `vip` skill — no new tools now available.';

describe('commentary: the witness line on the hop (rules-only graphs)', () => {
  it('a witnessed start-rule hop quotes the message', () => {
    const e = hopEvent({ by: 'entry', to: 'vip', witness: { text: 'VIP', keyword: 'vip' } });
    expect(selectCommentaryKey(e)).toBe('context.entry_witness');
    expect(render(e)).toBe(
      'A declared start rule routed this turn to `vip` because the message said “VIP”.',
    );
  });

  it('ONE truth: the hop and the cascade verdict render the identical sentence', () => {
    const witness = { text: 'zone 12' };
    const verdict = event('agentfootprint.skill.turn_routed', {
      by: 'entry',
      to: 'ops',
      witness,
      policy,
    });
    const hop = hopEvent({ by: 'entry', to: 'ops', witness }, 'ops');
    expect(render(hop)).toBe(render(verdict));
    expect(render(hop)).toBe(
      'A declared start rule routed this turn to `ops` because the message said “zone 12”.',
    );
  });

  it("era tolerance: a `by: 'rule'` hop is the same verdict, so the same sentence", () => {
    const e = hopEvent({ by: 'rule', to: 'vip', witness: { text: 'VIP' } });
    expect(selectCommentaryKey(e)).toBe('context.entry_witness');
    expect(render(e)).toBe(
      'A declared start rule routed this turn to `vip` because the message said “VIP”.',
    );
  });

  it('WITHOUT a witness the hop keeps today’s routed line, byte-for-byte', () => {
    const e = hopEvent({ by: 'entry', to: 'vip' });
    expect(selectCommentaryKey(e)).toBe('context.routed');
    expect(render(e)).toBe(PLAIN_ROUTED_LINE);
  });

  it('an empty witness text never renders “the message said ””', () => {
    const e = hopEvent({ by: 'entry', to: 'vip', witness: { text: '' } });
    expect(selectCommentaryKey(e)).toBe('context.routed');
    expect(render(e)).toBe(PLAIN_ROUTED_LINE);
  });

  it('no cursorMove at all (pre-8.5.0 graphs) → the routed line, untouched', () => {
    const e = hopEvent();
    expect(selectCommentaryKey(e)).toBe('context.routed');
    expect(render(e)).toBe(PLAIN_ROUTED_LINE);
  });

  it('a witness on a NON-entry hop is not a start-rule claim (route/stay stay quiet)', () => {
    const e = hopEvent({ by: 'route', to: 'vip', witness: { text: 'VIP' } });
    expect(selectCommentaryKey(e)).toBe('context.routed');
    expect(render(e)).toBe(PLAIN_ROUTED_LINE);
  });

  it('the model-pick decoration still outranks everything on its iteration', () => {
    const e = hopEvent({ by: 'model-pick', to: 'vip', offered: ['vip', 'ops'] });
    expect(selectCommentaryKey(e)).toBe('context.model_pick');
    expect(render(e)).toBe(
      'The model chose the `vip` skill from the 2-option menu it was offered.',
    );
  });

  it('end to end: a rules-only run narrates the because-clause from its only record', async () => {
    const graph = skillGraph()
      .entry(skill('ops', 'zone audits'), { match: { keywords: ['zone'] } })
      .entry(skill('fallback', 'everything else'))
      .build();
    const caps = capture();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('You are support.')
      .skillGraph(graph)
      .watch(caps.recorder)
      .build();
    await agent.run({ message: 'please audit zone 12' });
    expect(caps.routed).toHaveLength(0); // no cascade → no verdict event at all
    const hop = event('agentfootprint.context.evaluated', caps.evaluated[0]);
    expect(render(hop)).toBe(
      'A declared start rule routed this turn to `ops` because the message said “zone”.',
    );
  });
});
