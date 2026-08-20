/**
 * A TYPED CLAIM MUST NOT BE ESCAPABLE BY ARITHMETIC (R5).
 *
 * The dead cache meter was one INSTANCE of a general rule, and fixing only the
 * instance would leave the rule unenforced. Four answers are genuinely
 * different and a meter must never blur them:
 *
 *   Known(0)                        — measured, and it was zero.
 *   Unknown(provider-did-not-report)— the call reported no cache fields.
 *   Unknown(adapter-unsupported)    — nothing here can be measured at all.
 *   Unknown(parse-failed)           — no usage payload arrived.
 *
 * A derived metric over an unknown input is UNKNOWN — not zero, and not
 * "partial". This file tests that at the BOUNDARY (the `CacheStrategy`
 * contract and the report API), not inside the one recorder that happened to
 * be caught, so a strategy added later cannot quietly reintroduce the bug.
 *
 * Test types: unit (the contract) / property (propagation) / regression (the
 * exact shipped defect: a 20-call turn hitting cache on every call).
 */

import { describe, expect, it } from 'vitest';
import { cacheRecorder } from '../../src/cache/cacheRecorder.js';
import { AnthropicCacheStrategy } from '../../src/cache/strategies/AnthropicCacheStrategy.js';
import { OpenAICacheStrategy } from '../../src/cache/strategies/OpenAICacheStrategy.js';
import { BedrockCacheStrategy } from '../../src/cache/strategies/BedrockCacheStrategy.js';
import { NoOpCacheStrategy } from '../../src/cache/strategies/NoOpCacheStrategy.js';
import {
  isKnown,
  valueOr,
  describeClaim,
  unknown,
  notApplicable,
  type Claim,
} from '../../src/lib/claim/claim.js';
import type { CacheStrategy } from '../../src/cache/types.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

const ALL_STRATEGIES: ReadonlyArray<readonly [string, CacheStrategy]> = [
  ['anthropic', new AnthropicCacheStrategy()],
  ['openai', new OpenAICacheStrategy()],
  ['bedrock', new BedrockCacheStrategy()],
  ['noop', new NoOpCacheStrategy()],
];

const llmEnd = (usage: unknown): AgentfootprintEvent =>
  ({ type: 'agentfootprint.stream.llm_end', payload: { usage } } as unknown as AgentfootprintEvent);

describe('R5 unit: every strategy answers with a Claim, whatever it is handed', () => {
  it.each(ALL_STRATEGIES)('%s never returns a bare value or undefined', (_name, strategy) => {
    const inputs = [
      undefined,
      { input: 0, output: 0 },
      { input: 100, output: 20 },
      { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 },
      { input: 100, output: 20, cacheRead: 3000 },
    ];
    for (const usage of inputs) {
      const c = strategy.extractMetrics(usage);
      expect(c, `${_name} returned undefined — the contract is a Claim`).toBeDefined();
      expect(['known', 'unknown', 'not-applicable']).toContain(c.kind);
      // Every non-known answer carries its own sentence. An unexplained
      // unknown is a shrug, and a shrug is what gets rounded to zero.
      if (c.kind === 'unknown') expect(c.reason.length).toBeGreaterThan(0);
      if (c.kind === 'not-applicable') expect(c.evidence.length).toBeGreaterThan(0);
    }
  });

  it('the only door to a value is isKnown, and the fallback is never implicit', () => {
    const c: Claim<number> = new AnthropicCacheStrategy().extractMetrics(undefined) as never;
    expect(isKnown(c)).toBe(false);
    // `valueOr` takes a REQUIRED fallback. A default of `undefined` would put
    // the shrug straight back into the type that exists to remove it — so a
    // caller has to say, in the code, what it wants an unknown to become.
    expect(valueOr(c, -1)).toBe(-1);
    expect(describeClaim(c)).toMatch(/^unknown — /);
  });
});

