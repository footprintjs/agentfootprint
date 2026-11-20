/**
 * TEXT THE LIBRARY APPENDS — the standing line (`.answerLayer({ standingLine })`)
 * and the limits block (`.limitsTravelWithTheAnswer()`) reach an AG-UI
 * frontend's text, streamed or not.
 *
 * Both are appended to the answer after the model's stream ended, so
 * `stream.token` carries only the model's words (the documented contract).
 * An AG-UI frontend reads only TEXT_MESSAGE_* events: the serializer writes the
 * rest of `turn_end.finalContent` — what the stream did not carry — as its own
 * message, so the person reads the line the app turned on.
 *
 * Sections: Scenario (streamed, both arms) · Regression (not streamed, no arm,
 * a rewritten answer).
 */

import { describe, expect, it } from 'vitest';

import {
  absent,
  Agent,
  defineTool,
  isPaused,
  pauseHere,
  Sequence,
  type RedactionPolicy,
} from '../../src/index.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { mock } from '../../src/llm-providers.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { replayThroughClient, runAsAgUi } from './helpers.js';

const only = <T extends AgUiEvent['type']>(events: readonly AgUiEvent[], type: T) =>
  events.filter((e): e is Extract<AgUiEvent, { type: T }> => e.type === type);

/** Every text delta on the wire, in order — what the person reads. */
const wireText = (events: readonly AgUiEvent[]): string =>
  only(events, 'TEXT_MESSAGE_CONTENT')
    .map((e) => e.delta)
    .join('');

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

const pendingReport = defineTool({
  name: 'pending_report',
  description: 'Check whether the report is ready.',
  inputSchema: { type: 'object' },
  execute: () => ({ content: 'Queued.', effects: [], status: 'pending' }),
});

const approval = defineTool({
  name: 'approval',
  description: 'Ask the reader whether to continue.',
  inputSchema: { type: 'object' },
  execute: () => pauseHere({ question: 'Continue?' }),
});

const REPORT = 'The report is ready.';
const WARNING = '\n\n---\n\nNot sure — a tool reported unfinished work.';

function reportAgent(delivery: 'streamed' | 'complete-only', redact?: RedactionPolicy) {
  const scripted = mock({
    chunkDelayMs: 0,
    replies: [
      call('pending_report'),
      { toolCalls: [{ id: 'c2', name: 'approval', args: {} }] },
      REPORT,
    ],
  });
  const provider: LLMProvider =
    delivery === 'streamed'
      ? scripted
      : { name: scripted.name, complete: (request) => scripted.complete(request) };
  return Agent.create({
    provider,
    model: 'm',
    ...(redact !== undefined && { redact }),
  })
    .tool(pendingReport)
    .tool(approval)
    .answerLayer({ standingLine: true })
    .build();
}

/** The answer the run delivered, as `turn_end` carried it. */
function finalContentOf(run: { served: readonly { type: string; payload: unknown }[] }): string {
  const end = run.served.find((e) => e.type === 'agentfootprint.agent.turn_end');
  return String((end?.payload as { finalContent?: unknown }).finalContent);
}

describe('appended text — streamed answers', () => {
  it('the standing line reaches the AG-UI text after the streamed answer', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('lookup'), 'There are 4242 open orders.'] }),
      model: 'm',
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const run = await runAsAgUi(agent, { message: 'How many orders?' });

    const delivered = finalContentOf(run);
    expect(delivered.startsWith('There are 4242 open orders.')).toBe(true);
    expect(delivered.length).toBeGreaterThan('There are 4242 open orders.'.length);
    // What the person reads is the answer the run delivered, line included.
    expect(wireText(run.events)).toBe(delivered);

    const client = await replayThroughClient(run.events, 'thread-1');
    const said = client.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('');
    expect(said).toBe(delivered);
    expect(client.result.result).toBe(delivered);
  });

  it('the limits block reaches the AG-UI text after the streamed answer', async () => {
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
    const run = await runAsAgUi(agent, { message: 'Where is order 77?' });

    const delivered = finalContentOf(run);
    expect(delivered).toContain('the archive');
    expect(wireText(run.events)).toBe(delivered);
  });
});

