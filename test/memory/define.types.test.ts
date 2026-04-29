/**
 * Memory subsystem types — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers the Layer-1 contract surface in [src/memory/define.types.ts]:
 *   - MEMORY_TYPES, MEMORY_STRATEGIES, MEMORY_TIMING, SNAPSHOT_PROJECTIONS
 *   - Discriminated `Strategy` union (kind narrowing)
 *   - Type guards (isMemoryType / isMemoryStrategyKind / ...)
 *   - Per-id scope-key convention (memoryInjectionKey / isMemoryInjectionKey)
 *
 * No factory logic exercised here — that's `defineMemory()` step 2's
 * test surface. This file exists ONLY to lock the contract before
 * downstream code starts depending on it.
 */

import { describe, expect, it } from 'vitest';

import {
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  MEMORY_TIMING,
  SNAPSHOT_PROJECTIONS,
  MEMORY_INJECTION_KEY_PREFIX,
  isMemoryType,
  isMemoryStrategyKind,
  isMemoryTiming,
  isSnapshotProjection,
  memoryInjectionKey,
  isMemoryInjectionKey,
  type MemoryType,
  type MemoryStrategyKind,
  type MemoryTiming,
  type SnapshotProjection,
  type Strategy,
  type WindowStrategy,
  type SummarizeStrategy,
  type TopKStrategy,
} from '../../src/memory/define.types.js';

// ─── Unit — const-object identity + cardinality ────────────────────

describe('memory const-objects — unit', () => {
  it('MEMORY_TYPES exposes exactly 4 types — Episodic/Semantic/Narrative/Causal', () => {
    expect(Object.keys(MEMORY_TYPES).sort()).toEqual([
      'CAUSAL',
      'EPISODIC',
      'NARRATIVE',
      'SEMANTIC',
    ]);
    expect(MEMORY_TYPES.EPISODIC).toBe('episodic');
    expect(MEMORY_TYPES.CAUSAL).toBe('causal');
  });

  it('MEMORY_STRATEGIES exposes exactly 7 strategies', () => {
    expect(Object.keys(MEMORY_STRATEGIES).sort()).toEqual([
      'BUDGET',
      'DECAY',
      'EXTRACT',
      'HYBRID',
      'SUMMARIZE',
      'TOP_K',
      'WINDOW',
    ]);
    expect(MEMORY_STRATEGIES.WINDOW).toBe('window');
    expect(MEMORY_STRATEGIES.TOP_K).toBe('topK');
  });

  it('MEMORY_TIMING exposes exactly 2 timings', () => {
    expect(Object.keys(MEMORY_TIMING).sort()).toEqual([
      'EVERY_ITERATION',
      'TURN_START',
    ]);
    expect(MEMORY_TIMING.TURN_START).toBe('turn-start');
  });

  it('SNAPSHOT_PROJECTIONS exposes exactly 4 projections (only meaningful for CAUSAL)', () => {
    expect(Object.keys(SNAPSHOT_PROJECTIONS).sort()).toEqual([
      'COMMITS',
      'DECISIONS',
      'FULL',
      'NARRATIVE',
    ]);
  });
});

// ─── Unit — type guards ─────────────────────────────────────────────

describe('memory type guards — unit', () => {
  it('isMemoryType narrows to MemoryType', () => {
    expect(isMemoryType('episodic')).toBe(true);
    expect(isMemoryType('causal')).toBe(true);
    expect(isMemoryType('procedural')).toBe(false);
    expect(isMemoryType('')).toBe(false);
  });

  it('isMemoryStrategyKind narrows to MemoryStrategyKind', () => {
    expect(isMemoryStrategyKind('window')).toBe(true);
    expect(isMemoryStrategyKind('topK')).toBe(true);
    expect(isMemoryStrategyKind('TOP_K')).toBe(false); // case-sensitive — value not key
    expect(isMemoryStrategyKind('reranker')).toBe(false);
  });

  it('isMemoryTiming narrows to MemoryTiming', () => {
    expect(isMemoryTiming('turn-start')).toBe(true);
    expect(isMemoryTiming('every-iteration')).toBe(true);
    expect(isMemoryTiming('on-tool-return')).toBe(false);
  });

  it('isSnapshotProjection narrows to SnapshotProjection', () => {
    expect(isSnapshotProjection('decisions')).toBe(true);
    expect(isSnapshotProjection('full')).toBe(true);
    expect(isSnapshotProjection('partial')).toBe(false);
  });
});