describe('R5 property: unknown PROPAGATES through every derived metric', () => {
  it('one unmeasured call cannot be averaged away into a confident number', () => {
    const rec = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    // Three measured calls, then one that reported nothing.
    for (let i = 0; i < 3; i++) rec.onEmit(llmEnd({ input: 100, output: 10, cacheRead: 900 }));
    rec.onEmit(llmEnd({ input: 100, output: 10 })); // no cache fields → unmeasured

    const r = rec.report();
    expect(r.totalIterations).toBe(4);
    expect(r.measuredIterations).toBe(3);
    expect(r.unmeasuredIterations).toBe(1);

    // The rate is still stated — but it STATES ITS OWN DENOMINATOR, because a
    // rate over 3 of 4 calls is not the turn's rate. No percentage without it.
    expect(isKnown(r.hitRate)).toBe(true);
    expect(isKnown(r.hitRate) && r.hitRate.evidence).toContain('3 of 4');

    // And the unmeasured ROW carries unknown all the way through its own
    // derived dollars — it is never folded in as a zero.
    const last = r.perIter[3]!;
    expect(isKnown(last.metrics)).toBe(false);
    expect(isKnown(last.dollarsSpent)).toBe(false);
    expect(isKnown(last.dollarsSavedVsNoCache)).toBe(false);
  });

  it('an adapter that CANNOT report makes the whole turn not-applicable, by name', () => {
    const rec = cacheRecorder({ strategy: new BedrockCacheStrategy() });
    for (let i = 0; i < 5; i++) rec.onEmit(llmEnd({ input: 100, output: 10 }));
    const r = rec.report();
    expect(r.measuredIterations).toBe(0);
    expect(isKnown(r.hitRate)).toBe(false);
    // The reason names the provider gap rather than shrugging — the difference
    // between "your cache is broken" and "we cannot see your cache".
    expect(r.hitRate.kind === 'unknown' && r.hitRate.reason).toMatch(/cannot report it/);
  });
});

describe('R5 regression: the exact shipped defect', () => {
  it('a 20-call turn hitting cache on EVERY call no longer reports 0%', () => {
    // This is the measured incident. Before 9.59.0 the strategy parsed raw
    // wire names off a port-shaped value, every field read undefined, and the
    // report said hitRate 0 — dishonestly, since the strategy's own comment
    // claimed it returned nothing precisely to avoid a misleading 0%.
    const rec = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    rec.onEmit(llmEnd({ input: 200, output: 30, cacheRead: 0, cacheWrite: 8000 }));
    for (let i = 0; i < 19; i++) {
      rec.onEmit(llmEnd({ input: 50, output: 30, cacheRead: 8000, cacheWrite: 0 }));
    }
    const r = rec.report();
    expect(r.totalIterations).toBe(20);
    expect(r.measuredIterations).toBe(20);
    expect(isKnown(r.hitRate)).toBe(true);
    expect(isKnown(r.hitRate) && r.hitRate.value).toBeGreaterThan(0.9);
  });

  it('a SILENT NON-CACHE reads as measured zeros, distinct from an unmeasured turn', () => {
    // Below the model's minimum cacheable prefix the request is processed
    // WITHOUT caching and NO error is returned. The adapter still reports the
    // fields, so the turn is measured and the hit rate is a real 0 — which is
    // the only way this is observable at all, rather than looking exactly like
    // an unsupported adapter.
    const silent = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    for (let i = 0; i < 4; i++) {
      silent.onEmit(llmEnd({ input: 300, output: 10, cacheRead: 0, cacheWrite: 0 }));
    }
    const s = silent.report();
    expect(s.measuredIterations).toBe(4);
    expect(isKnown(s.hitRate)).toBe(true);
    expect(isKnown(s.hitRate) && s.hitRate.value).toBe(0);

    const blind = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    for (let i = 0; i < 4; i++) blind.onEmit(llmEnd({ input: 300, output: 10 }));
    const b = blind.report();
    expect(b.measuredIterations).toBe(0);
    expect(isKnown(b.hitRate)).toBe(false);

    // The two turns are the SAME on the wire in every respect a naive meter
    // looks at, and the report tells them apart. That is the whole feature.
    expect(describeClaim(s.hitRate)).not.toBe(describeClaim(b.hitRate));
  });
});

// ─── 9.59.1 ──────────────────────────────────────────────────────────
//
// The law broken INSIDE the release that enforced it: `report()` built the
// turn-level unknown by hardcoding a cause ("the provider reported no cache
// fields") instead of carrying the reason the rows had already stated. An
// unknown that invents its own reason is worse than a shrug — it points the
// reader at the wrong suspect.
//
// Test types: regression (the reported bug) / unit (the honest case still
// reads honestly) / boundary (rows that disagree, and the list's bound).

/** A strategy that answers with a scripted claim per call — for mixed turns. */
function scriptedStrategy(claims: ReadonlyArray<Claim<never>>): CacheStrategy {
  let i = 0;
  return {
    providerName: 'scripted',
    capabilities: {
      enabled: false,
      maxMarkers: 0,
      ttls: [] as readonly ('short' | 'long')[],
      fields: [] as readonly ('system' | 'tools' | 'messages')[],
      automatic: false,
    },
    prepareRequest: async (req) => ({ request: req, markersApplied: [] }),
    extractMetrics: () =>
      (claims[Math.min(i++, claims.length - 1)] ?? unknown('scripted')) as never,
  };
}

