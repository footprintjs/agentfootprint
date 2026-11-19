import { describe, expect, it, vi } from 'vitest';

import {
  absent,
  Agent,
  allow,
  defineTool,
  deny,
  type ToolMiddleware,
} from '../../../../src/index.js';
import { toSSE } from '../../../../src/hosting/stream.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import { assessmentDataOf } from '../../../../src/core/agent/assessment/compose.js';
import type { AgentTurnEndPayload } from '../../../../src/events/payloads/agent.js';
import type { AnswerAssessedPayload } from '../../../../src/events/payloads/answer.js';
import type { Recording } from '../../../../src/recorders/observability/recordRun.js';

const BODY = 'Here is what I can report.';
const DIVIDER = '\n\n---\n\n';
const TOOL = 'lookup_private_archive';
const PRIVATE_GAP = 'archive partition 7';
const PRIVATE_STATUS = 'job 831 is waiting';
const NOT_HELD = '2026-09-26T02:00:00Z';
const NATIVE_ABSENCE = absent({
  what: 'backup records',
  checked: ['the old export'],
  cannotCover: [{ what: PRIVATE_GAP, why: 'not connected' }],
  period: {
    queried: { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' },
    held: { from: '2026-09-25T02:00:00Z', to: NOT_HELD },
  },
});
const NATIVE_PENDING = { content: PRIVATE_STATUS, effects: [], status: 'pending' as const };

type ResultRecording = Recording & {
  snapshot: {
    sharedState: {
      history: Record<string, unknown>[];
      middlewareDecisions?: unknown;
      coverageDeclared?: unknown;
      findingsLedger?: unknown;
    };
  };
};

async function readText(agent: Agent): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of toSSE(agent, { format: 'text' })) chunks.push(chunk);
  return chunks.join('');
}

async function run({
  hook,
  observerDelivery = 'inline',
  includePending = false,
  throws = false,
  columnRows,
}: {
  readonly hook?: NonNullable<ToolMiddleware['onToolResult']>;
  readonly observerDelivery?: 'inline' | 'deferred';
  readonly includePending?: boolean;
  readonly throws?: boolean;
  readonly columnRows?: readonly Record<string, unknown>[];
} = {}) {
  const execute = vi.fn(({ pending }: { pending?: boolean }) => {
    if (throws) throw new Error('Fixture archive failed.');
    return columnRows ?? (pending ? NATIVE_PENDING : NATIVE_ABSENCE);
  });
  const toolCalls = [
    { id: 'native-absence', name: TOOL, args: {} },
    ...(includePending ? [{ id: 'native-pending', name: TOOL, args: { pending: true } }] : []),
  ];
  let builder = Agent.create({
    provider: mock({ chunkDelayMs: 0, replies: [{ content: '', toolCalls }, BODY] }),
    model: 'mock',
    observerDelivery,
    ...(columnRows && { checkColumnTypes: 'warn' as const }),
  })
    .tool(
      defineTool({
        name: TOOL,
        description: 'Read the archive.',
        inputSchema: { type: 'object', properties: { pending: { type: 'boolean' } } },
        execute,
        ...(columnRows && { resultColumns: { logical_unit_number: 'number' } }),
      }),
    )
    .resultsLayer()
    .answerLayer({ standingLine: true });
  if (hook) builder = builder.toolMiddleware({ name: 'archive_rule', onToolResult: hook });

  const agent = builder.build();
  const turnEnds: AgentTurnEndPayload[] = [];
  const assessed: AnswerAssessedPayload[] = [];
  const offTurn = agent.on('agentfootprint.agent.turn_end', ({ payload }) =>
    turnEnds.push(payload),
  );
  const offAssessed = agent.on('agentfootprint.answer.assessed', ({ payload }) =>
    assessed.push(payload),
  );
  const recorder = recordRun(agent);
  const reading = readText(agent);
  try {
    const returned = await agent.run({ message: 'Check the archive.' });
    const sse = await reading;
    const recordingText = JSON.stringify(recorder.toRecording());
    const recording = JSON.parse(recordingText) as ResultRecording;
    const saved = assessAnswer(recording);
    expect(execute).toHaveBeenCalledTimes(toolCalls.length);
    expect(turnEnds).toHaveLength(1);
    expect(assessed).toHaveLength(1);
    const { turn, iteration, ...eventAssessment } = assessed[0]!;
    expect(turn).toBe(1);
    expect(iteration).toBe(2);
    return {
      returned,
      sse,
      turnEnd: turnEnds[0]!,
      eventAssessment,
      saved,
      recording,
      recordingText,
    };
  } finally {
    recorder.stop();
    offTurn();
    offAssessed();
  }
}

