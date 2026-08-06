/**
 * The SQLite-sessions template, run for real.
 *
 * `test/hosting/sqliteSessions.test.ts` pins the adapter's contract. This file
 * asserts the thing only the example can prove: **the documented template still
 * does what its page says**, over a real socket, a real file and a real pause —
 * because the example is what a reader copies, and a drifted example is a lie
 * no unit test would notice.
 *
 * It runs on every supported Node. On one without `node:sqlite` the example
 * reports the refusal instead of the run, and this file asserts THAT — which is
 * the honest thing to check on a Node where the refusal is what a reader would
 * meet.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../../examples/deploy/sqlite-sessions.js';

interface Skipped {
  readonly ranOnThisNode: false;
  readonly nodeVersion: string;
  readonly code: string;
  readonly refusal: string;
}

interface TemplateResult {
  readonly restartProofConversation: {
    readonly journalMode: string;
    readonly firstProcessSaid: string;
    readonly secondProcessSaid: string;
    readonly conversationSurvived: boolean;
    readonly turnsInTheStore: number;
  };
  readonly pauseThatOutlivesTheProcess: {
    readonly askedWith: string;
    readonly storedAs: string;
    readonly answeredInAnotherProcess: string;
    readonly sideEffectsPerformed: readonly string[];
    readonly theToolRanExactlyOnce: boolean;
  };
  readonly unreadableIsNotAbsent: {
    readonly refused: boolean;
    readonly code: string;
    readonly problem: string;
    readonly refusalNamesTheFile: boolean;
  };
}

function isSkipped(result: unknown): result is Skipped {
  return (result as Skipped).ranOnThisNode === false;
}

describe('deploy/sqlite-sessions — the template, executed', () => {
  it('survives a restart, keeps a pause across it, and refuses an unreadable store', async () => {
    const result = await run('Refund my order.');

    if (isSkipped(result)) {
      // No `node:sqlite` here. The refusal is the deliverable on this Node, and
      // it must name what to do rather than merely fail.
      expect(result.code).toBe('ERR_SQLITE_UNAVAILABLE');
      expect(result.refusal).toContain('22.5');
      expect(result.refusal).toContain('memorySessions()');
      return;
    }

    const { restartProofConversation, pauseThatOutlivesTheProcess, unreadableIsNotAbsent } =
      result as TemplateResult;

    // 1. A second process, on the same file, answered from a conversation it
    //    never had.
    expect(restartProofConversation.journalMode).toBe('wal');
    expect(restartProofConversation.conversationSurvived).toBe(true);
    expect(restartProofConversation.turnsInTheStore).toBeGreaterThanOrEqual(4);

    // 2. The headline: a question held open across the process boundary, and
    //    answered — without the pre-pause tool running a second time.
    expect(pauseThatOutlivesTheProcess.storedAs).toBe('flowchart-v1');
    expect(pauseThatOutlivesTheProcess.answeredInAnotherProcess).toContain('refunded');
    expect(pauseThatOutlivesTheProcess.sideEffectsPerformed).toEqual(['refund:40']);
    expect(pauseThatOutlivesTheProcess.theToolRanExactlyOnce).toBe(true);

    // 3. A file that exists and cannot be read is refused, not started over.
    expect(unreadableIsNotAbsent.refused).toBe(true);
    expect(unreadableIsNotAbsent.code).toBe('ERR_UNREADABLE_SESSION_FILE');
    expect(unreadableIsNotAbsent.problem).toBe('cannot-open');
    expect(unreadableIsNotAbsent.refusalNamesTheFile).toBe(true);
  });
});
