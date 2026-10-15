/**
 * agUiSerializer — unit tests over hand-built event sequences.
 *
 * Each block pins one rule of the mapping (`src/ag-ui/serializer.ts` header):
 * the run lifecycle, text, tool calls, reasoning, sub-agents and steps, the
 * three terminals, and the guards (one settle, one run, the CUSTOM filter).
 * Real runs through the official client live in `contract.test.ts` and
 * `scenario.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { AgentfootprintEvent } from '../../src/index.js';
import {
  AG_UI_RUN_FAILED,
  AG_UI_SUBAGENT_CANCELLED,
  AG_UI_SUBAGENT_UNFINISHED,
  agUiSerializer,
} from '../../src/ag-ui/serializer.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';

let clock = 1_000;

/** One served event at a stage execution `rsid`, under the subflow `path`. */
function ev(
  type: string,
  payload: Record<string, unknown>,
  at: { rsid?: string; path?: readonly string[]; runId?: string } = {},
): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: clock++,
      runOffsetMs: 0,
      runtimeStageId: at.rsid ?? 'stage#1',
      subflowPath: at.path ?? [],
      compositionPath: [],
      runId: at.runId ?? 'run-100-1',
    },
  } as unknown as AgentfootprintEvent;
}

const t = (type: string) => `agentfootprint.${type}`;

function feed(
  events: readonly AgentfootprintEvent[],
  options: { custom?: (e: AgentfootprintEvent) => boolean } = {},
) {
  const s = agUiSerializer({ threadId: 'thread-1', runId: 'ag-run', ...options });
  const out: AgUiEvent[] = [];
  for (const e of events) out.push(...s.event(e));
  return { s, out };
}

const only = <T extends AgUiEvent['type']>(events: readonly AgUiEvent[], type: T) =>
  events.filter((e): e is Extract<AgUiEvent, { type: T }> => e.type === type);

describe('agUiSerializer — the run lifecycle', () => {
  it('opens with RUN_STARTED, once, carrying the protocol version and the record’s own run id', () => {
    const { s, out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0, userPrompt: 'hi' }, { rsid: 'seed#0' }),
      ev(t('context.evaluated'), { iteration: 1 }),
    ]);
    const closing = s.settle({ kind: 'finished' });
    expect(out[0]).toEqual({
      type: 'RUN_STARTED',
      threadId: 'thread-1',
      runId: 'ag-run',
      protocolVersion: '1.0',
      metadata: { agentfootprint: { runId: 'run-100-1' } },
    });
    expect(only([...out, ...closing], 'RUN_STARTED')).toHaveLength(1);
    expect(closing.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      threadId: 'thread-1',
      runId: 'ag-run',
    });
  });

  it('a run settled before any event still opens and closes', () => {
    const s = agUiSerializer({ threadId: 'th', runId: 'r' });
    const out = s.settle({ kind: 'finished' });
    expect(out.map((e) => e.type)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
    expect(out[0]).not.toHaveProperty('metadata');
  });

  it('refuses an empty thread or run id — every id the run mints hangs off them', () => {
    expect(() => agUiSerializer({ threadId: '', runId: 'r' })).toThrow(/threadId/);
    expect(() => agUiSerializer({ threadId: 't', runId: '' })).toThrow(/runId/);
  });

  it('settles once; nothing is translated after the terminal', () => {
    const { s } = feed([]);
    expect(s.settle({ kind: 'finished' }).length).toBeGreaterThan(0);
    expect(s.settle({ kind: 'finished' })).toEqual([]);
    expect(
      s.event(ev(t('stream.token'), { iteration: 1, tokenIndex: 0, content: 'late' })),
    ).toEqual([]);
  });

  it("never translates another run's event; an event of no run (a consumer emit) goes out as CUSTOM", () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(
        t('stream.token'),
        { iteration: 1, tokenIndex: 0, content: 'other' },
        { runId: 'run-999-9' },
      ),
      ev('app.note', { note: 'mine' }, { runId: 'consumer-scope' }),
    ]);
    expect(only(out, 'TEXT_MESSAGE_CONTENT')).toEqual([]);
    expect(only(out, 'CUSTOM').map((e) => e.name)).toEqual(['app.note']);
  });
});

