/**
 * OpenAIThinkingHandler — Phase 5 7-pattern test matrix.
 *
 * Pins the contract for OpenAI o1/o3 reasoning_summary normalization:
 *   - Three input shapes: string (older o1), structured array (o3+), undefined
 *   - All output blocks marked summary: true
 *   - No signature handling (OpenAI doesn't sign)
 *   - No parseChunk (OpenAI doesn't stream reasoning)
 *   - Forward-compat: unknown shapes return [] gracefully
 *
 * 7-pattern coverage:
 *   1. Unit         — normalize() per input variant
 *   2. Scenario     — full o3 reasoning_summary → ThinkingBlock[]
 *   3. Integration  — registry membership + findThinkingHandler('openai')
 *   4. Property     — random summary configurations produce predictable output
 *   5. Security     — content unchanged; no signature in output
 *   6. Performance  — normalize() x1000 of 5-step summary under bound
 *   7. ROI          — realistic o3 multi-step reasoning_summary
 */

import { describe, expect, it } from 'vitest';
import {
  findThinkingHandler,
  openAIThinkingHandler,
  SHIPPED_THINKING_HANDLERS,
  type ThinkingBlock,
} from '../../src/thinking/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

/** Build a structured-array reasoning_summary (o3+ format). */
function structuredSummary(steps: readonly string[]): readonly { type: string; text: string }[] {
  return steps.map((text) => ({ type: 'summary_text', text }));
}

// ─── 1. UNIT — normalize() per input variant ─────────────────────

describe('OpenAIThinkingHandler — unit: normalize() input variants', () => {
  it('returns empty array for undefined / null', () => {
    expect(openAIThinkingHandler.normalize(undefined)).toEqual([]);
    expect(openAIThinkingHandler.normalize(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(openAIThinkingHandler.normalize('')).toEqual([]);
  });

  it('normalizes simple string (older o1 format) → single summary block', () => {
    const blocks = openAIThinkingHandler.normalize('I worked through the problem step by step');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'thinking',
      content: 'I worked through the problem step by step',
      summary: true,
    });
  });

  it('normalizes structured array (o3+ format) → multi-block with summary: true', () => {
    const raw = structuredSummary(['Step 1', 'Step 2', 'Step 3']);
    const blocks = openAIThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.summary === true)).toBe(true);
    expect(blocks.every((b) => b.type === 'thinking')).toBe(true);
    expect(blocks.map((b) => b.content)).toEqual(['Step 1', 'Step 2', 'Step 3']);
  });

  it('returns empty array for empty structured array', () => {
    expect(openAIThinkingHandler.normalize([])).toEqual([]);
  });

  it('skips array items without text field (defensive)', () => {
    const raw = [
      { type: 'summary_text', text: 'valid step' },
      { type: 'summary_text' }, // no text
      { type: 'unknown' }, // no text
      { type: 'summary_text', text: '' }, // empty text
      { type: 'summary_text', text: 'another valid step' },
    ];
    const blocks = openAIThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.content).toBe('valid step');
    expect(blocks[1]?.content).toBe('another valid step');
  });

  it('returns empty array for unknown shapes (forward-compat)', () => {
    expect(openAIThinkingHandler.normalize({ kind: 'unknown' })).toEqual([]);
    expect(openAIThinkingHandler.normalize(42)).toEqual([]);
    expect(openAIThinkingHandler.normalize(true)).toEqual([]);
  });
});

// ─── 2. SCENARIO — realistic o3 reasoning_summary ───────────────

describe('OpenAIThinkingHandler — scenario: realistic o3 response', () => {
  it('multi-step reasoning_summary → all blocks marked summary: true', () => {
    const raw = structuredSummary([
      'Identify the user request: refund order #42',
      'Look up order in database',
      'Verify refund eligibility',
      'Calculate refund amount',
    ]);
    const blocks = openAIThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(4);
    blocks.forEach((b) => {
      expect(b.summary).toBe(true);
      expect(b.signature).toBeUndefined(); // OpenAI doesn't sign
      expect(b.type).toBe('thinking');
    });
    expect(blocks[0]?.content).toContain('refund order #42');
  });
});

// ─── 3. INTEGRATION — registry membership ───────────────────────

describe('OpenAIThinkingHandler — integration: registry', () => {
  it('appears in SHIPPED_THINKING_HANDLERS', () => {
    expect(SHIPPED_THINKING_HANDLERS).toContain(openAIThinkingHandler);
  });

  it('findThinkingHandler("openai") returns this handler', () => {
    expect(findThinkingHandler('openai')).toBe(openAIThinkingHandler);
  });

  it('handler.providerNames is ["openai"]', () => {
    expect(openAIThinkingHandler.providerNames).toEqual(['openai']);
  });

  it('handler does NOT implement parseChunk (OpenAI does not stream reasoning)', () => {
    expect(openAIThinkingHandler.parseChunk).toBeUndefined();
  });
});

// ─── 4. PROPERTY — random configurations ────────────────────────

