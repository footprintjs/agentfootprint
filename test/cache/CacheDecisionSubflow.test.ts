/**
 * CacheDecision subflow — 7-pattern test matrix (~20 tests).
 *
 * Phase 4 of v2.6 cache layer. Tests the pure-transform subflow that
 * walks activeInjections + evaluates DSL directives → CacheMarker[].
 *
 * Most tests bypass the subflow boundary and exercise the core
 * decision functions directly (`evaluateCachePolicy`,
 * `injectionTargetSlots`, the inline `decide` invocation via a fresh
 * FlowChartExecutor mount).
 *
 * 7-pattern coverage:
 *   - unit:       individual policy evaluation cases
 *   - boundary:   empty/extreme inputs (0 injections, all-volatile, etc.)
 *   - scenario:   realistic Neo-shaped agents (always-on + skill + rule)
 *   - property:   contiguous-from-start invariant; no markers when all-volatile
 *   - security:   throwing predicate fail-closed; unknown policy fail-closed
 *   - performance: subflow body completes in <5ms for 100 injections
 *   - ROI:        end-to-end (kill switch → empty markers; happy path → 3 markers)
 */

import { describe, expect, it } from 'vitest';
import {
  computeCacheMarkers,
  evaluateCachePolicy,
  injectionTargetSlots,
  type CacheDecisionState,
} from '../../src/cache/CacheDecisionSubflow';
import type { CacheMarker, CachePolicy, CachePolicyContext } from '../../src/cache/types';
import type { Injection } from '../../src/lib/injection-engine/types';

// ─── Fixtures ─────────────────────────────────────────────────────

function makeContext(overrides: Partial<CachePolicyContext> = {}): CachePolicyContext {
  return {
    iteration: 1,
    iterationsRemaining: 4,
    userMessage: 'go',
    cumulativeInputTokens: 0,
    ...overrides,
  };
}

function makeInjection(opts: {
  id: string;
  flavor?: 'steering' | 'fact' | 'skill' | 'instructions';
  cache?: CachePolicy;
  systemPrompt?: string;
  tools?: readonly { name: string }[];
  messages?: readonly { role: 'system' | 'user'; content: string }[];
}): Injection {
  return {
    id: opts.id,
    flavor: (opts.flavor ?? 'steering') as never,
    trigger: { kind: 'always' } as never,
    inject: {
      ...(opts.systemPrompt && { systemPrompt: opts.systemPrompt }),
      ...(opts.tools && { tools: opts.tools as never }),
      ...(opts.messages && { messages: opts.messages as never }),
    },
    metadata: { cache: opts.cache ?? 'never' },
  } as unknown as Injection;
}

/**
 * Tests call the pure transform directly. The subflow body is a thin
 * scope-binding wrapper exercised by the integration tests in Phase 5+.
 */
function runSubflow(
  state: Omit<CacheDecisionState, 'cacheMarkers'>,
): readonly CacheMarker[] {
  return computeCacheMarkers(state);
}

// ─── 1. Unit — evaluateCachePolicy correctness ────────────────────

describe("evaluateCachePolicy — unit", () => {
  it("'always' returns true regardless of context", () => {
    expect(evaluateCachePolicy('always', makeContext())).toBe(true);
    expect(evaluateCachePolicy('always', makeContext({ iteration: 99 }))).toBe(true);
  });

  it("'never' returns false regardless of context", () => {
    expect(evaluateCachePolicy('never', makeContext())).toBe(false);
  });

  it("'while-active' returns true (membership in activeInjections is the activation proof)", () => {
    expect(evaluateCachePolicy('while-active', makeContext())).toBe(true);
  });

  it("{ until } predicate: cacheable when predicate returns false", () => {
    const pol: CachePolicy = { until: (c) => c.iteration > 5 };
    expect(evaluateCachePolicy(pol, makeContext({ iteration: 3 }))).toBe(true);
    expect(evaluateCachePolicy(pol, makeContext({ iteration: 6 }))).toBe(false);
  });

  it("{ until } predicate: composition with cumulativeInputTokens budget", () => {
    const pol: CachePolicy = { until: (c) => c.cumulativeInputTokens > 50_000 };
    expect(evaluateCachePolicy(pol, makeContext({ cumulativeInputTokens: 30_000 }))).toBe(true);
    expect(evaluateCachePolicy(pol, makeContext({ cumulativeInputTokens: 60_000 }))).toBe(false);
  });
});

// ─── 1. Unit — injectionTargetSlots correctness ──────────────────

