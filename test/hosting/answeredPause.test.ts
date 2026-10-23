/**
 * hosting/answeredPause — a stored pause whose resume failed and may have used
 * its decision: marked answered, its open calls settled as unknown (a declined
 * one as declined), and the mark read back through the envelope (or refused by
 * name when malformed).
 */

import { describe, expect, it, vi } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';

import {
  NOT_RUN_UNANSWERABLE,
  OUTCOME_NOT_RECORDED,
  OUTCOME_UNKNOWN_UNANSWERABLE,
  afterFailedAnswer,
  answeredRefusal,
  closedConversation,
  listedFormatOf,
  listedFormatOfRow,
  markAnswered,
  openToolCalls,
  readStoredSession,
  settleOpenCalls,
  unanswerablePause,
  watchAnswer,
} from '../../src/hosting/answeredPause.js';
import {
  readEnvelope,
  readPausedRun,
  toEnvelope,
  toPausedEnvelope,
} from '../../src/hosting/index.js';
import type { CheckpointEnvelope, PausedRun } from '../../src/hosting/index.js';
import {
  inMemoryDecisionLedger,
  mintConsentRequest,
  noteDecisionTakenUp,
  spendDecision,
} from '../../src/core/consentRequest.js';
import type { LLMMessage } from '../../src/provider-contract/types.js';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

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
      toolResultOrigin: 'outcome-unknown',
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

  it('marks the notice as the library’s — not a result — whether or not the run served findings', () => {
    const settled = settleOpenCalls(halfAnswered);
    expect(settled[settled.length - 1]).toMatchObject({
      toolCallId: 'b',
      toolResultOrigin: 'outcome-unknown',
    });
  });
});