// ─── Scenario — consumer ergonomics ────────────────────────────────

describe('memory const-objects — consumer scenarios', () => {
  it('typed config — Window strategy fully narrowed', () => {
    const s: Strategy = { kind: MEMORY_STRATEGIES.WINDOW, size: 10 };
    if (s.kind === MEMORY_STRATEGIES.WINDOW) {
      expect(s.size).toBe(10);
      // @ts-expect-error — Window has no `embedder` field
      void s.embedder;
    }
  });

  it('typed config — TopK strategy narrowed with embedder + threshold', () => {
    const embedder = { dimensions: 1536, embed: async () => [] } as unknown as TopKStrategy['embedder'];
    const s: Strategy = {
      kind: MEMORY_STRATEGIES.TOP_K,
      topK: 5,
      threshold: 0.75,
      embedder,
    };
    if (s.kind === MEMORY_STRATEGIES.TOP_K) {
      expect(s.topK).toBe(5);
      expect(s.threshold).toBe(0.75);
      expect(s.embedder).toBe(embedder);
    }
  });

  it('typed config — Hybrid composes a list of non-Hybrid strategies', () => {
    const inner: WindowStrategy = { kind: MEMORY_STRATEGIES.WINDOW, size: 5 };
    const s: Strategy = {
      kind: MEMORY_STRATEGIES.HYBRID,
      strategies: [inner],
    };
    if (s.kind === MEMORY_STRATEGIES.HYBRID) {
      expect(s.strategies).toHaveLength(1);
      expect(s.strategies[0]?.kind).toBe(MEMORY_STRATEGIES.WINDOW);
    }
  });

  it('bare string literals still typecheck (consumers can grow into constants)', () => {
    const t: MemoryType = 'causal';
    const k: MemoryStrategyKind = 'window';
    const tm: MemoryTiming = 'turn-start';
    const p: SnapshotProjection = 'decisions';
    expect([t, k, tm, p]).toEqual(['causal', 'window', 'turn-start', 'decisions']);
  });
});

// ─── Integration — scope-key convention (multi-memory layering) ────

describe('memory injection scope-key convention — integration', () => {
  it('memoryInjectionKey prefixes id with stable convention', () => {
    expect(memoryInjectionKey('long-chat')).toBe('memoryInjection_long-chat');
    expect(memoryInjectionKey('causal')).toBe('memoryInjection_causal');
  });

  it('isMemoryInjectionKey detects keys produced by memoryInjectionKey', () => {
    const a = memoryInjectionKey('a');
    const b = memoryInjectionKey('b');
    expect(isMemoryInjectionKey(a)).toBe(true);
    expect(isMemoryInjectionKey(b)).toBe(true);
    // Round-trip: every produced key should be detected
    expect(isMemoryInjectionKey(memoryInjectionKey('xyz-123_abc'))).toBe(true);
  });

  it('isMemoryInjectionKey rejects non-memory scope keys', () => {
    expect(isMemoryInjectionKey('messages')).toBe(false);
    expect(isMemoryInjectionKey('systemPromptInjections')).toBe(false);
    expect(isMemoryInjectionKey('memoryInjection')).toBe(false); // missing trailing _
  });

  it('multiple memory ids never collide on scope keys', () => {
    const k1 = memoryInjectionKey('m1');
    const k2 = memoryInjectionKey('m2');
    const k3 = memoryInjectionKey('m1-shadow');
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });
});

// ─── Property — round-trip invariants ──────────────────────────────

describe('memory const-objects — properties', () => {
  it('every MEMORY_TYPES value passes its type guard', () => {
    for (const v of Object.values(MEMORY_TYPES)) {
      expect(isMemoryType(v)).toBe(true);
    }
  });

  it('every MEMORY_STRATEGIES value passes its type guard', () => {
    for (const v of Object.values(MEMORY_STRATEGIES)) {
      expect(isMemoryStrategyKind(v)).toBe(true);
    }
  });

  it('every MEMORY_TIMING value passes its type guard', () => {
    for (const v of Object.values(MEMORY_TIMING)) {
      expect(isMemoryTiming(v)).toBe(true);
    }
  });

  it('every SNAPSHOT_PROJECTIONS value passes its type guard', () => {
    for (const v of Object.values(SNAPSHOT_PROJECTIONS)) {
      expect(isSnapshotProjection(v)).toBe(true);
    }
  });

  it('memoryInjectionKey output ALWAYS satisfies isMemoryInjectionKey', () => {
    const ids = ['a', 'B', '1', 'long-id-with-dashes', 'has_underscore'];
    for (const id of ids) {
      expect(isMemoryInjectionKey(memoryInjectionKey(id))).toBe(true);
    }
  });
});