describe('agUiSerializer — text', () => {
  it('streams tokens as one message per LLM call, closed at llm_end', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('stream.token'),
        { iteration: 1, tokenIndex: 0, content: 'Hel' },
        { rsid: 'call-llm#5' },
      ),
      ev(t('stream.token'), { iteration: 1, tokenIndex: 1, content: 'lo' }, { rsid: 'call-llm#5' }),
      ev(
        t('stream.llm_end'),
        { iteration: 1, content: 'Hello', toolCallCount: 0 },
        { rsid: 'call-llm#5' },
      ),
    ]);
    const types = out.map((e) => e.type).filter((x) => x.startsWith('TEXT'));
    expect(types).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ]);
    const start = only(out, 'TEXT_MESSAGE_START')[0]!;
    expect(start).toMatchObject({
      messageId: 'ag-run/text/0/call-llm#5',
      role: 'assistant',
      metadata: { agentfootprint: { runtimeStageId: 'call-llm#5', subflowPath: [] } },
    });
    expect(
      only(out, 'TEXT_MESSAGE_CONTENT')
        .map((e) => e.delta)
        .join(''),
    ).toBe('Hello');
    // The agent's llm_end.content is a draft — never written a second time.
    expect(only(out, 'TEXT_MESSAGE_START')).toHaveLength(1);
  });

  it('a stream that restarts (a retried call) becomes a new message, never a garbled one', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('stream.token'),
        { iteration: 1, tokenIndex: 0, content: 'Hel' },
        { rsid: 'call-llm#5' },
      ),
      ev(
        t('stream.token'),
        { iteration: 1, tokenIndex: 0, content: 'Hello' },
        { rsid: 'call-llm#5' },
      ),
    ]);
    expect(only(out, 'TEXT_MESSAGE_START').map((e) => e.messageId)).toEqual([
      'ag-run/text/0/call-llm#5',
      'ag-run/text/1/call-llm#5',
    ]);
    expect(only(out, 'TEXT_MESSAGE_END').map((e) => e.messageId)).toEqual([
      'ag-run/text/0/call-llm#5',
    ]);
  });

  it("writes an agent's answer whole from turn_end when nothing streamed", () => {
    const { s, out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('stream.llm_end'),
        { iteration: 1, content: 'draft', toolCallCount: 0 },
        { rsid: 'call-llm#5' },
      ),
      ev(
        t('agent.turn_end'),
        { turnIndex: 0, finalContent: 'The answer.' },
        { rsid: 'final/prepare-final#9', path: ['final'] },
      ),
    ]);
    expect(only(out, 'TEXT_MESSAGE_CONTENT').map((e) => e.delta)).toEqual(['The answer.']);
    expect(only(out, 'TEXT_MESSAGE_START')[0]!.messageId).toBe(
      'ag-run/text/0/final/prepare-final#9',
    );
    expect(s.settle({ kind: 'finished' }).at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      result: 'The answer.',
    });
  });

  it('never writes an answer the record marks refused', () => {
    const { s, out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('agent.turn_end'),
        { turnIndex: 0, finalContent: 'made up', refused: { by: 'evidence-rails' } },
        { rsid: 'final/prepare-final#9', path: ['final'] },
      ),
    ]);
    expect(only(out, 'TEXT_MESSAGE_CONTENT')).toEqual([]);
    expect(s.settle({ kind: 'finished' }).at(-1)).not.toHaveProperty('result');
  });

  it('with no agent around (an LLMCall), llm_end content IS the answer — unless withheld', () => {
    const { out } = feed([
      ev(
        t('stream.llm_start'),
        { iteration: 1 },
        { rsid: 'sf-llm-call/call-llm#3', path: ['sf-llm-call'] },
      ),
      ev(
        t('stream.llm_end'),
        { iteration: 1, content: 'Paris.', toolCallCount: 0 },
        { rsid: 'sf-llm-call/call-llm#3', path: ['sf-llm-call'] },
      ),
      ev(
        t('stream.llm_start'),
        { iteration: 2 },
        { rsid: 'sf-llm-call/call-llm#7', path: ['sf-llm-call'] },
      ),
      ev(
        t('stream.llm_end'),
        { iteration: 2, content: '', contentWithheld: true, toolCallCount: 0 },
        { rsid: 'sf-llm-call/call-llm#7', path: ['sf-llm-call'] },
      ),
    ]);
    expect(only(out, 'TEXT_MESSAGE_CONTENT').map((e) => e.delta)).toEqual(['Paris.']);
  });
});

