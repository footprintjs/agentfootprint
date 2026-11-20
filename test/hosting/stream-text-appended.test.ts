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

import { describe, expect, it, vi } from 'vitest';

import {
  absent,
  Agent,
  defineTool,
  isPaused,
  Parallel,
  Sequence,
  type AgentOptions,
} from '../../src/index.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { mock } from '../../src/doors/providers.js';
import { encodeSSE, toSSE, type ToSSEOptions } from '../../src/hosting/stream.js';
import { runnerLive } from '../../src/core/runnerLive.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import type { MockReply } from '../../src/adapters/llm/MockProvider.js';
import {
  approval,
  call,
  DRAFT,
  mountReport,
  readWithHeartbeat,
  REPORT,
  reportBuilder,
  TURN_END,
  WARNING,
} from './fixtures/streamReport.js';

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

const REPORT_CHUNKS = ['The ', 'report ', 'is ', 'ready.', WARNING];
const DRAFT_CHUNKS = ['The ', 'draft ', 'is ', 'ready.'];

function nestedReport(pause: boolean, observerDelivery?: AgentOptions['observerDelivery']) {
  const child = reportBuilder(DRAFT, pause).build();
  return { agent: mountReport(child, { observerDelivery }), child };
}

type Runnable = {
  run(input: { message: string }): Promise<unknown>;
  on(type: '*', listener: (event: AgentfootprintEvent) => void): () => void;
};

async function readText(
  agent: Pick<Runnable, 'on'>,
  options: ToSSEOptions = {},
): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of toSSE(agent, { format: 'text', ...options })) chunks.push(chunk);
  return chunks;
}

/** Run once, reading the text reply; returns the reply and the run's answer. */
async function textReply(
  agent: Runnable,
  options: ToSSEOptions = {},
): Promise<{ reply: string; chunks: string[]; answer: unknown }> {
  const reading = readText(agent, options);
  const answer = await agent.run({ message: 'How many orders?' });
  const chunks = await reading;
  return { reply: chunks.join(''), chunks, answer };
}

const STREAMED = 'There are 4242 open orders.';

/** A provider with no `stream()`: no token at all, the answer comes whole. */
function completeOnly(...replies: MockReply[]): LLMProvider {
  const scripted = mock({ replies });
  return { name: scripted.name, complete: (request) => scripted.complete(request) };
}

const noTurnStarts = (event: AgentfootprintEvent) =>
  event.type !== 'agentfootprint.agent.turn_start';

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

  it('an older record still gets the whole answer when its root start is filtered out', async () => {
    const agent = Agent.create({ provider: completeOnly('Root answer.'), model: 'm' }).build();
    const runner: Runnable = {
      run: (input) => agent.run(input),
      on: (_pattern, listener) =>
        agent.on('*', (event) => {
          const meta = { ...event.meta };
          delete meta.rootTurn;
          listener({ ...event, meta });
        }),
    };
    const { reply } = await textReply(runner, { filter: noTurnStarts });
    expect(reply).toBe('Root answer.');
  });

  it('a runner without event metadata is treated as the root', async () => {
    const agent = Agent.create({ provider: completeOnly('Root answer.'), model: 'm' }).build();
    const runner: Runnable = {
      run: (input) => agent.run(input),
      on: (_pattern, listener) =>
        agent.on('agentfootprint.agent.turn_end', ({ type, payload }) => {
          listener({ type, payload } as AgentfootprintEvent);
        }),
    };
    const { reply } = await textReply(runner);
    expect(reply).toBe('Root answer.');
  });
});

