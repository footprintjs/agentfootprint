/**
 * The recovery message under `code: 'match'` (design § 7): one clause after
 * "Recovery action: replace the rejected draft", chosen by what the verdict
 * holds — keep the script, fix the values — carrying the call's ACTUAL label
 * in its words. Request-only; the default `code: 'check'` instruction keeps
 * its bytes.
 */

import { describe, expect, it } from 'vitest';

import { buildEvidenceRecovery } from '../../../../src/core/agent/evidence/recovery.js';
import { scriptRecoveryClause } from '../../../../src/core/agent/scripts/recovery.js';
import {
  answer,
  callCode,
  fenced,
  runnerAnswering,
  scriptAgent,
  stateOf,
} from './fixtures/scriptAgent.js';

const PROGRAM = 'print(sum([1200, 2400]))';
const done = runnerAnswering({ ok: false, exitCode: 7, stdout: '3600\n', stderr: 'boom' });

const instructionOf = (state: Record<string, unknown>): string =>
  (state.evidenceRecovery as { instruction: string }).instruction;

describe('the clause, in the run', () => {
  it('an UNMATCHED block whose values were flagged: keep a script, show it exactly, fix the values', async () => {
    const altered = PROGRAM.replace('2400', '2500');
    const { agent, checks } = scriptAgent({
      runner: done,
      gate: { posture: 'guard', code: 'match' },
      replies: [
        callCode('c1', PROGRAM),
        answer(`Total 3600.\n\n${fenced(altered)}`),
        answer(`Total 3600.\n\n${fenced(PROGRAM)}`),
      ],
    });
    await agent.run('total?');
    const instruction = instructionOf(stateOf(agent));
    expect(instruction).toContain(
      'Recovery action: replace the rejected draft. The fenced code in the rejected draft matched ' +
        'no submission to `run_code` recorded this turn, so its contents were checked as prose. ' +
        'Keep a script in the answer: show the program exactly as it was submitted on that call, ' +
        'byte for byte, or say that the code shown is not the one that was submitted. Fix the ' +
        'values in the prose.',
    );
    // The values are listed as today, each with its region.
    expect(instruction).toContain('"region":"code"');
    // The revision showed the program as submitted: matched, labelled from the record.
    expect(checks.at(-1)!.scripts).toMatchObject({
      blocks: [{ label: 'completed-with-failure', exitCode: 7, toolCallId: 'c1' }],
    });
    expect(checks.find((c) => c.action === 'revision-asked')!.scripts).toMatchObject({
      blocks: [{ label: 'unmatched', reason: 'no-submission-this-turn' }],
    });
  });

  it("a MATCHED block with values flagged in the prose: keep it — the call's actual label, never 'executed'", async () => {
    const { agent } = scriptAgent({
      runner: done,
      gate: { posture: 'guard', code: 'match' },
      replies: [
        callCode('c1', PROGRAM),
        answer(`The total was 98765.\n\n${fenced(PROGRAM)}`),
        answer(`The program exited 7.\n\n${fenced(PROGRAM)}`),
      ],
    });
    await agent.run('total?');
    const instruction = instructionOf(stateOf(agent));
    expect(instruction).toContain(
      'The script shown is the one submitted to `run_code` on call c1 (completed with failure, ' +
        'exit 7) and was not checked. Keep it. The listed values were in the prose around it.',
    );
    expect(instruction).not.toMatch(/executed/);
  });

  it("under code: 'check' the instruction carries no script clause", async () => {
    const { agent } = scriptAgent({
      runner: done,
      gate: { posture: 'guard' },
      replies: [
        callCode('c1', PROGRAM),
        answer(`The total was 98765.\n\n${fenced(PROGRAM)}`),
        answer('I could not confirm the total.'),
      ],
    });
    await agent.run('total?');
    const instruction = instructionOf(stateOf(agent));
    expect(instruction).not.toContain('fenced code');
    expect(instruction).not.toContain('The script shown');
    expect(instruction).not.toContain('"region"');
  });
});

describe('the clause, unit by unit', () => {
  const verdict = (blocks: Parameters<typeof scriptRecoveryClause>[0]['blocks']) => ({
    blocks,
    earlierTurnRows: 0,
    regionsDropped: 0,
  });

  it('no block, or no flagged value the blocks bear on → no clause', () => {
    expect(scriptRecoveryClause(verdict([]), [{ region: 'prose' }], ['run_code'])).toBe('');
    expect(
      scriptRecoveryClause(
        verdict([{ block: 1, label: 'unmatched', reason: 'no-submission-this-turn' }]),
        [{ region: 'prose' }],
        ['run_code'],
      ),
    ).toBe('');
  });

  it('an absent clause leaves the instruction byte-identical', () => {
    const input = {
      iteration: 2,
      originalRequest: 'q',
      rejectedDraft: 'd 98765',
      unsupported: [{ value: '98765', shape: 'number' }],
    };
    expect(buildEvidenceRecovery(input, undefined, undefined, undefined, '')).toEqual(
      buildEvidenceRecovery(input),
    );
  });

  it('a turn with no code-running call names no tool it cannot name', () => {
    expect(
      scriptRecoveryClause(
        verdict([{ block: 1, label: 'unmatched', reason: 'no-submission-this-turn' }]),
        [{ region: 'code' }],
        [],
      ),
    ).toContain('matched no submission to a code-running tool recorded this turn');
  });
});
