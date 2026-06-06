/**
 * CacheGate decider — 15-test matrix covering 7 patterns.
 *
 * Phase 5 of v2.6 cache layer. Tests the decider that gates
 * cache-marker application each iteration, plus the skill-churn
 * helper that feeds it.
 *
 * 7-pattern coverage:
 *   - unit:        each rule fires correctly in isolation (4)
 *   - boundary:    edge inputs (empty history, undefined hitRate) (3)
 *   - scenario:    realistic combined-state cases (2)
 *   - property:    rule precedence + default branch invariant (2)
 *   - security:    decider doesn't crash on malformed scope (1)
 *   - performance: detectSkillChurn O(window) bounded (1)
 *   - ROI:         end-to-end via decide()'s evidence shape (2)
 */

import { describe, expect, it } from 'vitest';
import {
  cacheGateDecide,
  detectSkillChurn,
  updateSkillHistory,
  HIT_RATE_FLOOR,
  SKILL_CHURN_THRESHOLD,
  SKILL_CHURN_WINDOW,
  type CacheGateState,
} from '../../src/cache/CacheGateDecider';

// ─── Fixtures ─────────────────────────────────────────────────────

/**
 * Build a scope-like object that exposes only what the decider reads.
 * The decider uses `scope.x` typed access via the proxy; for testing
 * we pass a plain object that satisfies the same shape.
 */
function makeScope(state: Partial<CacheGateState>): CacheGateState {
  return {
    cachingDisabled: false,
    recentHitRate: undefined,
    skillHistory: [],
    ...state,
  };
}

// ─── 1. Unit — each rule fires in isolation ───────────────────────

describe('cacheGateDecide — unit: rule firing', () => {
  it('default → "apply-markers" when no rules match', () => {
    const result = cacheGateDecide(makeScope({}));
    expect(result.branch).toBe('apply-markers');
  });

  it('kill switch → "no-markers"', () => {
    const result = cacheGateDecide(makeScope({ cachingDisabled: true }));
    expect(result.branch).toBe('no-markers');
  });

  it('hit-rate floor → "no-markers" when rate below threshold', () => {
    const result = cacheGateDecide(makeScope({ recentHitRate: 0.15 }));
    expect(result.branch).toBe('no-markers');
  });

  it('hit-rate above floor → "apply-markers"', () => {
    const result = cacheGateDecide(makeScope({ recentHitRate: 0.6 }));
    expect(result.branch).toBe('apply-markers');
  });
});

// ─── 1b. Unit — detectSkillChurn ──────────────────────────────────

describe('detectSkillChurn — unit', () => {
  it('returns false when history shorter than threshold', () => {
    expect(detectSkillChurn(['a', 'b'])).toBe(false);
  });

  it('returns true on 3 unique skills in window', () => {
    expect(detectSkillChurn(['a', 'b', 'c'])).toBe(true);
  });

  it('returns false when only 2 unique skills (A → B → A)', () => {
    expect(detectSkillChurn(['a', 'b', 'a'])).toBe(false);
  });

  it('ignores undefined entries when counting unique skills', () => {
    expect(detectSkillChurn([undefined, undefined, 'a', 'b'])).toBe(false);
    expect(detectSkillChurn([undefined, 'a', 'b', 'c'])).toBe(true);
  });
});

// ─── 2. Boundary — edge inputs ────────────────────────────────────

describe('cacheGateDecide — boundary', () => {
  it('empty skillHistory → no churn → falls through to "apply-markers"', () => {
    const result = cacheGateDecide(makeScope({ skillHistory: [] }));
    expect(result.branch).toBe('apply-markers');
  });

  it('undefined recentHitRate (no history yet) → does not trigger floor rule', () => {
    const result = cacheGateDecide(makeScope({ recentHitRate: undefined }));
    expect(result.branch).toBe('apply-markers');
  });

  it('hit rate exactly at floor (0.30) → does not trigger (strict <)', () => {
    const result = cacheGateDecide(makeScope({ recentHitRate: HIT_RATE_FLOOR }));
    expect(result.branch).toBe('apply-markers');
  });
});

// ─── 3. Scenario — realistic combined-state cases ─────────────────

describe('cacheGateDecide — scenario', () => {
  it('Neo-like: 5 iters all on port-error-triage + 60% hit rate → applies', () => {
    const scope = makeScope({
      recentHitRate: 0.6,
      skillHistory: [
        'port-error-triage',
        'port-error-triage',
        'port-error-triage',
        'port-error-triage',
        'port-error-triage',
      ],
    });
    const result = cacheGateDecide(scope);
    expect(result.branch).toBe('apply-markers');
  });

  it('Skill thrash + low hit rate → no-markers (kill rule precedence: hit rate first)', () => {
    const scope = makeScope({
      recentHitRate: 0.1, // below floor
      skillHistory: ['a', 'b', 'a', 'c', 'b'], // 3 unique → churn
    });
    const result = cacheGateDecide(scope);
    expect(result.branch).toBe('no-markers');
    // Both rules would have fired; first match wins (hit rate listed first
    // in the rule order)
    const matched = result.evidence?.rules.find((r) => r.matched);
    expect(matched?.label).toContain('hit rate');
  });
});

// ─── 4. Property — rule precedence + default invariant ────────────

