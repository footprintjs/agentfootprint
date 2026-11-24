import { expect, it } from 'vitest';
import type {
  AnthropicMessage,
  AnthropicMessagesBody,
} from '../../../src/adapters/llm/anthropicMessagesWire.js';
import { withFallback } from '../../../src/doors/resilience.js';
import {
  Agent,
  coverage,
  defineTool,
  epochAt,
  isInputPause,
  servedAt,
} from '../../../src/index.js';
import { LATE_RECORD_NOTE_ATTRIBUTION } from '../../../src/lib/saidByPerson.js';
import { sha256Hex } from '../../../src/lib/sha256.js';
import { anthropic, openai } from '../../../src/providers.js';
import { isPlaceholder } from '../../../src/redaction/marker.js';
import { readAfterCall } from '../../../src/time-travel/epochs.js';

import {
  lateNoteLookupTool as lookupTool,
  lateNoteModel as model,
  lateNoteWhy as why,
  recordedLateNoteRun as recordedRun,
  scriptedLateNoteSdk as scriptedSdk,
  type LateNoteSnapshotState as SnapshotState,
} from '../../helpers/lateRecordNoteSdk.js';

const variants = (['dynamic', 'dynamic-grouped'] as const).flatMap((reactMode) =>
  (['inline', 'deferred'] as const).flatMap((observerDelivery) =>
    (['full', 'delta'] as const).map((commitValues) => ({
      reactMode,
      observerDelivery,
      commitValues,
    })),
  ),
);

it.each(variants)(
  'witnesses a real $reactMode SDK note with $observerDelivery delivery and $commitValues records',
  async (options) => {
    const off = await recordedRun(options, false);
    const on = await recordedRun(options, true);
    expect(off.requests).toHaveLength(2);
    expect(on.requests).toHaveLength(2);
    expect(on.requests[0]).toEqual(off.requests[0]);
    expect(on.answer).toEqual(off.answer);
    expect(off.state).not.toHaveProperty('lateRecordNoteReceipt');

    const followUp = on.requests[1];
    const note = followUp?.messages.at(-1);
    expect(note?.role).toBe('user');
    const [opening, payload] = note?.content?.split('\n') ?? [];
    expect(opening).toBe(LATE_RECORD_NOTE_ATTRIBUTION);
    expect(JSON.parse(payload ?? 'null')).toEqual([
      { owner: 'tool', kind: 'notChecked', tool: 'Attachment lookup', why },
    ]);
    expect({ ...followUp, messages: followUp?.messages.slice(0, -1) }).toEqual(off.requests[1]);

    const submitted = { ordinal: 1, disposition: 'submitted' };
    expect(on.state?.lateRecordNoteReceipt).toHaveLength(1);
    expect(on.state?.lateRecordNoteReceipt?.[0]).toEqual({
      attempts: [submitted],
      accepted: submitted,
    });
    expect(on.state?.history).toContainEqual(expect.objectContaining({ role: 'tool' }));
    expect(JSON.stringify(on.state?.history)).not.toContain(LATE_RECORD_NOTE_ATTRIBUTION);

    const saved: unknown = JSON.parse(JSON.stringify(on.snapshot));
    const savedOff: unknown = JSON.parse(JSON.stringify(off.snapshot));
    const first = servedAt(saved, 1);
    const second = servedAt(saved, 2);
    if (first === undefined || second === undefined || typeof note?.content !== 'string')
      throw new Error('Fixture expected both saved call views and a submitted SDK note');
    expect(first.lateRecordNote).toEqual({
      disposition: 'omitted',
      pointer: { callRuntimeStageId: first.callRuntimeStageId, ordinal: 1 },
    });
    expect(second.lateRecordNote).toEqual({
      disposition: 'submitted',
      pointer: { callRuntimeStageId: second.callRuntimeStageId, ordinal: 1 },
    });
    expect(first.callRuntimeStageId).not.toBe(second.callRuntimeStageId);
    expect(servedAt(on.snapshot, 2)?.lateRecordNote).toEqual(second.lateRecordNote);
    for (const epoch of [1, 2]) {
      const baseline = servedAt(savedOff, epoch);
      expect(baseline?.epoch).toBe(epoch);
      expect(baseline).not.toHaveProperty('lateRecordNote');
    }

    const digest = sha256Hex(JSON.stringify(note.content));
    const publicView = JSON.stringify([first, second]);
    expect(publicView).not.toContain(LATE_RECORD_NOTE_ATTRIBUTION);
    expect(publicView).not.toContain(digest);
    expect(publicView).not.toContain('recordNoteWireProof');
    expect(JSON.stringify(saved).includes(LATE_RECORD_NOTE_ATTRIBUTION)).toBe(false);
    expect(
      JSON.stringify(saved).includes(digest),
      'private proof leaked into the native snapshot',
    ).toBe(false);
    const located = epochAt(saved, 2);
    if (located === undefined) throw new Error('Fixture expected a native call location');
    const proof = readAfterCall(located, 'recordNoteWireProof');
    for (const value of [proof, on.state.recordNoteWireProof]) {
      if (value !== undefined) expect(isPlaceholder(value)).toBe(true);
    }
  },
);

