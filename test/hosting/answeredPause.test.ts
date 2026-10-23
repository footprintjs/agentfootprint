/**
 * hosting/answeredPause — a stored pause whose resume failed and may have used
 * its decision: marked answered, its open calls settled as unknown (a declined
 * one as declined), and the mark read back through the envelope (or refused by
 * name when malformed).
 */

import { describe, expect, it, vi } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';

import {
  OUTCOME_NOT_RECORDED,
  afterFailedAnswer,
  answeredRefusal,
  markAnswered,
  openToolCalls,
  readStoredSession,
  settleOpenCalls,
  watchAnswer,
} from '../../src/hosting/answeredPause.js';
import { readPausedRun, toEnvelope, toPausedEnvelope } from '../../src/hosting/index.js';
import type { CheckpointEnvelope, PausedRun } from '../../src/hosting/index.js';
import {
  inMemoryDecisionLedger,
  noteDecisionTakenUp,
  spendDecision,
} from '../../src/core/consentRequest.js';
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

describe('afterFailedAnswer — marked when its decision may have been used', () => {
  const REQUEST = 'a'.repeat(64);

  /** A stored check-in pause for REQUEST, paused on call 'b', and a store that records writes. */
  function setup(
    read: (
      paused: PausedRun,
    ) => Promise<CheckpointEnvelope | undefined> | CheckpointEnvelope | undefined = (paused) =>
      toPausedEnvelope(paused),
    sharedState: Record<string, unknown> = {},
  ) {
    const paused: PausedRun = {
      ...pausedOver(halfAnswered, { pausedToolCallId: 'b', ...sharedState }),
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
    const after = (
      watch: ReturnType<typeof watchAnswer>,
      over: Partial<{ paused: PausedRun; answer: unknown }> = {},
    ) =>
      afterFailedAnswer({
        store,
        sessionId: 's',
        paused: over.paused ?? paused,
        watch,
        answer: over.answer,
        settle: async () => void order.push('settle'),
      });
    return { paused, written, order, after };
  }

  /** A watch on REQUEST that saw what `happened` does — then the failure. */
  async function watched(
    paused: PausedRun,
    happened: 'nothing' | 'taken-up' | 'spent' | 'refused-by-ledger' = 'spent',
  ) {
    const watch = watchAnswer(paused);
    if (happened !== 'nothing') noteDecisionTakenUp(REQUEST);
    const decision = { requestId: REQUEST, approved: true, by: 'maya', at: 1 };
    if (happened === 'spent') await spendDecision(inMemoryDecisionLedger(), decision, 'checkIn');
    if (happened === 'refused-by-ledger') {
      await spendDecision({ spend: () => false }, decision, 'checkIn').catch(() => undefined);
    }
    return watch;
  }

  it('leaves the pause answerable when the resume this library took up never took the decision to a ledger', async () => {
    const { written, paused, after } = setup();
    const watch = await watched(paused, 'taken-up');
    expect(await after(watch)).toBe('kept');
    expect(written).toEqual([]);
    watch?.release();
  });

  it.each([
    ['spent', 'spent' as const],
    ['refused by the ledger — an earlier resume spent it', 'refused-by-ledger' as const],
    ['never taken up by this library — that cannot be told apart from a use', 'nothing' as const],
  ])('marks the pause when the decision was %s', async (_label, happened) => {
    const { written, order, paused, after } = setup();
    const watch = await watched(paused, happened);
    expect(await after(watch)).toBe('marked');
    expect(readPausedRun(written[0]).answered).toEqual({ at: expect.any(Number) });
    // In-flight writes drained first, so none lands on top of the mark.
    expect(order).toEqual(['settle', 'persist']);
    watch?.release();
  });

  it('a spend that failed is asked of its ledger: one that never landed leaves the pause answerable', async () => {
    for (const [isSpent, outcome] of [
      [() => false, 'kept'],
      [() => true, 'marked'],
      [undefined, 'marked'],
    ] as const) {
      const { paused, after } = setup();
      const watch = watchAnswer(paused);
      noteDecisionTakenUp(REQUEST);
      const ledger = {
        spend: () => {
          throw new Error('store down');
        },
        ...(isSpent !== undefined && { isSpent }),
      };
      await spendDecision(
        ledger,
        { requestId: REQUEST, approved: true, by: 'maya', at: 1 },
        'checkIn',
      ).catch(() => undefined);
      expect(await after(watch)).toBe(outcome);
      watch?.release();
    }
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
    const watch = await watched(paused);
    const outcome = await afterFailedAnswer({
      store: {
        hydrate: async () => toPausedEnvelope(paused),
        persist: async (_id: string, envelope: CheckpointEnvelope) => void written.push(envelope),
      },
      sessionId: 's',
      paused,
      watch,
      settle: settle as () => Promise<void>,
    });
    expect(outcome).toBe('marked');
    expect(readPausedRun(written[0]).answered).toEqual({ at: expect.any(Number) });
    watch?.release();
  });

  it('a store that cannot be read, or holds what cannot be read, is marked anyway — from the pause’s own conversation', async () => {
    const throws = setup(async () => {
      throw new Error('read timed out');
    });
    const unreadable = setup(() => ({ format: 'conversation-v1', data: {} } as never));
    for (const { paused, after, written } of [throws, unreadable]) {
      const watch = await watched(paused);
      expect(await after(watch)).toBe('marked');
      expect(written).toHaveLength(1);
      expect(readPausedRun(written[0]).conversation.history).toEqual(settleOpenCalls(halfAnswered));
      watch?.release();
    }
  });

  it('a store that holds NOTHING is left so: the session expired or was forgotten, and a mark would bring it back', async () => {
    const { paused, after, written } = setup(() => undefined);
    const watch = await watched(paused);
    expect(await after(watch)).toBe('kept');
    expect(written).toEqual([]);
    watch?.release();
  });

  it('a read that succeeds and shows a newer pause, or a mark already there, is left as it is', async () => {
    const newer = setup((paused) =>
      toPausedEnvelope({ ...paused, pending: { checkIn: { id: 'c'.repeat(64) } as never } }),
    );
    const marked = setup((paused) => toPausedEnvelope(markAnswered(paused, undefined, 1)));
    for (const { paused, after, written } of [newer, marked]) {
      const watch = await watched(paused);
      expect(await after(watch)).toBe('kept');
      expect(written).toEqual([]);
      watch?.release();
    }
  });

  it('goes on from what the run kept for THIS session when it stored a conversation mid-run', async () => {
    const { paused, written, after } = setup((paused) =>
      toEnvelope({
        ...paused.conversation,
        runId: 'r-resumed',
        history: [
          ...halfAnswered,
          { role: 'tool' as const, toolCallId: 'b', toolName: 'refund', content: 'refunded 2' },
        ],
      }),
    );
    const watch = await watched(paused);
    await after(watch);
    const conversation = readPausedRun(written[0]).conversation;
    expect(conversation.runId).toBe('r-resumed');
    expect(conversation.history[conversation.history.length - 1]?.content).toBe('refunded 2');
    watch?.release();
  });

  it('a declined decision never ran its call: the paused call is settled as declined, not as unknown', async () => {
    const { paused, written, after } = setup((p) => toPausedEnvelope(p), { findingsServe: 'ids' });
    const watch = await watched(paused);
    await after(watch, {
      answer: { requestId: REQUEST, approved: false, by: 'maya', at: 1, note: 'not this account' },
    });
    const history = readPausedRun(written[0]).conversation.history;
    expect(history[history.length - 1]).toEqual({
      role: 'tool',
      toolName: 'refund',
      toolCallId: 'b',
      toolResultOrigin: 'not-entered',
      content: 'declined by human: not this account',
    });
    watch?.release();
  });

  it('an approval, or a decline told only by a getter, is not read as a decline', async () => {
    for (const answer of [
      { requestId: REQUEST, approved: true, by: 'maya', at: 1 },
      Object.defineProperty({ requestId: REQUEST, by: 'maya', at: 1 }, 'approved', {
        get: () => false,
        enumerable: true,
      }),
    ]) {
      const { paused, written, after } = setup();
      const watch = await watched(paused);
      await after(watch, { answer });
      const history = readPausedRun(written[0]).conversation.history;
      expect(history[history.length - 1]?.content).toBe(OUTCOME_NOT_RECORDED);
      watch?.release();
    }
  });

  it('marks only a consent gate’s pause — an askHuman answer is a value, not a decision', async () => {
    const { written, after, paused } = setup();
    const valuePause = { ...paused, pending: { tool: 'x' } };
    expect(watchAnswer(valuePause)).toBeUndefined();
    expect(await after(undefined, { paused: valuePause })).toBe('kept');
    expect(written).toEqual([]);
  });

  it('a store that refuses the WRITE is swallowed — and said on the console, never silent', async () => {
    const { paused } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const watch = await watched(paused);
    try {
      await expect(
        afterFailedAnswer({
          store: {
            hydrate: async () => toPausedEnvelope(paused),
            persist: async () => {
              throw new Error('store unavailable');
            },
          },
          sessionId: 's',
          paused,
          watch,
        }),
      ).resolves.toBe('kept');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('could not be marked answered');
      expect(JSON.stringify(warn.mock.calls[0])).not.toContain(REQUEST);
    } finally {
      warn.mockRestore();
      watch?.release();
    }
  });
});
