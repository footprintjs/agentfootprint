/**
 * CONTINUATION — a run that pauses, and the run that continues it, read the way
 * an AG-UI frontend reads a thread.
 *
 *   1. A pause at depth two belongs to the agent that paused: the interrupt
 *      names its sub-agent and the call it stopped in, and that sub-agent's
 *      suspension names the interrupt (the pause used to be addressed by
 *      footprintjs's cumulative resume cursor and was handed to the parent).
 *   2. The continuation is the SAME invocation: its sub-agent re-opens under its
 *      own `subagentRunId`, its open steps re-open, the call it stopped in is
 *      answered under its own id, and the answer is the run's result.
 *   3. A tool the CLIENT runs (a frontend tool) completes the segment with the
 *      call pending; the client's answer is never written back to it.
 *   4. The interrupt says what was asked, for every kind of pause.
 *   5. Several calls in one model response are one assistant message.
 *
 * Every stream goes through the official client, run after run on one thread.
 */

import { describe, expect, it } from 'vitest';

import { Agent, ask, checkInApproved, defineTool, Parallel, Sequence } from '../../src/index.js';
import { pauseHere } from '../../src/core/pause.js';
import { mock } from '../../src/llm-providers.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';
import { replayRunsThroughClient, runAsAgUi } from './helpers.js';

const only = <T extends AgUiEvent['type']>(events: readonly AgUiEvent[], type: T) =>
  events.filter((e): e is Extract<AgUiEvent, { type: T }> => e.type === type);

const askPerson = defineTool({
  name: 'ask_person',
  description: 'Ask a person.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => pauseHere({ question: 'Approve the refund?' }),
});

const callAsk = { content: '', toolCalls: [{ id: 'c1', name: 'ask_person', args: {} }] };

const pausing = (answer = 'done') =>
  Agent.create({ provider: mock({ chunkDelayMs: 0, replies: [callAsk, answer] }), model: 'm' })
    .system('s')
    .tool(askPerson)
    .build();

const answering = (answer: string) =>
  Agent.create({ provider: mock({ chunkDelayMs: 0, replies: [answer] }), model: 'm' })
    .system('s')
    .build();

/** A sequence step that fans out to a pausing agent and one that answers. */
const fanned = () =>
  Sequence.create({ id: 'seq' })
    .step(
      'p',
      Parallel.create({ id: 'fan' })
        .branch('x', pausing('x done'))
        .branch('y', answering('y done'))
        .mergeWithFn((r) => JSON.stringify(r))
        .build(),
    )
    .build();

describe('continuation — a pause at depth two belongs to the agent that paused', () => {
  for (const [shape, build] of [
    ['a parallel branch in a sequence step', fanned],
    [
      'a sequence inside a sequence',
      () =>
        Sequence.create({ id: 'outer' })
          .step('in', Sequence.create({ id: 'inner' }).step('a', pausing()).build())
          .build(),
    ],
  ] as const) {
    it(shape, async () => {
      const run = await runAsAgUi(build(), { message: 'go' });
      const finished = only(run.events, 'RUN_FINISHED')[0]!;
      if (finished.outcome?.type !== 'interrupt') throw new Error('expected an interrupt');
      const [interrupt] = finished.outcome.interrupts;
      const call = only(run.events, 'TOOL_CALL_START')[0]!;

      // The interrupt is the paused sub-agent's, about the call it stopped in.
      expect(interrupt!.subagentRunId).toBe(call.subagentRunId);
      expect(interrupt!.subagentRunId).toBeDefined();
      expect(interrupt!.toolCallId).toBe(call.toolCallId);
      expect(interrupt!.message).toBe('Approve the refund?');
      // Its address is the segment path every event of that agent carries.
      expect(interrupt!.metadata?.agentfootprint?.subflowPath).toEqual(
        call.metadata?.agentfootprint?.subflowPath,
      );
      // That sub-agent is the one suspended ON the interrupt.
      const suspended = only(run.events, 'SUBAGENT_FINISHED').find(
        (e) => e.subagentRunId === interrupt!.subagentRunId,
      )!;
      expect(suspended.outcome).toEqual({ type: 'suspended', interruptIds: [interrupt!.id] });

      const { warnings } = await replayRunsThroughClient([{ events: run.events }]);
      expect(warnings).toEqual([]);
    });
  }
});

