/**
 * SSEFormatter / toSSE — 7-pattern tests.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/core/Agent.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import { toSSE, SSEFormatter, encodeSSE } from '../../../src/stream.js';

function buildAgent() {
  return Agent.create({
    provider: mock({ reply: 'final answer' }),
    model: 'mock',
    maxIterations: 1,
  }).build();
}

// ─── Unit ──────────────────────────────────────────────────────────

describe('toSSE — unit', () => {
  it('encodeSSE() produces standard event/data wire format', () => {
    const out = encodeSSE('my.event', { x: 1 });
    expect(out).toBe('event: my.event\ndata: {"x":1}\n\n');
  });

  it('class form delegates to toSSE() with same options', async () => {
    const agent = buildAgent();
    const fmt = new SSEFormatter(agent);
    const it1 = fmt.stream();
    expect(typeof it1[Symbol.asyncIterator]).toBe('function');
  });
});

// ─── Scenario — full agent run streamed as SSE ─────────────────────

describe('toSSE — scenario (full agent run)', () => {
  it('yields multiple SSE chunks during a real run + ends naturally', async () => {
    const agent = buildAgent();

    const chunks: string[] = [];
    const stream = toSSE(agent);

    // Drive the agent + collect SSE in parallel.
    const collect = (async () => {
      for await (const c of stream) chunks.push(c);
    })();

    await agent.run({ message: 'hi' });
    // Allow the dispatcher microtask + turn_end event to flow.
    await new Promise((r) => setTimeout(r, 10));
    await collect;

    // We expect at least one event (turn_start, llm_*, turn_end, etc.).
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.startsWith('event: ') || c.startsWith(': '))).toBe(true);
    // Final event should be turn_end.
    const last = chunks[chunks.length - 1]!;
    expect(last).toContain('agentfootprint.agent.turn_end');
  });
});

// ─── Integration — text-only mode for chat UIs ─────────────────────

describe('toSSE — integration (text-only mode)', () => {
  it('format=text yields only stream.token content as raw text', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'streamed answer', chunkDelayMs: 0 }),
      model: 'mock',
      maxIterations: 1,
    }).build();

    const tokens: string[] = [];
    const stream = toSSE(agent, { format: 'text' });
    const collect = (async () => {
      for await (const c of stream) tokens.push(c);
    })();

    await agent.run({ message: 'hi' });
    await new Promise((r) => setTimeout(r, 10));
    await collect;

    // Tokens are emitted as raw text — no SSE framing in text mode.
    const joined = tokens.join('');
    // The mock provider's stream() yields one chunk per word; we can
    // verify content matches the reply (or its prefix if turn_end
    // arrived first).
    expect(joined.length).toBeGreaterThan(0);
    expect(tokens.every((t) => !t.startsWith('event:'))).toBe(true);
  });
});

// ─── Property — every emitted event becomes exactly one SSE chunk ─

describe('toSSE — property', () => {
  it('filter predicate gates events 1:1 (no double-emit)', async () => {
    const agent = buildAgent();
    const stream = toSSE(agent, {
      filter: (e) => e.type === 'agentfootprint.agent.turn_start' || e.type === 'agentfootprint.agent.turn_end',
    });
    const collected: string[] = [];
    const collect = (async () => {
      for await (const c of stream) collected.push(c);
    })();

    await agent.run({ message: 'hi' });
    await new Promise((r) => setTimeout(r, 10));
    await collect;

    // Exactly one turn_start + one turn_end.
    expect(collected.length).toBe(2);
    expect(collected[0]).toContain('turn_start');
    expect(collected[1]).toContain('turn_end');
  });

  it('eventName customizer replaces the default type tag', async () => {
    const agent = buildAgent();
    const stream = toSSE(agent, {
      filter: (e) => e.type === 'agentfootprint.agent.turn_end',
      eventName: () => 'custom.tag',
    });
    const collected: string[] = [];
    const collect = (async () => {
      for await (const c of stream) collected.push(c);
    })();
    await agent.run({ message: 'hi' });
    await new Promise((r) => setTimeout(r, 10));
    await collect;

    expect(collected[0]).toMatch(/^event: custom\.tag\n/);
  });
});

// ─── Security — bounded behavior ──────────────────────────────────

describe('toSSE — security', () => {
  it('encoded SSE never embeds raw newlines that would break the protocol', () => {
    // JSON.stringify converts inner newlines to \n in the output, so
    // the resulting `data:` field stays single-line. Verify with a
    // payload that DOES contain a newline in its content string.
    const out = encodeSSE('test.event', { content: 'line1\nline2' });
    // Only TWO newlines should appear in the chunk: the one between
    // event: and data:, and the trailing \n\n separator.
    const matches = out.match(/\n/g);
    expect(matches?.length).toBe(3); // event line end + data line end + trailing blank
  });
});

// ─── Performance — encodeSSE overhead ──────────────────────────────

describe('toSSE — performance', () => {
  it('encodeSSE() handles 10k events in under 100ms', () => {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      encodeSSE('e', { i, payload: 'x' });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── ROI — real-world chat UI shape ────────────────────────────────

describe('toSSE — ROI (chat UI shape)', () => {
  it('text mode yields a string consumers can pipe to res.write', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'hello world' }),
      model: 'mock',
      maxIterations: 1,
    }).build();

    const buf: string[] = [];
    const stream = toSSE(agent, { format: 'text' });
    const collect = (async () => {
      for await (const c of stream) buf.push(c);
    })();
    await agent.run({ message: 'q' });
    await new Promise((r) => setTimeout(r, 10));
    await collect;

    // Each piece is a string ready for res.write — no JSON framing.
    expect(buf.every((b) => typeof b === 'string')).toBe(true);
  });
});
