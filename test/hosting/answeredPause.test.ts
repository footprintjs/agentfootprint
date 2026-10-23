/**
 * hosting/answeredPause — a stored pause whose resume failed and may have used
 * its decision: marked answered, its open calls settled as unknown, and the
 * mark read back through the envelope (or refused by name when malformed).
 */

import { describe, expect, it, vi } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';

import {
  OUTCOME_NOT_RECORDED,
  answeredRefusal,
  markAnswered,
  markAnsweredAfterFailure,
  openToolCalls,
  readStoredSession,
  settleOpenCalls,
} from '../../src/hosting/answeredPause.js';
import { readPausedRun, toEnvelope, toPausedEnvelope } from '../../src/hosting/index.js';
import type { CheckpointEnvelope, PausedRun } from '../../src/hosting/index.js';
import { noteRefusedBeforeUse } from '../../src/core/consentRequest.js';
import { ResumeDecisionError } from '../../src/core/pause.js';
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

describe('markAnsweredAfterFailure — marked unless the resume proved it used nothing', () => {
  const REQUEST = 'a'.repeat(64);

  /** A stored check-in pause for REQUEST, and a store that records writes. */
  function setup(
    read: (
      paused: PausedRun,
    ) => Promise<CheckpointEnvelope | undefined> | CheckpointEnvelope | undefined = (paused) =>
      toPausedEnvelope(paused),
  ) {
    const paused: PausedRun = {
      ...pausedOver(halfAnswered),
      pending: { tool: 'refund', checkIn: { id: REQUEST } as never },
    };
    const written: CheckpointEnvelope[] = [];
    const order: string[] = [];
    const store = {
      hydrate: async () => read(paused),
      persist: async (_id: string, envelope: CheckpointEnvelope) => {
        order.push('persist');
        written.push(envelope);
      },
    };
    const mark = (error: unknown, over: Partial<{ paused: PausedRun }> = {}) =>
      markAnsweredAfterFailure({
        store,
        sessionId: 's',
        paused: over.paused ?? paused,
        error,
        settle: async () => void order.push('settle'),
      });
    return { paused, written, order, mark };
  }

  /** What the library throws when it refuses before use — registered for `requestId`. */
  function refusedFor(requestId: string | undefined): Error {
    const error = new ResumeDecisionError('other-request', 'checkIn');
    noteRefusedBeforeUse(error, requestId);
    return error;
  }

  it('leaves the pause answerable when the resume refused before use, for this request', async () => {
    const { written, mark } = setup();
    expect(await mark(refusedFor(REQUEST))).toBe(false);
    expect(written).toEqual([]);
  });

  it.each([
    ['a plain failure', new Error('model unavailable')],
    [
      'an error calling itself ERR_DECISION_REQUIRED',
      Object.assign(new Error('x'), { code: 'ERR_DECISION_REQUIRED' }),
    ],
    [
      'an error calling itself a refused decision',
      Object.assign(new Error('x'), { code: 'ERR_RESUME_DECISION', reason: 'other-request' }),
    ],
    [
      'a library refusal never registered (built, not thrown before use)',
      new ResumeDecisionError('call-changed', 'checkIn'),
    ],
    ['a value that is not even an error', undefined],
  ])('marks the pause after anything else: %s', async (_label, error) => {
    const { written, order, mark } = setup();
    expect(await mark(error)).toBe(true);
    expect(readPausedRun(written[0]).answered).toEqual({ at: expect.any(Number) });
    // In-flight writes drained first, so none lands on top of the mark.
    expect(order).toEqual(['settle', 'persist']);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('drain failed'))],
    [
      'throws before handing back a promise',
      () => {
        throw new Error('drain failed');
      },
    ],
  ])('a drain of in-flight writes that %s does not stop the mark', async (_label, settle) => {
    const { paused } = setup();
    const written: CheckpointEnvelope[] = [];
    const marked = await markAnsweredAfterFailure({
      store: {
        hydrate: async () => toPausedEnvelope(paused),
        persist: async (_id: string, envelope: CheckpointEnvelope) => void written.push(envelope),
      },
      sessionId: 's',
      paused,
      error: new Error('model unavailable'),
      settle: settle as () => Promise<void>,
    });
    expect(marked).toBe(true);
    expect(readPausedRun(written[0]).answered).toEqual({ at: expect.any(Number) });
  });

  it('a refusal registered for ANOTHER request proves nothing about this one', async () => {
    const { written, mark } = setup();
    await mark(refusedFor('b'.repeat(64)));
    await mark(refusedFor(undefined));
    expect(written).toHaveLength(2);
  });

  it('a store that cannot be read, holds nothing, or holds what cannot be read is marked anyway', async () => {
    const throws = setup(async () => {
      throw new Error('read timed out');
    });
    await throws.mark(new Error('model unavailable'));
    const empty = setup(() => undefined);
    await empty.mark(new Error('model unavailable'));
    const unreadable = setup(() => ({ format: 'conversation-v1', data: {} } as never));
    await unreadable.mark(new Error('model unavailable'));
    for (const { written } of [throws, empty, unreadable]) {
      expect(written).toHaveLength(1);
      // From the pause's own conversation, its open call settled.
      expect(readPausedRun(written[0]).conversation.history).toEqual(settleOpenCalls(halfAnswered));
    }
  });

  it('a read that succeeds and shows a newer pause, or a mark already there, is left as it is', async () => {
    const newer = setup((paused) =>
      toPausedEnvelope({ ...paused, pending: { checkIn: { id: 'c'.repeat(64) } as never } }),
    );
    expect(await newer.mark(new Error('model unavailable'))).toBe(false);
    const marked = setup((paused) => toPausedEnvelope(markAnswered(paused, undefined, 1)));
    expect(await marked.mark(new Error('model unavailable'))).toBe(false);
    expect([...newer.written, ...marked.written]).toEqual([]);
  });

  it('goes on from what the run kept for THIS session when it stored a conversation mid-run', async () => {
    const { written, mark } = setup((paused) =>
      toEnvelope({
        ...paused.conversation,
        runId: 'r-resumed',
        history: [
          ...halfAnswered,
          { role: 'tool' as const, toolCallId: 'b', toolName: 'refund', content: 'refunded 2' },
        ],
      }),
    );
    await mark(new Error('model unavailable'));
    const conversation = readPausedRun(written[0]).conversation;
    expect(conversation.runId).toBe('r-resumed');
    expect(conversation.history[conversation.history.length - 1]?.content).toBe('refunded 2');
  });

  it('marks only a consent gate’s pause — an askHuman answer is a value, not a decision', async () => {
    const { written, mark, paused } = setup();
    await mark(new Error('model unavailable'), { paused: { ...paused, pending: { tool: 'x' } } });
    expect(written).toEqual([]);
  });

  it('a store that refuses the WRITE is swallowed — and said on the console, never silent', async () => {
    const { paused } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        markAnsweredAfterFailure({
          store: {
            hydrate: async () => toPausedEnvelope(paused),
            persist: async () => {
              throw new Error('store unavailable');
            },
          },
          sessionId: 's',
          paused,
          error: new Error('model unavailable'),
        }),
      ).resolves.toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('could not be marked answered');
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain(REQUEST);
    } finally {
      warn.mockRestore();
    }
  });
});
