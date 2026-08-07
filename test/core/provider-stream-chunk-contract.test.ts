/**
 * A provider is a port anyone can implement — so its contract teaches (8.18.0).
 *
 * `LLMProvider` is three fields, and the streaming half is a generator of
 * `{ tokenIndex, content, done }` whose LAST chunk carries the authoritative
 * `response`. The commonest way to get that wrong is to end the stream with a
 * marker of one's own — `{ type: 'done', response }` — which is not seen as
 * terminal, so it is read as a token chunk with no `content`.
 *
 * Through 8.17.0 that died on `chunk.content.length` as
 * `TypeError: Cannot read properties of undefined (reading 'length')`, naming
 * neither the provider nor the contract. It is the same disease as an
 * undefined message content, one layer out: an untrusted implementation hands
 * in a hole, and the crash lands somewhere that cannot explain it.
 *
 * Seven patterns, in the house order (property/security fold into boundary
 * here — there is one field and one law).
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import type { LLMChunk, LLMProvider, LLMResponse } from '../../src/adapters/types.js';

const RESPONSE: LLMResponse = {
  content: 'hello there',
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 2 },
};

function streamingProvider(chunks: readonly unknown[]): LLMProvider {
  return {
    name: 'homemade',
    complete: async (): Promise<LLMResponse> => RESPONSE,
    // eslint-disable-next-line @typescript-eslint/require-await
    stream: async function* (): AsyncGenerator<LLMChunk> {
      for (const c of chunks) yield c as LLMChunk;
    },
  };
}

const runWith = (chunks: readonly unknown[]): Promise<unknown> =>
  Agent.create({ provider: streamingProvider(chunks), model: 'm' })
    .build()
    .run('hi');

// ─── 1. UNIT / 2. BOUNDARY ────────────────────────────────────────

describe('provider stream chunks — boundary', () => {
  it('a well-formed stream runs, and the tokens reach the consumer', async () => {
    const agent = Agent.create({
      provider: streamingProvider([
        { tokenIndex: 0, content: 'hello ', done: false },
        { tokenIndex: 1, content: 'there', done: false },
        { tokenIndex: 2, content: '', done: true, response: RESPONSE },
      ]),
      model: 'm',
    }).build();
    const tokens: string[] = [];
    agent.on('agentfootprint.stream.token', (e) =>
      tokens.push((e.payload as { content: string }).content),
    );
    expect(await agent.run('hi')).toBe('hello there');
    expect(tokens.join('')).toBe('hello there');
  });

  it('refuses a chunk with no content, naming the provider and the shape', async () => {
    await expect(runWith([{ type: 'done', response: RESPONSE }])).rejects.toThrow(
      /provider 'homemade' yielded a stream chunk whose `content` is missing/,
    );
  });

  it('the refusal states what the TERMINAL chunk looks like — the usual mistake', async () => {
    await expect(runWith([{ type: 'done', response: RESPONSE }])).rejects.toThrow(
      /\{ content: '', done: true, response \}/,
    );
  });

  it('names a non-string content by type', async () => {
    await expect(runWith([{ tokenIndex: 0, content: 42, done: false }])).rejects.toThrow(
      /whose `content` is a number/,
    );
  });

  it('an empty-content non-terminal chunk is legal and emits nothing', async () => {
    const agent = Agent.create({
      provider: streamingProvider([
        { tokenIndex: 0, content: '', done: false },
        { tokenIndex: 1, content: 'hello there', done: false },
        { tokenIndex: 2, content: '', done: true, response: RESPONSE },
      ]),
      model: 'm',
    }).build();
    let tokens = 0;
    agent.on('agentfootprint.stream.token', () => (tokens += 1));
    expect(await agent.run('hi')).toBe('hello there');
    expect(tokens).toBe(1);
  });

  it('a terminal chunk with no response still falls back to complete() — unchanged', async () => {
    // The documented allowance for older providers: yield text, end with
    // `done: true`, and the authoritative payload comes from `complete()`.
    expect(
      await runWith([
        { tokenIndex: 0, content: 'hello there', done: false },
        { tokenIndex: 1, content: '', done: true },
      ]),
    ).toBe('hello there');
  });
});