describe('continuation — the run that continues a pause is the same invocation', () => {
  it('a sub-agent at depth two: re-opened under its own id, its call answered, its answer kept', async () => {
    const pipeline = fanned();
    const first = await runAsAgUi(pipeline, { message: 'go' }, { runId: 'ag-1' });
    const suspension = first.translation.suspension()!;
    expect(suspension).toMatchObject({ version: 1, runId: 'ag-1', rootAgent: false });
    const interruptId = suspension.interruptId!;
    const paused = first.out as { checkpoint: unknown };

    const second = await runAsAgUi(pipeline, undefined, {
      runId: 'ag-2',
      serializer: { resume: suspension },
      resume: { checkpoint: paused.checkpoint, answer: 'yes' },
    });

    const opened = only(first.events, 'SUBAGENT_STARTED').find((e) => e.name.endsWith('/x'))!;
    const call = only(first.events, 'TOOL_CALL_START')[0]!;
    // RUN_STARTED names agentfootprint's run, and the same invocation re-opens.
    expect(second.events[0]).toMatchObject({ type: 'RUN_STARTED', runId: 'ag-2' });
    expect(second.events[0]!.metadata?.agentfootprint?.runId).toBe(
      second.served.find((e) => e.meta.runId !== 'consumer-scope')!.meta.runId,
    );
    expect(only(second.events, 'SUBAGENT_STARTED')).toEqual([
      expect.objectContaining({ subagentRunId: opened.subagentRunId, name: opened.name }),
    ]);
    // The call it stopped in is answered under ITS id, in its sub-agent.
    expect(only(second.events, 'TOOL_CALL_RESULT')).toEqual([
      expect.objectContaining({
        toolCallId: call.toolCallId,
        content: 'yes',
        subagentRunId: opened.subagentRunId,
      }),
    ]);
    // Its text and its end belong to it, and it answered.
    expect(
      only(second.events, 'TEXT_MESSAGE_START').every(
        (e) => e.subagentRunId === opened.subagentRunId,
      ),
    ).toBe(true);
    expect(only(second.events, 'SUBAGENT_FINISHED')).toEqual([
      expect.objectContaining({ subagentRunId: opened.subagentRunId, result: 'x done' }),
    ]);

    const client = await replayRunsThroughClient([
      { events: first.events },
      {
        events: second.events,
        resume: [{ interruptId, status: 'resolved', payload: 'yes' }],
      },
    ]);
    expect(client.warnings).toEqual([]);
    expect(client.messages.filter((m) => m.role === 'tool')).toEqual([
      expect.objectContaining({ toolCallId: call.toolCallId, content: 'yes' }),
    ]);
  });

  it('a root agent: the iteration it paused in re-opens and closes; its answer is the result', async () => {
    const agent = pausing('Refunded.');
    const first = await runAsAgUi(agent, { message: 'refund order 7' }, { runId: 'ag-1' });
    const suspension = first.translation.suspension()!;
    expect(suspension.rootAgent).toBe(true);
    expect(suspension.scopes).toEqual([{ mount: [], steps: ['iteration 1'] }]);

    const second = await runAsAgUi(agent, undefined, {
      runId: 'ag-2',
      serializer: { resume: suspension },
      resume: { checkpoint: (first.out as { checkpoint: unknown }).checkpoint, answer: 'approved' },
    });
    expect(only(second.events, 'STEP_STARTED').map((e) => e.stepName)[0]).toBe('iteration 1');
    expect(only(second.events, 'STEP_FINISHED').map((e) => e.stepName)).toContain('iteration 1');
    const finished = second.events.at(-1)!;
    expect(finished).toMatchObject({ type: 'RUN_FINISHED', result: 'Refunded.' });

    const client = await replayRunsThroughClient([
      { events: first.events },
      {
        events: second.events,
        resume: [{ interruptId: suspension.interruptId!, status: 'resolved', payload: 'approved' }],
      },
    ]);
    expect(client.warnings).toEqual([]);
    expect(client.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
  });
});

describe('continuation — a tool the client runs', () => {
  it('completes the segment with the call pending; the client’s answer is never written back', async () => {
    const pick = defineTool({
      name: 'pick_date',
      description: 'Let the person pick a date in the page.',
      inputSchema: { type: 'object', properties: { month: { type: 'string' } } },
      execute: async () => pauseHere({ clientTool: 'pick_date' }),
    });
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          { content: '', toolCalls: [{ id: 'd1', name: 'pick_date', args: { month: 'May' } }] },
          'Booked for May 3.',
        ],
      }),
      model: 'm',
    })
      .system('s')
      .tool(pick)
      .build();

    const first = await runAsAgUi(agent, { message: 'book it' }, { awaiting: 'caller' });
    const call = only(first.events, 'TOOL_CALL_START')[0]!;
    expect(first.events.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      outcome: { type: 'success', pendingToolCallIds: [call.toolCallId] },
    });
    expect(only(first.events, 'TOOL_CALL_RESULT')).toEqual([]);
    const suspension = first.translation.suspension()!;
    expect(suspension.interruptId).toBeUndefined();
    expect(suspension.call).toEqual({ toolCallId: call.toolCallId, mount: [], client: true });

    const second = await runAsAgUi(agent, undefined, {
      runId: 'run-2',
      serializer: { resume: suspension },
      resume: {
        checkpoint: (first.out as { checkpoint: unknown }).checkpoint,
        answer: '2026-05-03',
      },
    });
    expect(only(second.events, 'TOOL_CALL_RESULT')).toEqual([]);
    expect(second.events.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      result: 'Booked for May 3.',
    });

    const client = await replayRunsThroughClient([
      { events: first.events },
      {
        events: second.events,
        add: [
          { id: 'tool-msg-1', role: 'tool', toolCallId: call.toolCallId, content: '2026-05-03' },
        ],
      },
    ]);
    expect(client.warnings).toEqual([]);
    expect(client.results[0]!.result).toBeUndefined();
    expect(client.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
  });
});

