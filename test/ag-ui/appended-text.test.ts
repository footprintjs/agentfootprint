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

import { absent, Agent, defineTool } from '../../src/index.js';
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