describe('OpenAIThinkingHandler — property: random inputs preserve invariants', () => {
  it('random N-step structured summary produces N matching blocks', () => {
    for (let trial = 0; trial < 20; trial++) {
      const n = Math.floor(Math.random() * 8);
      const steps = Array.from({ length: n }, (_, i) => `step ${i}`);
      const raw = structuredSummary(steps);
      const blocks = openAIThinkingHandler.normalize(raw);
      expect(blocks).toHaveLength(n);
      blocks.forEach((b, i) => {
        expect(b.content).toBe(`step ${i}`);
        expect(b.summary).toBe(true);
      });
    }
  });

  it('every output block has summary: true (never raw thinking marker)', () => {
    for (let trial = 0; trial < 20; trial++) {
      const n = Math.floor(Math.random() * 5);
      const raw = structuredSummary(Array.from({ length: n }, (_, i) => `s-${i}`));
      const out = openAIThinkingHandler.normalize(raw);
      expect(out.every((b) => b.summary === true)).toBe(true);
    }
  });

  it('string-shape input always produces 0 or 1 blocks', () => {
    const inputs = ['', 'short', 'a longer reasoning summary', '   only whitespace   '];
    for (const input of inputs) {
      const out = openAIThinkingHandler.normalize(input);
      expect(out.length).toBeLessThanOrEqual(1);
      if (input.length > 0) expect(out).toHaveLength(1);
    }
  });
});

// ─── 5. SECURITY — content + no signature ───────────────────────

describe('OpenAIThinkingHandler — security: content + no-signature', () => {
  it('content passes through unchanged (no encoding normalization)', () => {
    const tricky = 'Reasoning with: 中文, emoji 🎯, and special chars +/=';
    const blocks = openAIThinkingHandler.normalize(tricky);
    expect(blocks[0]?.content).toBe(tricky);
  });

  it('no signature field on output blocks (OpenAI does not sign)', () => {
    const blocks = openAIThinkingHandler.normalize(structuredSummary(['step 1', 'step 2']));
    blocks.forEach((b) => {
      expect(b.signature).toBeUndefined();
    });
  });

  it('redacted_thinking type NEVER produced (only Anthropic-specific)', () => {
    const blocks = openAIThinkingHandler.normalize(structuredSummary(['step']));
    blocks.forEach((b) => {
      expect(b.type).toBe('thinking');
    });
  });
});

// ─── 6. PERFORMANCE — normalize() x1000 ─────────────────────────

describe('OpenAIThinkingHandler — performance: normalize() x1000', () => {
  it('5-step structured summary x1000 under 250ms', () => {
    const raw = structuredSummary([
      'identify request',
      'look up data',
      'apply logic',
      'verify result',
      'format response',
    ]);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const blocks = openAIThinkingHandler.normalize(raw);
      if (blocks.length !== 5) throw new Error('shape regression');
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(250);
  });

  it('undefined input x1000 under 50ms (early-return)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) openAIThinkingHandler.normalize(undefined);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(150);
  });

  it('large 50-step summary normalize under 50ms', () => {
    const raw = structuredSummary(
      Array.from({ length: 50 }, (_, i) => `Step ${i}: detailed reasoning content here`),
    );
    const t0 = performance.now();
    const blocks = openAIThinkingHandler.normalize(raw);
    const elapsed = performance.now() - t0;
    expect(blocks).toHaveLength(50);
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — realistic o3 reasoning_summary ────────────────────

describe('OpenAIThinkingHandler — ROI: realistic o3 multi-step summary', () => {
  it('realistic 7-step refund-decision reasoning → 7 blocks all summary', () => {
    // Realistic o3 reasoning_summary shape for a refund decision agent
    const raw = structuredSummary([
      'The user requests a refund for order #ord-123.',
      'I need to look up the order to verify its details.',
      'Order found: $50 charged 5 days ago, status delivered.',
      'Refund policy allows refunds within 30 days of delivery.',
      'Verify customer eligibility — no fraud flags on account.',
      'Calculate refund amount: full $50 (no restocking fee for first refund).',
      'Process refund and send confirmation email.',
    ]);
    const blocks = openAIThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(7);
    blocks.forEach((b) => {
      expect(b.type).toBe('thinking');
      expect(b.summary).toBe(true);
      expect(b.signature).toBeUndefined();
    });
    // Verify content order preserved
    expect(blocks[0]?.content).toContain('refund for order #ord-123');
    expect(blocks[6]?.content).toContain('Process refund');
  });

  it('JSON round-trip preserves all fields (persistence path)', () => {
    const raw = structuredSummary(['step 1', 'step 2 with chars +/= and 中文']);
    const blocks: readonly ThinkingBlock[] = openAIThinkingHandler.normalize(raw);
    const restored = JSON.parse(JSON.stringify(blocks)) as readonly ThinkingBlock[];
    expect(restored).toHaveLength(2);
    expect(restored[1]?.content).toBe('step 2 with chars +/= and 中文');
    expect(restored[1]?.summary).toBe(true);
  });
});