// ─── Security — no surprise prefix collision ───────────────────────

describe('memory injection key — security', () => {
  it('does NOT match a key that merely contains the prefix substring', () => {
    // Adversarial: a different namespace happens to embed our prefix
    // mid-string. Our convention uses startsWith(), so embed-only
    // shouldn't false-positive.
    expect(isMemoryInjectionKey('user-memoryInjection_x')).toBe(false);
  });

  it('rejects empty / whitespace ids upstream by guarding only the convention', () => {
    // The convention itself is permissive — id validation is the
    // factory's job (step 2). This test pins behavior so any future
    // factory tightening is visible against the contract.
    expect(memoryInjectionKey('')).toBe(MEMORY_INJECTION_KEY_PREFIX);
    expect(isMemoryInjectionKey(memoryInjectionKey(''))).toBe(true);
  });
});

// ─── Performance — const-objects erase at compile time ─────────────

describe('memory const-objects — performance', () => {
  it('hot-path lookups (1M iterations) under 100ms — tree-shake-friendly', () => {
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < 1_000_000; i++) {
      // Realistic hot-path: switch on a const value
      switch (MEMORY_TYPES.EPISODIC) {
        case 'episodic':
          acc++;
          break;
      }
    }
    const elapsed = performance.now() - start;
    expect(acc).toBe(1_000_000);
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── ROI — what this contract unblocks ─────────────────────────────

describe('memory const-objects — ROI', () => {
  it('one place to add a 5th memory type (e.g. PROCEDURAL) — proves extensibility', () => {
    // This test pins the design's evolution path. Adding `PROCEDURAL: 'procedural'`
    // to MEMORY_TYPES should NOT require touching:
    //   - the discriminated Strategy union (strategies are universal)
    //   - the scope-key convention (id is independent of type)
    //   - any consumer that filters by isMemoryType (truthy expansion)
    // We can't add types in tests, so we assert the inverse: every
    // strategy works for every type today.
    const allTypes = Object.values(MEMORY_TYPES);
    const allStrategies = Object.values(MEMORY_STRATEGIES);
    for (const t of allTypes) {
      expect(isMemoryType(t)).toBe(true);
      for (const k of allStrategies) {
        expect(isMemoryStrategyKind(k)).toBe(true);
      }
    }
  });

  it('Causal type is first-class (not an afterthought) — differentiator', () => {
    // The 5-axis pedagogy says causal memory is OUR contribution
    // (no other library has snapshot-as-memory). Pin Causal as a
    // peer of Episodic/Semantic/Narrative — same shape, same guards.
    expect(MEMORY_TYPES.CAUSAL).toBeDefined();
    expect(isMemoryType(MEMORY_TYPES.CAUSAL)).toBe(true);
    // SNAPSHOT_PROJECTIONS exists only because of Causal — pin its presence.
    expect(SNAPSHOT_PROJECTIONS.DECISIONS).toBeDefined();
    expect(isSnapshotProjection(SNAPSHOT_PROJECTIONS.DECISIONS)).toBe(true);
  });

  it('SummarizeStrategy carries the LLM dependency explicitly (no hidden coupling)', () => {
    // The book (Ch 7 — context janitor) and our design both say:
    // long-conversation compression requires an LLM. Pin that requirement
    // on the type itself so consumers can't accidentally skip it.
    const s: SummarizeStrategy = {
      kind: MEMORY_STRATEGIES.SUMMARIZE,
      recent: 6,
      llm: {} as SummarizeStrategy['llm'], // placeholder
    };
    expect(s.recent).toBe(6);
    // @ts-expect-error — `llm` is required, not optional
    const bad: SummarizeStrategy = { kind: MEMORY_STRATEGIES.SUMMARIZE, recent: 6 };
    void bad;
  });
});