describe('closedConversation / unanswerablePause — a pause no answer can reach', () => {
  it('with nothing that proves its calls never ran, settles every one it left open as outcome unknown, marked for findings admission', async () => {
    // "Did not run" needs proof from a ledger (test/hosting/closed-pause-outcome.test.ts).
    const closed = await closedConversation(pausedOver(halfAnswered, { findingsServe: 'ids' }));
    expect(closed.history.slice(0, halfAnswered.length)).toEqual(halfAnswered);
    expect(closed.history[closed.history.length - 1]).toEqual({
      role: 'tool',
      toolName: 'refund',
      toolCallId: 'b',
      toolResultOrigin: 'outcome-unknown',
      content: OUTCOME_UNKNOWN_UNANSWERABLE,
    });
    expect(openToolCalls(closed.history)).toEqual([]);
  });

  it('a pause that asks for no decision is never one', () => {
    expect(unanswerablePause(pausedOver(halfAnswered))).toBeUndefined();
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

describe('listedFormatOf — what a session listing says a stored session is', () => {
  /** A check-in pause over a real minted request; `state` changes what the paused run holds. */
  function checkInPause(state: Record<string, unknown> = {}): PausedRun {
    const minted = mintConsentRequest({
      gate: 'checkIn',
      tool: 'refund',
      toolCallId: 'b',
      args: { order: 2 },
    });
    if (minted === undefined) throw new Error('expected the call to bind');
    const base = pausedOver(halfAnswered, {
      pausedToolName: 'refund',
      pausedToolCallId: 'b',
      pausedRequest: minted.request,
      pausedCheckInArgs: minted.args,
      ...state,
    });
    return {
      ...base,
      checkpoint: {
        ...base.checkpoint,
        pauseData: { checkIn: {}, toolName: 'refund' },
      } as FlowchartCheckpoint,
      pending: { tool: 'refund', checkIn: { id: minted.request.id } as never, pauseData: {} },
    };
  }

  it("a pause still waiting on a person — and only that — lists as 'flowchart-v1'", () => {
    expect(listedFormatOf(toPausedEnvelope(checkInPause()))).toBe('flowchart-v1');
    expect(listedFormatOf(toPausedEnvelope(pausedOver(halfAnswered)))).toBe('flowchart-v1');
    expect(listedFormatOf(toEnvelope(pausedOver(halfAnswered).conversation))).toBe(
      'conversation-v1',
    );
  });

  it("an answered pause lists as 'conversation-v1' — no door offers it for an answer", () => {
    const marked = toPausedEnvelope(markAnswered(checkInPause(), undefined, 3));
    expect(listedFormatOf(marked)).toBe('conversation-v1');
    expect(listedFormatOf(JSON.parse(JSON.stringify(marked)))).toBe('conversation-v1');
    // The envelope itself is unchanged: hydrate hands back the paused run.
    expect(marked.format).toBe('flowchart-v1');
  });

  it("a pause no answer can reach lists as 'conversation-v1', as the stored checkpoint tells it", () => {
    const notRecorded = toPausedEnvelope(checkInPause({ pausedRequest: undefined }));
    const changed = toPausedEnvelope(checkInPause({ pausedCheckInArgs: { order: 3 } }));
    expect(listedFormatOf(notRecorded)).toBe('conversation-v1');
    expect(listedFormatOf(changed)).toBe('conversation-v1');
  });

  it("never throws: what is not an envelope lists as 'unknown', what the readers refuse lists as stored", () => {
    for (const value of [undefined, null, 'flowchart-v1', 42, {}, { format: 7 }]) {
      expect(listedFormatOf(value)).toBe('unknown');
    }
    expect(listedFormatOf({ format: 'flowchart-v2', data: {} })).toBe('flowchart-v2');
    // A pause a reader refuses by name (no checkpoint; an unreadable mark).
    expect(listedFormatOf({ format: 'flowchart-v1', data: {}, savedAt: 1 })).toBe('flowchart-v1');
    const badMark = { ...toPausedEnvelope(pausedOver(halfAnswered)) };
    (badMark.data as { answered?: unknown }).answered = 'yes';
    expect(listedFormatOf(badMark)).toBe('flowchart-v1');
  });
});

describe('listedFormatOfRow — a row that keeps a format beside its envelope', () => {
  it("only a stored 'flowchart-v1' is read again — from the envelope beside it", () => {
    const waiting = JSON.stringify(toPausedEnvelope(pausedOver(halfAnswered)));
    const answered = JSON.stringify(
      toPausedEnvelope(markAnswered(pausedOver(halfAnswered), undefined, 3)),
    );
    expect(listedFormatOfRow('flowchart-v1', waiting)).toBe('flowchart-v1');
    expect(listedFormatOfRow('flowchart-v1', answered)).toBe('conversation-v1');
    // Any other stored value stands: nothing makes it a waiting pause without a write.
    expect(listedFormatOfRow('conversation-v1', waiting)).toBe('conversation-v1');
  });

  it('never throws: an envelope it cannot read keeps what the row says', () => {
    for (const envelope of [undefined, null, 42, '{not json', '"a string"', '{}']) {
      expect(listedFormatOfRow('flowchart-v1', envelope)).toBe('flowchart-v1');
    }
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
    /** The decision taken to the ledger was a decline. */
    declined = false,
  ) {
    const watch = watchAnswer(paused);
    if (happened !== 'nothing') noteDecisionTakenUp(REQUEST);
    const decision = { requestId: REQUEST, approved: !declined, by: 'maya', at: 1 };
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
    // The decline is what the ledger spent: no approval ran the call.
    const watch = await watched(paused, 'spent', true);
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

  it('a decline refused because an approval already spent the request is settled as unknown — that call may have run', async () => {
    for (const [why, spend] of [
      // An approval in this process spent it while this decline was watched.
      [
        'an approval spent it while watched',
        async () => {
          await spendDecision(
            inMemoryDecisionLedger(),
            { requestId: REQUEST, approved: true, by: 'maya', at: 1 },
            'checkIn',
          );
        },
      ],
      // The ledger had it spent already (another process's approval): this
      // decline was refused there.
      [
        'the ledger refused the decline',
        async () => {
          await spendDecision(
            { spend: () => false },
            { requestId: REQUEST, approved: false, by: 'maya', at: 1 },
            'checkIn',
          ).catch(() => undefined);
        },
      ],
    ] as const) {
      const { paused, written, after } = setup();
      const watch = watchAnswer(paused);
      noteDecisionTakenUp(REQUEST);
      await spend();
      expect(
        await after(watch, {
          answer: { requestId: REQUEST, approved: false, by: 'maya', at: 1, note: 'no' },
        }),
        why,
      ).toBe('marked');
      const history = readPausedRun(written[0]).conversation.history;
      expect(history[history.length - 1]?.content, why).toBe(OUTCOME_NOT_RECORDED);
      watch?.release();
    }
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

  describe('a refusal no decision can change, having used nothing, closes the pause', () => {
    const refusal = (reason: string) =>
      Object.assign(new Error('refused'), { code: 'ERR_RESUME_DECISION', reason });

    it.each(['request-not-recorded', 'call-changed', 'chain-changed'])(
      "closed for '%s': the store holds the conversation it goes on from — every open call not known, this resume's non-use being no proof that an earlier one used nothing",
      async (reason) => {
        const { paused, written, after } = setup();
        const watch = await watched(paused, 'taken-up');
        expect(
          await afterFailedAnswer({
            store: {
              hydrate: async () => toPausedEnvelope(paused),
              persist: async (_id: string, envelope: CheckpointEnvelope) =>
                void written.push(envelope),
            },
            sessionId: 's',
            paused,
            watch,
            error: refusal(reason),
          }),
        ).toBe('closed');
        expect(written[0]?.format).toBe('conversation-v1');
        const history = readEnvelope(written[0]!).history;
        expect(history[history.length - 1]?.content).toBe(OUTCOME_UNKNOWN_UNANSWERABLE);
        watch?.release();
        void after;
      },
    );

    it.each([
      ['never spent', false, NOT_RUN_UNANSWERABLE],
      ['spent by an earlier resume', true, OUTCOME_UNKNOWN_UNANSWERABLE],
    ] as const)(
      'closed with a runner on the ledger the request was minted under, the request %s',
      async (_label, spentEarlier, notice) => {
        const spent = new Set<string>();
        const decisionLedger = {
          id: 'refunds-ledger',
          spend: (id: string) => (spent.has(id) ? false : (spent.add(id), true)),
        };
        const bound = mintConsentRequest(
          { gate: 'checkIn', tool: 'refund', toolCallId: 'b', args: { order: 2 } },
          decisionLedger,
        );
        if (bound === undefined) throw new Error('expected a request');
        if (spentEarlier) spent.add(bound.request.id);
        const base = setup().paused;
        const paused: PausedRun = {
          ...base,
          checkpoint: {
            ...base.checkpoint,
            sharedState: { ...base.checkpoint.sharedState, pausedRequest: bound.request },
          },
          pending: { tool: 'refund', checkIn: { id: bound.request.id } as never },
        };
        const written: CheckpointEnvelope[] = [];
        const runner = Agent.create({
          provider: mock({ reply: 'x' }),
          model: 'm',
          decisionLedger,
        }).build();
        const watch = watchAnswer(paused);
        noteDecisionTakenUp(bound.request.id);
        expect(
          await afterFailedAnswer({
            store: {
              hydrate: async () => toPausedEnvelope(paused),
              persist: async (_id: string, envelope: CheckpointEnvelope) =>
                void written.push(envelope),
            },
            sessionId: 's',
            paused,
            watch,
            error: refusal('chain-changed'),
            runner,
          }),
        ).toBe('closed');
        const history = readEnvelope(written[0]!).history;
        expect(history[history.length - 1]?.content).toBe(notice);
        watch?.release();
      },
    );

    it('any other refusal, or a decision that may have been used, never closes it', async () => {
      for (const [happened, error, outcome] of [
        ['taken-up', refusal('other-request'), 'kept'],
        ['taken-up', new Error('model unavailable'), 'kept'],
        ['spent', refusal('chain-changed'), 'marked'],
      ] as const) {
        const { paused, after } = setup();
        const watch = await watched(paused, happened);
        expect(
          await afterFailedAnswer({
            store: {
              hydrate: async () => toPausedEnvelope(paused),
              persist: async () => undefined,
            },
            sessionId: 's',
            paused,
            watch,
            error,
          }),
        ).toBe(outcome);
        watch?.release();
        void after;
      }
    });

    it('closes only the same pause, still waiting, read back from the store', async () => {
      const reads: ((paused: PausedRun) => CheckpointEnvelope | undefined)[] = [
        () => undefined,
        (paused) => toPausedEnvelope(markAnswered(paused, undefined, 1)),
        (paused) =>
          toPausedEnvelope({ ...paused, pending: { checkIn: { id: 'c'.repeat(64) } as never } }),
        (paused) => toEnvelope(paused.conversation),
        () => {
          throw new Error('read timed out');
        },
      ];
      for (const read of reads) {
        const { paused, written } = setup();
        const watch = await watched(paused, 'taken-up');
        expect(
          await afterFailedAnswer({
            store: {
              hydrate: async () => read(paused),
              persist: async (_id: string, envelope: CheckpointEnvelope) =>
                void written.push(envelope),
            },
            sessionId: 's',
            paused,
            watch,
            error: refusal('chain-changed'),
          }),
        ).toBe('kept');
        expect(written).toEqual([]);
        watch?.release();
      }
    });
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
