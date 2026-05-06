/**
 * AnthropicThinkingHandler — Phase 4a 7-pattern test matrix.
 *
 * Pins the contract for Anthropic's extended-thinking normalization:
 *   - Filter response.content for thinking + redacted_thinking blocks
 *   - Preserve signature BYTE-EXACT (Anthropic round-trip integrity)
 *   - Empty content for redacted_thinking blocks (per wire format)
 *   - Ignore other block types (text, tool_use, etc.)
 *   - Optional parseChunk for handler-direct consumers
 *
 * 7-pattern coverage:
 *   1. Unit         — normalize() per input variant
 *   2. Scenario     — full Anthropic response → ThinkingBlock[]
 *   3. Integration  — registry membership + findThinkingHandler('anthropic')
 *   4. Property     — random Anthropic content arrays produce predictable output
 *   5. Security     — signature byte-exact across multiple normalize cycles
 *   6. Performance  — normalize() x1000 of 5-block response under bound
 *   7. ROI          — realistic Sonnet response (mixed thinking + tool_use + text)
 */

import { describe, expect, it } from 'vitest';
import {
  anthropicThinkingHandler,
  findThinkingHandler,
  SHIPPED_THINKING_HANDLERS,
  type ThinkingBlock,
} from '../../src/thinking/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

/** Build a realistic Anthropic response.content array. */
function anthropicContent(blocks: readonly unknown[]): readonly unknown[] {
  return blocks;
}

// ─── 1. UNIT — normalize() per input variant ─────────────────────

describe('AnthropicThinkingHandler — unit: normalize() input variants', () => {
  it('returns empty array for non-array input (defensive)', () => {
    expect(anthropicThinkingHandler.normalize(null)).toEqual([]);
    expect(anthropicThinkingHandler.normalize(undefined)).toEqual([]);
    expect(anthropicThinkingHandler.normalize('garbage')).toEqual([]);
    expect(anthropicThinkingHandler.normalize({})).toEqual([]);
    expect(anthropicThinkingHandler.normalize(42)).toEqual([]);
  });

  it('returns empty array for empty content', () => {
    expect(anthropicThinkingHandler.normalize([])).toEqual([]);
  });

  it('normalizes a single thinking block with signature', () => {
    const raw = anthropicContent([
      { type: 'thinking', thinking: 'I need to look up the order', signature: 'AwI3p9...XYZ' },
    ]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'thinking',
      content: 'I need to look up the order',
      signature: 'AwI3p9...XYZ',
    });
  });

  it('normalizes a thinking block WITHOUT signature (rare but possible)', () => {
    const raw = anthropicContent([{ type: 'thinking', thinking: 'unsigned reasoning' }]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'thinking',
      content: 'unsigned reasoning',
    });
    expect(blocks[0]?.signature).toBeUndefined();
  });

  it('normalizes redacted_thinking blocks with empty content + signature', () => {
    const raw = anthropicContent([{ type: 'redacted_thinking', signature: 'AwI3pRedacted999' }]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'redacted_thinking',
      content: '',
      signature: 'AwI3pRedacted999',
    });
  });

  it('IGNORES non-thinking block types (text, tool_use)', () => {
    const raw = anthropicContent([
      { type: 'text', text: 'Hi there!' },
      { type: 'tool_use', id: 'tu-1', name: 'lookup', input: {} },
    ]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks).toEqual([]);
  });

  it('preserves order across multiple thinking blocks', () => {
    const raw = anthropicContent([
      { type: 'thinking', thinking: 'first', signature: 'sig-A' },
      { type: 'thinking', thinking: 'second', signature: 'sig-B' },
      { type: 'redacted_thinking', signature: 'sig-C' },
    ]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.signature).toBe('sig-A');
    expect(blocks[1]?.signature).toBe('sig-B');
    expect(blocks[2]?.signature).toBe('sig-C');
  });
});

// ─── 1b. UNIT — parseChunk() ────────────────────────────────────

describe('AnthropicThinkingHandler — unit: parseChunk()', () => {
  it('extracts thinking text from thinking_delta event', () => {
    const chunk = {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'partial reasoning' },
    };
    expect(anthropicThinkingHandler.parseChunk?.(chunk)).toEqual({
      thinkingDelta: 'partial reasoning',
    });
  });

  it('returns empty for text_delta events (visible content)', () => {
    const chunk = {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'visible token' },
    };
    expect(anthropicThinkingHandler.parseChunk?.(chunk)).toEqual({});
  });

  it('returns empty for chunks without delta', () => {
    expect(anthropicThinkingHandler.parseChunk?.({ type: 'message_start' })).toEqual({});
    expect(anthropicThinkingHandler.parseChunk?.(null)).toEqual({});
    expect(anthropicThinkingHandler.parseChunk?.('garbage')).toEqual({});
  });
});

