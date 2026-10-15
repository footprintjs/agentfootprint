/**
 * agUiSerializer — unit tests over hand-built event sequences.
 *
 * Each block pins one rule of the mapping (`src/ag-ui/serializer.ts` header):
 * the run lifecycle, text, tool calls, reasoning, sub-agents and steps, the
 * three terminals, and the guards (one settle, one run, the CUSTOM allow-list,
 * reasoning only on request).
 * Real runs through the official client live in `contract.test.ts` and
 * `scenario.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { AgentfootprintEvent } from '../../src/index.js';
import {
  AG_UI_CUSTOM_EVENTS,
  AG_UI_RUN_FAILED,
  AG_UI_SUBAGENT_CANCELLED,
  AG_UI_SUBAGENT_UNFINISHED,
  agUiSerializer,
  type AgUiSerializerOptions,
} from '../../src/ag-ui/serializer.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';
import { LLM_ERROR_SENTENCES } from '../../src/lib/humanizeLLMError.js';

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
  options: Omit<AgUiSerializerOptions, 'threadId' | 'runId'> = {},
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

  it("never translates another run's event; an event of no run (a consumer emit) can go out as CUSTOM", () => {
    const { out } = feed(
      [
        ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
        ev(
          t('stream.token'),
          { iteration: 1, tokenIndex: 0, content: 'other' },
          { runId: 'run-999-9' },
        ),
        ev('app.note', { note: 'mine' }, { runId: 'consumer-scope' }),
      ],
      { custom: { 'app.note': (p) => ({ note: p.note }) } },
    );
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

  it('a result the record cannot tie to a call this run opened is never attached to one', () => {
    const { out } = feed([
      ...opening,
      ev(t('stream.tool_end'), { toolCallId: 'ghost', result: 'x' }, { rsid: 'tool-calls#8' }),
    ]);
    expect(only(out, 'TOOL_CALL_RESULT')).toEqual([]);
    expect(only(out, 'CUSTOM')).toEqual([]);
  });
});

describe('agUiSerializer — reasoning', () => {
  it('streamed thinking is one reasoning span and message, closed at thinking_end', () => {
    const { out } = feed(
      [
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
      ],
      { reasoning: true },
    );
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
    const { out } = feed(
      [
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
      ],
      { reasoning: true },
    );
    expect(only(out, 'REASONING_MESSAGE_CONTENT').map((e) => e.delta)).toEqual(['first', 'next']);
    expect(only(out, 'REASONING_START')).toHaveLength(1);
    expect(only(out, 'REASONING_END')).toHaveLength(1);
  });

  it('writes no reasoning unless the app asks — a chain of thought is not shown by default', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('stream.llm_start'), { iteration: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('stream.thinking_delta'),
        { iteration: 1, tokenIndex: 0, content: 'private' },
        { rsid: 'call-llm#5' },
      ),
      ev(
        t('stream.thinking_end'),
        {
          iteration: 1,
          blockCount: 1,
          totalChars: 7,
          blocks: [{ type: 'thinking', content: 'private' }],
        },
        { rsid: 'sf-thinking/normalize#6', path: ['sf-thinking'] },
      ),
    ]);
    expect(out.some((e) => e.type.startsWith('REASONING'))).toBe(false);
    expect(JSON.stringify(out)).not.toContain('private');
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

  it('a turn_end it never saw open is never taken for the root’s answer', () => {
    const { s, out } = feed([
      ev(t('composition.enter'), { kind: 'Sequence' }, { rsid: 'seed#0' }),
      ev(
        t('agent.turn_end'),
        { turnIndex: 0, finalContent: 'orphan' },
        { rsid: 'step-a/final/prepare-final#9', path: ['step-a', 'final'] },
      ),
    ]);
    expect(only(out, 'CUSTOM')).toEqual([]);
    expect(only(out, 'TEXT_MESSAGE_CONTENT')).toEqual([]);
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
    });
    // The question's text only — nothing else of the pause's payload reaches the wire.
    expect(interrupt!.metadata?.agentfootprint).toEqual({
      runtimeStageId: 'step-a/tool-calls#paused',
      subflowPath: ['step-a'],
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

  it('a failure is RUN_ERROR in the record’s fixed words, and nothing is closed before it', () => {
    const { s } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('agent.iteration_start'), { turnIndex: 0, iterIndex: 1 }, { rsid: 'call-llm#5' }),
      ev(
        t('error.fatal'),
        { error: LLM_ERROR_SENTENCES.rateLimited, stage: '__root__', scope: 'run' },
        { rsid: '__root__#0' },
      ),
    ]);
    expect(s.settle({ kind: 'failed' })).toEqual([
      {
        type: 'RUN_ERROR',
        message: LLM_ERROR_SENTENCES.rateLimited,
        metadata: { agentfootprint: { runId: 'run-100-1' } },
      },
    ]);
  });

  it('a failure the record describes by quoting the thrown message never repeats it', () => {
    const { s } = feed([
      ev(
        t('error.fatal'),
        {
          error: 'The AI call failed: card 4111 rejected for alice',
          stage: '__root__',
          scope: 'run',
        },
        { rsid: '__root__#0' },
      ),
    ]);
    expect(s.settle({ kind: 'failed' }).at(-1)).toEqual({
      type: 'RUN_ERROR',
      message: AG_UI_RUN_FAILED,
      metadata: { agentfootprint: { runId: 'run-100-1' } },
    });
  });

  it('a failure the record never described says only that', () => {
    const { s } = feed([]);
    const [, error] = s.settle({ kind: 'failed' });
    expect(error).toEqual({ type: 'RUN_ERROR', message: AG_UI_RUN_FAILED });
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

describe('agUiSerializer — CUSTOM is an allow-list', () => {
  it('an allow-listed event goes out with ONLY its listed fields, attributed and addressed', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'a/seed#2', path: ['a'] }),
      ev(
        t('cost.tick'),
        { scope: 'iteration', model: 'm', tokensInput: 3, estimatedUsd: 0.01, extra: 'not listed' },
        { rsid: 'a/call-llm#4', path: ['a'] },
      ),
    ]);
    expect(only(out, 'CUSTOM')).toEqual([
      {
        type: 'CUSTOM',
        name: 'agentfootprint.cost.tick',
        value: { scope: 'iteration', model: 'm', tokensInput: 3, estimatedUsd: 0.01 },
        timestamp: expect.any(Number),
        subagentRunId: 'ag-run/agent/0/a/seed#2',
        metadata: { agentfootprint: { runtimeStageId: 'a/call-llm#4', subflowPath: ['a'] } },
      },
    ]);
  });

  it('by default, the record’s content stays off the wire: the prompt, a raw retry error, credentials', () => {
    const { out } = feed([
      ev(t('context.injected'), { rawContent: 'SYSTEM-PROMPT-SECRET', slot: 'system-prompt' }),
      ev(t('error.retried'), {
        attempt: 1,
        maxAttempts: 3,
        lastError: 'token sk-LEAK',
        backoffMs: 10,
        reason: 'x',
      }),
      ev(t('credential.acquired'), { service: 'crm', kind: 'bearer' }),
      ev(t('memory.attached'), { memoryId: 'm1', contentSummary: 'MEMORY-SECRET' }),
    ]);
    expect(only(out, 'CUSTOM')).toEqual([
      expect.objectContaining({
        name: 'agentfootprint.error.retried',
        value: { attempt: 1, maxAttempts: 3, backoffMs: 10 },
      }),
    ]);
    for (const secret of ['SYSTEM-PROMPT-SECRET', 'sk-LEAK', 'crm', 'MEMORY-SECRET'])
      expect(JSON.stringify(out)).not.toContain(secret);
  });

  it('a progress report names the AG-UI tool call it belongs to', () => {
    const { out } = feed([
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(
        t('stream.tool_start'),
        { toolName: 'crawl', toolCallId: 'c9', args: {} },
        { rsid: 'tool-calls#8' },
      ),
      ev(
        t('stream.tool_progress'),
        { toolCallId: 'c9', toolName: 'crawl', iteration: 1, payload: { done: 3, total: 12 } },
        { rsid: 'tool-calls#8' },
      ),
    ]);
    expect(only(out, 'CUSTOM')[0]!.value).toEqual({
      toolCallId: 'ag-run/tool/0/tool-calls#8',
      iteration: 1,
      payload: { done: 3, total: 12 },
    });
  });

  it('`custom` replaces the list: `{}` sends none; spreading the default adds one; mapped events never go', () => {
    const events = [
      ev(t('context.injected'), { rawContent: 'prompt', slot: 'system-prompt' }),
      ev(t('cost.tick'), { scope: 'turn' }),
      ev(t('stream.llm_start'), { iteration: 1 }),
    ];
    expect(only(feed(events, { custom: {} }).out, 'CUSTOM')).toEqual([]);
    const widened = feed(events, {
      custom: {
        ...AG_UI_CUSTOM_EVENTS,
        'agentfootprint.context.injected': (p) => ({ slot: p.slot }),
        'agentfootprint.stream.llm_start': () => ({ never: true }),
      },
    }).out;
    expect(only(widened, 'CUSTOM').map((e) => [e.name, e.value])).toEqual([
      ['agentfootprint.context.injected', { slot: 'system-prompt' }],
      ['agentfootprint.cost.tick', { scope: 'turn' }],
    ]);
  });
});

describe('agUiSerializer — which run, and a run that continues another', () => {
  it('`owns` decides which events are the run’s, whichever run spoke first', () => {
    const mine = (e: AgentfootprintEvent) => e.meta.runId === 'run-mine';
    const { out } = feed(
      [
        ev(
          t('stream.token'),
          { iteration: 1, tokenIndex: 0, content: 'theirs' },
          { runId: 'run-x' },
        ),
        ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0', runId: 'run-mine' }),
        ev(
          t('stream.token'),
          { iteration: 1, tokenIndex: 0, content: 'mine' },
          { runId: 'run-mine' },
        ),
      ],
      { owns: mine },
    );
    expect(out[0]).toMatchObject({ type: 'RUN_STARTED' });
    expect(out[0]!.metadata?.agentfootprint?.runId).toBe('run-mine');
    expect(only(out, 'TEXT_MESSAGE_CONTENT').map((e) => e.delta)).toEqual(['mine']);
  });

  it('opens nothing until the run names itself — the resume’s own bookkeeping names no run', () => {
    const s = agUiSerializer({ threadId: 'thread-1', runId: 'ag-run' });
    expect(
      s.event(
        ev(t('pause.resume'), { resumeInput: { input: 'yes' } }, { runId: 'consumer-scope' }),
      ),
    ).toEqual([]);
    const first = s.event(ev(t('agent.iteration_start'), { iterIndex: 2 }, { rsid: 'call-llm#9' }));
    expect(first[0]).toMatchObject({ type: 'RUN_STARTED' });
    expect(first[0]!.metadata?.agentfootprint?.runId).toBe('run-100-1');
  });

  it('a pause records what its continuation needs; any other ending records nothing', () => {
    const events = [
      ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
      ev(t('agent.iteration_start'), { iterIndex: 1 }, { rsid: 'call-llm#1' }),
      ev(
        t('stream.tool_start'),
        { toolName: 'ask', toolCallId: 'c1', args: {} },
        { rsid: 'tool-calls#2' },
      ),
      ev(
        t('pause.request'),
        { reason: 'r', questionPayload: { question: 'Sure?' } },
        { rsid: 'tool-calls#paused', runId: 'consumer-scope' },
      ),
    ];
    const paused = feed(events);
    const end = paused.s.settle({ kind: 'paused' });
    const finished = end.at(-1) as Extract<AgUiEvent, { type: 'RUN_FINISHED' }>;
    if (finished.outcome?.type !== 'interrupt') throw new Error('expected an interrupt');
    expect(paused.s.suspension()).toEqual({
      version: 1,
      runId: 'ag-run',
      interruptId: finished.outcome.interrupts[0]!.id,
      call: { toolCallId: 'ag-run/tool/0/tool-calls#2', mount: [], client: false },
      rootAgent: true,
      scopes: [
        {
          mount: [],
          steps: ['iteration 1'],
          calls: [{ toolCallId: 'ag-run/tool/0/tool-calls#2', client: false }],
          messageId: 'ag-run/text/0/tool-calls#2',
        },
      ],
    });

    const done = feed(events);
    done.s.settle({ kind: 'finished' });
    expect(done.s.suspension()).toBeUndefined();
  });

  it('a pause that waits on the caller with no call open is an interrupt like any other', () => {
    const { s } = feed([ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' })]);
    const end = s.settle({ kind: 'paused', awaiting: 'caller' });
    expect(end.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'interrupt' } });
  });

  it('a continuation re-opens the sub-agents and steps it was handed, then answers the open call', () => {
    const s = agUiSerializer({
      threadId: 'thread-1',
      runId: 'ag-2',
      resume: {
        version: 1,
        runId: 'ag-1',
        interruptId: 'ag-1/interrupt/0/x',
        call: { toolCallId: 'ag-1/tool/0/x/tool-calls#5', mount: ['p', 'x'], client: false },
        rootAgent: false,
        scopes: [
          { mount: [], steps: ['Sequence'], calls: [] },
          {
            mount: ['p', 'x'],
            subagentRunId: 'ag-1/agent/0/x',
            name: 'p/x',
            steps: ['iteration 1'],
            calls: [{ toolCallId: 'ag-1/tool/0/x/tool-calls#5', client: false }],
          },
        ],
      },
    });
    const out = s.event(
      ev(t('stream.tool_end'), { result: 'yes' }, { rsid: 'p/x/tool-calls#9', path: ['p', 'x'] }),
    );
    expect(out.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'STEP_STARTED',
      'SUBAGENT_STARTED',
      'STEP_STARTED',
      'TOOL_CALL_RESULT',
    ]);
    expect(out[2]).toMatchObject({ subagentRunId: 'ag-1/agent/0/x', name: 'p/x' });
    expect(out[3]).toMatchObject({ stepName: 'iteration 1', subagentRunId: 'ag-1/agent/0/x' });
    expect(out[4]).toMatchObject({
      toolCallId: 'ag-1/tool/0/x/tool-calls#5',
      content: 'yes',
      subagentRunId: 'ag-1/agent/0/x',
    });
  });
});

describe('agUiSerializer — a pause is kept before the caller is told', () => {
  const events = [
    ev(t('agent.turn_start'), { turnIndex: 0 }, { rsid: 'seed#0' }),
    ev(
      t('stream.tool_start'),
      { toolName: 'ask', toolCallId: 'c1', args: {} },
      { rsid: 'tool-calls#2' },
    ),
    ev(
      t('pause.request'),
      { reason: 'r', questionPayload: { question: 'Sure?' } },
      { rsid: 'tool-calls#paused', runId: 'consumer-scope' },
    ),
  ];

  it('the record asked for before settling is the one the settlement hands out', () => {
    const { s } = feed(events);
    const kept = s.suspension('person');
    const end = s.settle({ kind: 'paused', awaiting: 'person' });
    const finished = end.at(-1) as Extract<AgUiEvent, { type: 'RUN_FINISHED' }>;
    if (finished.outcome?.type !== 'interrupt') throw new Error('expected an interrupt');
    expect(kept?.interruptId).toBe(finished.outcome.interrupts[0]!.id);
    expect(s.suspension()).toEqual(kept);
  });

  it('…for a tool the client runs too', () => {
    const { s } = feed(events);
    const kept = s.suspension('caller');
    s.settle({ kind: 'paused', awaiting: 'caller' });
    expect(kept?.call).toEqual({
      toolCallId: 'ag-run/tool/0/tool-calls#2',
      mount: [],
      client: true,
    });
    expect(s.suspension()).toEqual(kept);
  });

  it('a pause that could not be kept settles as a failure, and leaves no record', () => {
    const { s } = feed(events);
    s.suspension('person');
    expect(s.settle({ kind: 'failed' }).at(-1)).toMatchObject({ type: 'RUN_ERROR' });
    expect(s.suspension()).toBeUndefined();
  });
});

describe('agUiSerializer — a call the continuation dispatches belongs to the response that made it', () => {
  it('joins the assistant message the paused run’s response opened', () => {
    const s = agUiSerializer({
      threadId: 'thread-1',
      runId: 'ag-2',
      resume: {
        version: 1,
        runId: 'ag-1',
        interruptId: 'ag-1/interrupt/0/x',
        rootAgent: true,
        scopes: [
          {
            mount: [],
            steps: [],
            calls: [{ toolCallId: 'ag-1/tool/0/tool-calls#5', client: false }],
            messageId: 'ag-1/text/0/call-llm#4',
          },
        ],
      },
    });
    const out = [
      ...s.event(ev(t('stream.tool_end'), { result: 'yes' }, { rsid: 'tool-calls#9' })),
      ...s.event(
        ev(t('stream.tool_start'), { toolName: 'next', args: {} }, { rsid: 'tool-calls#9' }),
      ),
    ];
    expect(only(out, 'TOOL_CALL_START')[0]!.parentMessageId).toBe('ag-1/text/0/call-llm#4');
  });
});