describe('agUiSerializer — tool calls', () => {
  const opening = [
    ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
    ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
    ev(
      t('stream.token'),
      { iteration: 1, tokenIndex: 0, content: 'Checking.' },
      { rsid: 'call-llm#5' },
    ),
    ev(
      t('stream.llm_end'),
      { iteration: 1, content: 'Checking.', toolCallCount: 2 },
      { rsid: 'call-llm#5' },
    ),
  ];

  it('a call is START + ARGS + END at tool_start, parented to its LLM call’s message; its result follows', () => {
    const boom = Object.assign(new Error('nope'), {
      config: { headers: { authorization: 'Bearer x' } },
    });
    const { out } = feed([
      ...opening,
      ev(
        t('stream.tool_start'),
        { toolName: 'weather', toolCallId: 'c1', args: { city: 'Paris', err: boom } },
        { rsid: 'tool-calls#8' },
      ),
      ev(
        t('stream.tool_end'),
        { toolCallId: 'c1', result: { temp: 21 }, durationMs: 3 },
        { rsid: 'tool-calls#8' },
      ),
    ]);
    const start = only(out, 'TOOL_CALL_START')[0]!;
    expect(start).toMatchObject({
      toolCallId: 'ag-run/tool/0/tool-calls#8',
      toolCallName: 'weather',
      parentMessageId: 'ag-run/text/0/call-llm#5',
      metadata: { agentfootprint: { runtimeStageId: 'tool-calls#8', toolCallId: 'c1' } },
    });
    // The wire rule: an Error in the arguments is its name and message, never its custom fields.
    expect(only(out, 'TOOL_CALL_ARGS')[0]!.delta).toBe(
      '{"city":"Paris","err":{"name":"Error","message":"nope"}}',
    );
    expect(only(out, 'TOOL_CALL_END')).toHaveLength(1);
    expect(only(out, 'TOOL_CALL_RESULT')[0]).toMatchObject({
      messageId: 'ag-run/result/0/tool-calls#8',
      toolCallId: 'ag-run/tool/0/tool-calls#8',
      content: '{"temp":21}',
      role: 'tool',
    });
  });

  it('pairs results by the stage execution even when the record serves every id as the placeholder', () => {
    const { out } = feed([
      ...opening,
      ev(
        t('stream.tool_start'),
        { toolName: '[REDACTED]', toolCallId: '[REDACTED]', args: {} },
        { rsid: 'tool-calls#8' },
      ),
      ev(
        t('stream.tool_end'),
        { toolCallId: '[REDACTED]', result: '[REDACTED]' },
        { rsid: 'tool-calls#8' },
      ),
      ev(
        t('stream.tool_start'),
        { toolName: '[REDACTED]', toolCallId: '[REDACTED]', args: {} },
        { rsid: 'tool-calls#8' },
      ),
      ev(
        t('stream.tool_end'),
        { toolCallId: '[REDACTED]', result: '[REDACTED]' },
        { rsid: 'tool-calls#8' },
      ),
    ]);
    expect(only(out, 'TOOL_CALL_START').map((e) => e.toolCallId)).toEqual([
      'ag-run/tool/0/tool-calls#8',
      'ag-run/tool/1/tool-calls#8',
    ]);
    expect(only(out, 'TOOL_CALL_RESULT').map((e) => [e.toolCallId, e.messageId])).toEqual([
      ['ag-run/tool/0/tool-calls#8', 'ag-run/result/0/tool-calls#8'],
      ['ag-run/tool/1/tool-calls#8', 'ag-run/result/1/tool-calls#8'],
    ]);
  });

  it('the same provider id twice in one run still mints two different AG-UI ids', () => {
    const { out } = feed([
      ...opening,
      ev(
        t('stream.tool_start'),
        { toolName: 'w', toolCallId: '1', args: {} },
        { rsid: 'tool-calls#8' },
      ),
      ev(t('stream.tool_end'), { toolCallId: '1', result: 'a' }, { rsid: 'tool-calls#8' }),
      ev(
        t('stream.tool_start'),
        { toolName: 'w', toolCallId: '1', args: {} },
        { rsid: 'tool-calls#30' },
      ),
      ev(t('stream.tool_end'), { toolCallId: '1', result: 'b' }, { rsid: 'tool-calls#30' }),
    ]);
    const ids = only(out, 'TOOL_CALL_START').map((e) => e.toolCallId);
    expect(new Set(ids).size).toBe(2);
  });

  it('a result the record cannot tie to a call this run opened goes out as the event it is', () => {
    const { out } = feed([
      ...opening,
      ev(t('stream.tool_end'), { toolCallId: 'ghost', result: 'x' }, { rsid: 'tool-calls#8' }),
    ]);
    expect(only(out, 'TOOL_CALL_RESULT')).toEqual([]);
    expect(only(out, 'CUSTOM').map((e) => e.name)).toEqual(['agentfootprint.stream.tool_end']);
  });
});