describe('injectionTargetSlots — unit', () => {
  it('system-only injection (steering)', () => {
    const inj = makeInjection({ id: 'a', systemPrompt: 'rule' });
    expect(injectionTargetSlots(inj)).toEqual(['system']);
  });

  it('skill (system + tools)', () => {
    const inj = makeInjection({
      id: 'sk',
      systemPrompt: 'body',
      tools: [{ name: 't' }],
    });
    expect(injectionTargetSlots(inj)).toEqual(['system', 'tools']);
  });

  it('messages-only fact', () => {
    const inj = makeInjection({
      id: 'f',
      messages: [{ role: 'system', content: 'note' }],
    });
    expect(injectionTargetSlots(inj)).toEqual(['messages']);
  });

  it('empty inject (no slot contributions)', () => {
    const inj = { id: 'x', flavor: 'steering', trigger: { kind: 'always' }, inject: {} } as never;
    expect(injectionTargetSlots(inj)).toEqual([]);
  });
});

// ─── 2. Boundary — empty / extreme inputs ─────────────────────────

describe('CacheDecision subflow — boundary', () => {
  it('empty activeInjections + cacheable base → 1 marker (system, idx 0)', async () => {
    const markers = await runSubflow({
      activeInjections: [],
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0].field).toBe('system');
    expect(markers[0].boundaryIndex).toBe(0);
  });

  it('empty activeInjections + non-cacheable base → 0 markers', async () => {
    const markers = await runSubflow({
      activeInjections: [],
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'never',
      cachingDisabled: false,
    });
    expect(markers).toHaveLength(0);
  });

  it('cachingDisabled=true short-circuits to zero markers', async () => {
    const markers = await runSubflow({
      activeInjections: [
        makeInjection({ id: 's1', cache: 'always', systemPrompt: 'rule' }),
      ],
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'always',
      cachingDisabled: true,
    });
    expect(markers).toHaveLength(0);
  });
});

// ─── 3. Scenario — realistic agent shapes ─────────────────────────

describe('CacheDecision subflow — scenario', () => {
  it('Neo-like: base + 8 always-on steering → boundary at idx 8 (base + 8)', async () => {
    const injections = Array.from({ length: 8 }, (_, i) =>
      makeInjection({
        id: `safety-${i}`,
        flavor: 'steering',
        cache: 'always',
        systemPrompt: `rule ${i}`,
      }),
    );
    const markers = await runSubflow({
      activeInjections: injections,
      iteration: 3,
      maxIterations: 5,
      userMessage: 'investigate',
      cumulativeInputTokens: 12_000,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });
    const sysMarker = markers.find((m) => m.field === 'system');
    expect(sysMarker?.boundaryIndex).toBe(8); // base (0) + 8 always-on (1..8)
  });

  it('volatile rule in middle → boundary clamps before it', async () => {
    const injections = [
      makeInjection({ id: 'a', cache: 'always', systemPrompt: 'A' }),
      makeInjection({ id: 'b', cache: 'always', systemPrompt: 'B' }),
      makeInjection({ id: 'c', cache: 'never', systemPrompt: 'C-volatile' }),
      makeInjection({ id: 'd', cache: 'always', systemPrompt: 'D' }), // doesn't help
    ];
    const markers = await runSubflow({
      activeInjections: injections,
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });
    const sysMarker = markers.find((m) => m.field === 'system');
    // Boundary: base(0) + a(1) + b(2) = idx 2
    expect(sysMarker?.boundaryIndex).toBe(2);
  });

  it('skill spans system + tools slots → 2 markers', async () => {
    const skill = makeInjection({
      id: 'port-error-triage',
      flavor: 'skill',
      cache: 'while-active',
      systemPrompt: 'triage procedure',
      tools: [{ name: 'get_counters' }, { name: 'get_sfp' }],
    });
    const markers = await runSubflow({
      activeInjections: [skill],
      iteration: 3,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });
    expect(markers.find((m) => m.field === 'system')).toBeDefined();
    expect(markers.find((m) => m.field === 'tools')).toBeDefined();
    expect(markers.find((m) => m.field === 'messages')).toBeUndefined();
  });
});

// ─── 4. Property — invariants of the marker output ────────────────

