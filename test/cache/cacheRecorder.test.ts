/**
 * cacheRecorder() — 7-pattern test matrix.
 *
 * Phase 9 of v2.6 cache layer.
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

// Sonnet 4.5 simplified pricing — $3/M input, $0.30/M cache read, $3.75/M cache write
const sonnetPricing: PricingTable = {
  name: 'sonnet-4-5',
  pricePerToken(_model: string, kind: TokenKind): number {
    switch (kind) {
      case 'input': return 3 / 1_000_000;
      case 'output': return 15 / 1_000_000;
      case 'cacheRead': return 0.3 / 1_000_000; // 10% of input
      case 'cacheWrite': return 3.75 / 1_000_000; // 125% of input
    }
  },
};

function decisionEvent(
  branch: 'apply-markers' | 'no-markers',
  rule?: string,
): FlowDecisionEvent {
  return {
    decider: 'cache-gate',
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

function llmEndEvent(usage: unknown): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.llm_end',
    payload: { usage },
  } as unknown as AgentfootprintEvent;
}

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('cacheRecorder — unit', () => {
  it('initial report has zero iterations', () => {
    const rec = cacheRecorder();
    const r = rec.report();
    expect(r.totalIterations).toBe(0);
    expect(r.cacheReadTokensTotal).toBe(0);
    expect(r.hitRate).toBe(0);
  });

  it('reset clears accumulated state', () => {
    const rec = cacheRecorder();
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
    rec.reset();
    expect(rec.report().totalIterations).toBe(0);
  });

  it("decision recorded only when event.decider === 'cache-gate'", () => {
    const rec = cacheRecorder();
    // Different decider — should be ignored
    rec.onDecision({
      decider: 'route',
      chosen: 'final',
    } as unknown as FlowDecisionEvent);
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
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

  it('no strategy → metrics undefined; report still works', () => {
    const rec = cacheRecorder();
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
    const r = rec.report();
    expect(r.totalIterations).toBe(1);
    expect(r.perIter[0].metrics).toBeUndefined();
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
      llmEndEvent({
        input_tokens: 240,
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 0,
      }),
    );

    // Iter 2: cache hit
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({
        input_tokens: 80,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 3000,
      }),
    );

    // Iter 3: cache hit
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({
        input_tokens: 80,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 3000,
      }),
    );

    const r = rec.report();
    expect(r.totalIterations).toBe(3);
    expect(r.cacheReadTokensTotal).toBe(6000);
    expect(r.cacheWriteTokensTotal).toBe(3000);
    // Hit rate: cacheRead / total = 6000 / (6000 + 3000 + 400) ≈ 0.638
    expect(r.hitRate).toBeGreaterThan(0.6);
    expect(r.hitRate).toBeLessThan(0.7);
  });

  it("'no-markers' branch records the rule that fired", () => {
    const rec = cacheRecorder();
    rec.onDecision(decisionEvent('no-markers', 'kill switch active'));
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
    expect(rec.report().perIter[0].rule).toContain('kill switch');
  });

  it('mixed apply / skip iterations counted separately', () => {
    const rec = cacheRecorder();
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
    rec.onDecision(decisionEvent('no-markers', 'churn'));
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
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
          input_tokens: 100 * (i + 1),
          cache_creation_input_tokens: i === 0 ? 5000 : 0,
          cache_read_input_tokens: i > 0 ? 5000 : 0,
        }),
      );
    }
    const r = rec.report();
    expect(r.hitRate).toBeGreaterThanOrEqual(0);
    expect(r.hitRate).toBeLessThanOrEqual(1);
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
      llmEndEvent({
        input_tokens: 240,
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 0,
      }),
    );
    for (let i = 0; i < 5; i++) {
      rec.onDecision(decisionEvent('apply-markers'));
      rec.onEmit(
        llmEndEvent({
          input_tokens: 80,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 3000,
        }),
      );
    }
    const r = rec.report();
    expect(r.estimatedDollarsSavedVsNoCache).toBeGreaterThan(0);
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('cacheRecorder — security: defensive parsing', () => {
  it('llm_end with null usage → no crash, metrics undefined', () => {
    const rec = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    rec.onEmit(llmEndEvent(null));
    const r = rec.report();
    expect(r.perIter[0].metrics).toBeUndefined();
  });

  it('decision with no evidence → branch captured but rule undefined', () => {
    const rec = cacheRecorder();
    rec.onDecision({
      decider: 'cache-gate',
      chosen: 'apply-markers',
      // no evidence field
    } as unknown as FlowDecisionEvent);
    rec.onEmit(llmEndEvent({ input_tokens: 100 }));
    expect(rec.report().perIter[0].rule).toBeUndefined();
    expect(rec.report().perIter[0].branch).toBe('apply-markers');
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('cacheRecorder — performance', () => {
  it('100 iterations in <50ms', () => {
    const rec = cacheRecorder({
      strategy: new AnthropicCacheStrategy(),
      pricing: sonnetPricing,
    });
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      rec.onDecision(decisionEvent('apply-markers'));
      rec.onEmit(
        llmEndEvent({
          input_tokens: 100,
          cache_read_input_tokens: 1000,
        }),
      );
    }
    rec.report();
    expect(Date.now() - start).toBeLessThan(50);
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
      llmEndEvent({
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1_000_000, // 1M tokens cached
      }),
    );
    const r = rec.report();
    // No-cache would cost $3.00 (1M * $3/M).
    // Cache read: 1M * $0.30/M = $0.30.
    // Saved: $3.00 - $0.30 = $2.70.
    expect(r.estimatedDollarsSpent).toBeCloseTo(0.3, 2);
    expect(r.estimatedDollarsSavedVsNoCache).toBeCloseTo(2.7, 2);
  });

  it('cache write costs 25% MORE; recorded as positive spend', () => {
    const rec = cacheRecorder({
      strategy: new AnthropicCacheStrategy(),
      pricing: sonnetPricing,
      model: 'sonnet',
    });
    rec.onDecision(decisionEvent('apply-markers'));
    rec.onEmit(
      llmEndEvent({
        input_tokens: 0,
        cache_creation_input_tokens: 1_000_000, // 1M tokens written
        cache_read_input_tokens: 0,
      }),
    );
    const r = rec.report();
    // Write: 1M * $3.75/M = $3.75. No-cache equivalent: 1M * $3/M = $3.00.
    expect(r.estimatedDollarsSpent).toBeCloseTo(3.75, 2);
    expect(r.estimatedDollarsSavedVsNoCache).toBeCloseTo(-0.75, 2); // negative — write penalty
  });
});