const redactionVariants = [
  { reactMode: 'dynamic', observerDelivery: 'inline', commitValues: 'full' },
  { reactMode: 'dynamic-grouped', observerDelivery: 'deferred', commitValues: 'delta' },
] as const;

it.each(redactionVariants)(
  'keeps a hidden WHY off the SDK and the served $reactMode record',
  async (options) => {
    const redact = { fields: { coverageDeclared: ['0.notChecked.0.why'], history: ['2.content'] } };
    const hidden = [
      'private archival timestamp phrase',
      'second withheld archival status',
    ] as const;
    const first = await recordedRun(options, true, hidden[0], redact);
    const second = await recordedRun(options, true, hidden[1], redact);
    const followUp = first.requests[1];
    const note = followUp?.messages.at(-1);
    expect(note?.role).toBe('user');
    const [opening, payload] = note?.content?.split('\n') ?? [];
    expect(opening).toBe(LATE_RECORD_NOTE_ATTRIBUTION);
    expect(JSON.parse(payload ?? 'null')).toEqual([
      { owner: 'tool', kind: 'notChecked', tool: 'Attachment lookup' },
    ]);
    expect(note).toEqual(second.requests[1]?.messages.at(-1));

    // The ordinary tool row is outside the late-note projection. The existing
    // SDK delivery stays byte-identical with the feature off for each run.
    for (const [armed, reason] of [
      [first, hidden[0]],
      [second, hidden[1]],
    ] as const) {
      const baseline = await recordedRun(options, false, reason, redact);
      expect(armed.requests[0]).toEqual(baseline.requests[0]);
      expect(armed.requests[1]?.messages.slice(0, -1)).toEqual(baseline.requests[1]?.messages);
    }

    const submitted = { ordinal: 1, disposition: 'submitted' };
    const publicReceipt = [{ attempts: [submitted], accepted: submitted }];
    const publicHistory = ({ state }: typeof first) =>
      state?.history?.map(({ role, content }) => ({ role, content }));
    expect(publicHistory(first)).toEqual(publicHistory(second));
    for (const result of [first, second]) {
      expect(result.state?.lateRecordNoteReceipt).toEqual(publicReceipt);
      expect(result.state?.history).toContainEqual(expect.objectContaining({ role: 'tool' }));
      const noteFields = Object.fromEntries(
        Object.entries(result.state ?? {}).filter(([key]) => key.startsWith('lateRecordNote')),
      );
      expect(noteFields).toEqual({ lateRecordNoteReceipt: publicReceipt });
      const served = JSON.stringify({
        noteFields,
        history: result.state?.history,
        coverageDeclared: result.state?.coverageDeclared,
        answer: result.answer,
      });
      for (const reason of hidden) expect(served).not.toContain(reason);
    }
  },
);

