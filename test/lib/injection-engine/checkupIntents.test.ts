/**
 * checkupIntents — the ASYNC leave-one-out intent audit (SG-C).
 *
 * Runs the CONFIGURED scorer (the router that will actually run) over every
 * declared example with its own intent represented by its REMAINING examples;
 * a cross-match or near-tie is an `overlapping-intents` warning naming the
 * example, both intents and both numbers. Absent without a classifier —
 * never `{ ok: true }` for a question it cannot ask.
 */

import { describe, it, expect } from 'vitest';
import { skillGraph, defineSkill, keywordScorer } from '../../../src/injection-engine.js';

const skill = (id: string) => defineSkill({ id, description: `use ${id}`, body: `${id} body` });

describe('checkupIntents', () => {
  it('is ABSENT without a classifier (the question cannot be asked)', () => {
    const g = skillGraph().entry(skill('a')).build();
    expect(g.checkupIntents).toBeUndefined();
  });

  it('clean, well-separated intents come back ok with no problems', async () => {
    const g = skillGraph()
      .entry(skill('billing'), {
        match: {
          intent: 'refunds',
          examples: ['refund my order money back', 'charge dispute invoice'],
        },
      })
      .entry(skill('weather'), {
        match: {
          intent: 'weather',
          examples: ['tomorrow forecast rain', 'sunny temperature today'],
        },
      })
      .classify(keywordScorer())
      .build();
    const report = await g.checkupIntents!();
    expect(report.ok).toBe(true);
    expect(report.problems.filter((p) => p.code === 'overlapping-intents')).toEqual([]);
  });

  it('an example whose top-1 is a DIFFERENT intent warns with both ids, both numbers, and the fix', async () => {
    const g = skillGraph()
      .entry(skill('billing'), {
        match: { intent: 'refunds', examples: ['refund my order'] },
      })
      .entry(skill('returns'), {
        // This intent's example corpus claims the refund phrasing outright.
        match: { intent: 'returns', examples: ['refund my order please', 'send the item back'] },
      })
      .classify(keywordScorer())
      .build();
    const report = await g.checkupIntents!();
    const overlap = report.problems.find((p) => p.code === 'overlapping-intents');
    expect(overlap).toBeDefined();
    expect(overlap?.kind).toBe('warning'); // warnings, never errors
    expect(overlap?.message).toContain('"billing"');
    expect(overlap?.message).toContain('"returns"');
    expect(overlap?.message).toMatch(/Differentiate the examples, or merge the intents/);
  });

  it('honesty clauses ride every message: configured-scorer-only + opaque `when` + tier-1 shadowers', async () => {
    const g = skillGraph()
      .entry(skill('vip'), { when: (ctx) => ctx.userMessage.includes('vip') })
      .entry(skill('billing'), { match: { intent: 'refunds', examples: ['refund my order'] } })
      .entry(skill('returns'), {
        match: { intent: 'returns', examples: ['refund my order now', 'return the item'] },
      })
      .classify(keywordScorer())
      .build();
    const report = await g.checkupIntents!();
    const overlap = report.problems.find((p) => p.code === 'overlapping-intents');
    expect(overlap?.message).toContain("Only the configured scorer's view was checked");
    expect(overlap?.message).toMatch(/`when` predicates are opaque/);
    // The rule entry fires BEFORE tier 2 in declaration order — named as unaudited.
    expect(overlap?.message).toContain('"vip"');
    expect(overlap?.message).toMatch(/NOT audited/);
  });

  it('duplicate examples surface here too (the sync provable half rides along)', async () => {
    const g = skillGraph()
      .entry(skill('a'), { match: { intent: 'one', examples: ['same words here'] } })
      .entry(skill('b'), { match: { intent: 'two', examples: ['Same  Words here', 'other'] } })
      .classify(keywordScorer())
      .build({ check: 'off' });
    const report = await g.checkupIntents!();
    expect(report.problems.some((p) => p.code === 'duplicate-intent-example')).toBe(true);
  });
});
