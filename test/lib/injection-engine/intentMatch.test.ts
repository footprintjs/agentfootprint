/**
 * The intent match arm (SG-C) — `match: { intent, examples }` as the third
 * `SkillMatch` member, plus the graph-side rules it compiles under:
 *
 *   • compile: no sync predicate (the classifier judges it), serializable
 *     SkillMatchData, teaching refusals for every unhonorable shape;
 *   • graph: intent-without-classify is a BUILD refusal with a stable code;
 *     classify is one-router-per-graph and flat-only; the config rules form
 *     takes `classify`/`routing` beside the rules;
 *   • checkup: duplicate-intent-example is provable from data alone; the
 *     tier-1 pairwise checks RUN under classify (declaration order is back);
 *   • drawing: an intent edge captions with its sentence.
 *
 * Sections follow Convention 3: Unit · Functional · Integration (build).
 */

import { describe, it, expect } from 'vitest';
import { compileMatch, mermaidMatchCaption } from '../../../src/lib/injection-engine/skillMatch.js';
import { skillGraph, defineSkill, keywordScorer } from '../../../src/injection-engine.js';

const skill = (id: string) => defineSkill({ id, description: `use ${id}`, body: `${id} body` });

describe('unit: compileMatch — the intent arm', () => {
  it('compiles to NO predicate + serializable data (trimmed sentence, copied examples)', () => {
    const { predicate, data } = compileMatch(
      { intent: '  customer wants a refund ', examples: ['refund my order', 'money back'] },
      'entry "billing"',
    );
    expect(predicate).toBeUndefined();
    expect(data).toEqual({
      kind: 'intent',
      intent: 'customer wants a refund',
      examples: ['refund my order', 'money back'],
    });
    // Survives structuredClone — the SkillMatchData law.
    expect(structuredClone(data)).toEqual(data);
  });

  it('refuses an empty intent sentence, naming the field', () => {
    expect(() => compileMatch({ intent: '  ', examples: ['x'] }, 'entry "a"')).toThrow(
      /`intent` sentence/,
    );
  });

  it('refuses an empty / blank / non-string examples list, naming the field', () => {
    expect(() => compileMatch({ intent: 'x', examples: [] }, 'entry "a"')).toThrow(
      /`examples` list/,
    );
    expect(() => compileMatch({ intent: 'x', examples: ['  '] }, 'entry "a"')).toThrow(
      /`examples` list/,
    );
    expect(() =>
      compileMatch({ intent: 'x', examples: [1 as unknown as string] }, 'entry "a"'),
    ).toThrow(/`examples` list/);
  });

  it('the generic refusal now names all three supported forms', () => {
    expect(() => compileMatch('nope' as never, 'entry "a"')).toThrow(/intent: '…', examples/);
  });

  it('mermaid caption for an intent edge leads with the sentence', () => {
    expect(
      mermaidMatchCaption({ kind: 'intent', intent: 'customer wants a refund', examples: ['x'] }),
    ).toBe('intent: customer wants a refund');
  });
});

describe('functional: graph build refusals', () => {
  it('an intent entry with no classifier is refused with the stable code', () => {
    expect(() =>
      skillGraph()
        .entry(skill('billing'), { match: { intent: 'refunds', examples: ['refund me'] } })
        .build(),
    ).toThrow(/intent-without-classify/);
  });

  it('classify + entryBy / entryByRead is refused — one entry router per graph', () => {
    expect(() =>
      skillGraph()
        .entry(skill('a'), { match: { intent: 'i', examples: ['x'] } })
        .classify(keywordScorer())
        .entryBy(keywordScorer())
        .build(),
    ).toThrow(/ONE entry router/);
    expect(() =>
      skillGraph().entry(skill('a')).classify(keywordScorer()).entryByRead().build(),
    ).toThrow(/ONE entry router/);
  });

  it('classify + tree is refused (a tree has no turn start to route)', () => {
    expect(() => skillGraph().tree(skill('leaf')).classify(keywordScorer()).build()).toThrow(
      /flat entry\/route graphs/,
    );
  });

  it('config rules form: `routing` without `classify` is refused (one dial, one home)', () => {
    expect(() =>
      skillGraph({
        skills: [skill('a')],
        start: { rules: [{ use: 'a', match: { keywords: ['x'] } }], routing: { menuSize: 5 } },
      }),
    ).toThrow(/start\.routing/);
  });

  it('config rules form: classify beside intent rules compiles', () => {
    const g = skillGraph({
      skills: [skill('billing'), skill('shipping')],
      start: {
        rules: [
          { use: 'billing', match: { intent: 'refunds', examples: ['refund my order'] } },
          { use: 'shipping', match: { intent: 'delivery', examples: ['where is my parcel'] } },
        ],
        classify: keywordScorer(),
      },
    });
    expect(g.entrySelection).toBe('classify');
    expect(g.turnRouting?.scorer?.name).toBe('keyword');
    expect(typeof g.checkupIntents).toBe('function');
  });
});

