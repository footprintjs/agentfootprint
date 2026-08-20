/**
 * cacheRecorder() — 7-pattern test matrix.
 *
 * ── THE FIXTURES ARE PORT-SHAPED, AND THAT IS THE POINT (9.59.0) ────────
 * `llmEndEvent` below feeds `{ input, output, cacheRead?, cacheWrite? }` —
 * the shape `agentfootprint.stream.llm_end` has ALWAYS carried. Until 9.59.0
 * every fixture in this file fed RAW WIRE names (`cache_read_input_tokens`),
 * which no strategy is ever handed. So the suite stayed green while the
 * SHIPPED meter read `undefined` from every field, recorded nothing, and
 * reported a 0% hit rate for turns that hit cache on every call. Wire-shaped
 * fixtures are how that bug survived a release.
 *
 * The second half of the fix is the TYPE: every derived quantity is a
 * `Claim`, so "nobody measured" and "measured, and it was zero" can no longer
 * render identically. Assertions below go through `isKnown`, which is the only
 * door to a value — an unmeasured report has no `.value` to read.
 *
 * 7-pattern coverage:
 *   - unit:        report shape; reset behavior (3)
 *   - boundary:    no events received → empty report (2)
 *   - scenario:    end-to-end Anthropic strategy + pricing (3)
 *   - property:    hitRate ∈ [0, 1]; spent ≤ no-cache cost (2)
 *   - security:    malformed usage doesn't crash (2)
 *   - performance: 100 iterations of recorder updates fast (1)
 *   - ROI:         dollar savings computed correctly (2)
 */

import { describe, expect, it } from 'vitest';
import { cacheRecorder } from '../../src/cache/cacheRecorder';
import { AnthropicCacheStrategy } from '../../src/cache/strategies/AnthropicCacheStrategy';
import type { PricingTable, TokenKind } from '../../src/adapters/types';
import type { FlowDecisionEvent } from 'footprintjs';
import type { AgentfootprintEvent } from '../../src/events/registry';
import { expectScalesLinearly } from '../helpers/perf.js';
import { isKnown, describeClaim } from '../../src/lib/claim/claim.js';

// Sonnet 4.5 simplified pricing — $3/M input, $0.30/M cache read, $3.75/M cache write
const sonnetPricing: PricingTable = {
  name: 'sonnet-4-5',
  pricePerToken(_model: string, kind: TokenKind): number {
    switch (kind) {
      case 'input':
        return 3 / 1_000_000;
      case 'output':
        return 15 / 1_000_000;
      case 'cacheRead':
        return 0.3 / 1_000_000; // 10% of input
      case 'cacheWrite':
        return 3.75 / 1_000_000; // 125% of input
    }
  },
};

function decisionEvent(branch: 'apply-markers' | 'no-markers', rule?: string): FlowDecisionEvent {
  return {
    // cacheRecorder matches by the LOCAL stage id off traversalContext.stageId
    // (NOT event.decider, which is the NAME). The real engine emits the
    // PREFIXED id now that CacheGate is nested in sf-cache — reproduce that so
    // splitStageId(...).localStageId === 'cache-gate' is what's exercised.
    // (decider carries the matching prefixed NAME for realism; unused by the match.)
    decider: 'sf-cache/CacheGate',
    traversalContext: { stageId: 'sf-cache/cache-gate', runtimeStageId: 'sf-cache/cache-gate#0' },
    chosen: branch,
    evidence: rule
      ? {
          rules: [
            {
              type: 'function',
              ruleIndex: 0,
              branch,
              matched: true,
              label: rule,
              inputs: [],
            },
          ],
          chosen: branch,
          default: 'apply-markers',
        }
      : undefined,
  } as unknown as FlowDecisionEvent;
}

/**
 * One `llm_end` carrying PORT-shaped usage.
 *
 * `cacheRead` / `cacheWrite` are omitted unless given, exactly as an adapter
 * omits them when the provider reported no number — their absence is the
 * signal "nobody measured", and collapsing it to 0 is the original bug.
 */
function llmEndEvent(usage: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
} | null): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.llm_end',
    payload: { usage: usage === null ? undefined : { output: 0, ...usage } },
  } as unknown as AgentfootprintEvent;
}

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('cacheRecorder — unit', () => {
  it('an EMPTY report is unmeasured, not zero — and says why', () => {
    const rec = cacheRecorder();
    const r = rec.report();
    // The counts the recorder made itself are plain numbers: it counted them.
    expect(r.totalIterations).toBe(0);
    expect(r.measuredIterations).toBe(0);
    // Everything DERIVED from provider usage is a Claim. `hitRate: 0` here
    // would be a lie a dashboard renders as "caching is not working".
    expect(isKnown(r.hitRate)).toBe(false);
    expect(isKnown(r.cacheReadTokensTotal)).toBe(false);
    expect(r.hitRate.kind === 'unknown' && r.hitRate.reason).toMatch(/nothing to measure/);
    expect(describeClaim(r.hitRate)).toMatch(/^unknown — /);
  });

  it('reset clears accumulated state', () => {
    const rec = cacheRecorder();
    rec.onEmit(llmEndEvent({ input: 100 }));
    rec.reset();
    expect(rec.report().totalIterations).toBe(0);
  });

  it('decision recorded only for the cache-gate stage (other deciders ignored)', () => {
    const rec = cacheRecorder();
    // A different decider (the Route decider) — should be ignored: its local
    // stage id is 'sf-route', not 'cache-gate'.
    rec.onDecision({
      decider: 'Route',
      traversalContext: { stageId: 'sf-route', runtimeStageId: 'sf-route#0' },
      chosen: 'final',
    } as unknown as FlowDecisionEvent);
    rec.onEmit(llmEndEvent({ input: 100 }));
    const r = rec.report();
    expect(r.perIter[0].rule).toBeUndefined(); // no rule captured
  });
});

