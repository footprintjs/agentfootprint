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
 *
 * Every saved shape has ONE reader, and it refuses exactly what no writer of
 * this library files (`attachment.ts` · `recordedScripts`, `match.ts` ·
 * `recordedBlocks`): a label and an exit code that disagree, a cut that
 * claims more than the program, a count that is not a whole number, more
 * entries than the writer's cap. Such an entry never becomes a line — it is
 * counted, and nothing is said from it.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { Agent, codeRunnerTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

const PROGRAM = 'print(41 + 1)';

async function recordingOf(answer: string, match = false): Promise<Recording> {
  const built = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: PROGRAM } }] },
        { content: answer },
      ] as never,
    }),
    model: 'mock',
  });
  // `code: 'match'` files the shown blocks' verdicts on `evidence_checked.scripts`.
  const agent = (
    match ? built.namesAndNumbersFromEvidence({ posture: 'assist', code: 'match' }) : built
  )
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

/** A copy of `recording` with its last `type` event's payload edited by `edit`. */
function editedEvent(
  recording: Recording,
  type: string,
  edit: (payload: Record<string, unknown>) => void,
): Recording {
  const copy = JSON.parse(JSON.stringify(recording)) as {
    events: Array<{ type: string; payload: Record<string, unknown> }>;
  };
  const event = [...copy.events].reverse().find((e) => e.type === `agentfootprint.${type}`);
  edit(event!.payload);
  return copy as unknown as Recording;
}

/** A copy of `recording` with its last `turn_end.scripts` edited by `edit`. */
const edited = (recording: Recording, edit: (scripts: Record<string, unknown>) => void) =>
  editedEvent(recording, 'agent.turn_end', (p) => edit(p.scripts as Record<string, unknown>));

const shown = (s: Record<string, unknown>) => (s.shown as Array<Record<string, unknown>>)[0]!;
const linesOf = (account: ReturnType<typeof accountForAnswer>) =>
  account.rows.flatMap((r) => r.lines.map((l) => l.text));
const idsOf = (account: ReturnType<typeof accountForAnswer>) =>
  account.rows.flatMap((r) => r.lines.map((l) => l.template.id));

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
    [
      'an attached script labelled submitted (a call that never reached the tool)',
      // No exit code either, as a submitted row has none: only the attach rule refuses it.
      (s: Record<string, unknown>) =>
        void ((shown(s).label = 'submitted'), delete shown(s).exitCode),
    ],
    [
      'a completed script whose exit code is not 0',
      (s: Record<string, unknown>) => void (shown(s).exitCode = 7),
    ],
    [
      'a returned script that carries an exit code',
      (s: Record<string, unknown>) => void ((shown(s).label = 'returned'), (shown(s).exitCode = 0)),
    ],
    [
      'a cut that claims more bytes shown than the program has',
      (s: Record<string, unknown>) => void (shown(s).truncated = { shownBytes: 99 }),
    ],
    [
      'a cut that shows the whole program',
      (s: Record<string, unknown>) =>
        void (shown(s).truncated = { shownBytes: shown(s).bytes as number }),
    ],
    [
      'a program whose length disagrees with its byte count',
      (s: Record<string, unknown>) => void (shown(s).text = 'print(1)'),
    ],
    ['omitted that is not a whole number', (s: Record<string, unknown>) => void (s.omitted = 2.5)],
    ['omitted that is negative', (s: Record<string, unknown>) => void (s.omitted = -1)],
    ['shown that is not a list', (s: Record<string, unknown>) => void (s.shown = {})],
    [
      'more shown scripts than any writer attaches',
      (s: Record<string, unknown>) =>
        void (s.shown = Array.from({ length: 9 }, () => ({ ...shown(s) }))),
    ],
  ])('%s: the reader returns, counts it unread, and claims no reconstruction', (_name, edit) => {
    for (const recording of [plain, closed]) {
      const control = accountForAnswer(recording);
      const account = accountForAnswer(edited(recording, edit));
      expect(account.unread).toBeGreaterThan(control.unread);
      expect(account.facts.limitsBlock.status).not.toBe('recorded');
      // Refused by the reader, never a line that failed to fill.
      expect(idsOf(account)).not.toContain('unreadable.line');
    }
  });

  it('scripts that are not an object: counted unread, nothing said or reconstructed', () => {
    const control = accountForAnswer(plain);
    const account = accountForAnswer(
      editedEvent(plain, 'agent.turn_end', (p) => void (p.scripts = 'x')),
    );
    expect(account.unread).toBeGreaterThan(control.unread);
    expect(account.facts.limitsBlock.status).not.toBe('recorded');
    expect(linesOf(account).filter((t) => /attached by the library/.test(t))).toEqual([]);
  });

  it('a false exit is never said: "exit 0" is printed only from a record whose exit code is 0', () => {
    const account = accountForAnswer(edited(plain, (s) => void (shown(s).exitCode = 7)));
    expect(linesOf(account).filter((t) => /exit 0/.test(t))).toEqual([]);
  });

  it('a count that is not a whole number is never printed', () => {
    const account = accountForAnswer(edited(plain, (s) => void (s.omitted = 2.5)));
    expect(linesOf(account).filter((t) => /2\.5/.test(t))).toEqual([]);
  });

  it('withheld from the text: the line counts only the entries a writer files', () => {
    // An answer whose formatting leaves the reader unsure (raw HTML opens):
    // the programs ride the data only, and the account says how many.
    return recordingOf('The answer is 42.\n\n<div>').then((withheld) => {
      const count = (r: Recording) =>
        linesOf(accountForAnswer(r)).filter((t) => /named under the answer, not printed/.test(t));
      expect(count(withheld)).toEqual([
        '1 attached script is named under the answer, not printed: the formatting above could have shown part of a program as ordinary text. The programs are on the record.',
      ]);
      const damaged = edited(withheld, (s) => void (s.shown = [shown(s), { label: 'ran' }]));
      expect(count(damaged)).toEqual(count(withheld));
    });
  });
});