it('keeps the abandoned plain handoff separate from the accepted signing fallback', async () => {
  const signedModel = 'claude-sonnet-4-6';
  const open = scriptedSdk(true);
  const signedRequests: AnthropicMessagesBody[] = [];
  const signedResponse: AnthropicMessage = {
    id: 'signed-answer',
    model: signedModel,
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Scripted private thought.', signature: 'scripted-signature' },
      { type: 'text', text: 'The archive remained unchecked.' },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 3 },
  };
  const signing = anthropic({
    _client: {
      messages: {
        async create() {
          throw new Error('Expected native streaming fallback');
        },
        stream(body) {
          signedRequests.push(body);
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'message_stop' };
            },
            async finalMessage() {
              return signedResponse;
            },
          };
        },
      },
    },
  });
  const agent = Agent.create({
    provider: withFallback(openai({ _client: open.client }), signing),
    model: signedModel,
    lateRecordNotes: true,
  })
    .tool(lookupTool(why))
    .build();
  try {
    const answer = await agent.run({ message: 'Read the attachment index.' });
    expect(answer).toEqual(expect.stringMatching(/^The archive remained unchecked\./u));
    expect(open.requests).toHaveLength(2);
    expect(open.requests[1]?.messages.at(-1)?.content).toContain(LATE_RECORD_NOTE_ATTRIBUTION);
    expect(signedRequests).toHaveLength(1);
    expect(JSON.stringify(signedRequests)).not.toContain(LATE_RECORD_NOTE_ATTRIBUTION);
    const state = agent.getLastSnapshot()?.sharedState as SnapshotState | undefined;
    const omitted = { ordinal: 2, disposition: 'omitted' };
    expect(state?.lateRecordNoteReceipt).toEqual([
      { attempts: [{ ordinal: 1, disposition: 'submitted' }, omitted], accepted: omitted },
    ]);
  } finally {
    await agent.shutdown();
  }
});

it('keeps each note tied to its call across a saved native input pause', async () => {
  const { client, requests } = scriptedSdk(false, '{"unit":"cm"}');
  const ran: string[] = [];
  const tool = defineTool({
    name: 'lookup',
    displayName: 'Attachment lookup',
    description: 'Read a measurement.',
    inputSchema: {
      type: 'object',
      properties: { unit: { type: 'string' } },
      required: ['unit'],
    } as const,
    askOrAssume: { unit: { ask: 'Which unit?', choices: ['cm', 'mm'] } },
    execute: ({ unit }) => {
      ran.push(unit);
      return coverage('The active measurement is available.', {
        checked: ['active measurement'],
        notChecked: [{ what: 'archived measurement', why }],
      });
    },
  });
  const agent = Agent.create({
    provider: openai({ _client: client }),
    model,
    lateRecordNotes: true,
    observerDelivery: 'deferred',
    commitValues: 'delta',
    redact: { fields: { coverageDeclared: ['0.notChecked.0.why'] } },
  })
    .tool(tool)
    .findings({ argumentSources: true })
    .build();
  try {
    const paused = await agent.run({ message: 'Read the measurement.' });
    if (!isInputPause(paused)) throw new Error('Fixture expected a native input pause');
    expect(ran).toEqual([]);
    expect(requests).toHaveLength(1);
    const pausedSnapshot: unknown = JSON.parse(JSON.stringify(agent.getLastSnapshot()));
    const before = servedAt(pausedSnapshot, 1);
    if (before === undefined) throw new Error('Fixture expected the paused call to be saved');
    expect(before.lateRecordNote).toEqual({
      disposition: 'omitted',
      pointer: { callRuntimeStageId: before.callRuntimeStageId, ordinal: 1 },
    });

    const finished = await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), {
      requestId: paused.awaitingInput.requestId,
      values: { f1: 'mm' },
    });
    expect(typeof finished).toBe('string');
    expect(ran).toEqual(['mm']);
    expect(requests).toHaveLength(2);
    const note = requests[1]?.messages.at(-1)?.content;
    const [opening, payload] = note?.split('\n') ?? [];
    expect(opening).toBe(LATE_RECORD_NOTE_ATTRIBUTION);
    expect(JSON.parse(payload ?? 'null')).toEqual([
      { owner: 'tool', kind: 'notChecked', tool: 'Attachment lookup' },
    ]);
    const resumedSnapshot: unknown = JSON.parse(JSON.stringify(agent.getLastSnapshot()));
    const after = servedAt(resumedSnapshot, 2);
    if (after === undefined) throw new Error('Fixture expected the resumed call to be saved');
    expect(after.lateRecordNote).toEqual({
      disposition: 'submitted',
      pointer: { callRuntimeStageId: after.callRuntimeStageId, ordinal: 1 },
    });
    expect(after.callRuntimeStageId).not.toBe(before.callRuntimeStageId);
    expect(servedAt(pausedSnapshot, 1)?.lateRecordNote).toEqual(before.lateRecordNote);
  } finally {
    await agent.shutdown();
  }
});