describe('toSSE text — regression', () => {
  it.each(['text', 'full'] as const)(
    'a fresh %s stream closes with a token-only filter',
    async (format) => {
      const agent = reportBuilder(REPORT, false).build();
      const readAfterDrain = readWithHeartbeat(agent, {
        format,
        filter: (event) => event.type === 'agentfootprint.stream.token',
      });
      try {
        expect(await agent.run({ message: 'Is the report ready?' })).toBe(REPORT + WARNING);
        await agent.drainObservers();
        const { closed, chunks } = await readAfterDrain();
        expect(closed).toBe(true);
        const tokens = REPORT_CHUNKS.slice(0, -1);
        if (format === 'text') {
          expect(chunks).toEqual(tokens);
        } else {
          expect(chunks).toHaveLength(tokens.length);
          chunks.forEach((chunk, i) => {
            expect(chunk).toMatch(/^event: agentfootprint\.stream\.token\n/);
            expect(chunk).toContain(`"content":${JSON.stringify(tokens[i])}`);
          });
        }
      } finally {
        await readAfterDrain();
        await agent.shutdown();
      }
    },
  );

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

  it('a filter that leaves a gap in the answer gets no guessed rest', async () => {
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

  it('a filter that drops only the last token gets it back with the appended text', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('lookup'), STREAMED] }),
      model: 'm',
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const { reply, chunks, answer } = await textReply(agent, {
      filter: (event) =>
        event.type !== 'agentfootprint.stream.token' || event.payload.content !== 'orders.',
    });
    expect((answer as string).length).toBeGreaterThan(STREAMED.length);
    expect(reply).toBe(answer);
    expect(chunks).not.toContain('orders.');
    expect(chunks.at(-1)).toBe((answer as string).slice('There are 4242 open '.length));
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
    const reading = readText(agent);
    await expect(agent.run({ message: 'Where is order 77?' })).rejects.toThrow();
    const chunks = await reading;
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
  // Standalone compositions keep closing at the first turn_end. An inner end
  // has no owning Agent answer to append to the stream.
  it.each([
    ['with all events', undefined],
    ['with turn starts filtered out', noTurnStarts],
  ] as const)('a non-streaming Sequence writes no text %s', async (_label, filter) => {
    const sequence = Sequence.create({ name: 'steps' })
      .step('a', Agent.create({ provider: completeOnly('First step answer.'), model: 'm' }).build())
      .step(
        'b',
        Agent.create({ provider: completeOnly('Second step answer.'), model: 'm' }).build(),
      )
      .build();
    const { reply, answer } = await textReply(sequence, filter === undefined ? {} : { filter });
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

  it('a streaming Sequence closes both formats at its first step end', async () => {
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
    const events: AgentfootprintEvent[] = [];
    const off = sequence.on('*', (event) => events.push(event));
    const readAfterDrain = readWithHeartbeat(sequence, { format: 'text' });
    const readFullAfterDrain = readWithHeartbeat(sequence, { format: 'full' });
    try {
      expect(await sequence.run({ message: 'Run both steps.' })).toBe('Second step answer.');
      expect(events.filter((event) => event.meta.mountedTurn !== undefined)).toEqual([]);
      expect(await readAfterDrain()).toEqual({
        closed: true,
        chunks: ['First ', 'step ', 'answer.'],
      });
      const firstEnd = events.findIndex((event) => event.type === TURN_END);
      expect(events[firstEnd]).toMatchObject({
        type: TURN_END,
        payload: { finalContent: 'First step answer.' },
      });
      expect(await readFullAfterDrain()).toEqual({
        closed: true,
        chunks: events.slice(0, firstEnd + 1).map((event) => encodeSSE(event.type, event)),
      });
    } finally {
      off();
      await Promise.all([readAfterDrain(), readFullAfterDrain()]);
      await sequence.shutdown();
    }
  });

  it.each(['inline', 'deferred'] as const)(
    'a fresh stream writes only the mounting Agent answer and suffix (%s)',
    async (observerDelivery) => {
      const { agent, child } = nestedReport(false, observerDelivery);
      const readAfterDrain = readWithHeartbeat(agent, { format: 'text' });
      try {
        expect(await agent.run({ message: 'Is the report ready?' })).toBe(REPORT + WARNING);
        await agent.drainObservers();
        expect(await readAfterDrain()).toEqual({ closed: true, chunks: REPORT_CHUNKS });
      } finally {
        await readAfterDrain();
        await Promise.all([agent.shutdown(), child.shutdown()]);
      }
    },
  );

  it('text format keeps the owning Agent tokens from its dynamic LLM subflow', async () => {
    const agent = reportBuilder(REPORT, false, { reactMode: 'dynamic-grouped' }).build();
    const paths: (readonly string[])[] = [];
    const off = agent.on('agentfootprint.stream.token', (event) =>
      paths.push(event.meta.subflowPath),
    );
    const readAfterDrain = readWithHeartbeat(agent, { format: 'text' });
    try {
      expect(await agent.run({ message: 'Is the report ready?' })).toBe(REPORT + WARNING);
      await agent.drainObservers();
      expect(paths).toHaveLength(REPORT_CHUNKS.length - 1);
      expect(paths.every((path) => path.includes('sf-llm-call'))).toBe(true);
      expect(await readAfterDrain()).toEqual({ closed: true, chunks: REPORT_CHUNKS });
    } finally {
      off();
      await readAfterDrain();
      await agent.shutdown();
    }
  });

  it.each(['inline', 'deferred'] as const)(
    'a stream retained across a mounted Agent pause writes only the root answer and suffix (%s)',
    async (observerDelivery) => {
      const { agent, child } = nestedReport(true, observerDelivery);
      const readAfterDrain = readWithHeartbeat(agent, { format: 'text' });
      try {
        const paused = await agent.run({ message: 'Is the report ready?' });
        if (!isPaused(paused)) throw new Error('Expected the specialist to pause the run');
        await agent.drainObservers();
        expect(await agent.resume(paused.checkpoint, { approved: true })).toBe(REPORT + WARNING);
        await agent.drainObservers();
        expect(await readAfterDrain()).toEqual({ closed: true, chunks: REPORT_CHUNKS });
      } finally {
        await readAfterDrain();
        await Promise.all([agent.shutdown(), child.shutdown()]);
      }
    },
  );

  it('an older nested event port without turn markers writes the draft and closes at its first turn end', async () => {
    const { agent, child } = nestedReport(false);
    const runner: Pick<Runnable, 'on'> = {
      on: (pattern, listener) =>
        agent.on(pattern, (event) => {
          const meta = { ...event.meta };
          delete meta.rootTurn;
          delete meta.mountedTurn;
          listener({ ...event, meta });
        }),
    };
    const readAfterDrain = readWithHeartbeat(runner, { format: 'text' });
    try {
      expect(await agent.run({ message: 'Is the report ready?' })).toBe(REPORT + WARNING);
      await agent.drainObservers();
      expect(await readAfterDrain()).toEqual({ closed: true, chunks: DRAFT_CHUNKS });
    } finally {
      await readAfterDrain();
      await Promise.all([agent.shutdown(), child.shutdown()]);
    }
  });
});

describe('toSSE full — mounted Agents', () => {
  it.each([
    ['fresh', false],
    ['opened on resume', false],
    ['retained across a pause', false],
    ['fresh', true],
  ] as const)(
    'carries both Agents through the owning end (%s, token-only filter: %s)',
    async (when, tokensOnly) => {
      const { agent, child } = nestedReport(when !== 'fresh');
      const events: AgentfootprintEvent[] = [];
      const off = agent.on('*', (event) => events.push(event));
      const realTap = vi.spyOn(runnerLive(agent)!, 'onRealEvent');
      const startReading = () =>
        readWithHeartbeat(agent, {
          format: 'full',
          filter: (event) => !tokensOnly || event.type === 'agentfootprint.stream.token',
        });
      let readAfterDrain = when === 'opened on resume' ? undefined : startReading();
      try {
        const outcome = await agent.run({ message: 'Is the report ready?' });
        if (when === 'fresh') {
          expect(outcome).toBe(REPORT + WARNING);
        } else {
          if (!isPaused(outcome)) throw new Error('Expected the specialist to pause the run');
          await agent.drainObservers();
          if (when === 'opened on resume') {
            events.length = 0;
            readAfterDrain = startReading();
          }
          expect(await agent.resume(outcome.checkpoint, { approved: true })).toBe(REPORT + WARNING);
        }
        await agent.drainObservers();
        expect(realTap).not.toHaveBeenCalled();
        if (!readAfterDrain) throw new Error('The full stream was not opened');
        const { closed, chunks } = await readAfterDrain();
        expect(closed).toBe(true);

        const ends = events.filter((event) => event.type === TURN_END);
        expect(ends.map((event) => [event.meta.rootTurn, event.payload.finalContent])).toEqual([
          [undefined, DRAFT + WARNING],
          [true, REPORT + WARNING],
        ]);
        const rootEnd = ends[1]!;
        const expectedEvents = events.slice(0, events.indexOf(rootEnd) + 1);
        const tokens = expectedEvents.filter(
          (event) => event.type === 'agentfootprint.stream.token',
        );
        expect(tokens.map((event) => event.payload.content)).toEqual([
          ...DRAFT_CHUNKS,
          ...REPORT_CHUNKS.slice(0, -1),
        ]);
        if (!tokensOnly) {
          expect(chunks.at(-1)).toBe(encodeSSE(TURN_END, rootEnd));
          expect(chunks.filter((chunk) => chunk.startsWith(`event: ${TURN_END}\n`))).toEqual(
            ends.map((event) => encodeSSE(event.type, event)),
          );
        }
        expect(chunks).toEqual(
          (tokensOnly ? tokens : expectedEvents).map((event) => encodeSSE(event.type, event)),
        );
      } finally {
        realTap.mockRestore();
        off();
        await readAfterDrain?.();
        await Promise.all([agent.shutdown(), child.shutdown()]);
      }
    },
  );
});

describe('toSSE text — resume', () => {
  it('a text stream opened after the question delivers the same chunks as a fresh turn', async () => {
    const fresh = await textReply(reportBuilder(REPORT, false).build());
    expect(fresh.answer).toBe(REPORT + WARNING);
    expect(fresh.chunks).toEqual(REPORT_CHUNKS);

    const agent = reportBuilder(REPORT, true).build();
    const paused = await agent.run({ message: 'Is the report ready?' });
    if (!isPaused(paused)) throw new Error('Expected the approval tool to pause the run');

    const reading = readText(agent);
    expect(await agent.resume(paused.checkpoint, { approved: true })).toBe(fresh.answer);
    expect(await reading).toEqual(fresh.chunks);
  });

  it.each(['a two-agent Sequence', 'a lone agent'] as const)(
    'resuming %s writes only an owning Agent answer if no tokens streamed',
    async (shape) => {
      const first = Agent.create({
        provider: completeOnly(call('ask_approval'), 'Approved.'),
        model: 'm',
      })
        .tool(approval)
        .build();
      const composed = shape === 'a two-agent Sequence';
      const runner = composed
        ? Sequence.create()
            .step('approve', first)
            .step(
              'report',
              Agent.create({
                provider: mock({ chunkDelayMs: 0, replies: ['Report complete.'] }),
                model: 'm',
              }).build(),
            )
            .build()
        : first;
      const paused = await runner.run({ message: 'Approve the report.' });
      if (!isPaused(paused)) throw new Error('Expected the approval tool to pause the run');

      const turnAnswers: string[] = [];
      const off = runner.on('agentfootprint.agent.turn_end', (event) => {
        turnAnswers.push(event.payload.finalContent);
      });
      try {
        const reading = readText(runner);
        const answer = await runner.resume(paused.checkpoint, { approved: true });
        expect(answer).toBe(composed ? 'Report complete.' : 'Approved.');
        expect(turnAnswers[0]).toBe('Approved.');
        expect(await reading).toEqual(composed ? [] : ['Approved.']);
      } finally {
        off();
      }
    },
  );

  it.each([
    { observerDelivery: 'inline', dropRoot: false },
    { observerDelivery: 'inline', dropRoot: true },
    { observerDelivery: 'deferred', dropRoot: false },
    { observerDelivery: 'deferred', dropRoot: true },
  ] as const)(
    'a nested resume writes only the root answer and closes ($observerDelivery, filter root end: $dropRoot)',
    async ({ observerDelivery, dropRoot }) => {
      const { agent, child } = nestedReport(true, observerDelivery);
      const paused = await agent.run({ message: 'Is the report ready?' });
      if (!isPaused(paused)) throw new Error('Expected the specialist to pause the run');
      await agent.drainObservers();

      const ends: unknown[] = [];
      const readAfterDrain = readWithHeartbeat(agent, {
        format: 'text',
        filter: (event) => {
          if (event.type !== 'agentfootprint.agent.turn_end') return true;
          ends.push({ root: event.meta.rootTurn, answer: event.payload.finalContent });
          return !(dropRoot && event.meta.rootTurn === true);
        },
      });
      try {
        expect(await agent.resume(paused.checkpoint, { approved: true })).toBe(REPORT + WARNING);
        await agent.drainObservers();
        expect(ends).toEqual([
          { root: undefined, answer: DRAFT + WARNING },
          { root: true, answer: REPORT + WARNING },
        ]);
        const rootChunks = dropRoot ? REPORT_CHUNKS.slice(0, -1) : REPORT_CHUNKS;
        expect(await readAfterDrain()).toEqual({ closed: true, chunks: rootChunks });
      } finally {
        await readAfterDrain();
        await Promise.all([agent.shutdown(), child.shutdown()]);
      }
    },
  );

  it('does not append a refused answer after the question', async () => {
    const draft = 'Order 77 is 4242.';
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [call('archive_lookup'), call('ask_approval', 'c2'), draft, draft],
      }),
      model: 'm',
    })
      .tool(archive)
      .tool(approval)
      .namesAndNumbersFromEvidence({ posture: 'rails' })
      .limitsTravelWithTheAnswer()
      .build();
    const paused = await agent.run({ message: 'Where is order 77?' });
    if (!isPaused(paused)) throw new Error('Expected the approval tool to pause the run');

    const reading = readText(agent);
    await expect(agent.resume(paused.checkpoint, { approved: true })).rejects.toThrow();
    expect((await reading).join('')).toBe(draft + draft);
  });

  it.each(['inline', 'deferred'] as const)(
    'uses the real value for the resumed text and serves the record under redaction (%s)',
    async (observerDelivery) => {
      const agent = reportBuilder(REPORT, true, {
        observerDelivery,
        redact: conversationRedaction(),
      }).build();
      const paused = await agent.run({ message: 'Is the report ready?' });
      if (!isPaused(paused)) throw new Error('Expected the approval tool to pause the run');

      const seen: AgentfootprintEvent[] = [];
      const reading = readText(agent, {
        filter: (event) => {
          seen.push(event);
          return true;
        },
      });
      const record = readText(agent, { format: 'full' });
      expect(await agent.resume(paused.checkpoint, { approved: true })).toBe(REPORT + WARNING);
      expect(await reading).toEqual(REPORT_CHUNKS);
      expect(seen.filter((event) => event.type === 'agentfootprint.stream.token')).toEqual(
        REPORT_CHUNKS.slice(0, -1).map(() =>
          expect.objectContaining({ payload: expect.objectContaining({ content: '[REDACTED]' }) }),
        ),
      );
      const end = seen.find((event) => event.type === 'agentfootprint.agent.turn_end');
      expect(end).toMatchObject({
        meta: { rootTurn: true },
        payload: { finalContent: '[REDACTED]' },
      });
      const recordText = (await record).join('');
      expect(recordText).toContain('"finalContent":"[REDACTED]"');
      expect(recordText).not.toContain(REPORT);
      expect(recordText).not.toContain(WARNING);
    },
  );
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