describe('agUiSerializer — reasoning', () => {
  it('streamed thinking is one reasoning span and message, closed at thinking_end', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('stream.thinking_delta'),
        { iteration: 1, tokenIndex: 0, content: 'Hmm, ' },
        { rsid: 'call-llm#5' },
      ),
      ev(
        t('stream.thinking_delta'),
        { iteration: 1, tokenIndex: 1, content: 'Paris.' },
        { rsid: 'call-llm#5' },
      ),
      ev(
        t('stream.llm_end'),
        { iteration: 1, content: '', toolCallCount: 0 },
        { rsid: 'call-llm#5' },
      ),
      ev(
        t('stream.thinking_end'),
        { iteration: 1, blockCount: 1, totalChars: 11 },
        { rsid: 'sf-thinking/normalize#6', path: ['sf-thinking'] },
      ),
    ]);
    expect(out.map((e) => e.type).filter((x) => x.startsWith('REASONING'))).toEqual([
      'REASONING_START',
      'REASONING_MESSAGE_START',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_END',
      'REASONING_END',
    ]);
    expect(
      only(out, 'REASONING_MESSAGE_CONTENT')
        .map((e) => e.delta)
        .join(''),
    ).toBe('Hmm, Paris.');
  });

  it('thinking that arrived whole is one message per block; a provider-redacted block has no text to show', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('stream.thinking_end'),
        {
          iteration: 1,
          blockCount: 3,
          totalChars: 9,
          blocks: [
            { type: 'thinking', content: 'first' },
            { type: 'redacted_thinking', content: '' },
            { type: 'thinking', content: 'next' },
          ],
        },
        { rsid: 'sf-thinking/normalize#6', path: ['sf-thinking'] },
      ),
    ]);
    expect(only(out, 'REASONING_MESSAGE_CONTENT').map((e) => e.delta)).toEqual(['first', 'next']);
    expect(only(out, 'REASONING_START')).toHaveLength(1);
    expect(only(out, 'REASONING_END')).toHaveLength(1);
  });
});