describe('standing reads results within the host rule', () => {
  it('a withheld error notice preserves the call failure without claiming a withheld return', async () => {
    const hook = vi.fn(() => deny('The error details are unavailable.'));
    const proof = await run({ throws: true, hook });
    expect(hook).toHaveBeenCalledOnce();
    expect(proof.eventAssessment.reasons).toEqual(['call-not-completed']);
    expect(assessmentDataOf(proof.saved)).toEqual(proof.eventAssessment);
    expect(proof.returned).toBe(`${BODY}${DIVIDER}Not sure — a call failed.`);
    expect(proof.sse).toBe(proof.returned);
  });

  it.each(['inline', 'deferred'] as const)(
    'REGRESSION — denied results contribute one public fact (%s)',
    async (observerDelivery) => {
      const proof = await run({
        hook: () => deny('Archive result is unavailable.'),
        observerDelivery,
        includePending: true,
      });
      const text = `${BODY}${DIVIDER}Not sure — a result was kept out by a rule.`;
      const assessment = {
        assessment: 'unknown',
        standing: 'not-sure',
        reasons: ['result-withheld'],
        checked: [],
      };
      expect.soft(proof.returned, 'agent.run').toBe(text);
      expect.soft(proof.sse, 'text SSE').toBe(text);
      expect.soft(proof.turnEnd.finalContent, 'turn_end text').toBe(text);
      expect.soft(proof.turnEnd.answerAssessment, 'turn_end standing data').toEqual(assessment);
      expect.soft(proof.eventAssessment, 'answer.assessed data').toEqual(assessment);
      expect
        .soft(assessmentDataOf(proof.saved), 'assessAnswer from the recording')
        .toEqual(assessment);
      expect.soft(proof.saved.reasons).toHaveLength(1);
      expect.soft(proof.saved.reasons[0]).toMatchObject({
        reason: 'result-withheld',
        source: { kind: 'run' },
      });
      expect.soft(proof.saved.reasons[0]?.witness ?? []).toEqual([]);
      // The host's recording still carries the native facts.
      expect(proof.recording.snapshot.sharedState.coverageDeclared).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'absence', toolName: TOOL })]),
      );
      expect(proof.recordingText).toContain(PRIVATE_GAP);
      expect(proof.recordingText).toContain(PRIVATE_STATUS);
      expect(proof.recordingText).toContain(NOT_HELD);
    },
  );

  it.each(['pre-mark history', 'omitted decision ledger'] as const)(
    'BOUNDARY — a saved denial can use either retained source (%s)',
    async (variant) => {
      const proof = await run({ hook: () => deny('Archive result is unavailable.') });
      const { sharedState } = proof.recording.snapshot;
      if (variant === 'pre-mark history') {
        for (const message of sharedState.history) delete message.toolResultDisposition;
      } else {
        // A recording can omit the payload-bearing decision ledger.
        delete sharedState.middlewareDecisions;
      }
      expect(assessmentDataOf(assessAnswer(proof.recording))).toEqual({
        assessment: 'unknown',
        standing: 'not-sure',
        reasons: ['result-withheld'],
        checked: [],
      });
    },
  );

  it('SCENARIO — ungoverned results contribute their native facts', async () => {
    const proof = await run({ includePending: true });
    const reasons = ['work-not-finished', 'coverage-gap', 'declared-absent', 'period-not-held'];
    expect(proof.eventAssessment.reasons).toEqual(reasons);
    expect(proof.turnEnd.answerAssessment).toEqual(proof.eventAssessment);
    expect(assessmentDataOf(proof.saved)).toEqual(proof.eventAssessment);
    expect(proof.returned).toContain('nothing matched');
    expect(proof.sse).toBe(proof.returned);
  });

  it('REGRESSION — a rewrite can remove an absence, gap, and period', async () => {
    const proof = await run({
      hook: () => allow({ items: ['backup record'] }, 'Serve only the public index.'),
    });
    expect.soft(proof.eventAssessment.reasons).toEqual([]);
    expect.soft(proof.turnEnd.answerAssessment).toEqual(proof.eventAssessment);
    expect.soft(assessmentDataOf(proof.saved)).toEqual(proof.eventAssessment);
    expect.soft(proof.returned).not.toContain('nothing matched');
    expect.soft(proof.sse).toBe(proof.returned);
  });

  it('REGRESSION — a rewrite can keep an absence and drop its original gap and period', async () => {
    const proof = await run({
      hook: () =>
        allow(
          absent({ what: 'visible records', checked: ['the visible partition'] }),
          'Serve the visible partition only.',
        ),
    });
    expect.soft(proof.eventAssessment.reasons).toEqual(['declared-absent']);
    expect.soft(proof.turnEnd.answerAssessment).toEqual(proof.eventAssessment);
    expect.soft(assessmentDataOf(proof.saved)).toEqual(proof.eventAssessment);
    expect.soft(proof.returned).toBe(`${BODY}${DIVIDER}Not sure — a tool said nothing matched.`);
    expect.soft(proof.sse).toBe(proof.returned);
  });

  it('REGRESSION — a reused provider ID does not inherit a prior turn’s denial', async () => {
    const call = { content: '', toolCalls: [{ id: 'same-id', name: TOOL, args: {} }] };
    const onToolResult = vi
      .fn<NonNullable<ToolMiddleware['onToolResult']>>()
      .mockReturnValueOnce(deny('Archive result is unavailable.'))
      .mockReturnValueOnce(allow());
    const agent = Agent.create({
      provider: mock({ replies: [call, BODY, call, BODY] }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: TOOL,
          description: 'Read the archive.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => NATIVE_PENDING,
        }),
      )
      .toolMiddleware({ name: 'archive_rule', onToolResult })
      .answerLayer({ standingLine: true })
      .build();
    const first = await agent.run({ message: 'Check the archive.' });
    const second = await agent.run({ message: 'Check again.', continueFrom: agent.checkpoint()! });
    expect(onToolResult).toHaveBeenCalledTimes(2);
    expect.soft(first).toBe(`${BODY}${DIVIDER}Not sure — a result was kept out by a rule.`);
    expect.soft(second).toBe(`${BODY}${DIVIDER}Not sure — a tool reported unfinished work.`);
    expect((await agent.assessment())?.reasons.map(({ reason }) => reason)).toEqual([
      'work-not-finished',
    ]);
  });
});

