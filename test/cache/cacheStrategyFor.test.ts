/**
 * cacheStrategyFor — the cache strategy is chosen from what the provider
 * DECLARES (`LLMProvider.promptCaching`), never from its name.
 *
 * 7-pattern matrix (unit · boundary · scenario · property · security ·
 * performance · ROI). The law pinned: a decorator that renames its provider
 * (`withRetry` → `anthropic+retry`, `withFallback` → `a|b`, an app's own
 * routing wrapper) keeps the strategy of the adapter it wraps, because it
 * forwards the declaration — the name-keyed registry this replaces sent all
 * of them to the no-op strategy, and every such call paid full input price.
 */

import { describe, expect, it } from 'vitest';

import { cacheStrategyFor } from '../../src/cache/cacheStrategyFor';
import { AutomaticCacheStrategy } from '../../src/cache/strategies/AutomaticCacheStrategy';
import { BreakpointCacheStrategy } from '../../src/cache/strategies/BreakpointCacheStrategy';
import { NoOpCacheStrategy } from '../../src/cache/strategies/NoOpCacheStrategy';
import type { CacheMarker } from '../../src/cache/types';
import type { LLMProvider, PromptCaching } from '../../src/adapters/types';
import { anthropic } from '../../src/adapters/llm/AnthropicProvider';
import { browserAnthropic } from '../../src/adapters/llm/BrowserAnthropicProvider';
import { openai } from '../../src/adapters/llm/OpenAIProvider';
import { mock } from '../../src/adapters/llm/MockProvider';
import { withRetry } from '../../src/resilience/withRetry';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker';
import { withFallback } from '../../src/resilience/withFallback';
import { expectScalesLinearly } from '../helpers/perf.js';

const BREAKPOINTS: PromptCaching = { mode: 'breakpoints', maxBreakpoints: 4, reportsUsage: true };
const AUTOMATIC: PromptCaching = { mode: 'automatic', reportsUsage: false };

/** A provider that answers nothing — only its declaration matters here. */
function declared(name: string, promptCaching?: PromptCaching): LLMProvider {
  return {
    name,
    ...(promptCaching !== undefined && { promptCaching }),
    complete: async () => ({ content: '', toolCalls: [], usage: { input: 0, output: 0 } }),
  };
}

const fakeClient = { messages: { create: async () => ({}), stream: () => ({}) } } as never;

const CTX = {
  iteration: 1,
  iterationsRemaining: 4,
  recentHitRate: undefined,
  cachingDisabled: false,
};

function markers(n: number): CacheMarker[] {
  return Array.from({ length: n }, (_, i) => ({
    field: 'messages' as const,
    boundaryIndex: i,
    ttl: 'short' as const,
    reason: `m${i}`,
  }));
}

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('cacheStrategyFor — unit', () => {
  it('breakpoints → BreakpointCacheStrategy; automatic → Automatic; nothing → NoOp', () => {
    expect(cacheStrategyFor(declared('x', BREAKPOINTS))).toBeInstanceOf(BreakpointCacheStrategy);
    expect(cacheStrategyFor(declared('x', AUTOMATIC))).toBeInstanceOf(AutomaticCacheStrategy);
    expect(cacheStrategyFor(declared('x'))).toBeInstanceOf(NoOpCacheStrategy);
  });

  it('names the capability it serves — what the receipt records', () => {
    expect(cacheStrategyFor(declared('x', BREAKPOINTS)).name).toBe('breakpoints');
    expect(cacheStrategyFor(declared('x', AUTOMATIC)).name).toBe('automatic');
    expect(cacheStrategyFor(declared('x')).name).toBe('none');
  });

  it('the shipped adapters declare what their wire does', () => {
    expect(anthropic({ _client: fakeClient }).promptCaching).toEqual(BREAKPOINTS);
    expect(
      browserAnthropic({ apiKey: 'k', fetch: (async () => new Response()) as never }).promptCaching,
    ).toEqual(BREAKPOINTS);
    expect(openai({ _client: fakeClient }).promptCaching).toEqual(AUTOMATIC);
    // An OpenAI-COMPATIBLE server behind a custom baseURL caches as it likes —
    // the adapter does not promise it on that server's behalf.
    expect(
      openai({ _client: fakeClient, baseURL: 'http://localhost:11434/v1' }).promptCaching,
    ).toBe(undefined);
    expect(mock({ reply: 'x' }).promptCaching).toBe(undefined);
  });
});