describe('agUiSerializer — sub-agents and steps', () => {
  const branch = (b: string, n: number) => ({
    path: ['step-p', b],
    rsid: `step-p/${b}/call-llm#${n}`,
  });

  it('a nested turn is a sub-agent; every event under its mount carries its handle, never a sibling’s', () => {
    const { out } = feed([
      ev(
        t('composition.enter'),
        { kind: 'Parallel', id: '[REDACTED]' },
        { rsid: 'step-p/seed#50', path: ['step-p'] },
      ),
      ev(
        t('agent.turn_start'),
        { turnIndex: 0 },
        { rsid: 'step-p/x/seed#52', path: ['step-p', 'x'] },
      ),
      ev(
        t('agent.turn_start'),
        { turnIndex: 0 },
        { rsid: 'step-p/y/seed#54', path: ['step-p', 'y'] },
      ),
      ev(t('stream.llm_start'), { iteration: 1 }, branch('x', 89)),
      ev(t('stream.llm_start'), { iteration: 1 }, branch('y', 90)),
      ev(t('stream.token'), { iteration: 1, tokenIndex: 0, content: 'X' }, branch('x', 89)),
      ev(t('stream.token'), { iteration: 1, tokenIndex: 0, content: 'Y' }, branch('y', 90)),
      ev(t('stream.token'), { iteration: 1, tokenIndex: 1, content: 'x' }, branch('x', 89)),
      ev(t('stream.token'), { iteration: 1, tokenIndex: 1, content: 'y' }, branch('y', 90)),
      ev(
        t('agent.turn_end'),
        { turnIndex: 0, finalContent: 'Xx' },
        { rsid: 'step-p/x/final/prepare-final#91', path: ['step-p', 'x', 'final'] },
      ),
      ev(
        t('agent.turn_end'),
        { turnIndex: 0, finalContent: 'Yy' },
        { rsid: 'step-p/y/final/prepare-final#92', path: ['step-p', 'y', 'final'] },
      ),
      ev(
        t('composition.exit'),
        { kind: 'Parallel', status: 'ok' },
        { rsid: 'step-p/merge#93', path: ['step-p'] },
      ),
    ]);
    const started = only(out, 'SUBAGENT_STARTED');
    expect(started.map((e) => [e.subagentRunId, e.name])).toEqual([
      ['ag-run/agent/0/step-p/x/seed#52', 'step-p/x'],
      ['ag-run/agent/0/step-p/y/seed#54', 'step-p/y'],
    ]);
    expect(started.every((e) => e.parentSubagentRunId === undefined)).toBe(true);
    const x = started[0]!.subagentRunId;
    const y = started[1]!.subagentRunId;
    const byMessage = new Map<string, Set<string | undefined>>();
    for (const e of [...only(out, 'TEXT_MESSAGE_START'), ...only(out, 'TEXT_MESSAGE_CONTENT')]) {
      const seen = byMessage.get(e.messageId) ?? new Set();
      seen.add(e.subagentRunId);
      byMessage.set(e.messageId, seen);
    }
    expect([...byMessage.values()].map((owners) => [...owners])).toEqual([[x], [y]]);
    const text = (owner: string) =>
      only(out, 'TEXT_MESSAGE_CONTENT')
        .filter((e) => e.subagentRunId === owner)
        .map((e) => e.delta)
        .join('');
    expect([text(x), text(y)]).toEqual(['Xx', 'Yy']);
    expect(only(out, 'SUBAGENT_FINISHED').map((e) => [e.subagentRunId, e.result])).toEqual([
      [x, 'Xx'],
      [y, 'Yy'],
    ]);
    // The composition is a step of the parent, under its mount — its id stays out of the name.
    expect(only(out, 'STEP_STARTED').map((e) => [e.stepName, e.subagentRunId])).toEqual([
      ['Parallel:step-p', undefined],
    ]);
    expect(only(out, 'STEP_FINISHED').map((e) => e.stepName)).toEqual(['Parallel:step-p']);
  });

  it('a turn_end it never saw open is shown as the event it is — never taken for the root’s answer', () => {
    const { s, out } = feed([
      ev(t('composition.enter'), { kind: 'Sequence' }, { rsid: 'seed#0' }),
      ev(
        t('agent.turn_end'),
        { turnIndex: 0, finalContent: 'orphan' },
        { rsid: 'step-a/final/prepare-final#9', path: ['step-a', 'final'] },
      ),
    ]);
    expect(only(out, 'CUSTOM').map((e) => e.name)).toEqual(['agentfootprint.agent.turn_end']);
    expect(only(out, 'STEP_FINISHED')).toEqual([]);
    expect(s.settle({ kind: 'finished' }).at(-1)).not.toHaveProperty('result');
  });

  it('a turn mounted inside another turn names its parent', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'outer/seed#2', path: ['outer'] }),
      ev(
        t('agent.turn_start'),
        { turnIndex: 0 },
        { rsid: 'outer/inner/seed#4', path: ['outer', 'inner'] },
      ),
    ]);
    const [outer, inner] = only(out, 'SUBAGENT_STARTED');
    expect(inner!.parentSubagentRunId).toBe(outer!.subagentRunId);
  });

  it('a turn its composition left without an answer (a tolerated failure) ends in SUBAGENT_ERROR', () => {
    const { out } = feed([
      ev(t('composition.enter'), { kind: 'Parallel' }, { rsid: 'seed#0' }),
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'bad/seed#4', path: ['bad'] }),
      ev(
        t('agent.iteration_start'),
        { turnIndex: 0, iterIndex: 1 },
        { rsid: 'bad/call-llm#40', path: ['bad'] },
      ),
      ev(t('composition.exit'), { kind: 'Parallel', status: 'ok' }, { rsid: 'merge#47' }),
    ]);
    const handle = only(out, 'SUBAGENT_STARTED')[0]!.subagentRunId;
    expect(out.map((e) => e.type).slice(-3)).toEqual([
      'STEP_FINISHED',
      'SUBAGENT_ERROR',
      'STEP_FINISHED',
    ]);
    expect(only(out, 'SUBAGENT_ERROR')[0]).toEqual({
      type: 'SUBAGENT_ERROR',
      subagentRunId: handle,
      message: AG_UI_SUBAGENT_UNFINISHED,
    });
  });

  it('iterations are steps of their agent; a step the record never closed is closed before it reopens', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('agent.iteration_start'), { turnIndex: 0, iterIndex: 1 }, { rsid: 'call-llm#5' }),
      ev(t('agent.iteration_start'), { turnIndex: 0, iterIndex: 1 }, { rsid: 'call-llm#9' }),
      ev(t('agent.iteration_end'), { turnIndex: 0, iterIndex: 1 }, { rsid: 'tool-calls#10' }),
    ]);
    expect(out.filter((e) => e.type.startsWith('STEP')).map((e) => e.type)).toEqual([
      'STEP_STARTED',
      'STEP_FINISHED',
      'STEP_STARTED',
      'STEP_FINISHED',
    ]);
  });
});

