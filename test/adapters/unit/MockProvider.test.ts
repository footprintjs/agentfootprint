/**
 * MockProvider — realistic-mode tests.
 *
 * 5 patterns covering the realistic-LLM behavior consumers actually
 * use in playgrounds and Lens demos:
 *
 *   M1  thinkingMs (fixed)        — complete() waits the full delay
 *   M2  thinkingMs (range)        — complete() waits within [min, max]
 *   M3  respond() with tool calls — partial response composes into full response
 *   M4  stream()                  — yields word-by-word chunks ending with done
 *   M5  signal abort              — pending sleep rejects on abort
 *
 * Goal: prove the mock LLM-like behavior (latency + streaming + tool
 * calls) without flaking the suite. Timings asserted with a slack window
 * that won't break under a loaded CI host.
 */

import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMRequest, LLMChunk } from '../../../src/adapters/types.js';

function req(message = 'hello'): LLMRequest {
  return {
    messages: [{ role: 'user', content: message }],
    tools: [],
  } as unknown as LLMRequest;
}

// ── M1: fixed thinking latency ─────────────────────────────────────

describe('MockProvider — M1: thinkingMs (fixed)', () => {
  it('complete() waits at least thinkingMs before returning', async () => {
    const provider = new MockProvider({ thinkingMs: 80, reply: 'ok' });
    const t0 = Date.now();
    const res = await provider.complete(req());
    const elapsed = Date.now() - t0;
    expect(res.content).toBe('ok');
    expect(elapsed).toBeGreaterThanOrEqual(70);
  });
});

// ── M2: random thinking latency in a [min, max] band ───────────────

describe('MockProvider — M2: thinkingMs (range)', () => {
  it('complete() waits within [min, max] when given a tuple', async () => {
    const provider = new MockProvider({ thinkingMs: [40, 120], reply: 'r' });
    const t0 = Date.now();
    await provider.complete(req());
    const elapsed = Date.now() - t0;
    // Lower bound is hard, upper bound has loose slack for CI noise.
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(400);
  });
});

// ── M3: respond() can return a Partial<LLMResponse> with tool calls ─

describe('MockProvider — M3: respond() with tool calls', () => {
  it('passes tool calls through and infers stopReason="tool_use"', async () => {
    const provider = new MockProvider({
      respond: () => ({
        content: '',
        toolCalls: [{ id: 't1', name: 'askOperator', args: { q: 'approve?' } }],
      }),
    });
    const res = await provider.complete(req('please refund me'));
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({
      id: 't1',
      name: 'askOperator',
      args: { q: 'approve?' },
    });
    // stopReason auto-flipped because toolCalls > 0
    expect(res.stopReason).toBe('tool_use');
  });

  it('respond() returning a string still works (back-compat)', async () => {
    const provider = new MockProvider({
      respond: (r) => `you said: ${r.messages[r.messages.length - 1].content}`,
    });
    const res = await provider.complete(req('hi'));
    expect(res.content).toBe('you said: hi');
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe('stop');
  });
});

// ── M4: streaming yields word-by-word chunks ───────────────────────

describe('MockProvider — M4: stream()', () => {
  it('emits one chunk per word and ends with done=true', async () => {
    const provider = new MockProvider({
      thinkingMs: 0,
      chunkDelayMs: 0,
      reply: 'hello world from mock',
    });
    const chunks: LLMChunk[] = [];
    for await (const c of provider.stream!(req())) chunks.push(c);
    // 4 words + 1 final done sentinel = 5
    expect(chunks).toHaveLength(5);
    expect(chunks[chunks.length - 1].done).toBe(true);
    expect(chunks[chunks.length - 1].content).toBe('');
    // Concatenating non-final chunk content reconstructs the original
    const reconstructed = chunks
      .slice(0, -1)
      .map((c) => c.content)
      .join('');
    expect(reconstructed).toBe('hello world from mock');
    // tokenIndex increments monotonically
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].tokenIndex).toBe(i);
    }
  });

  it('empty content emits only the done sentinel', async () => {
    const provider = new MockProvider({ thinkingMs: 0, reply: '' });
    const chunks: LLMChunk[] = [];
    for await (const c of provider.stream!(req())) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ tokenIndex: 0, content: '', done: true });
  });

  it('yields the full LLMResponse on the done chunk (tool calls + usage + stopReason)', async () => {
    // The Agent uses stream() for token-by-token UI feedback AND needs
    // the authoritative response (toolCalls, usage, stopReason) to
    // continue the ReAct loop. We deliver both via the terminal chunk's
    // optional `response` field — single round trip, no double call.
    const provider = new MockProvider({
      thinkingMs: 0,
      chunkDelayMs: 0,
      respond: () => ({
        content: '',
        toolCalls: [{ id: 't1', name: 'askOperator', args: { q: '?' } }],
      }),
    });
    const chunks: LLMChunk[] = [];
    for await (const c of provider.stream!(req())) chunks.push(c);
    const last = chunks[chunks.length - 1];
    expect(last.done).toBe(true);
    expect(last.response).toBeDefined();
    expect(last.response!.toolCalls).toHaveLength(1);
    expect(last.response!.toolCalls[0]).toMatchObject({
      id: 't1',
      name: 'askOperator',
    });
    expect(last.response!.stopReason).toBe('tool_use');
    expect(last.response!.usage).toBeDefined();
  });

  it('done-chunk response.content matches concatenated stream content', async () => {
    const provider = new MockProvider({
      thinkingMs: 0,
      chunkDelayMs: 0,
      reply: 'one two three',
    });
    const chunks: LLMChunk[] = [];
    for await (const c of provider.stream!(req())) chunks.push(c);
    const concat = chunks
      .slice(0, -1)
      .map((c) => c.content)
      .join('');
    expect(chunks[chunks.length - 1].response!.content).toBe(concat);
  });
});

// ── M5: AbortSignal cancels the pending thinking delay ─────────────

describe('MockProvider — M5: signal abort', () => {
  it('complete() rejects when the request signal aborts mid-thinking', async () => {
    const provider = new MockProvider({ thinkingMs: 5_000, reply: 'never' });
    const ac = new AbortController();
    const r = { ...req(), signal: ac.signal } as LLMRequest;
    const promise = provider.complete(r);
    // Abort shortly after dispatch — provider should reject promptly.
    setTimeout(() => ac.abort(new Error('client gone')), 30);
    await expect(promise).rejects.toThrow(/client gone/);
  });
});

// ── Realistic factory smoke test ───────────────────────────────────

describe('MockProvider.realistic()', () => {
  it('returns a provider with thinkingMs set; consumer can override via options', async () => {
    // Override thinkingMs to a tiny value so the test stays fast — we
    // only need to prove the factory produces a working provider.
    const provider = MockProvider.realistic({ thinkingMs: 5, reply: 'r' });
    const t0 = Date.now();
    const res = await provider.complete(req());
    expect(res.content).toBe('r');
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
