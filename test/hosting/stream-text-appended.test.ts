/**
 * toSSE({ format: 'text' }) — the reply reaches the reader whole.
 *
 * The library appends to an answer after the model's stream ends: the
 * standing line (`.answerLayer({ standingLine })`), the limits block
 * (`.limitsTravelWithTheAnswer()`). `stream.token` carries only the model's
 * words, so a text reply built from tokens alone dropped those lines. At the
 * turn's end the text format now writes what of the answer the reader was not
 * given yet — the same rule the AG-UI adapter asks (`hosting/unstreamedText.ts`).
 *
 * Sections: Scenario (streamed, both arms; not streamed) · Regression (nothing
 * appended; a filter that drops some tokens or all of them; a refused answer;
 * text on a tool turn) · Composition (only the outermost turn's end writes the
 * rest) · Redaction (the real answer, never the served one).
 */

import { describe, expect, it } from 'vitest';

import { absent, Agent, defineTool, Parallel, Sequence } from '../../src/index.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { mock } from '../../src/doors/providers.js';
import { toSSE, type ToSSEOptions } from '../../src/hosting/stream.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import type { MockReply } from '../../src/adapters/llm/MockProvider.js';

const lookup = defineTool({
  name: 'lookup',
  description: 'Count open orders.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'orders: 12 open',
});

const archive = defineTool({
  name: 'archive_lookup',
  description: 'Look an order up in the live store.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () =>
    absent({
      what: 'order 77',
      checked: ['the live store'],
      cannotCover: [{ what: 'the archive', why: 'not connected' }],
    }),
});

const call = (name: string) => ({ content: '', toolCalls: [{ id: 'c1', name, args: {} }] });

type Runnable = {
  run(input: { message: string }): Promise<unknown>;
  on(type: '*', listener: (event: AgentfootprintEvent) => void): () => void;
};

/** Run once, reading the text reply; returns the reply and the run's answer. */
async function textReply(
  agent: Runnable,
  options: ToSSEOptions = {},
): Promise<{ reply: string; chunks: string[]; answer: unknown }> {
  const chunks: string[] = [];
  const reading = (async () => {
    for await (const chunk of toSSE(agent, { format: 'text', ...options })) chunks.push(chunk);
  })();
  const answer = await agent.run({ message: 'How many orders?' });
  await reading;
  return { reply: chunks.join(''), chunks, answer };
}

const STREAMED = 'There are 4242 open orders.';

/** A provider with no `stream()`: no token at all, the answer comes whole. */
function completeOnly(...replies: MockReply[]): LLMProvider {
  const scripted = mock({ replies });
  return { name: scripted.name, complete: (request) => scripted.complete(request) };
}

describe('toSSE text — the appended text reaches the reader', () => {
  it('the standing line follows the streamed answer', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('lookup'), STREAMED] }),
      model: 'm',
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const { reply, answer } = await textReply(agent);
    expect(typeof answer).toBe('string');
    expect((answer as string).length).toBeGreaterThan(STREAMED.length);
    expect((answer as string).startsWith(STREAMED)).toBe(true);
    // What the person reads is the answer the run delivered, line included.
    expect(reply).toBe(answer);
  });

  it('the limits block follows the streamed answer', async () => {
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [call('archive_lookup'), 'Order 77 is not in the live store.'],
      }),
      model: 'm',
    })
      .tool(archive)
      .limitsTravelWithTheAnswer()
      .build();
    const { reply, answer } = await textReply(agent);
    expect(answer).toContain('the archive');
    expect(reply).toBe(answer);
  });

  it('an answer that streamed nothing is written whole, once', async () => {
    const agent = Agent.create({ provider: completeOnly(call('lookup'), STREAMED), model: 'm' })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const { reply, chunks, answer } = await textReply(agent);
    expect(reply).toBe(answer);
    expect(chunks).toHaveLength(1);
  });
});