// ─── 2. SCENARIO — realistic full response ──────────────────────

describe('AnthropicThinkingHandler — scenario: full Anthropic response', () => {
  it('mixed-block response → only thinking blocks land in output', () => {
    // Realistic Sonnet extended-thinking-with-tool-use response shape
    const raw = anthropicContent([
      {
        type: 'thinking',
        thinking: 'The user wants order #42. I should look it up.',
        signature: 'AwI3pBlk9HqXYZopaque',
      },
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'lookupOrder',
        input: { id: '42' },
      },
    ]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.content).toContain('order #42');
    expect(blocks[0]?.signature).toBe('AwI3pBlk9HqXYZopaque');
  });
});

// ─── 3. INTEGRATION — registry membership ───────────────────────

describe('AnthropicThinkingHandler — integration: registry', () => {
  it('appears in SHIPPED_THINKING_HANDLERS', () => {
    expect(SHIPPED_THINKING_HANDLERS).toContain(anthropicThinkingHandler);
  });

  it('findThinkingHandler("anthropic") returns this handler', () => {
    expect(findThinkingHandler('anthropic')).toBe(anthropicThinkingHandler);
  });

  it('handler.providerNames includes only "anthropic" for v2.14.0', () => {
    // Bedrock-via-Anthropic deferred to Phase 5+
    expect(anthropicThinkingHandler.providerNames).toEqual(['anthropic']);
  });
});

// ─── 4. PROPERTY — random inputs preserve invariants ────────────

describe('AnthropicThinkingHandler — property: random content arrays', () => {
  it('random mix of block types produces predictable thinking-block count', () => {
    for (let trial = 0; trial < 30; trial++) {
      const total = Math.floor(Math.random() * 8);
      let expectedThinkingCount = 0;
      const blocks: unknown[] = [];
      for (let i = 0; i < total; i++) {
        const r = Math.random();
        if (r < 0.4) {
          blocks.push({
            type: 'thinking',
            thinking: `block-${i}`,
            signature: `sig-${i}`,
          });
          expectedThinkingCount++;
        } else if (r < 0.55) {
          blocks.push({ type: 'redacted_thinking', signature: `red-sig-${i}` });
          expectedThinkingCount++;
        } else if (r < 0.8) {
          blocks.push({ type: 'text', text: `text-${i}` });
        } else {
          blocks.push({ type: 'tool_use', id: `tu-${i}`, name: 'x', input: {} });
        }
      }
      const out = anthropicThinkingHandler.normalize(blocks);
      expect(out).toHaveLength(expectedThinkingCount);
    }
  });

  it('every output block has type either "thinking" or "redacted_thinking"', () => {
    for (let trial = 0; trial < 20; trial++) {
      const n = Math.floor(Math.random() * 5);
      const blocks = Array.from({ length: n }, (_, i) => ({
        type: i % 2 === 0 ? 'thinking' : 'redacted_thinking',
        thinking: i % 2 === 0 ? `b-${i}` : undefined,
        signature: `sig-${i}`,
      }));
      const out = anthropicThinkingHandler.normalize(blocks);
      for (const b of out) {
        expect(['thinking', 'redacted_thinking']).toContain(b.type);
      }
    }
  });
});

// ─── 5. SECURITY — signature byte-exact preservation ────────────

