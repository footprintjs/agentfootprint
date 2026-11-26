import { describe, expect, it, vi } from 'vitest';
import { admitPauseTypedAnswers, admitStoredHistory } from './checkpointHistory.js';
import { stripFrameworkFields } from './agent/composeRequest.js';

const reply = { role: 'assistant', content: 'identical' } as const;
const host = { kind: 'host', runId: 'turn-b' } as const;
const admit = [
  (message: unknown) => admitStoredHistory([message], undefined),
  (message: unknown) => admitStoredHistory([], [{ messages: [message] }]),
  (message: unknown) => admitPauseTypedAnswers({ history: [message] }),
  (message: unknown) => admitPauseTypedAnswers({ foldedSpans: [{ messages: [message] }] }),
];

describe('reply authorship at storage and transport boundaries', () => {
  it.each([true, false])('projects both authors to identical wire bytes (reuse %s)', (reuse) => {
    const marked = [host, { kind: 'model', runId: 'turn-a' }].map((replyOrigin) => ({
      ...reply,
      replyOrigin,
    }));
    expect(stripFrameworkFields(marked, reuse)).toEqual([reply, reply]);
    expect(stripFrameworkFields(marked, reuse)).toEqual([reply, reply]);
    expect(marked[0].replyOrigin).toEqual(host);
  });

  for (const [index, check] of admit.entries()) {
    it('checks the mark at carrier ' + index, () => {
      for (const mark of [
        null,
        [],
        {},
        { ...host, kind: 'user' },
        { ...host, runId: '' },
        { ...host, runId: 'x'.repeat(4097) },
        { ...host, extra: 1 },
        Object.create(host),
      ]) {
        expect(() => check({ ...reply, replyOrigin: mark })).toThrow(/replyOrigin/);
      }
      for (const field of ['thinkingBlocks', 'replay', 'toolCalls', 'toolCallId']) {
        expect(() => check({ ...reply, replyOrigin: host, [field]: [] })).toThrow(/replyOrigin/);
      }
      expect(() => check({ ...reply, role: 'user', replyOrigin: host })).toThrow(/replyOrigin/);
      const spy = vi.fn(() => host);
      expect(() => check(Object.defineProperty({ ...reply }, 'replyOrigin', { get: spy }))).toThrow(
        /replyOrigin/,
      );
      expect(() =>
        check({
          ...reply,
          replyOrigin: Object.defineProperty({ kind: 'host' }, 'runId', { get: spy }),
        }),
      ).toThrow(/replyOrigin/);
      expect(spy).not.toHaveBeenCalled();
      check(reply);
      check({ ...reply, replyOrigin: host });
      check({ ...reply, replyOrigin: { kind: 'model', runId: 'a' }, thinkingBlocks: [] });
    });
  }
});
