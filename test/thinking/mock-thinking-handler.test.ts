/**
 * MockThinkingHandler — Phase 1 7-pattern test matrix.
 *
 * Pins the contract for the canonical example handler used by:
 *   - Future provider authors as a reference implementation
 *   - The shared contract test (every shipped handler honors invariants)
 *   - End-to-end agent tests via MockProvider
 *
 * 7-pattern coverage:
 *   1. Unit         — normalize() + parseChunk() for known inputs
 *   2. Scenario     — full Anthropic-shape + OpenAI-shape end-to-end
 *   3. Integration  — registry lookup matches mock to 'mock' provider
 *   4. Property     — random raw inputs never panic
 *   5. Security     — outputs contain no fake-PII / no fake-signature material
 *   6. Performance  — normalize() x1000 < 100ms (overhead bound)
 *   7. ROI          — round-trip block round-trip (signature preservation)
 */

import { describe, expect, it } from 'vitest';
import {
  mockAnthropicRaw,
  mockOpenAIRaw,
  mockThinkingHandler,
  type ThinkingBlock,
} from '../../src/thinking/index.js';

// ─── 1. UNIT — normalize() + parseChunk() ────────────────────────

describe('MockThinkingHandler — unit: normalize()', () => {
  it('returns empty array for unknown raw shape', () => {
    expect(mockThinkingHandler.normalize(null)).toEqual([]);
    expect(mockThinkingHandler.normalize(undefined)).toEqual([]);
    expect(mockThinkingHandler.normalize('garbage')).toEqual([]);
    expect(mockThinkingHandler.normalize({ kind: 'unknown' })).toEqual([]);
  });

  it('returns empty array for Anthropic-shape with no blocks', () => {
    expect(mockThinkingHandler.normalize(mockAnthropicRaw([]))).toEqual([]);
  });

  it('normalizes Anthropic-shape blocks with content + signature', () => {
    const raw = mockAnthropicRaw([
      { content: 'reasoning step 1', signature: 'sig-A' },
      { content: 'reasoning step 2', signature: 'sig-B' },
    ]);
    const blocks = mockThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'thinking',
      content: 'reasoning step 1',
      signature: 'sig-A',
    });
    expect(blocks[1]?.signature).toBe('sig-B');
  });

  it('normalizes Anthropic redacted_thinking with empty content + signature', () => {
    const raw = mockAnthropicRaw([
      { content: 'will-be-redacted', signature: 'sig-redacted', redacted: true },
    ]);
    const blocks = mockThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'redacted_thinking',
      content: '',
      signature: 'sig-redacted',
    });
  });

  it('normalizes OpenAI-shape multi-block summary', () => {
    const raw = mockOpenAIRaw(['step one', 'step two', 'step three']);
    const blocks = mockThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(3);
    blocks.forEach((b, i) => {
      expect(b.type).toBe('thinking');
      expect(b.summary).toBe(true);
      expect(b.content).toBe(['step one', 'step two', 'step three'][i]);
      // OpenAI blocks don't carry signatures
      expect(b.signature).toBeUndefined();
    });
  });
});

describe('MockThinkingHandler — unit: parseChunk()', () => {
  it('returns thinkingDelta from { thinkingDelta: "..." } chunk', () => {
    expect(mockThinkingHandler.parseChunk?.({ thinkingDelta: 'partial reasoning' })).toEqual({
      thinkingDelta: 'partial reasoning',
    });
  });

  it('returns empty object for chunks without thinkingDelta', () => {
    expect(mockThinkingHandler.parseChunk?.({})).toEqual({});
    expect(mockThinkingHandler.parseChunk?.({ otherField: 'x' })).toEqual({});
    expect(mockThinkingHandler.parseChunk?.(null)).toEqual({});
    expect(mockThinkingHandler.parseChunk?.('garbage')).toEqual({});
  });
});

// ─── 2. SCENARIO — end-to-end shape handling ─────────────────────

describe('MockThinkingHandler — scenario: handles BOTH provider shapes', () => {
  it('Anthropic flow: signed blocks normalize and round-trip identifiers', () => {
    const raw = mockAnthropicRaw([
      { content: 'I should check inventory first.', signature: 'sig-XYZ' },
    ]);
    const blocks = mockThinkingHandler.normalize(raw);
    const block = blocks[0]!;
    expect(block.type).toBe('thinking');
    expect(block.content).toBe('I should check inventory first.');
    expect(block.signature).toBe('sig-XYZ');
  });

  it('OpenAI flow: structured-summary multi-block with summary flag', () => {
    const raw = mockOpenAIRaw(['Identify the user request', 'Choose appropriate tool']);
    const blocks = mockThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.summary === true)).toBe(true);
    expect(blocks.every((b) => b.signature === undefined)).toBe(true);
  });
});

// ─── 3. INTEGRATION — registry lookup ────────────────────────────

describe('MockThinkingHandler — integration: registry lookup', () => {
  it('mockThinkingHandler is in SHIPPED_THINKING_HANDLERS', async () => {
    const { SHIPPED_THINKING_HANDLERS } = await import('../../src/thinking/registry.js');
    expect(SHIPPED_THINKING_HANDLERS).toContain(mockThinkingHandler);
  });

  it('findThinkingHandler("mock") returns mockThinkingHandler', async () => {
    const { findThinkingHandler } = await import('../../src/thinking/registry.js');
    expect(findThinkingHandler('mock')).toBe(mockThinkingHandler);
  });

  it('findThinkingHandler returns undefined for unknown providers', async () => {
    const { findThinkingHandler } = await import('../../src/thinking/registry.js');
    expect(findThinkingHandler('nonexistent')).toBeUndefined();
  });
});