// ─── 2. Boundary ──────────────────────────────────────────────────

describe('cacheRecorder — boundary', () => {
  it('no llm_end events → empty report', () => {
    const rec = cacheRecorder();
    rec.onDecision(decisionEvent('apply-markers'));
    expect(rec.report().totalIterations).toBe(0);
  });

  it('no strategy → the row states that NOTHING READ the usage', () => {
    const rec = cacheRecorder();
    rec.onEmit(llmEndEvent({ input: 100 }));
    const r = rec.report();
    expect(r.totalIterations).toBe(1);
    expect(r.measuredIterations).toBe(0);
    expect(r.unmeasuredIterations).toBe(1);
    const m = r.perIter[0]!.metrics;
    expect(m.kind).toBe('unknown');
    expect(m.kind === 'unknown' && m.reason).toMatch(/no CacheStrategy/);
    // R5: unknown PROPAGATES through every derived metric.
    expect(isKnown(r.perIter[0]!.dollarsSpent)).toBe(false);
    expect(isKnown(r.hitRate)).toBe(false);
  });
});

// ─── 3. Scenario ──────────────────────────────────────────────────

describe('cacheRecorder — scenario', () => {
  it('iter 1 cache write, iter 2-3 cache hits — Anthropic strategy', () => {
    const rec = cacheRecorder({
      strategy: new AnthropicCacheStrategy(),
      pricing: sonnetPricing,
      model: 'claude-sonnet-4-5',
    });

    // Iter 1: cache write
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({ input: 240, cacheWrite: 3000, cacheRead: 0 }),
    );

    // Iter 2: cache hit
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({ input: 80, cacheWrite: 0, cacheRead: 3000 }),
    );

    // Iter 3: cache hit
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({ input: 80, cacheWrite: 0, cacheRead: 3000 }),
    );

    const r = rec.report();
    expect(r.totalIterations).toBe(3);
    expect(r.measuredIterations).toBe(3);
    expect(r.unmeasuredIterations).toBe(0);
    expect(isKnown(r.cacheReadTokensTotal) && r.cacheReadTokensTotal.value).toBe(6000);
    expect(isKnown(r.cacheWriteTokensTotal) && r.cacheWriteTokensTotal.value).toBe(3000);
    // Hit rate: cacheRead / total = 6000 / (6000 + 3000 + 400) ≈ 0.638
    expect(isKnown(r.hitRate)).toBe(true);
    expect(isKnown(r.hitRate) && r.hitRate.value).toBeGreaterThan(0.6);
    expect(isKnown(r.hitRate) && r.hitRate.value).toBeLessThan(0.7);
    // NO PERCENTAGE WITHOUT ITS DENOMINATOR: the evidence sentence carries it.
    expect(isKnown(r.hitRate) && r.hitRate.evidence).toMatch(/3 of 3/);
  });

  it("'no-markers' branch records the rule that fired", () => {
    const rec = cacheRecorder();
    rec.onDecision(decisionEvent('no-markers', 'kill switch active'));
    rec.onEmit(llmEndEvent({ input: 100 }));
    expect(rec.report().perIter[0].rule).toContain('kill switch');
  });

  it('mixed apply / skip iterations counted separately', () => {
    const rec = cacheRecorder();
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(llmEndEvent({ input: 100 }));
    rec.onDecision(decisionEvent('no-markers', 'churn'));
    rec.onEmit(llmEndEvent({ input: 100 }));
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(llmEndEvent({ input: 100 }));
    const r = rec.report();
    expect(r.applyMarkersIterations).toBe(2);
    expect(r.noMarkersIterations).toBe(1);
  });
});

// ─── 4. Property ──────────────────────────────────────────────────

