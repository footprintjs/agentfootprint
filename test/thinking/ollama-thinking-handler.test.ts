/**
 * ollamaThinkingHandler — normalization + the adapter plumbing that feeds it.
 *
 * Two situations, and the difference between them is the whole point:
 *   • ASKED (`think` on)  → Ollama lifts reasoning into `message.thinking`.
 *   • NOT ASKED           → the model leaves `<think>…</think>` in the answer,
 *                            and the library RECOGNIZES it without rewriting
 *                            the answer.
 */

import { describe, expect, it } from 'vitest';

import {
  ollamaThinkingHandler,
  extractInlineThinking,
} from '../../src/thinking/OllamaThinkingHandler.js';
import { findThinkingHandler, SHIPPED_THINKING_HANDLERS } from '../../src/thinking/registry.js';
import { ollama } from '../../src/adapters/llm/OllamaProvider.js';
import type { LLMRequest } from '../../src/adapters/types.js';

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'deepseek-r1',
};

function jsonFetch(body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch;
}

function ndjsonFetch(frames: readonly unknown[]): typeof fetch {
  const text = frames.map((f) => `${JSON.stringify(f)}\n`).join('');
  return (() => Promise.resolve(new Response(text, { status: 200 }))) as unknown as typeof fetch;
}

// ─── Registry ───────────────────────────────────────────────────────

describe('ollamaThinkingHandler — unit: registry wiring', () => {
  it('auto-wires by provider name', () => {
    expect(findThinkingHandler('ollama')).toBe(ollamaThinkingHandler);
  });

  it('is in the shipped list', () => {
    expect(SHIPPED_THINKING_HANDLERS).toContain(ollamaThinkingHandler);
  });

  it('declares an id and the provider it serves', () => {
    expect(ollamaThinkingHandler.id).toBe('ollama');
    expect(ollamaThinkingHandler.providerNames).toEqual(['ollama']);
  });
});

// ─── normalize ──────────────────────────────────────────────────────

describe('ollamaThinkingHandler — unit: normalize', () => {
  it('normalizes the structured field into one block', () => {
    const blocks = ollamaThinkingHandler.normalize({
      kind: 'field',
      thinking: 'First I check the units.',
    });
    expect(blocks).toEqual([{ type: 'thinking', content: 'First I check the units.' }]);
  });

  it('normalizes inline tags into one block per tag', () => {
    const blocks = ollamaThinkingHandler.normalize({
      kind: 'inline',
      content: '<think>step one</think>answer<think>step two</think>',
    });
    expect(blocks.map((b) => b.content)).toEqual(['step one', 'step two']);
  });

  it('handles a truncated answer whose <think> never closed', () => {
    const blocks = ollamaThinkingHandler.normalize({
      kind: 'inline',
      content: '<think>I was cut off mid-',
    });
    expect(blocks).toEqual([{ type: 'thinking', content: 'I was cut off mid-' }]);
  });

  it('accepts a bare string — a hand-fed or third-party value', () => {
    expect(ollamaThinkingHandler.normalize('raw reasoning')).toEqual([
      { type: 'thinking', content: 'raw reasoning' },
    ]);
  });

  it('signs nothing — this wire has no signatures to round-trip', () => {
    const blocks = ollamaThinkingHandler.normalize({ kind: 'field', thinking: 'x' });
    expect(blocks[0]!.signature).toBeUndefined();
  });

  it('never claims to be a summary — this is raw reasoning', () => {
    const blocks = ollamaThinkingHandler.normalize({ kind: 'field', thinking: 'x' });
    expect(blocks[0]!.summary).toBeUndefined();
  });

  it('never marks anything redacted — only Anthropic redacts', () => {
    const blocks = ollamaThinkingHandler.normalize({ kind: 'field', thinking: 'x' });
    expect(blocks.every((b) => b.type === 'thinking')).toBe(true);
  });

  it('empty and absent inputs produce no blocks', () => {
    expect(ollamaThinkingHandler.normalize(undefined)).toEqual([]);
    expect(ollamaThinkingHandler.normalize(null)).toEqual([]);
    expect(ollamaThinkingHandler.normalize('')).toEqual([]);
    expect(ollamaThinkingHandler.normalize('   ')).toEqual([]);
    expect(ollamaThinkingHandler.normalize({ kind: 'field', thinking: '' })).toEqual([]);
    expect(ollamaThinkingHandler.normalize({ kind: 'inline', content: 'no tags here' })).toEqual(
      [],
    );
  });

  it('an unknown shape yields empty rather than throwing (forward-compat)', () => {
    expect(ollamaThinkingHandler.normalize({ kind: 'martian', payload: 1 })).toEqual([]);
    expect(ollamaThinkingHandler.normalize(42)).toEqual([]);
    expect(ollamaThinkingHandler.normalize([1, 2])).toEqual([]);
    expect(ollamaThinkingHandler.normalize({ thinking: 'untagged object' })).toEqual([]);
  });

  it('parseChunk lifts a streamed thinking delta', () => {
    expect(ollamaThinkingHandler.parseChunk!({ message: { thinking: 'mm' } })).toEqual({
      thinkingDelta: 'mm',
    });
    expect(ollamaThinkingHandler.parseChunk!({ message: { content: 'hi' } })).toEqual({});
    expect(ollamaThinkingHandler.parseChunk!(null)).toEqual({});
  });
});

