/**
 * hosting/answeredPause — a stored pause whose decision a resume used and did
 * not finish: marked answered, its open calls settled as unknown, and the mark
 * read back through the envelope (or refused by name when malformed).
 */

import { describe, expect, it } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';

import {
  OUTCOME_NOT_RECORDED,
  answeredRefusal,
  markAnswered,
  openToolCalls,
  readStoredSession,
  settleOpenCalls,
} from '../../src/hosting/answeredPause.js';
import { readPausedRun, toEnvelope, toPausedEnvelope } from '../../src/hosting/index.js';
import type { PausedRun } from '../../src/hosting/index.js';
import type { LLMMessage } from '../../src/provider-contract/types.js';

/** Two refunds asked in one turn; only the first has its result. */
const halfAnswered: LLMMessage[] = [
  { role: 'user', content: 'refund orders 1 and 2' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'a', name: 'refund', args: { order: 1 } },
      { id: 'b', name: 'refund', args: { order: 2 } },
    ],
  },
  { role: 'tool', toolCallId: 'a', toolName: 'refund', content: 'refunded 1' },
];

function pausedOver(
  history: readonly LLMMessage[],
  sharedState: Record<string, unknown> = {},
): PausedRun {
  return {
    checkpoint: {
      pausedStageId: 'tool-calls',
      sharedState,
      subflowPath: [],
    } as unknown as FlowchartCheckpoint,
    conversation: {
      version: 1,
      runId: 'r-1',
      history,
      lastCompletedIteration: 1,
      originalInput: { message: 'refund orders 1 and 2' },
      checkpointedAt: 1,
    },
    pending: { tool: 'refund' },
  };
}

describe('openToolCalls / settleOpenCalls', () => {
  it('finds the calls no tool message answered, in the order the model made them', () => {
    expect(openToolCalls(halfAnswered)).toEqual([{ id: 'b', name: 'refund' }]);
  });

  it('settles each open call with the host’s notice — never a result', () => {
    const settled = settleOpenCalls(halfAnswered);
    expect(settled.slice(0, halfAnswered.length)).toEqual(halfAnswered);
    expect(settled[settled.length - 1]).toEqual({
      role: 'tool',
      toolName: 'refund',
      toolCallId: 'b',
      content: OUTCOME_NOT_RECORDED,
    });
    expect(openToolCalls(settled)).toEqual([]);
  });

  it('leaves a history with nothing open as it was', () => {
    const answered = settleOpenCalls(halfAnswered);
    expect(settleOpenCalls(answered)).toEqual(answered);
    expect(settleOpenCalls([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  it('marks the notice as not a result for findings admission', () => {
    const settled = settleOpenCalls(halfAnswered, true);
    expect(settled[settled.length - 1]).toMatchObject({
      toolCallId: 'b',
      toolResultOrigin: 'outcome-unknown',
    });
  });
});

describe('markAnswered', () => {
  it('marks the pause answered and settles the conversation it goes on from', () => {
    const marked = markAnswered(pausedOver(halfAnswered), undefined, 42);
    expect(marked.answered).toEqual({ at: 42 });
    expect(openToolCalls(marked.conversation.history)).toEqual([]);
    // What continues the session is the conversation; the pause itself is kept
    // as it was, so a reader can still see what was asked.
    expect(marked.pending).toEqual({ tool: 'refund' });
  });

  it('goes on from the failed run’s own conversation when it has one — its results kept', () => {
    const paused = pausedOver(halfAnswered);
    const progressed = {
      ...paused.conversation,
      runId: 'r-2',
      history: [
        ...halfAnswered,
        { role: 'tool' as const, toolCallId: 'b', toolName: 'refund', content: 'refunded 2' },
      ],
    };
    const marked = markAnswered(paused, progressed, 1);
    expect(marked.conversation.runId).toBe('r-2');
    expect(marked.conversation.history[marked.conversation.history.length - 1]?.content).toBe(
      'refunded 2',
    );
  });

  it('settles under findings admission when the paused run served findings', () => {
    const marked = markAnswered(pausedOver(halfAnswered, { findingsServe: 'ids' }), undefined, 1);
    expect(marked.conversation.history[marked.conversation.history.length - 1]).toMatchObject({
      toolResultOrigin: 'outcome-unknown',
    });
  });

  it('round-trips through a stored envelope, and a malformed mark is refused by name', () => {
    const marked = markAnswered(pausedOver(halfAnswered), undefined, 7);
    expect(readPausedRun(JSON.parse(JSON.stringify(toPausedEnvelope(marked)))).answered).toEqual({
      at: 7,
    });
    for (const answered of ['yes', null, {}, { at: '7' }]) {
      const envelope = toPausedEnvelope({ ...marked, answered } as unknown as PausedRun);
      expect(() => readPausedRun(envelope)).toThrow(/answered/);
    }
  });
});

describe('readStoredSession — the one reading of a stored session every door uses', () => {
  it('a pause still waiting is offered for an answer, and nothing to continue', () => {
    const paused = pausedOver(halfAnswered);
    const held = readStoredSession(toPausedEnvelope(paused));
    expect(held.waiting).toEqual(paused);
    expect(held.answered).toBeUndefined();
    expect(held.prior).toBeUndefined();
  });

  it('an answered pause is a conversation to continue — never a pause to answer', () => {
    const marked = markAnswered(pausedOver(halfAnswered), undefined, 3);
    const held = readStoredSession(JSON.parse(JSON.stringify(toPausedEnvelope(marked))));
    expect(held.waiting).toBeUndefined();
    expect(held.answered?.answered).toEqual({ at: 3 });
    expect(held.prior).toEqual(marked.conversation);
  });

  it('a stored conversation is a conversation', () => {
    const conversation = pausedOver(halfAnswered).conversation;
    const held = readStoredSession(toEnvelope(conversation));
    expect(held).toEqual({ prior: conversation });
  });

  it("an answer to an answered pause is refused 'already-answered', naming its gate", () => {
    const marked = markAnswered(pausedOver(halfAnswered), undefined, 3);
    expect(answeredRefusal(marked)).toMatchObject({
      code: 'ERR_RESUME_DECISION',
      reason: 'already-answered',
      gate: 'checkIn',
    });
    const asked = { ...marked, pending: { ask: { id: 'x', question: 'q', middleware: 'm' } } };
    expect(answeredRefusal(asked as PausedRun)).toMatchObject({ gate: 'ask' });
  });
});