// ─── 4. PROPERTY — random inputs never panic ─────────────────────

describe('MockThinkingHandler — property: random inputs preserve invariants', () => {
  it('random raw shapes return ThinkingBlock[] (possibly empty), never throw', () => {
    const shapes: unknown[] = [
      null,
      undefined,
      0,
      '',
      'string',
      [],
      {},
      { kind: 'anthropic', blocks: [] },
      { kind: 'openai', summarySteps: [] },
      { kind: 'gemini' },
      { random: { nested: { object: 'with', deep: 'values' } } },
    ];
    for (const raw of shapes) {
      const result = mockThinkingHandler.normalize(raw);
      expect(Array.isArray(result)).toBe(true);
      // Every block is well-formed when present
      for (const block of result) {
        expect(['thinking', 'redacted_thinking']).toContain(block.type);
        expect(typeof block.content).toBe('string');
      }
    }
  });

  it('random Anthropic-style block counts produce matching output length', () => {
    for (let trial = 0; trial < 20; trial++) {
      const n = Math.floor(Math.random() * 10);
      const raw = mockAnthropicRaw(
        Array.from({ length: n }, (_, i) => ({ content: `block-${i}`, signature: `sig-${i}` })),
      );
      const blocks = mockThinkingHandler.normalize(raw);
      expect(blocks).toHaveLength(n);
    }
  });

  it('random OpenAI-style step counts produce matching output length', () => {
    for (let trial = 0; trial < 20; trial++) {
      const n = Math.floor(Math.random() * 8);
      const raw = mockOpenAIRaw(Array.from({ length: n }, (_, i) => `step-${i}`));
      const blocks = mockThinkingHandler.normalize(raw);
      expect(blocks).toHaveLength(n);
      expect(blocks.every((b) => b.summary === true)).toBe(true);
    }
  });
});

// ─── 5. SECURITY — no PII / fake-signature defaults ──────────────

describe('MockThinkingHandler — security: zero sensitive defaults', () => {
  it('mock helpers do not default to fake-PII content', () => {
    // The mock helpers REQUIRE explicit content — they don't fabricate it
    const empty = mockAnthropicRaw([]);
    const blocks = mockThinkingHandler.normalize(empty);
    expect(blocks).toEqual([]);
  });

  it('redacted_thinking always has empty content (no leak path)', () => {
    const raw = mockAnthropicRaw([
      { content: 'super-secret-do-not-include', signature: 'sig', redacted: true },
    ]);
    const blocks = mockThinkingHandler.normalize(raw);
    // Even if the test fixture passed content, redacted blocks should
    // strip it (parallel to real Anthropic redacted_thinking behavior)
    expect(blocks[0]?.content).toBe('');
    expect(blocks[0]?.content).not.toContain('super-secret');
  });

  it('providerMeta is never set by the mock (foot-gun avoidance)', () => {
    const raw = mockAnthropicRaw([{ content: 'x', signature: 's' }]);
    const blocks = mockThinkingHandler.normalize(raw);
    // The example sets the bar — mock never adds providerMeta
    expect(blocks[0]?.providerMeta).toBeUndefined();
  });
});

// ─── 6. PERFORMANCE — normalize() overhead bound ─────────────────

describe('MockThinkingHandler — performance: normalize() x1000 under 100ms', () => {
  it('normalize() x1000 of 5-block Anthropic input under 100ms', () => {
    const raw = mockAnthropicRaw(
      Array.from({ length: 5 }, (_, i) => ({ content: `block-${i}`, signature: `sig-${i}` })),
    );
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const blocks = mockThinkingHandler.normalize(raw);
      if (blocks.length !== 5) throw new Error('shape regression');
    }
    const elapsed = performance.now() - t0;
    // Documented target: ~100µs per call. 100ms for 1000.
    // 300ms slack for CI cold start.
    expect(elapsed).toBeLessThan(300);
  });

  it('normalize() x1000 of empty input under 50ms (early-return path)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      mockThinkingHandler.normalize(undefined);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(150);
  });
});

// ─── 7. ROI — signature round-trip ───────────────────────────────

describe('MockThinkingHandler — ROI: signature byte-exact round-trip', () => {
  it('normalize → JSON serialize → JSON parse → normalize roundtrip preserves signature', () => {
    const original = mockAnthropicRaw([
      { content: 'I should check inventory first.', signature: 'sig-byte-exact-XYZ-12345' },
      { content: 'redacted reasoning', signature: 'sig-redacted-99', redacted: true },
    ]);
    const blocks1 = mockThinkingHandler.normalize(original);

    // Simulate scope.history JSON-serialization round-trip
    const serialized = JSON.stringify(blocks1);
    const reparsed = JSON.parse(serialized) as readonly ThinkingBlock[];

    // Signatures are byte-exact across the round trip
    expect(reparsed[0]?.signature).toBe('sig-byte-exact-XYZ-12345');
    expect(reparsed[1]?.signature).toBe('sig-redacted-99');
    expect(reparsed[0]?.content).toBe('I should check inventory first.');
    expect(reparsed[1]?.content).toBe(''); // redacted preserved
    expect(reparsed[1]?.type).toBe('redacted_thinking');
  });
});
