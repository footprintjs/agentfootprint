import { expect, it } from 'vitest';
import { absent, Agent, coverage, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, assessAnswer, recordRun, type Recording } from '../../src/observe.js';

const readShelf = defineTool({
  name: 'lookup',
  description: 'Read one fixture shelf.',
  inputSchema: { type: 'object', properties: { shelf: { type: 'number' } } },
  execute: ({ shelf }: { shelf: number }) => {
    switch (shelf) {
      case 1:
        return absent({ what: 'item', checked: ['shelf A'] });
      case 2:
        return coverage([{ item: 'book' }], { checked: ['shelf B'], notChecked: ['shelf C'] });
      default:
        return [{ item: 'other book' }];
    }
  },
});

function asLegacy(recording: Recording): Recording {
  return JSON.parse(
    JSON.stringify(recording, (key, value: unknown) =>
      ['callOccurrenceKey', 'enteredToolCalls', 'toolResultExecution'].includes(key)
        ? undefined
        : value,
    ),
  ) as Recording;
}

it.each([
  {
    label: 'absent then gap in one reply',
    batches: [[1, 2]],
    absentRows: 1,
    gap: true,
    covered: 2,
  },
  {
    label: 'absent then gap in two replies',
    batches: [[1], [2]],
    absentRows: 1,
    gap: true,
    covered: 2,
  },
  { label: 'two identical absences', batches: [[1, 1]], absentRows: 2, gap: false, covered: 2 },
  { label: 'one result then absence', batches: [[3, 1]], absentRows: 1, gap: false, covered: 1 },
])('counts only placed call evidence for $label', async ({ batches, absentRows, gap, covered }) => {
  const agent = Agent.create({
    provider: mock({
      replies: [
        ...batches.map((batch) => ({
          toolCalls: batch.map((shelf) => ({ id: 'dup', name: 'lookup', args: { shelf } })),
        })),
        { content: 'Done.' },
      ],
    }),
    model: 'mock',
  })
    .tool(readShelf)
    .answerLayer({ standingLine: true })
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'Read the fixture shelves.' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    const assessment = assessAnswer(recording);
    const source = assessment.reasons.find((r) => r.reason === 'declared-absent')?.source;
    expect.soft(source).toEqual({
      kind: 'calls',
      calls: Array.from({ length: absentRows }, () => ({ toolCallId: 'dup', toolName: 'lookup' })),
    });
    expect
      .soft(assessment.checked.find((c) => c.check === 'tool-coverage'))
      .toMatchObject({ ran: covered, of: 2 });
    const account = accountForAnswer(recording);
    const lines = account.rows.find((row) => row.id === 'how-sure')?.lines.map((line) => line.text);
    expect
      .soft(lines)
      .toContain(
        `${absentRows} ${absentRows === 1 ? 'call' : 'calls'} declared that nothing matched.`,
      );
    if (gap) {
      expect.soft(assessment.reasons.find((r) => r.reason === 'coverage-gap')?.source).toEqual({
        kind: 'calls',
        calls: [{ toolCallId: 'dup', toolName: 'lookup' }],
      });
      expect.soft(lines).toContain('1 call declared ground it did not check or can never cover.');
    }
    const withoutDeclarationEvents: Recording = {
      ...recording,
      events: recording.events.filter((event) => event.type !== 'agentfootprint.tools.absent'),
    };
    const unmatched = `${absentRows} evidence ${
      absentRows === 1 ? 'row' : 'rows'
    } could not be matched to a call.`;
    const standingLines = (record: Recording) =>
      accountForAnswer(record)
        .rows.find((row) => row.id === 'how-sure')
        ?.lines.map((line) => line.text);

    expect.soft(standingLines(withoutDeclarationEvents)).not.toContain(unmatched);

    // Exercise the historical shape by removing only the library field from
    // this closed fixture. With no declaration event it still has no address.
    const legacyFull = asLegacy(recording);
    expect.soft(accountForAnswer(legacyFull).facts.standing).toEqual(account.facts.standing);
    expect.soft(standingLines(legacyFull)).toEqual(lines);

    // With the absence events missing the older recording has no exact owner
    // for those native rows. A retained result can still testify for its own
    // bytes. The repeat-call note makes the second identical result unreadable
    // as bare JSON, so only its first absence can be read on this path.
    const legacy = asLegacy(withoutDeclarationEvents);
    const legacyAssessment = assessAnswer(legacy);
    const absence = legacyAssessment.reasons.find((r) => r.reason === 'declared-absent');
    expect.soft(absence?.source).toEqual({
      kind: 'calls',
      calls: [{ toolCallId: 'dup', toolName: 'lookup' }],
    });
    expect
      .soft(absence?.witness)
      .toEqual([expect.objectContaining({ kind: 'history', toolCallId: 'dup' })]);
    expect
      .soft(legacyAssessment.reasons.map(({ reason }) => reason))
      .toEqual([...(gap ? ['coverage-gap'] : []), 'declared-absent']);
    expect
      .soft(legacyAssessment.checked.find((c) => c.check === 'tool-coverage'))
      .toMatchObject({ ran: covered - absentRows + 1, of: 2 });
    const legacyLines = standingLines(legacy);
    expect.soft(legacyLines).toContain('1 call declared that nothing matched.');
    expect.soft(legacyLines).not.toContain(unmatched);
  } finally {
    recorder.stop();
  }
});