describe('cacheRecorder — property', () => {
  it('hitRate is always in [0, 1]', () => {
    const rec = cacheRecorder({
      strategy: new AnthropicCacheStrategy(),
      pricing: sonnetPricing,
    });
    for (let i = 0; i < 5; i++) {
      rec.onDecision(decisionEvent('apply-markers'));
      rec.onEmit(
        llmEndEvent({
          input: 100 * (i + 1),
          cacheWrite: i === 0 ? 5000 : 0,
          cacheRead: i > 0 ? 5000 : 0,
        }),
      );
    }
    const r = rec.report();
    expect(isKnown(r.hitRate)).toBe(true);
    expect(isKnown(r.hitRate) && r.hitRate.value).toBeGreaterThanOrEqual(0);
    expect(isKnown(r.hitRate) && r.hitRate.value).toBeLessThanOrEqual(1);
  });

  it('cache spend ≤ no-cache cost (caching is never net-cost-positive when strategy works)', () => {
    const rec = cacheRecorder({
      strategy: new AnthropicCacheStrategy(),
      pricing: sonnetPricing,
      model: 'sonnet',
    });
    // Simulate 5 cache-hit iterations after one initial write
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({ input: 240, cacheWrite: 3000, cacheRead: 0 }),
    );
    for (let i = 0; i < 5; i++) {
      rec.onDecision(decisionEvent('apply-markers'));
      rec.onEmit(
        llmEndEvent({ input: 80, cacheWrite: 0, cacheRead: 3000 }),
      );
    }
    const r = rec.report();
    expect(isKnown(r.estimatedDollarsSavedVsNoCache)).toBe(true);
    expect(
      isKnown(r.estimatedDollarsSavedVsNoCache) && r.estimatedDollarsSavedVsNoCache.value,
    ).toBeGreaterThan(0);
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('cacheRecorder — security: defensive parsing', () => {
  it('llm_end with no usage → no crash, and the row says why it is unknown', () => {
    const rec = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    rec.onEmit(llmEndEvent(null));
    const r = rec.report();
    const m = r.perIter[0]!.metrics;
    expect(m.kind).toBe('unknown');
    expect(m.kind === 'unknown' && m.reason).toMatch(/no usage payload/);
  });

  it('decision with no evidence → branch captured but rule undefined', () => {
    const rec = cacheRecorder();
    rec.onDecision({
      decider: 'cache-gate',
      chosen: 'apply-markers',
      // no evidence field
    } as unknown as FlowDecisionEvent);
    rec.onEmit(llmEndEvent({ input: 100 }));
    expect(rec.report().perIter[0].rule).toBeUndefined();
    expect(rec.report().perIter[0].branch).toBe('apply-markers');
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('cacheRecorder — performance', () => {
  it('recording cost stays flat as iterations pile up', { timeout: 30_000, retry: 2 }, async () => {
    // The recorder folds each event into running totals. If it kept and
    // re-summed a growing list instead, ten times the iterations would cost a
    // hundred times the work — which is what this ratio refuses.
    const record = (iterations: number): void => {
      const rec = cacheRecorder({
        strategy: new AnthropicCacheStrategy(),
        pricing: sonnetPricing,
      });
      for (let i = 0; i < iterations; i++) {
        rec.onDecision(decisionEvent('apply-markers'));
        rec.onEmit(
          llmEndEvent({ input: 100, cacheRead: 1000 }),
        );
      }
      rec.report();
    };
    await expectScalesLinearly({
      small: () => record(100),
      large: () => record(1000),
      scale: 10,
      why: 'cacheRecorder must fold events, not accumulate and re-sum them',
    });
  });
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('cacheRecorder — ROI: dollar math', () => {
  it('cache hit at 90% off saves ~90% of input cost', () => {
    const rec = cacheRecorder({
      strategy: new AnthropicCacheStrategy(),
      pricing: sonnetPricing,
      model: 'sonnet',
    });
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({ input: 0, cacheWrite: 0, cacheRead: 1_000_000 }), // 1M tokens cached
    );
    const r = rec.report();
    // No-cache would cost $3.00 (1M * $3/M).
    // Cache read: 1M * $0.30/M = $0.30.
    // Saved: $3.00 - $0.30 = $2.70.
    expect(isKnown(r.estimatedDollarsSpent) && r.estimatedDollarsSpent.value).toBeCloseTo(0.3, 2);
    expect(
      isKnown(r.estimatedDollarsSavedVsNoCache) && r.estimatedDollarsSavedVsNoCache.value,
    ).toBeCloseTo(2.7, 2);
  });

  it('cache write costs 25% MORE; recorded as positive spend', () => {
    const rec = cacheRecorder({
      strategy: new AnthropicCacheStrategy(),
      pricing: sonnetPricing,
      model: 'sonnet',
    });
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({ input: 0, cacheWrite: 1_000_000, cacheRead: 0 }), // 1M tokens written
    );
    const r = rec.report();
    // Write: 1M * $3.75/M = $3.75. No-cache equivalent: 1M * $3/M = $3.00.
    expect(isKnown(r.estimatedDollarsSpent) && r.estimatedDollarsSpent.value).toBeCloseTo(3.75, 2);
    expect(
      isKnown(r.estimatedDollarsSavedVsNoCache) && r.estimatedDollarsSavedVsNoCache.value,
    ).toBeCloseTo(-0.75, 2); // negative — write penalty
  });
});
