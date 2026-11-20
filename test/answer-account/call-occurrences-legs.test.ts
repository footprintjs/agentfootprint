import { describe, expect, it } from 'vitest';

import { absent, Agent, defineTool, isInputPause, requestInput } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, answerAccountPointerKey, recordRun } from '../../src/observe.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';
import type { LLMMessage, LLMRequest } from '../../src/provider-contract/types.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { assertP1 } from './helpers.js';

function tool(name: string, execute: () => unknown) {
  return defineTool({
    name,
    description: 'Read fixture data.',
    inputSchema: { type: 'object', properties: {} },
    execute,
  });
}

const proposal = (id: string, name: string) => ({ id, name, args: {} });

function saved(recorder: ReturnType<typeof recordRun>): Recording {
  return JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
}

function completedAccount(recording: Recording) {
  const runId = recording.events.findLast((event) => event.type === 'agentfootprint.agent.turn_end')
    ?.meta.runId;
  if (runId === undefined) throw new Error('Expected a completed run in the fixture recording.');
  const account = accountForAnswer(recording, undefined, { runId });
  assertP1(account, recording, {});
  return account;
}

function resultPosition(recording: Recording, name: string): number {
  const { sharedState } = recording.snapshot as {
    sharedState: { history: readonly { role: string; toolName?: string }[] };
  };
  const index = sharedState.history.findIndex((m) => m.role === 'tool' && m.toolName === name);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('reused call IDs across recording boundaries', () => {
  it('holds the result before a pause and keeps the resumed end in its own execution', async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [proposal('lookup', 'find_archived_record')] },
          { toolCalls: [proposal('year', 'request_year')] },
          {
            toolCalls: [
              proposal('lookup', 'list_current_records'),
              proposal('year', 'list_months'),
            ],
          },
          { content: 'The current list is ready.' },
        ],
      }),
      model: 'mock',
    })
      .tools([
        tool('find_archived_record', () =>
          absent({
            what: 'the archived record',
            checked: [{ what: 'the fixture archive' }],
          }),
        ),
        tool('request_year', () =>
          requestInput({
            id: 'choose-year',
            question: 'Which year?',
            fields: [{ id: 'year', type: 'number', required: true }],
          }),
        ),
        tool('list_current_records', () => ['current a', 'current b']),
        tool('list_months', () => ['January', 'February', 'March']),
      ])
      .build();
    const recorder = recordRun(agent);
    try {
      const paused = await agent.run('Compare the archive with a year of current records.');
      if (!isInputPause(paused)) throw new Error('Expected the fixture to ask for a year.');
      const initial = saved(recorder);
      const start = initial.events.findIndex(
        (event) =>
          event.type === 'agentfootprint.stream.tool_start' &&
          event.payload.toolName === 'request_year',
      );
      expect(start).toBeGreaterThanOrEqual(0);
      expect(initial.events[start]?.meta.runtimeStageId).toEqual(expect.any(String));

      await agent.resume(paused.checkpoint, {
        requestId: paused.awaitingInput.requestId,
        values: { year: 2026 },
      });
      const recording = saved(recorder);
      const account = completedAccount(recording);
      const ends = recording.events.flatMap((event, index) =>
        event.type === 'agentfootprint.stream.tool_end' && event.payload.toolCallId === 'year'
          ? [{ index, stage: event.meta.runtimeStageId }]
          : [],
      );
      expect(ends).toHaveLength(2);
      const [resumed, months] = ends;
      expect(resumed?.stage).toEqual(expect.any(String));
      expect(months?.stage).toEqual(expect.any(String));
      expect(resumed?.stage).not.toBe(initial.events[start]?.meta.runtimeStageId);
      expect(months?.stage).not.toBe(resumed?.stage);

      expect(account.run.value?.resumedLeg).toBe(true);
      expect.soft(account.facts.beforePause).toEqual([
        expect.objectContaining({
          toolCallId: 'lookup',
          toolName: 'find_archived_record',
          emptiness: 'declared-absent',
          coverage: {
            kind: 'absent',
            lookedFor: 'the archived record',
            checked: 1,
            notChecked: 0,
            cannotCover: 0,
            kinds: 0,
          },
          pointers: expect.arrayContaining([
            expect.objectContaining({
              kind: 'history',
              index: resultPosition(recording, 'find_archived_record'),
              path: '/toolName',
            }),
          ]),
        }),
      ]);
      expect
        .soft(account.rows.find((row) => row.id === 'found')?.lines.map((line) => line.text))
        .toEqual(
          expect.arrayContaining([
            'Before the pause, find_archived_record looked for the archived record and reported no matching results.',
            'list_current_records returned 2 items.',
            'list_months returned 3 items.',
          ]),
        );
      expect(account.facts.calls.map(({ toolName, toolCallId }) => [toolName, toolCallId])).toEqual(
        [
          ['request_year', 'year'],
          ['list_current_records', 'lookup'],
          ['list_months', 'year'],
        ],
      );
      const [year, current, monthList] = account.facts.calls;
      expect(year?.pointers).toContainEqual(
        expect.objectContaining({
          kind: 'history',
          index: resultPosition(recording, 'request_year'),
          path: '/toolName',
        }),
      );
      expect(current).toMatchObject({ rows: 2, emptiness: 'non-empty' });
      expect(monthList).toMatchObject({ rows: 3, emptiness: 'non-empty' });
      for (const [call, end] of [
        [year, resumed],
        [monthList, months],
      ] as const) {
        const pointers = call?.pointers.filter((p) => p.kind === 'event') ?? [];
        expect(pointers).toContainEqual(
          expect.objectContaining({ index: end?.index, runtimeStageId: end?.stage }),
        );
        expect(pointers.every((p) => p.runtimeStageId === end?.stage)).toBe(true);
      }
    } finally {
      recorder.stop();
    }
  });

  it('distinguishes a prior result in view from a follow-up call with the same ID', async () => {
    const requests: LLMRequest[] = [];
    const fixture = mock({
      replies: [
        { toolCalls: [proposal('lookup', 'read_archive')] },
        { content: 'I found the archived record.' },
        { toolCalls: [proposal('lookup', 'read_current')] },
        { content: 'I found the current records.' },
      ],
    });
    const agent = Agent.create({
      provider: {
        name: fixture.name,
        complete(request) {
          requests.push(request);
          return fixture.complete(request);
        },
      },
      model: 'mock',
    })
      .tools([
        tool('read_archive', () => ['archived']),
        tool('read_current', () => ['current a', 'current b']),
      ])
      .build();
    const recorder = recordRun(agent);
    try {
      await agent.run('Read the archived record.');
      await agent.followUp('Now read the current records.');
      const recording = saved(recorder);
      const account = completedAccount(recording);
      const messages = recording.events.findLast(
        (event) =>
          event.type === 'agentfootprint.context.slot_composed' &&
          event.meta.runId === account.run.value?.runId &&
          event.payload.slot === 'messages',
      );
      expect(messages?.meta.runtimeStageId).toEqual(expect.any(String));
      const witnesses = recording.events.flatMap((event, index) =>
        event.type === 'agentfootprint.context.injected' &&
        event.meta.runId === messages?.meta.runId &&
        event.meta.runtimeStageId === messages?.meta.runtimeStageId &&
        event.payload.slot === 'messages' &&
        event.payload.source === 'tool-result' &&
        event.payload.sourceId === 'lookup'
          ? [{ index, position: event.payload.position, key: readCallOccurrenceKey(event.payload) }]
          : [],
      );
      const priorPosition = resultPosition(recording, 'read_archive');
      const currentPosition = resultPosition(recording, 'read_current');
      expect(witnesses.map(({ position }) => position)).toEqual([priorPosition, currentPosition]);
      const { sharedState } = recording.snapshot as {
        sharedState: { history: readonly LLMMessage[] };
      };
      expect(witnesses.map(({ key }) => key)).toEqual(
        [priorPosition, currentPosition].map((position) =>
          readCallOccurrenceKey(sharedState.history[position]),
        ),
      );
      expect(witnesses.map(({ key }) => key)).toEqual([expect.any(String), expect.any(String)]);
      expect(witnesses[0]?.key).not.toBe(witnesses[1]?.key);
      expect(requests.at(-1)?.messages.filter((message) => message.role === 'tool')).toHaveLength(
        2,
      );
      expect(JSON.stringify(requests)).not.toContain('callOccurrenceKey');

      expect(account.facts.calls).toEqual([
        expect.objectContaining({ toolCallId: 'lookup', toolName: 'read_current', rows: 2 }),
      ]);
      expect(account.facts.inView).toEqual([
        expect.objectContaining({
          toolCallId: 'lookup',
          toolName: 'read_archive',
          rows: 1,
          distance: 1,
          pointers: expect.arrayContaining([
            expect.objectContaining({
              kind: 'history',
              index: priorPosition,
              path: '/toolName',
            }),
            expect.objectContaining({
              kind: 'event',
              index: witnesses[0]?.index,
              path: '/sourceId',
            }),
          ]),
        }),
      ]);

      const found = account.rows.find((row) => row.id === 'found');
      expect(found?.lines.map((line) => line.text)).toContain('read_current returned 2 items.');
      const earlierLine = found?.lines.find((line) => line.template.id === 'found.inView');
      expect(earlierLine?.text).toContain('read_archive from an earlier answer');
      const priorRows = earlierLine?.pointers.find(
        (p) => p.kind === 'history' && p.path === '#emptiness',
      );
      if (priorRows === undefined)
        throw new Error('Expected a pointer to the earlier result count.');
      expect(showLeaves(account, recording)[answerAccountPointerKey(priorRows)]).toMatchObject({
        rows: 1,
      });
    } finally {
      recorder.stop();
    }
  });
});