describe('extractInlineThinking — unit', () => {
  it('is reusable and stateless across calls', () => {
    const text = '<think>a</think>x<think>b</think>';
    expect(extractInlineThinking(text)).toEqual(['a', 'b']);
    expect(extractInlineThinking(text)).toEqual(['a', 'b']); // no lastIndex carry-over
  });

  it('returns nothing for text with no tags', () => {
    expect(extractInlineThinking('plain answer')).toEqual([]);
  });
});

// ─── Adapter plumbing ───────────────────────────────────────────────

describe('ollamaThinkingHandler — scenario: what the adapter hands it', () => {
  it('the structured field arrives tagged as `field`', async () => {
    const p = ollama('deepseek-r1', {
      think: true,
      _fetch: jsonFetch({
        message: { role: 'assistant', content: '42', thinking: 'six times seven' },
        done: true,
        done_reason: 'stop',
      }),
    });
    const res = await p.complete(baseRequest);
    expect(res.rawThinking).toEqual({ kind: 'field', thinking: 'six times seven' });
    expect(ollamaThinkingHandler.normalize(res.rawThinking)).toEqual([
      { type: 'thinking', content: 'six times seven' },
    ]);
  });

  it('inline tags arrive tagged as `inline` — with the answer UNCHANGED', async () => {
    const answer = '<think>six times seven</think>42';
    const p = ollama('deepseek-r1', {
      _fetch: jsonFetch({
        message: { role: 'assistant', content: answer },
        done: true,
        done_reason: 'stop',
      }),
    });
    const res = await p.complete(baseRequest);
    // THE INVARIANT: recognized, never rewritten. Editing a model's answer
    // behind its back is a meaning change, and it is not the library's call.
    expect(res.content).toBe(answer);
    expect(res.rawThinking).toEqual({ kind: 'inline', content: answer });
    expect(ollamaThinkingHandler.normalize(res.rawThinking)).toEqual([
      { type: 'thinking', content: 'six times seven' },
    ]);
  });

  it('the structured field wins when both are somehow present', async () => {
    const p = ollama('deepseek-r1', {
      _fetch: jsonFetch({
        message: { role: 'assistant', content: '<think>stale</think>42', thinking: 'fresh' },
        done: true,
      }),
    });
    const res = await p.complete(baseRequest);
    expect(res.rawThinking).toEqual({ kind: 'field', thinking: 'fresh' });
  });

  it('a plain answer carries no rawThinking at all', async () => {
    const p = ollama('llama3.2', {
      _fetch: jsonFetch({ message: { role: 'assistant', content: '42' }, done: true }),
    });
    expect((await p.complete(baseRequest)).rawThinking).toBeUndefined();
  });

  it('streaming emits thinkingDelta live and reassembles the whole reasoning', async () => {
    const p = ollama('deepseek-r1', {
      think: 'high',
      _fetch: ndjsonFetch([
        { message: { role: 'assistant', content: '', thinking: 'six ' }, done: false },
        { message: { role: 'assistant', content: '', thinking: 'times seven' }, done: false },
        { message: { role: 'assistant', content: '42' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ]),
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);

    expect(chunks.filter((c) => c.thinkingDelta).map((c) => c.thinkingDelta)).toEqual([
      'six ',
      'times seven',
    ]);
    const final = chunks.at(-1)!.response!;
    expect(final.content).toBe('42'); // reasoning is NOT in the answer here
    expect(final.rawThinking).toEqual({ kind: 'field', thinking: 'six times seven' });
  });

  it('thinking deltas never leak into the answer text', async () => {
    const p = ollama('deepseek-r1', {
      think: true,
      _fetch: ndjsonFetch([
        { message: { role: 'assistant', content: '', thinking: 'secret reasoning' }, done: false },
        { message: { role: 'assistant', content: 'answer' }, done: true, done_reason: 'stop' },
      ]),
    });
    const chunks = [];
    for await (const c of p.stream!(baseRequest)) chunks.push(c);
    expect(chunks.map((c) => c.content).join('')).toBe('answer');
    expect(chunks.at(-1)!.response!.content).toBe('answer');
  });
});

// ─── Property / security ────────────────────────────────────────────

describe('ollamaThinkingHandler — property: never throws', () => {
  it('survives arbitrary junk', () => {
    const junk: unknown[] = [
      undefined,
      null,
      0,
      -1,
      NaN,
      '',
      'x'.repeat(10_000),
      [],
      [null],
      {},
      { kind: null },
      { kind: 'field' },
      { kind: 'field', thinking: 123 },
      { kind: 'inline' },
      { kind: 'inline', content: 456 },
      { kind: 'inline', content: '<think>'.repeat(200) },
      new Date(),
      () => 'nope',
    ];
    for (const raw of junk) {
      expect(() => ollamaThinkingHandler.normalize(raw)).not.toThrow();
      expect(Array.isArray(ollamaThinkingHandler.normalize(raw))).toBe(true);
    }
  });

  it('every produced block has a string content', () => {
    const blocks = ollamaThinkingHandler.normalize({
      kind: 'inline',
      content: '<think>a</think><think></think><think> b </think>',
    });
    for (const b of blocks) {
      expect(typeof b.content).toBe('string');
      expect(b.content.length).toBeGreaterThan(0);
    }
  });
});

describe('ollamaThinkingHandler — security', () => {
  it('attaches no providerMeta — nothing to leak into an audit log', () => {
    const blocks = ollamaThinkingHandler.normalize({ kind: 'field', thinking: 'x' });
    expect(blocks[0]!.providerMeta).toBeUndefined();
  });
});