// ─── 2. Boundary ──────────────────────────────────────────────────

describe('cacheStrategyFor — boundary', () => {
  it('a malformed declaration is REFUSED by provider name, never read as "no caching"', () => {
    const bad =
      (pc: unknown): (() => unknown) =>
      () =>
        cacheStrategyFor(declared('acme', pc as PromptCaching));
    expect(bad({ mode: 'breakpionts', maxBreakpoints: 4, reportsUsage: true })).toThrow(
      /the 'acme' provider declares promptCaching with mode "breakpionts"/,
    );
    expect(bad({ mode: 'breakpoints', maxBreakpoints: 0, reportsUsage: true })).toThrow(
      /maxBreakpoints 0/,
    );
    expect(bad({ mode: 'breakpoints', maxBreakpoints: 2.5, reportsUsage: true })).toThrow(
      /maxBreakpoints 2.5/,
    );
    expect(bad({ mode: 'automatic' })).toThrow(/reportsUsage undefined/);
  });

  it('clamps candidates to the DECLARED count, keeping slot order', async () => {
    const two = cacheStrategyFor(
      declared('x', { mode: 'breakpoints', maxBreakpoints: 2, reportsUsage: true }),
    );
    const out = await two.prepareRequest({ messages: [], model: 'm' }, markers(5), CTX);
    expect(out.markersApplied.map((m) => m.reason)).toEqual(['m0', 'm1']);
    expect(out.request.cacheMarkers).toEqual(out.markersApplied);
  });
});

// ─── 3. Scenario — the wrappers that used to lose it ──────────────

describe('cacheStrategyFor — scenario', () => {
  const inner = anthropic({ _client: fakeClient });

  it('withRetry renames to anthropic+retry and STILL selects breakpoints', () => {
    const wrapped = withRetry(inner);
    expect(wrapped.name).toBe('anthropic+retry');
    expect(cacheStrategyFor(wrapped).name).toBe('breakpoints');
  });

  it('withCircuitBreaker forwards it', () => {
    expect(cacheStrategyFor(withCircuitBreaker(inner)).name).toBe('breakpoints');
  });

  it('withFallback combines: breakpoints when either side takes them (min count)', () => {
    const pair = withFallback(inner, openai({ _client: fakeClient }));
    expect(pair.name).toBe('anthropic|openai');
    expect(pair.promptCaching).toEqual({
      mode: 'breakpoints',
      maxBreakpoints: 4,
      reportsUsage: true,
    });
    const small = declared('small', {
      mode: 'breakpoints',
      maxBreakpoints: 2,
      reportsUsage: false,
    });
    expect(withFallback(inner, small).promptCaching).toEqual({
      mode: 'breakpoints',
      maxBreakpoints: 2,
      reportsUsage: true,
    });
    expect(withFallback(declared('a'), declared('b')).promptCaching).toBe(undefined);
    expect(withFallback(declared('a'), declared('b', AUTOMATIC)).promptCaching).toEqual(AUTOMATIC);
  });

  it("an application's renaming wrapper that forwards the field keeps it; one that drops it says so", () => {
    const forwards: LLMProvider = {
      name: `seo-routing/${inner.name}`,
      ...(inner.promptCaching !== undefined && { promptCaching: inner.promptCaching }),
      complete: (req, hooks) => inner.complete(req, hooks),
    };
    expect(cacheStrategyFor(forwards).name).toBe('breakpoints');
    const drops: LLMProvider = { name: 'seo-routing/anthropic', complete: forwards.complete };
    // Undeclared is the no-op — and the receipt records 'none', so the run says why.
    expect(cacheStrategyFor(drops).name).toBe('none');
  });
});