describe('appended text — regression', () => {
  it('an answer that was not streamed is still written whole, once', async () => {
    // A provider with no `stream()`: no token at all, the answer comes whole.
    const scripted = mock({ replies: [call('lookup'), 'There are 4242 open orders.'] });
    const completeOnly: LLMProvider = {
      name: scripted.name,
      complete: (request) => scripted.complete(request),
    };
    const agent = Agent.create({ provider: completeOnly, model: 'm' })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .answerLayer({ standingLine: true })
      .build();
    const run = await runAsAgUi(agent, { message: 'How many orders?' });
    expect(wireText(run.events)).toBe(finalContentOf(run));
    expect(only(run.events, 'TEXT_MESSAGE_START')).toHaveLength(1);
  });

  it('with nothing appended, a streamed answer gets no second message', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('lookup'), 'There are 12 open orders.'] }),
      model: 'm',
    })
      .tool(lookup)
      .build();
    const run = await runAsAgUi(agent, { message: 'How many orders?' });
    expect(wireText(run.events)).toBe('There are 12 open orders.');
    // One message for the tool-call turn's text-less call is not opened; one for the answer.
    expect(only(run.events, 'TEXT_MESSAGE_START')).toHaveLength(1);
  });
});

describe('appended text — a record reader attached after a pause', () => {
  it.each(['streamed', 'complete-only'] as const)(
    'delivers the %s root answer and warning once',
    async (delivery) => {
      const agent = reportAgent(delivery);
      const paused = await agent.run({ message: 'Is the report ready?' });
      if (!isPaused(paused)) throw new Error('Expected the approval tool to pause');

      const run = await runAsAgUi(agent, undefined, {
        resume: { checkpoint: paused.checkpoint, answer: { approved: true } },
      });
      const expected = REPORT + WARNING;
      expect(run.out).toBe(expected);
      expect(finalContentOf(run)).toBe(expected);
      expect(run.served.some((event) => event.type === 'agentfootprint.agent.turn_start')).toBe(
        false,
      );
      expect(wireText(run.events)).toBe(expected);
      expect(only(run.events, 'TEXT_MESSAGE_START')).toHaveLength(2);
      expect(only(run.events, 'CUSTOM')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'agentfootprint.answer.assessed',
            value: expect.objectContaining({
              standing: 'not-sure',
              reasons: ['work-not-finished'],
            }),
          }),
        ]),
      );

      const client = await replayThroughClient(run.events);
      expect(
        client.messages.filter((message) => message.role === 'assistant').map((m) => m.content),
      ).toEqual([REPORT, WARNING]);
      expect(client.result.result).toBe(expected);
    },
  );

  it('takes the terminal result from the served record under redaction', async () => {
    const agent = reportAgent('streamed', conversationRedaction());
    const paused = await agent.run({ message: 'Is the report ready?' });
    if (!isPaused(paused)) throw new Error('Expected the approval tool to pause');

    const run = await runAsAgUi(agent, undefined, {
      resume: { checkpoint: paused.checkpoint, answer: { approved: true } },
    });
    expect(run.out).toBe(REPORT + WARNING);
    expect(finalContentOf(run)).toBe('[REDACTED]');
    expect(run.events.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: '[REDACTED]' });
    const deltas = only(run.events, 'TEXT_MESSAGE_CONTENT').map((event) => event.delta);
    expect(deltas).toEqual(Array.from({ length: 4 }, () => '[REDACTED]'));
    const wire = JSON.stringify(run.events);
    expect(wire).not.toContain(REPORT);
    expect(wire).not.toContain('a tool reported unfinished work');
  });

  it('does not promote a resumed mounted Agent’s answer to the root', async () => {
    const inner = Sequence.create().step('report', reportAgent('streamed')).build();
    const root = Sequence.create().step('inner', inner).build();
    const paused = await root.run({ message: 'Is the report ready?' });
    if (!isPaused(paused)) throw new Error('Expected the mounted approval tool to pause');

    const run = await runAsAgUi(root, undefined, {
      resume: { checkpoint: paused.checkpoint, answer: { approved: true } },
    });
    expect(run.out).toBe(REPORT + WARNING);
    expect(finalContentOf(run)).toBe(REPORT + WARNING);
    expect(wireText(run.events)).toBe(REPORT);
    expect(run.events.at(-1)).toMatchObject({ type: 'RUN_FINISHED' });
    expect(run.events.at(-1)).not.toHaveProperty('result');
  });
});