describe('toSSE text — regression', () => {
  it('with nothing appended, the streamed answer is not written twice', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('lookup'), 'There are 12 open orders.'] }),
      model: 'm',
    })
      .tool(lookup)
      .build();
    const { reply, answer } = await textReply(agent);
    expect(answer).toBe('There are 12 open orders.');
    expect(reply).toBe('There are 12 open orders.');
  });

  it('a filter that drops some tokens gets no guessed rest — what it was given is not the answer’s start', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('lookup'), STREAMED] }),
      model: 'm',
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const even = (event: AgentfootprintEvent) =>
      event.type !== 'agentfootprint.stream.token' ||
      ((event.payload as { tokenIndex?: number }).tokenIndex ?? 0) % 2 === 0;
    const { reply, answer } = await textReply(agent, { filter: even });
    expect(reply.length).toBeGreaterThan(0);
    expect(reply.length).toBeLessThan(STREAMED.length);
    expect((answer as string).startsWith(reply)).toBe(false);
  });

  it('a filter that drops every token gets the whole answer — nothing was written, as when nothing streamed', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('lookup'), STREAMED] }),
      model: 'm',
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const noTokens = (event: AgentfootprintEvent) => event.type !== 'agentfootprint.stream.token';
    const { reply, chunks, answer } = await textReply(agent, { filter: noTokens });
    expect((answer as string).length).toBeGreaterThan(STREAMED.length);
    expect(reply).toBe(answer);
    expect(chunks).toHaveLength(1);
  });

  it('a refused answer adds nothing after what streamed, though its text extends it', async () => {
    // Under 'rails' an answer stating a value no tool result carried is refused:
    // turn_end marks it `refused` and run() raises. Its finalContent still
    // carries the limits block after the streamed words — it is not the answer.
    const answer = 'Order 77 is 4242.';
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('archive_lookup'), answer, answer] }),
      model: 'm',
    })
      .tool(archive)
      .namesAndNumbersFromEvidence({ posture: 'rails' })
      .limitsTravelWithTheAnswer()
      .build();
    const ends: { refused?: unknown; finalContent?: unknown }[] = [];
    agent.on('agentfootprint.agent.turn_end', (event) => {
      ends.push(event.payload as { refused?: unknown; finalContent?: unknown });
    });
    const chunks: string[] = [];
    const reading = (async () => {
      for await (const chunk of toSSE(agent, { format: 'text' })) chunks.push(chunk);
    })();
    await expect(agent.run({ message: 'Where is order 77?' })).rejects.toThrow();
    await reading;
    expect(ends).toHaveLength(1);
    expect(ends[0]?.refused).toEqual({ by: 'evidence-rails' });
    // The control: the refused text does extend what streamed…
    expect(String(ends[0]?.finalContent).startsWith(answer)).toBe(true);
    expect(String(ends[0]?.finalContent)).toContain('the archive');
    // …and none of it beyond the tokens reaches the reader.
    expect(chunks.join('')).toBe(answer + answer);
  });

  it('text streamed on a tool turn does not hide the rest of the answer', async () => {
    // The tool turn streams its own words; the answer is the LAST call's. What
    // was written is compared from the last llm_start, so the rest still comes.
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [{ ...call('lookup'), content: 'Let me look.' }, STREAMED],
      }),
      model: 'm',
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const { reply, answer } = await textReply(agent);
    expect((answer as string).length).toBeGreaterThan(STREAMED.length);
    expect(reply).toBe('Let me look.' + (answer as string));
  });
});

describe('toSSE text — composition: only the outermost turn writes the rest', () => {
  // The stream still ends at the FIRST agent's turn_end, inner or not (older
  // than this rule; README "Not covered"). That inner turn's answer is not the
  // run's answer, so an inner turn_end writes nothing more: these runs read as
  // they did before the rest was written at all.
  it('a Sequence whose providers do not stream writes nothing, not its first step', async () => {
    const sequence = Sequence.create({ name: 'steps' })
      .step('a', Agent.create({ provider: completeOnly('First step answer.'), model: 'm' }).build())
      .step(
        'b',
        Agent.create({ provider: completeOnly('Second step answer.'), model: 'm' }).build(),
      )
      .build();
    const { reply, answer } = await textReply(sequence);
    expect(answer).toBe('Second step answer.');
    expect(reply).toBe('');
  });

  it('a Parallel whose providers do not stream writes nothing, not its branches', async () => {
    const parallel = Parallel.create({ name: 'both' })
      .branch('a', Agent.create({ provider: completeOnly('Alpha.'), model: 'm' }).build())
      .branch('b', Agent.create({ provider: completeOnly('Beta.'), model: 'm' }).build())
      .mergeWithFn((results) => Object.values(results).join(' | '))
      .build();
    const { reply } = await textReply(parallel);
    expect(reply).toBe('');
  });

  it('a Sequence whose providers stream writes the first step’s tokens and nothing more', async () => {
    const sequence = Sequence.create({ name: 'steps' })
      .step(
        'a',
        Agent.create({
          provider: mock({ chunkDelayMs: 0, replies: ['First step answer.'] }),
          model: 'm',
        }).build(),
      )
      .step(
        'b',
        Agent.create({
          provider: mock({ chunkDelayMs: 0, replies: ['Second step answer.'] }),
          model: 'm',
        }).build(),
      )
      .build();
    const { reply } = await textReply(sequence);
    expect(reply).toBe('First step answer.');
  });
});

describe('toSSE text — redaction', () => {
  it.each(['inline', 'deferred'] as const)(
    'the rest is taken from the real answer, as the tokens are; the record stays served (%s)',
    async (observerDelivery) => {
      const secretAnswer = 'Order SECRET-ANSWER-5521 is not in the live store.';
      const agent = Agent.create({
        provider: mock({ chunkDelayMs: 0, replies: [call('archive_lookup'), secretAnswer] }),
        model: 'm',
        observerDelivery,
        redact: conversationRedaction(),
      })
        .tool(archive)
        .limitsTravelWithTheAnswer()
        .build();
      const served: string[] = [];
      agent.on('agentfootprint.agent.turn_end', (event) => {
        served.push(String((event.payload as { finalContent?: unknown }).finalContent));
      });
      const { reply, answer } = await textReply(agent);
      expect(answer).toContain('SECRET-ANSWER-5521');
      expect(answer).toContain('the archive');
      expect(reply).toBe(answer);
      // The policy did apply: the record's turn_end does not carry the answer.
      expect(served).toHaveLength(1);
      expect(served[0]).not.toContain('SECRET-ANSWER-5521');
    },
  );
});