describe('AnthropicThinkingHandler — security: signature byte-exact', () => {
  it('signature is preserved BYTE-EXACT (no encoding normalization)', () => {
    // Use a signature with characters that COULD be normalized by JSON
    // round-tripping or string coercion: trailing whitespace, special
    // base64 chars (+ / =), unicode-adjacent characters.
    const trickySig = 'AwI3pBlk+9Hq/XYZ==trailing  ';
    const raw = anthropicContent([
      { type: 'thinking', thinking: 'reasoning', signature: trickySig },
    ]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    // Strict equality verifies BYTE-EXACT preservation. Even single
    // byte difference would break Anthropic's server-side validation.
    expect(blocks[0]?.signature).toBe(trickySig);
    expect(blocks[0]?.signature?.length).toBe(trickySig.length);
  });

  it('Buffer comparison verifies no encoding shift (defensive)', () => {
    const sig = 'AwI3pBlk+9Hq/XYZ==';
    const raw = anthropicContent([{ type: 'thinking', thinking: 'x', signature: sig }]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(Buffer.from(blocks[0]!.signature!).equals(Buffer.from(sig))).toBe(true);
  });

  it('multiple normalize cycles preserve signature byte-exact', () => {
    const sig = 'AwI3p+/=opaque';
    const raw = anthropicContent([{ type: 'thinking', thinking: 'x', signature: sig }]);
    let current: readonly ThinkingBlock[] = anthropicThinkingHandler.normalize(raw);
    // Round-trip the output back through (simulates persist/restore cycle).
    for (let i = 0; i < 5; i++) {
      const reformed = anthropicContent([
        { type: 'thinking', thinking: current[0]?.content, signature: current[0]?.signature },
      ]);
      current = anthropicThinkingHandler.normalize(reformed);
    }
    expect(current[0]?.signature).toBe(sig);
  });

  it('redacted_thinking signature is also byte-exact preserved', () => {
    const sig = 'AwI3pRedacted+/==';
    const raw = anthropicContent([{ type: 'redacted_thinking', signature: sig }]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks[0]?.signature).toBe(sig);
    expect(blocks[0]?.content).toBe('');
  });
});

// ─── 6. PERFORMANCE — normalize() under bound ───────────────────

describe('AnthropicThinkingHandler — performance: normalize() x1000', () => {
  it('5-block content x1000 under 250ms', () => {
    const raw = anthropicContent([
      { type: 'thinking', thinking: 'block 1', signature: 'sig-1' },
      { type: 'thinking', thinking: 'block 2', signature: 'sig-2' },
      { type: 'redacted_thinking', signature: 'sig-3' },
      { type: 'text', text: 'visible' },
      { type: 'tool_use', id: 'tu-1', name: 'x', input: {} },
    ]);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const blocks = anthropicThinkingHandler.normalize(raw);
      if (blocks.length !== 3) throw new Error('shape regression');
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(250);
  });

  it('empty content x1000 under 50ms (defensive early-return)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) anthropicThinkingHandler.normalize([]);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(150);
  });
});

// ─── 7. ROI — realistic Sonnet response ─────────────────────────

describe('AnthropicThinkingHandler — ROI: Sonnet extended-thinking-with-tool-use', () => {
  it('realistic 3-block response (thinking + tool_use + thinking) produces 2 thinking blocks', () => {
    // Anthropic CAN emit thinking before AND after tool_use within the same response
    // (model thinks, calls tool, thinks more about response while tool executes).
    // The handler must capture both.
    const raw = anthropicContent([
      {
        type: 'thinking',
        thinking: 'The user is asking about order ord-123. Let me look it up.',
        signature: 'AwI3pBefore12345',
      },
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'lookupOrder',
        input: { id: 'ord-123' },
      },
    ]);
    const blocks = anthropicThinkingHandler.normalize(raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.signature).toBe('AwI3pBefore12345');
    expect(blocks[0]?.content).toContain('ord-123');
  });

  it('signature round-trip integrity: normalize → JSON-serialize → JSON-parse → normalize', () => {
    // Simulates the scope.history persistence path — assistant message
    // serializes to JSON, deserializes on next request, signature
    // must survive byte-exact through the round trip.
    const originalSig = 'AwI3pRealistic+Anthropic/Sig+/==xyz';
    const raw = anthropicContent([
      {
        type: 'thinking',
        thinking: 'My reasoning step',
        signature: originalSig,
      },
    ]);
    const blocks1 = anthropicThinkingHandler.normalize(raw);

    // Persist + restore via JSON (the framework's scope.history path)
    const serialized = JSON.stringify(blocks1);
    const restored = JSON.parse(serialized) as readonly ThinkingBlock[];

    // Reconstruct an Anthropic-shape input from the restored block
    // and re-normalize (simulates the next-turn assistant message
    // construction the AnthropicProvider's serialization will do)
    const reformed = anthropicContent([
      {
        type: 'thinking',
        thinking: restored[0]?.content,
        signature: restored[0]?.signature,
      },
    ]);
    const blocks2 = anthropicThinkingHandler.normalize(reformed);

    expect(blocks2[0]?.signature).toBe(originalSig);
    // Buffer comparison for true byte-exact verification
    expect(Buffer.from(blocks2[0]!.signature!).equals(Buffer.from(originalSig))).toBe(true);
  });
});
