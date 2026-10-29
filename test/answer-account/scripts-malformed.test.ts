/**
 * The public account reader on a recording whose `turn_end.scripts` was
 * damaged after the run — a record this library never writes. The reader is
 * the one door saved recordings come back through, so it must answer for any
 * JSON it is handed:
 *
 *   - it never throws on a malformed boundary (`closedFence`,
 *     `withheldFromText`) or on a shown script missing a field it renders;
 *   - every repetition is bounded (a fence is never longer than the text it
 *     would have to be found in);
 *   - a malformed entry is counted as unread, and the attached block is not
 *     claimed as reconstructed (`facts.limitsBlock` is not `recorded`).
 *
 * Built from a real run on the mock, JSON-round-tripped, then edited in
 * exactly one field per case. No answer layer: the attached block is then the
 * whole appended section, found only by rebuilding it from the record.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { Agent, codeRunnerTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

const PROGRAM = 'print(41 + 1)';

async function recordingOf(answer: string): Promise<Recording> {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: PROGRAM } }] },
        { content: answer },
      ] as never,
    }),
    model: 'mock',
  })
    .tool(
      codeRunnerTool({
        runner: {
          id: 'answering',
          start: () =>
            Promise.resolve({
              id: 's1',
              execute: () => Promise.resolve({ ok: true, exitCode: 0, stdout: '42', stderr: '' }),
              stop: () => Promise.resolve(),
            }),
        },
      }),
    )
    .scriptTravelsWithTheAnswer()
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'compute' });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  return recording;
}

/** A copy of `recording` with its last `turn_end.scripts` edited by `edit`. */
function edited(recording: Recording, edit: (scripts: Record<string, unknown>) => void): Recording {
  const copy = JSON.parse(JSON.stringify(recording)) as {
    events: Array<{ type: string; payload: Record<string, unknown> }>;
  };
  const end = [...copy.events].reverse().find((e) => e.type === 'agentfootprint.agent.turn_end');
  edit(end!.payload.scripts as Record<string, unknown>);
  return copy as unknown as Recording;
}

const shown = (s: Record<string, unknown>) => (s.shown as Array<Record<string, unknown>>)[0]!;

describe('the public reader on damaged script metadata', () => {
  let plain: Recording;
  let closed: Recording;
  beforeAll(async () => {
    plain = await recordingOf('The answer is 42.');
    // An answer that ends inside an unfinished fence: the record says the
    // library closed it (`closedFence`).
    closed = await recordingOf('The answer is 42.\n\n```text\nunfinished');
  });

  it('controls: an intact record is read, and the attached block is reconstructed', () => {
    for (const recording of [plain, closed]) {
      const account = accountForAnswer(recording);
      expect(account.facts.limitsBlock.status).toBe('recorded');
      expect(account.facts.limitsBlock.value).toContain('Script submitted to `run_code`');
    }
  });

  it.each([
    ['closedFence: null', (s: Record<string, unknown>) => void (s.closedFence = null)],
    [
      'closedFence with a character no writer files',
      (s: Record<string, unknown>) => void (s.closedFence = { char: 'star', length: 3 }),
    ],
    [
      'closedFence with a negative length',
      (s: Record<string, unknown>) => void (s.closedFence = { char: 'backtick', length: -1 }),
    ],
    [
      'closedFence with a length no answer could hold',
      (s: Record<string, unknown>) => void (s.closedFence = { char: 'backtick', length: 1e9 }),
    ],
    [
      'closedFence with a fractional length',
      (s: Record<string, unknown>) => void (s.closedFence = { char: 'tilde', length: 3.5 }),
    ],
    [
      'withheldFromText that is not true',
      (s: Record<string, unknown>) => void (s.withheldFromText = 'yes'),
    ],
    ['a shown script without its tool', (s: Record<string, unknown>) => void delete shown(s).tool],
    [
      'a shown script without its call id',
      (s: Record<string, unknown>) => void delete shown(s).toolCallId,
    ],
    [
      'a shown script whose label is unknown',
      (s: Record<string, unknown>) => void (shown(s).label = 'ran'),
    ],
  ])('%s: the reader returns, counts it unread, and claims no reconstruction', (_name, edit) => {
    for (const recording of [plain, closed]) {
      const control = accountForAnswer(recording);
      const account = accountForAnswer(edited(recording, edit));
      expect(account.unread).toBeGreaterThan(control.unread);
      expect(account.facts.limitsBlock.status).not.toBe('recorded');
    }
  });
});