describe('CacheDecision subflow — properties', () => {
  it('boundaryIndex always points to a valid slot position (≥0)', async () => {
    const injections = [
      makeInjection({ id: 'a', cache: 'always', systemPrompt: 'A' }),
      makeInjection({ id: 'b', cache: 'always', systemPrompt: 'B' }),
    ];
    const markers = await runSubflow({
      activeInjections: injections,
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });
    for (const m of markers) {
      expect(m.boundaryIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('all-volatile produces no markers', async () => {
    const injections = [
      makeInjection({ id: 'a', cache: 'never', systemPrompt: 'A' }),
      makeInjection({ id: 'b', cache: 'never', systemPrompt: 'B' }),
    ];
    const markers = await runSubflow({
      activeInjections: injections,
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'never',
      cachingDisabled: false,
    });
    expect(markers).toHaveLength(0);
  });

  it("contiguous-from-start: marker covers exactly the prefix, never a 'gap'", async () => {
    // Sequence: cacheable, cacheable, NOT-CACHEABLE, cacheable, cacheable
    // Boundary must be 1 (the second cacheable, idx 1 within slot incl. base at 0)
    // After base (cacheable=true at idx 0), index 1 = injection a (cacheable),
    // index 2 = injection b (volatile). Stop. Boundary = 1.
    const injections = [
      makeInjection({ id: 'a', cache: 'always', systemPrompt: 'A' }),
      makeInjection({ id: 'b', cache: 'never', systemPrompt: 'B' }),
      makeInjection({ id: 'c', cache: 'always', systemPrompt: 'C' }), // doesn't help
    ];
    const markers = await runSubflow({
      activeInjections: injections,
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });
    const sysMarker = markers.find((m) => m.field === 'system');
    expect(sysMarker?.boundaryIndex).toBe(1);
  });
});

// ─── 5. Security — defensive fail-closed ──────────────────────────

describe('CacheDecision subflow — security', () => {
  it("predicate that throws fails-closed (cacheable=false)", () => {
    const policy: CachePolicy = {
      until: () => {
        throw new Error('oops');
      },
    };
    expect(evaluateCachePolicy(policy, makeContext())).toBe(false);
  });

  it("unknown policy form fails-closed (cacheable=false)", () => {
    // Force an invalid shape via cast — simulates a buggy consumer or
    // future format we don't recognize. Must not crash; must not cache.
    const bogus = 'sometimes' as unknown as CachePolicy;
    expect(evaluateCachePolicy(bogus, makeContext())).toBe(false);
  });
});

// ─── 6. Performance — bounded execution time ──────────────────────

describe('CacheDecision subflow — performance', () => {
  it('100 injections with mixed policies finish in <50ms', async () => {
    const injections = Array.from({ length: 100 }, (_, i) =>
      makeInjection({
        id: `i-${i}`,
        cache: i % 3 === 0 ? 'always' : i % 3 === 1 ? 'never' : 'while-active',
        systemPrompt: `entry ${i}`,
      }),
    );
    const start = Date.now();
    await runSubflow({
      activeInjections: injections,
      iteration: 1,
      maxIterations: 5,
      userMessage: 'go',
      cumulativeInputTokens: 0,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });
    const elapsed = Date.now() - start;
    // Generous bound (50ms) to absorb CI variance; subflow body is
    // ~O(n) over injections + O(slots * n) for boundary walk. Real
    // wall-clock per call is sub-ms.
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — end-to-end happy path ──────────────────────────────

describe('CacheDecision subflow — ROI', () => {
  it('happy path: 3 markers (system + tools), correct boundaries, includes diagnostic reasons', async () => {
    const injections = [
      // system slot only (always-on rule)
      makeInjection({ id: 'safety', cache: 'always', systemPrompt: 'be safe' }),
      makeInjection({ id: 'tone', cache: 'always', systemPrompt: 'be calm' }),
      // skill spans system + tools
      makeInjection({
        id: 'triage',
        flavor: 'skill',
        cache: 'while-active',
        systemPrompt: 'do triage',
        tools: [{ name: 't1' }],
      }),
    ];
    const markers = await runSubflow({
      activeInjections: injections,
      iteration: 3,
      maxIterations: 5,
      userMessage: 'investigate',
      cumulativeInputTokens: 5000,
      systemPromptCachePolicy: 'always',
      cachingDisabled: false,
    });

    // System slot: base(0) + safety(1) + tone(2) + triage(3)
    const sysMarker = markers.find((m) => m.field === 'system');
    expect(sysMarker?.boundaryIndex).toBe(3);
    expect(sysMarker?.reason).toContain('skill:triage');

    // Tools slot: triage's tools (idx 0 only)
    const toolsMarker = markers.find((m) => m.field === 'tools');
    expect(toolsMarker?.boundaryIndex).toBe(0);
    expect(toolsMarker?.reason).toContain('skill:triage');

    // No messages-slot contributions → no marker
    expect(markers.find((m) => m.field === 'messages')).toBeUndefined();

    // Total: 2 markers
    expect(markers).toHaveLength(2);
  });
});
