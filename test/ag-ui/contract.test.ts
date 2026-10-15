/**
 * THE CONTRACT — what real runs become is valid AG-UI 1.0, by the protocol's own
 * schema and its own client.
 *
 * Every shape a run takes here (a tool call, thinking, a pause, a pause two
 * levels deep and the run that continues it, a frontend tool's pending call,
 * a failure, a provider that does not stream, an LLMCall, a composition with
 * parallel branches, a redacted run) is translated by `agUiSerializer`, then:
 *
 *   1. every event is parsed by `@ag-ui/core/schemas`' `EventSchema` and comes
 *      back unchanged — no field the protocol does not declare (the client's
 *      enforcement would strip it, with a warning);
 *   2. the whole stream goes through `@ag-ui/client`'s own pipeline —
 *      enforcement, chunk expansion, VERIFICATION (open/close, ownership, the
 *      run lifecycle) and the reducer — and is accepted with no warning.
 *
 * The compile-time half (every event type assignable to `@ag-ui/core`'s
 * `Event`) is `test/type-regressions/AgUiEvents.assignability.test.ts`.
 */

import { EventSchema } from '@ag-ui/core/schemas';
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, LLMCall, Parallel, Sequence } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman, pauseHere } from '../../src/core/pause.js';
import { mockThinkingHandler } from '../../src/thinking/MockThinkingHandler.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';
import {
  replayRunsThroughClient,
  replayThroughClient,
  runAsAgUi,
  typesOf,
  type AgUiRun,
} from './helpers.js';

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: 'Let me check.',
  toolCalls: [{ id, name, args }],
});

const weather = defineTool({
  name: 'weather',
  description: 'Current weather for a city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  execute: async (args: { city?: string }) => `sunny in ${args.city}`,
});

const agentWith = (replies: unknown[], extra: Record<string, unknown> = {}) =>
  Agent.create({
    provider: mock({ chunkDelayMs: 0, replies: replies as never }),
    model: 'm',
    ...extra,
  })
    .system('You are terse.')
    .tool(weather)
    .build();

/** Every event parses under the protocol's own schema, unchanged. */
function expectSchemaValid(events: readonly AgUiEvent[]): void {
  for (const event of events) {
    const parsed = EventSchema.safeParse(event);
    expect(parsed.success, `${event.type}: ${parsed.success ? '' : parsed.error.message}`).toBe(
      true,
    );
    if (parsed.success) expect(parsed.data, event.type).toEqual(event);
  }
}

async function expectClientAccepts(run: AgUiRun) {
  expectSchemaValid(run.events);
  const client = await replayThroughClient(run.events);
  expect(client.warnings).toEqual([]);
  return client;
}