describe('functional: graph surfaces (SG-C)', () => {
  const classified = () =>
    skillGraph()
      .entry(skill('billing'), { match: { intent: 'refunds', examples: ['refund my order'] } })
      .entry(skill('shipping'), { match: { intent: 'delivery', examples: ['track my parcel'] } })
      .classify(keywordScorer())
      .build();

  it('classify → entries compile EXCLUSIVE and the cold walk is suppressed', () => {
    const g = classified();
    // Cold start with no verdict and no pick: never the first-declared entry.
    const move = g.explainNextSkill({
      iteration: 1,
      userMessage: 'anything',
      history: [],
      activatedInjectionIds: [],
    });
    expect(move.by).toBe('none');
    expect(move.to).toBeUndefined();
  });

  it('the resolver consumes a turn verdict on iteration 1 — and only on iteration 1', () => {
    const g = classified();
    const base = { userMessage: 'x', history: [], activatedInjectionIds: [] } as const;
    const withVerdict = g.explainNextSkill({
      ...base,
      iteration: 1,
      turnRoute: { by: 'intent', to: 'shipping' },
    });
    expect(withVerdict).toEqual({ to: 'shipping', by: 'intent' });
    // continuity stay carries from + the cause.
    const stay = g.explainNextSkill({
      ...base,
      iteration: 1,
      currentSkillId: 'billing',
      turnRoute: { by: 'continuity', from: 'billing', to: 'billing' },
    });
    expect(stay).toEqual({ from: 'billing', to: 'billing', by: 'continuity' });
    // Iterations 2..N keep today's law byte-for-byte: the verdict is ignored.
    const later = g.explainNextSkill({
      ...base,
      iteration: 2,
      currentSkillId: 'billing',
      turnRoute: { by: 'intent', to: 'shipping' },
    });
    expect(later).toEqual({ from: 'billing', to: 'billing', by: 'stay' });
  });

  it('a menu verdict (no `to`) falls through — the gated model pick resolves it (D2)', () => {
    const g = classified();
    const move = g.explainNextSkill({
      iteration: 1,
      userMessage: 'x',
      history: [],
      activatedInjectionIds: [],
      turnRoute: { by: 'menu', offered: ['billing', 'shipping'] },
    });
    expect(move.by).toBe('none'); // nothing loads while the menu is open
  });

  it("an ENTRY-SCORER graph's resolver obeys a verdict too — suppression follows the verdict, not the compile-time flag", () => {
    // `.entryBy()` compiles with the cold walk ON (no classify, no entryByRead);
    // only the MOUNT opts it into the cascade. A verdict on scope must suppress
    // the walk anyway — a cold 'menu' (near-tie / scorer-throw fallback) can
    // never be overridden by the first-declared entry.
    const g = skillGraph()
      .entry(skill('first'))
      .entry(skill('second'))
      .entryBy(keywordScorer())
      .build();
    const base = { userMessage: 'x', history: [], activatedInjectionIds: [] } as const;
    const menu = g.explainNextSkill({
      ...base,
      iteration: 1,
      turnRoute: { by: 'menu', offered: ['first', 'second'] },
    });
    expect(menu.by).toBe('none'); // nothing loads while the menu is open
    // The menu stays open past iteration 1: the walk stays suppressed and the
    // model's gated pick resolves it (D2) — the .entryByRead() machinery.
    const resolved = g.explainNextSkill({
      ...base,
      iteration: 2,
      pendingSkillPick: 'second',
      turnRoute: { by: 'menu', offered: ['first', 'second'] },
    });
    expect(resolved).toEqual({ to: 'second', by: 'model-pick' });
    // No verdict on scope (the 9.16 shape): the walk still decides — zero-delta.
    const walked = g.explainNextSkill({ ...base, iteration: 1 });
    expect(walked).toEqual({ to: 'first', by: 'entry' });
  });

  it('plain graphs never see turnRoute and behave exactly as before', () => {
    const g = skillGraph().entry(skill('a')).build();
    const move = g.explainNextSkill({
      iteration: 1,
      userMessage: 'x',
      history: [],
      activatedInjectionIds: [],
    });
    expect(move).toEqual({ to: 'a', by: 'entry' });
    expect(g.entrySelection).toBeUndefined();
    expect(g.checkupIntents).toBeUndefined();
    // …but every flat graph now carries the plan (additive, agent-facing).
    expect(g.turnRouting?.scorer).toBeUndefined();
    expect(g.turnRouting?.entryIds).toEqual(['a']);
  });
});

describe('integration: checkup — the intent codes', () => {
  it('duplicate-intent-example warns with both ids and the normalized string', () => {
    const g = skillGraph()
      .entry(skill('billing'), { match: { intent: 'refunds', examples: ['Refund my  order'] } })
      .entry(skill('returns'), { match: { intent: 'returns', examples: ['refund my order'] } })
      .classify(keywordScorer())
      .build({ check: 'off' });
    const report = g.checkup();
    const dup = report.problems.find((p) => p.code === 'duplicate-intent-example');
    expect(dup).toBeDefined();
    expect(dup?.message).toContain('"billing"');
    expect(dup?.message).toContain('"returns"');
  });

  it('the same example twice under ONE intent is not a duplicate problem', () => {
    const g = skillGraph()
      .entry(skill('billing'), { match: { intent: 'refunds', examples: ['refund', 'REFUND'] } })
      .classify(keywordScorer())
      .build({ check: 'off' });
    expect(g.checkup().problems.some((p) => p.code === 'duplicate-intent-example')).toBe(false);
  });

  it('tier-1 pairwise shadow checks RUN under classify (declaration order is back)', () => {
    const g = skillGraph()
      .entry(skill('a'), { match: { keywords: ['refund', 'billing'] } })
      .entry(skill('b'), { match: { keywords: ['refund'] } }) // subset — shadowed
      .entry(skill('c'), { match: { intent: 'other', examples: ['something else'] } })
      .classify(keywordScorer())
      .build({ check: 'off' });
    expect(g.checkup().problems.some((p) => p.code === 'rules-shadowed-by-order')).toBe(true);
  });

  it('…and stay SKIPPED under a pure entry scorer (a scorer ranks all candidates)', () => {
    const g = skillGraph()
      .entry(skill('a'), { match: { keywords: ['refund', 'billing'] } })
      .entry(skill('b'), { match: { keywords: ['refund'] } })
      .entryBy(keywordScorer())
      .build({ check: 'off' });
    expect(g.checkup().problems.some((p) => p.code === 'rules-shadowed-by-order')).toBe(false);
  });
});