describe.each([
  {
    reason: 'column-type-mismatch',
    words: "a tool's rows hold a different type than the tool declares",
    columnRows: [{ logical_unit_number: 'fixture-lun' }],
  },
  {
    reason: 'missing-column',
    words: 'a column a tool declares is in none of its rows',
    columnRows: [{ port: 1 }],
  },
])('standing for a native $reason', ({ reason, words, columnRows }) => {
  it.each(['inline', 'deferred'] as const)(
    'REGRESSION — governance limits what the standing reads (%s)',
    async (observerDelivery) => {
      const control = await run({ columnRows, observerDelivery });
      expect(control.eventAssessment.reasons).toEqual([reason]);
      expect(assessmentDataOf(control.saved)).toEqual(control.eventAssessment);
      expect(control.returned).toContain(words);

      const denied = await run({
        columnRows,
        observerDelivery,
        hook: () => deny('Archive result is unavailable.'),
      });
      const expectedText = `${BODY}${DIVIDER}Not sure — a result was kept out by a rule.`;
      expect.soft(denied.returned, 'denied agent.run').toBe(expectedText);
      expect.soft(denied.sse, 'denied text SSE').toBe(expectedText);
      expect.soft(denied.turnEnd.finalContent, 'denied turn_end text').toBe(expectedText);
      const expected = {
        assessment: 'unknown',
        standing: 'not-sure',
        reasons: ['result-withheld'],
        checked: [],
      };
      expect.soft(denied.turnEnd.answerAssessment, 'denied turn_end standing').toEqual(expected);
      expect.soft(denied.eventAssessment, 'denied answer.assessed').toEqual(expected);
      expect.soft(assessmentDataOf(denied.saved), 'denied saved standing').toEqual(expected);
      expect(denied.recording.snapshot.sharedState.findingsLedger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'integrity-finding', finding: reason }),
        ]),
      );

      const rewritten = await run({
        columnRows,
        observerDelivery,
        hook: () => allow([{ logical_unit_number: 1 }], 'Serve the public numeric index.'),
      });
      expect.soft(rewritten.returned, 'rewritten agent.run').not.toContain(words);
      expect.soft(rewritten.sse, 'rewritten text SSE').toBe(rewritten.returned);
      expect
        .soft(rewritten.turnEnd.finalContent, 'rewritten turn_end text')
        .toBe(rewritten.returned);
      expect
        .soft(rewritten.turnEnd.answerAssessment?.reasons, 'rewritten turn_end standing')
        .toEqual([]);
      expect.soft(rewritten.eventAssessment.reasons, 'rewritten answer.assessed').toEqual([]);
      expect.soft(rewritten.saved.reasons, 'rewritten saved standing').toEqual([]);
      expect(rewritten.recording.snapshot.sharedState.findingsLedger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'integrity-finding', finding: reason }),
        ]),
      );
    },
  );
});