describe('the public reader on damaged block verdicts (`evidence_checked.scripts`)', () => {
  let matched: Recording;
  beforeAll(async () => {
    matched = await recordingOf(`It printed 42.\n\n\`\`\`python\n${PROGRAM}\n\`\`\``, true);
  });
  const blocks = (p: Record<string, unknown>) =>
    (p.scripts as { blocks: Array<Record<string, unknown>> }).blocks;

  it('control: the matched block is said, from the record', () => {
    expect(linesOf(accountForAnswer(matched))).toContain(
      'The script shown is the one submitted to run_code on call c1; it completed, exit 0.',
    );
  });

  it.each([
    [
      'a completed block whose exit code is not 0',
      (p: Record<string, unknown>) => void (blocks(p)[0]!.exitCode = 7),
    ],
    [
      'an unmatched block with a reason no writer files',
      (p: Record<string, unknown>) =>
        void (blocks(p)[0] = { block: 1, label: 'unmatched', reason: 'lost' }),
    ],
    [
      'a block whose dispatch is not a whole number',
      (p: Record<string, unknown>) => void (blocks(p)[0]!.dispatch = 'x'),
    ],
    [
      'a block without its call id',
      (p: Record<string, unknown>) => void delete blocks(p)[0]!.toolCallId,
    ],
    [
      'blocks that is not a list',
      (p: Record<string, unknown>) => void ((p.scripts as Record<string, unknown>).blocks = {}),
    ],
    ['scripts that is not an object', (p: Record<string, unknown>) => void (p.scripts = 7)],
  ])('%s: counted unread, and no line is said from it', (_name, edit) => {
    const control = accountForAnswer(matched);
    const account = accountForAnswer(editedEvent(matched, 'agent.evidence_checked', edit));
    expect(account.unread).toBeGreaterThan(control.unread);
    const shownLines = (a: typeof account) =>
      linesOf(a).filter((t) => /^The script shown|^A script shown matches no/.test(t));
    expect(shownLines(account)).toEqual([]);
    expect(idsOf(account)).not.toContain('unreadable.line');
  });

  /** A copy of `recording` with its committed state edited by `edit`. */
  const editedState = (recording: Recording, edit: (state: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(recording)) as {
      snapshot: { sharedState: Record<string, unknown> };
    };
    edit(copy.snapshot.sharedState);
    return copy as unknown as Recording;
  };
  const ledgerPointers = (account: ReturnType<typeof accountForAnswer>) =>
    account.rows
      .flatMap((r) => r.lines)
      .filter((l) => /^The script shown/.test(l.text))
      .flatMap((l) => l.pointers)
      .filter((p) => p.kind === 'state' && p.key === 'findingsLedger');

  it('the call’s row is read for THIS turn only: a record without its turn number names no row', () => {
    expect(ledgerPointers(accountForAnswer(matched))).toHaveLength(1);
    const account = accountForAnswer(editedState(matched, (st) => void delete st.turnNumber));
    expect(ledgerPointers(account)).toEqual([]);
  });

  it('a call row no writer files: counted unread, and nothing is said from it', () => {
    const control = accountForAnswer(matched);
    const account = accountForAnswer(
      editedState(matched, (st) => {
        const row = (st.findingsLedger as Array<Record<string, unknown>>).find(
          (r) => r.kind === 'script',
        )!;
        row.bytes = 1; // the program it keeps is not 1 byte long
      }),
    );
    expect(account.unread).toBeGreaterThan(control.unread);
    expect(ledgerPointers(account)).toEqual([]);
  });
});