describe('agUiSerializer — terminals', () => {
  it('a pause ends the run with an interrupt naming the paused call; its sub-agent is suspended', () => {
    const { s } = feed([
      ev(t('composition.enter'), { kind: 'Sequence' }, { rsid: 'seed#0' }),
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'step-a/seed#2', path: ['step-a'] }),
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'step-b/seed#3', path: ['step-b'] }),
      ev(
        t('agent.iteration_start'),
        { turnIndex: 0, iterIndex: 1 },
        { rsid: 'step-a/call-llm#5', path: ['step-a'] },
      ),
      ev(
        t('stream.tool_start'),
        { toolName: 'ask', toolCallId: 'p1', args: {} },
        { rsid: 'step-a/tool-calls#8', path: ['step-a'] },
      ),
      ev(
        t('pause.request'),
        {
          reason: 'stage requested pause',
          questionPayload: { question: 'Approve?', toolCallId: 'p1' },
        },
        { rsid: 'step-a/tool-calls#paused', path: ['step-a'] },
      ),
    ]);
    const closing = s.settle({ kind: 'paused' });
    const finished = closing.at(-1) as Extract<AgUiEvent, { type: 'RUN_FINISHED' }>;
    expect(finished.type).toBe('RUN_FINISHED');
    const outcome = finished.outcome as Extract<
      NonNullable<typeof finished.outcome>,
      { type: 'interrupt' }
    >;
    expect(outcome.type).toBe('interrupt');
    const [interrupt] = outcome.interrupts;
    expect(interrupt).toMatchObject({
      id: 'ag-run/interrupt/0/step-a/tool-calls#paused',
      reason: 'stage requested pause',
      message: 'Approve?',
      toolCallId: 'ag-run/tool/0/step-a/tool-calls#8',
      subagentRunId: 'ag-run/agent/0/step-a/seed#2',
      metadata: { agentfootprint: { question: { question: 'Approve?', toolCallId: 'p1' } } },
    });
    const suspended = only(closing, 'SUBAGENT_FINISHED');
    expect(suspended.map((e) => [e.subagentRunId, e.outcome])).toEqual([
      ['ag-run/agent/0/step-b/seed#3', { type: 'suspended' }],
      ['ag-run/agent/0/step-a/seed#2', { type: 'suspended', interruptIds: [interrupt!.id] }],
    ]);
    // Every step closed before the run did.
    expect(only(closing, 'STEP_FINISHED').map((e) => e.stepName)).toEqual([
      'iteration 1',
      'Sequence',
    ]);
  });

  it('a failure is RUN_ERROR in the record’s own words, and nothing is closed before it', () => {
    const { s } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('agent.iteration_start'), { turnIndex: 0, iterIndex: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('error.fatal'),
        { error: 'The AI call failed: provider down', stage: '__root__', scope: 'run' },
        { rsid: '__root__#0' },
      ),
    ]);
    expect(
      s.settle({
        kind: 'failed',
        error: Object.assign(new Error('raw secret'), { code: 'ECONNRESET' }),
      }),
    ).toEqual([
      {
        type: 'RUN_ERROR',
        message: 'The AI call failed: provider down',
        code: 'ECONNRESET',
        metadata: { agentfootprint: { runId: 'run-100-1' } },
      },
    ]);
  });

  it('a failure the record never described says only that, never the thrown message', () => {
    const { s } = feed([]);
    const [, error] = s.settle({ kind: 'failed', error: new TypeError('input was "my password"') });
    expect(error).toEqual({ type: 'RUN_ERROR', message: AG_UI_RUN_FAILED, code: 'TypeError' });
  });

  it('a cancelled run closes its open sub-agents and ends with the cancelled outcome', () => {
    const { s } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'a/seed#2', path: ['a'] }),
    ]);
    const closing = s.settle({ kind: 'cancelled' });
    expect(only(closing, 'SUBAGENT_ERROR')[0]).toMatchObject({
      message: AG_UI_SUBAGENT_CANCELLED,
      code: 'cancelled',
    });
    expect(closing.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'cancelled' } });
  });
});