// ─── 4. Property ──────────────────────────────────────────────────

describe('cacheStrategyFor — property', () => {
  const NAMES = [
    '',
    'anthropic',
    'ANTHROPIC',
    'anthropic+retry',
    'a|b',
    'seo-routing/anthropic',
    '*',
  ];
  const DECLS: (PromptCaching | undefined)[] = [BREAKPOINTS, AUTOMATIC, undefined];

  it('the NAME never decides: any name, same declaration → same strategy kind', () => {
    for (const name of NAMES) {
      for (const pc of DECLS) {
        expect(cacheStrategyFor(declared(name, pc)).name).toBe(
          cacheStrategyFor(declared('anthropic', pc)).name,
        );
      }
    }
  });

  it('a breakpoint strategy never applies more than the declared count', async () => {
    for (let max = 1; max <= 6; max++) {
      const s = cacheStrategyFor(
        declared('x', { mode: 'breakpoints', maxBreakpoints: max, reportsUsage: true }),
      );
      for (let n = 0; n <= 8; n++) {
        const out = await s.prepareRequest({ messages: [], model: 'm' }, markers(n), CTX);
        expect(out.markersApplied.length).toBe(Math.min(max, n));
      }
    }
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('cacheStrategyFor — security', () => {
  it('the kill switch wins: no markers reach a request whose run said caching is off', async () => {
    const s = cacheStrategyFor(declared('x', BREAKPOINTS));
    const req = { messages: [], model: 'm' };
    const out = await s.prepareRequest(req, markers(3), { ...CTX, cachingDisabled: true });
    expect(out.request).toBe(req);
    expect(out.markersApplied).toEqual([]);
  });

  it('automatic and none return the request untouched — no field added', async () => {
    for (const pc of [AUTOMATIC, undefined]) {
      const req = { messages: [], model: 'm' };
      const out = await cacheStrategyFor(declared('x', pc)).prepareRequest(req, markers(2), CTX);
      expect(out.request).toBe(req);
      expect(out.markersApplied).toEqual([]);
    }
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('cacheStrategyFor — performance', () => {
  it('selection cost stays flat as selections pile up', { timeout: 30_000, retry: 2 }, async () => {
    const p = declared('x', BREAKPOINTS);
    const pick = (times: number): void => {
      for (let i = 0; i < times; i++) cacheStrategyFor(p);
    };
    await expectScalesLinearly({
      small: () => pick(1_000),
      large: () => pick(10_000),
      scale: 10,
      why: 'selection reads one declaration; it never scans a table',
    });
  });
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('cacheStrategyFor — ROI', () => {
  it('the meter tells the three answers apart, never a false zero', () => {
    const usage = { input: 100, output: 5, cacheRead: 900, cacheWrite: 0 };
    const reporting = cacheStrategyFor(declared('anthropic', BREAKPOINTS)).extractMetrics(usage);
    expect(reporting.kind).toBe('known');
    const silent = cacheStrategyFor(declared('openai', AUTOMATIC)).extractMetrics(usage);
    expect(silent.kind).toBe('not-applicable');
    expect(silent.kind === 'not-applicable' && silent.evidence).toMatch(/reportsUsage: false/);
    const none = cacheStrategyFor(declared('ollama')).extractMetrics(usage);
    expect(none.kind).toBe('not-applicable');
    expect(none.kind === 'not-applicable' && none.evidence).toMatch(/declares no prompt caching/);
    // A reporting adapter that reported nothing this call is UNMEASURED, not zero.
    const empty = cacheStrategyFor(declared('anthropic', BREAKPOINTS)).extractMetrics({
      input: 100,
      output: 5,
    });
    expect(empty.kind).toBe('unknown');
  });
});