describe('cacheGateDecide — property', () => {
  it('kill switch ALWAYS wins (highest precedence)', () => {
    const scope = makeScope({
      cachingDisabled: true,
      recentHitRate: 0.9, // would normally pass
      skillHistory: ['a', 'a', 'a'], // no churn
    });
    const result = cacheGateDecide(scope);
    expect(result.branch).toBe('no-markers');
    const matched = result.evidence?.rules.find((r) => r.matched);
    expect(matched?.label).toContain('kill switch');
  });

  it('all rules pass → default "apply-markers" (invariant: there is always a fallback)', () => {
    const scope = makeScope({
      cachingDisabled: false,
      recentHitRate: 0.85,
      skillHistory: ['only-skill', 'only-skill', 'only-skill'],
    });
    const result = cacheGateDecide(scope);
    expect(result.branch).toBe('apply-markers');
  });
});

// ─── 5. Security — defensive against malformed scope ──────────────

describe('cacheGateDecide — security', () => {
  it('falsy/zero hit rate (0.0) does not crash; treated as below floor', () => {
    const result = cacheGateDecide(makeScope({ recentHitRate: 0 }));
    expect(result.branch).toBe('no-markers');
  });
});

// ─── 6. Performance — detectSkillChurn bounded ────────────────────

describe('detectSkillChurn — performance', () => {
  it('runs in <5ms with 10K history entries (only window inspected)', () => {
    const huge = Array.from({ length: 10_000 }, (_, i) => `skill-${i % 7}`);
    const start = Date.now();
    detectSkillChurn(huge);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});

// ─── 7. ROI — evidence captured for cacheRecorder ─────────────────

describe('cacheGateDecide — ROI: evidence captures rule + inputs', () => {
  it("matched rule's label propagates to evidence", () => {
    const result = cacheGateDecide(makeScope({ cachingDisabled: true }));
    expect(result.evidence).toBeDefined();
    const matched = result.evidence!.rules.find((r) => r.matched);
    expect(matched?.label).toContain('kill switch');
  });

  it("updateSkillHistory appends current iter's active skill, bounds the window", () => {
    const scope: {
      activatedInjectionIds?: readonly string[];
      skillHistory: readonly (string | undefined)[];
    } = {
      activatedInjectionIds: ['skill-x'],
      skillHistory: Array.from({ length: SKILL_CHURN_WINDOW * 2 }, (_, i) => `skill-${i}`),
    };
    updateSkillHistory(scope as never);
    // Bounded to window*2; oldest entry dropped
    expect(scope.skillHistory.length).toBeLessThanOrEqual(SKILL_CHURN_WINDOW * 2);
    // Latest is the active skill
    expect(scope.skillHistory[scope.skillHistory.length - 1]).toBe('skill-x');
  });
});

// ─── 8. Regression — updateSkillHistory samples the TAIL (churn fix) ──
//
// `activatedInjectionIds` is cumulative + deduped per turn (read_skill
// APPENDS new ids to the end), so the HEAD is frozen at the FIRST skill
// activated and never changes mid-turn. Sampling the head made the rolling
// window record one constant value, so detectSkillChurn could never fire —
// the skill-churn cache rule was effectively dead. The fix samples the
// most-recently activated skill (the TAIL). These tests pin that fix.

describe('updateSkillHistory — samples the most-recent activation (tail)', () => {
  function step(
    activatedInjectionIds: readonly string[],
    skillHistory: readonly (string | undefined)[],
  ): readonly (string | undefined)[] {
    const scope = { activatedInjectionIds, skillHistory };
    updateSkillHistory(scope as never);
    return scope.skillHistory;
  }

  it('records the TAIL, not the head, when several skills are active', () => {
    // [a, b, c] cumulative → the skill active THIS iteration is c (newest).
    const next = step(['a', 'b', 'c'], []);
    expect(next[next.length - 1]).toBe('c'); // tail
    expect(next[next.length - 1]).not.toBe('a'); // 'a' is what the old head bug recorded
  });

  it('records undefined when no skill has been activated yet', () => {
    expect(step([], [])).toEqual([undefined]);
  });

  it('CHURN NOW FIRES across a → b → c iterations (the bug this fixes)', () => {
    // Simulate the ReAct loop: each iteration the LLM activates one more
    // skill, so activatedInjectionIds grows and updateSkillHistory samples it.
    let history: readonly (string | undefined)[] = [];
    history = step(['a'], history); // iter 1: active = a
    history = step(['a', 'b'], history); // iter 2: active = b
    history = step(['a', 'b', 'c'], history); // iter 3: active = c
    expect(history).toEqual(['a', 'b', 'c']);
    expect(detectSkillChurn(history)).toBe(true);
    // Proof of the bug: head-sampling would have produced ['a','a','a'],
    // and detectSkillChurn would (wrongly) return false.
    expect(detectSkillChurn(['a', 'a', 'a'])).toBe(false);
  });

  it('no churn when the agent stays on ONE skill across iterations', () => {
    let history: readonly (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) history = step(['a'], history);
    expect(detectSkillChurn(history)).toBe(false);
  });

  it('KNOWN LIMITATION: multiple skills in ONE iteration record only the tail', () => {
    // If a, b, c all activate in the SAME iteration, only the tail (c) is
    // recorded for that iteration — churn can under-count a multi-skill burst.
    // Documented in updateSkillHistory's JSDoc; a fully order-independent
    // signal would read activatedInjectionIds.length in the gate instead.
    const history = step(['a', 'b', 'c'], []);
    expect(history).toEqual(['c']); // single entry, the tail
    expect(detectSkillChurn(history)).toBe(false); // under-counts: 1 < threshold
  });
});