describe('agUiSerializer — CUSTOM', () => {
  it('an event with no AG-UI equivalent goes out as CUSTOM, attributed and addressed', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'a/seed#2', path: ['a'] }),
      ev(
        t('cost.tick'),
        { scope: 'iteration', model: 'm', usd: 0.01 },
        { rsid: 'a/call-llm#4', path: ['a'] },
      ),
    ]);
    expect(only(out, 'CUSTOM')[0]).toMatchObject({
      name: 'agentfootprint.cost.tick',
      value: { scope: 'iteration', model: 'm', usd: 0.01 },
      subagentRunId: 'ag-run/agent/0/a/seed#2',
      metadata: { agentfootprint: { runtimeStageId: 'a/call-llm#4', subflowPath: ['a'] } },
    });
  });

  it('`custom` chooses which of them go out; the mapped events never do', () => {
    const { out } = feed(
      [
        ev(t('context.injected'), { rawContent: 'system prompt' }),
        ev(t('cost.tick'), { scope: 'turn' }),
        ev(t('stream.llm_start'), { iteration: 1 }),
      ],
      { custom: (e) => e.type === 'agentfootprint.cost.tick' },
    );
    expect(only(out, 'CUSTOM').map((e) => e.name)).toEqual(['agentfootprint.cost.tick']);
  });
});