describe('continuation — the interrupt says what was asked, for every kind of pause', () => {
  const messageOf = async (agent: Parameters<typeof runAsAgUi>[0]) => {
    const run = await runAsAgUi(agent, { message: 'refund it' });
    const finished = only(run.events, 'RUN_FINISHED')[0]!;
    if (finished.outcome?.type !== 'interrupt') throw new Error('expected an interrupt');
    return finished.outcome.interrupts[0]!.message;
  };
  const act = defineTool({
    name: 'refund',
    description: 'Refund an order',
    inputSchema: { type: 'object', properties: { order: { type: 'string' } } },
    execute: async () => 'refunded',
  });
  const callRefund = {
    content: '',
    toolCalls: [{ id: 'r1', name: 'refund', args: { order: '7' } }],
  };

  it('a person asked from inside a tool', async () => {
    expect(await messageOf(pausing())).toBe('Approve the refund?');
  });

  it('a middleware that answered ask', async () => {
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [callRefund, 'ok'] }),
      model: 'm',
    })
      .tools([act])
      .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'Refund order 7?' }) })
      .build();
    expect(await messageOf(agent)).toBe('Refund order 7?');
  });

  it('a check-in: the plain-words claim of what the tool will do', async () => {
    const gated = defineTool({
      name: 'refund',
      description: 'Refund an order',
      inputSchema: { type: 'object', properties: { order: { type: 'string' } } },
      checkIn: 'always',
      execute: async () => 'refunded',
    });
    const agent = Agent.create({
      provider: mock({ chunkDelayMs: 0, replies: [callRefund, 'ok'] }),
      model: 'm',
    })
      .tools([gated])
      .build();
    const message = await messageOf(agent);
    expect(message).toEqual(expect.stringContaining('Refund an order'));
    // and it continues on a decision, through the same door
    void checkInApproved;
  });
});

describe('continuation — one model response is one assistant message', () => {
  it('several calls and no text share one message', async () => {
    const lookup = defineTool({
      name: 'lookup',
      description: 'Look up.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      execute: async (args: { q?: string }) => `about ${args.q}`,
    });
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [
          {
            content: '',
            toolCalls: [
              { id: 'a', name: 'lookup', args: { q: 'one' } },
              { id: 'b', name: 'lookup', args: { q: 'two' } },
            ],
          },
          'Both found.',
        ],
      }),
      model: 'm',
    })
      .system('s')
      .tool(lookup)
      .build();
    const run = await runAsAgUi(agent, { message: 'look both up' });
    const [first, second] = only(run.events, 'TOOL_CALL_START');
    expect(first!.parentMessageId).toBeDefined();
    expect(second!.parentMessageId).toBe(first!.parentMessageId);

    const client = await replayRunsThroughClient([{ events: run.events }]);
    expect(client.warnings).toEqual([]);
    expect(client.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'assistant']);
    expect(client.messages[0]!).toMatchObject({ role: 'assistant' });
    expect((client.messages[0] as { toolCalls?: unknown[] }).toolCalls).toHaveLength(2);
  });
});