describe('AG-UI contract — real runs, the protocol’s schema and its client', () => {
  it('a run with a tool call', async () => {
    const run = await runAsAgUi(
      agentWith([call('weather', 'c1', { city: 'Paris' }), 'It is sunny.']),
      {
        message: 'Weather in Paris?',
      },
    );
    const client = await expectClientAccepts(run);
    expect(client.result.result).toBe('It is sunny.');
    expect(client.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('a run whose model thinks', async () => {
    const thinker = {
      name: 'mock',
      thinkingHandler: mockThinkingHandler,
      complete: async () => ({
        content: 'Paris.',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
        rawThinking: {
          kind: 'anthropic',
          blocks: [{ type: 'thinking', thinking: 'The capital…' }],
        },
      }),
    };
    const run = await runAsAgUi(
      Agent.create({ provider: thinker as never, model: 'm' })
        .system('s')
        .build(),
      { message: 'Capital of France?' },
      { serializer: { reasoning: true } }, // reasoning goes out only when asked for
    );
    expect(typesOf(run.events)).toContain('REASONING_MESSAGE_CONTENT');
    const client = await expectClientAccepts(run);
    expect(
      client.messages.some((m) => m.role === 'reasoning' && m.content === 'The capital…'),
    ).toBe(true);
  });

  it('a run that pauses on a person', async () => {
    const ask = defineTool({
      name: 'approve',
      description: 'Ask a person to approve.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => askHuman({ question: 'Approve the refund?' }),
    });
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('approve', 'p1'), 'ok'] }),
      model: 'm',
    })
      .system('s')
      .tool(ask)
      .build();
    const run = await runAsAgUi(agent, { message: 'Refund order 7' });
    const finished = run.events.at(-1) as Extract<AgUiEvent, { type: 'RUN_FINISHED' }>;
    expect(finished.outcome?.type).toBe('interrupt');
    await expectClientAccepts(run);
  });

  it('a pause two levels deep, and the run that continues it', async () => {
    const approve = defineTool({
      name: 'approve',
      description: 'Ask a person to approve.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => askHuman({ question: 'Approve?' }),
    });
    const pausingAgent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('approve', 'p1'), 'approved'] }),
      model: 'm',
    })
      .system('s')
      .tool(approve)
      .build();
    const pipeline = Sequence.create()
      .step(
        'p',
        Parallel.create()
          .branch('x', pausingAgent)
          .branch('y', agentWith(['y done']))
          .mergeWithFn((r) => JSON.stringify(r))
          .build(),
      )
      .build();
    const first = await runAsAgUi(pipeline, { message: 'go' }, { runId: 'ag-1' });
    const suspension = first.translation.suspension()!;
    const second = await runAsAgUi(pipeline, undefined, {
      runId: 'ag-2',
      serializer: { resume: suspension },
      resume: { checkpoint: (first.out as { checkpoint: unknown }).checkpoint, answer: 'yes' },
    });
    expectSchemaValid(first.events);
    expectSchemaValid(second.events);
    const client = await replayRunsThroughClient([
      { events: first.events },
      {
        events: second.events,
        resume: [{ interruptId: suspension.interruptId!, status: 'resolved', payload: 'yes' }],
      },
    ]);
    expect(client.warnings).toEqual([]);
  });

  it('a frontend tool: the segment completes with the call pending, and the run continues', async () => {
    const pick = defineTool({
      name: 'pick',
      description: 'Pick in the page.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => pauseHere({ clientTool: 'pick' }),
    });
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [call('pick', 'k1'), 'picked'] }),
      model: 'm',
    })
      .system('s')
      .tool(pick)
      .build();
    const first = await runAsAgUi(agent, { message: 'go' }, { awaiting: 'caller' });
    const suspension = first.translation.suspension()!;
    const second = await runAsAgUi(agent, undefined, {
      runId: 'run-2',
      serializer: { resume: suspension },
      resume: { checkpoint: (first.out as { checkpoint: unknown }).checkpoint, answer: 'B' },
    });
    expectSchemaValid(first.events);
    expectSchemaValid(second.events);
    const client = await replayRunsThroughClient([
      { events: first.events },
      {
        events: second.events,
        add: [
          { id: 'tool-1', role: 'tool', toolCallId: suspension.call!.toolCallId, content: 'B' },
        ],
      },
    ]);
    expect(client.warnings).toEqual([]);
  });

  it('a run that fails', async () => {
    const agent = Agent.create({
      provider: {
        name: 'down',
        complete: async () => Promise.reject(new Error('provider down')),
      } as never,
      model: 'm',
    })
      .system('s')
      .build();
    const run = await runAsAgUi(agent, { message: 'hi' });
    expect(run.events.at(-1)).toMatchObject({ type: 'RUN_ERROR' });
    await expectClientAccepts(run);
  });

  it('a provider that does not stream: the answer arrives whole', async () => {
    const plain = {
      name: 'plain',
      complete: async () => ({
        content: 'Plain answer.',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      }),
    };
    const agent = Agent.create({ provider: plain as never, model: 'm' })
      .system('s')
      .build();
    const run = await runAsAgUi(agent, { message: 'hi' });
    const client = await expectClientAccepts(run);
    expect(client.messages).toMatchObject([{ role: 'assistant', content: 'Plain answer.' }]);
  });

  it('an LLMCall — no agent, no stream: its one call is the answer', async () => {
    const llm = LLMCall.create({ provider: mock({ reply: 'One sentence.' }), model: 'm' })
      .system('s')
      .build();
    const run = await runAsAgUi(llm, { message: 'hi' });
    const client = await expectClientAccepts(run);
    expect(client.messages).toMatchObject([{ role: 'assistant', content: 'One sentence.' }]);
  });

  it('a composition: a sequence step and two parallel branches that reuse a tool-call id', async () => {
    const fan = Parallel.create()
      .branch('x', agentWith([call('weather', 'c1', { city: 'X' }), 'X done']))
      .branch('y', agentWith([call('weather', 'c1', { city: 'Y' }), 'Y done']))
      .mergeWithFn((r) => JSON.stringify(r))
      .build();
    const pipeline = Sequence.create()
      .step('a', agentWith([call('weather', 'c1', { city: 'A' }), 'A done']))
      .step('p', fan)
      .build();
    const run = await runAsAgUi(pipeline, { message: 'go' });
    const client = await expectClientAccepts(run);
    expect(client.messages.filter((m) => m.role === 'tool')).toHaveLength(3);
  });

  it('a redacted run', async () => {
    const run = await runAsAgUi(
      agentWith([call('weather', 'c1', { city: 'Paris' }), 'It is sunny.'], {
        redact: { keys: ['city'] },
      }),
      { message: 'Weather in Paris?' },
    );
    await expectClientAccepts(run);
  });
});