describe('9.59.1: the SUMMARY carries the rows own reason, never a fabricated one', () => {
  it('regression: no strategy + a provider that DID report cache fields', () => {
    // The exact reproduction. The row is honest ("nothing read the usage");
    // 9.59.0's summary said "the provider reported no cache fields" — a claim
    // the very same payload disproves, and one that sends the reader to
    // debug their provider instead of passing the strategy they forgot.
    const rec = cacheRecorder(); // ← no strategy, the caller's likely mistake
    rec.onEmit(llmEnd({ input: 100, output: 10, cacheRead: 900, cacheWrite: 50 }));

    const r = rec.report();
    expect(r.measuredIterations).toBe(0);
    expect(isKnown(r.hitRate)).toBe(false);
    const reason = r.hitRate.kind === 'unknown' ? r.hitRate.reason : '';

    // It names the real cause — the caller's own omission.
    expect(reason).toMatch(/no CacheStrategy/);
    // And it does NOT accuse the provider, which demonstrably DID report.
    expect(reason).not.toMatch(/the provider reported no cache fields/);
    // Every claim in the report tells the same story, not just hitRate.
    for (const claim of [
      r.cacheReadTokensTotal,
      r.cacheWriteTokensTotal,
      r.freshInputTokensTotal,
      r.estimatedDollarsSpent,
      r.estimatedDollarsSavedVsNoCache,
    ]) {
      expect(claim.kind === 'unknown' && claim.reason).toMatch(/no CacheStrategy/);
    }
    // The count still adds information, so it is kept.
    expect(reason).toContain('1 observed call(s)');
  });

  it('unit: a strategy IS configured and the provider genuinely reported nothing', () => {
    // Here the provider really is the reason, and the summary says so — in
    // the ADAPTER's own words, not a generic sentence that happens to fit.
    const rec = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    for (let i = 0; i < 3; i++) rec.onEmit(llmEnd({ input: 100, output: 10 }));

    const r = rec.report();
    const reason = r.hitRate.kind === 'unknown' ? r.hitRate.reason : '';
    expect(reason).toContain('the Anthropic adapter reported no cache fields on this call');
    expect(reason).toContain('3 observed call(s)');
    // One shared reason ⇒ stated once, with no "they disagreed" noise.
    expect(reason).not.toMatch(/did not agree/);
    // It is the row's own sentence, verbatim — carried, not paraphrased.
    const row = r.perIter[0]!.metrics;
    expect(row.kind === 'unknown' && reason).toContain(row.kind === 'unknown' ? row.reason : '!');
  });

  it('boundary: rows that DISAGREE are reported as a disagreement, not one pick', () => {
    // A turn can genuinely mix causes. Silently promoting the first row's
    // reason to the whole turn would state a cause for calls that stated a
    // different one — the same fault in a subtler dress.
    const rec = cacheRecorder({ strategy: new AnthropicCacheStrategy() });
    rec.onEmit(llmEnd({ input: 100, output: 10 })); // usage, but no cache fields
    rec.onEmit(llmEnd(undefined)); // no usage payload at all

    const r = rec.report();
    const reason = r.hitRate.kind === 'unknown' ? r.hitRate.reason : '';
    expect(reason).toMatch(/did not agree/);
    expect(reason).toContain('2 different reasons');
    expect(reason).toContain('reported no cache fields on this call');
    expect(reason).toContain('carried no usage payload');
  });

  it('boundary: a not-applicable row is still named when it is NOT the first row', () => {
    // 9.59.0 sampled `perIter[0]` alone, so an adapter that cannot report was
    // only ever named if it happened to be the first call of the turn.
    const rec = cacheRecorder({
      strategy: scriptedStrategy([
        unknown('the llm_end event carried no usage payload'),
        notApplicable('this adapter never reads cache usage'),
      ]),
    });
    rec.onEmit(llmEnd({ input: 100, output: 10 }));
    rec.onEmit(llmEnd({ input: 100, output: 10 }));

    const reason = (() => {
      const h = rec.report().hitRate;
      return h.kind === 'unknown' ? h.reason : '';
    })();
    expect(reason).toContain('cannot report it');
    expect(reason).toContain('this adapter never reads cache usage');
  });

  it('boundary: the list is bounded — extra distinct reasons are COUNTED, not dropped', () => {
    // A strategy whose reason varies per call must not be able to grow the
    // summary into a wall of text; the honest move is to cap the list and
    // state how many were left out.
    const rec = cacheRecorder({
      strategy: scriptedStrategy([
        unknown('reason one'),
        unknown('reason two'),
        unknown('reason three'),
        unknown('reason four'),
        unknown('reason five'),
      ]),
    });
    for (let i = 0; i < 5; i++) rec.onEmit(llmEnd({ input: 1, output: 1 }));

    const h = rec.report().hitRate;
    const reason = h.kind === 'unknown' ? h.reason : '';
    expect(reason).toContain('5 different reasons');
    expect(reason).toContain('reason three');
    expect(reason).not.toContain('reason four');
    expect(reason).toContain('2 more not listed here');
  });
});
