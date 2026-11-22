import { expect, it } from 'vitest';
import { accountForAnswer } from '../../src/answer-account/account.js';
import type { Recording } from '../../src/observe.js';

function fixture(count: number) {
  const work = { keyDescriptors: 0, arrayReads: 0, arrayDescriptors: 0 };
  const keys = Array.from({ length: count }, (_, index) => [1, 2, 3, 4, index]);
  const rows: Record<string, unknown>[] = keys.map(
    (callOccurrenceKey, index) =>
      new Proxy(
        {
          callOccurrenceKey,
          toolCallId: `call-${index}`,
          toolName: 'lookup',
          at: 'tool',
          moment: 'after-tool',
          outcome: 'allow',
          changed: true,
          middleware: `rule-${index}`,
        },
        {
          getOwnPropertyDescriptor(target, property) {
            if (property === 'callOccurrenceKey') work.keyDescriptors++;
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
        },
      ),
  );
  const numeric = (property: PropertyKey) => typeof property === 'string' && /^\d+$/.test(property);
  const ledger = new Proxy(rows, {
    get(target, property, receiver) {
      if (numeric(property)) work.arrayReads++;
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (numeric(property)) work.arrayDescriptors++;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  const events = keys.flatMap((callOccurrenceKey, index) => {
    const call = { callOccurrenceKey, toolCallId: `call-${index}`, toolName: 'lookup' };
    const meta = { runId: 'fixture-run', runtimeStageId: 'tool-calls#1' };
    return [
      { type: 'agentfootprint.stream.tool_start', payload: { ...call, args: {} }, meta },
      {
        type: 'agentfootprint.stream.tool_end',
        payload: { ...call, entered: true, result: 'native', modelResult: '[1]', durationMs: 0 },
        meta,
      },
    ];
  });
  const recording = {
    snapshot: { sharedState: { history: [], middlewareDecisions: ledger } },
    events,
  } as unknown as Recording;
  return { recording, rows, keys, work };
}

it.each([false, true])(
  'an unreadable final name executes no getter and never credits an earlier rule (throws=%s)',
  (throws) => {
    const input = fixture(1);
    let getterCalls = 0;
    const last = {
      ...input.rows[0],
      get middleware() {
        getterCalls++;
        if (throws) throw new Error('Private getter executed.');
        return 'PRIVATE_GETTER_NAME';
      },
    };
    input.rows.push(last);
    let account: ReturnType<typeof accountForAnswer> | undefined;
    expect(() => {
      account = accountForAnswer(input.recording, {});
    }).not.toThrow();
    expect(getterCalls).toBe(0);
    expect(account?.facts.calls[0]).not.toHaveProperty('rewrittenBy');
  },
);

it('ledger work grows with N rather than calls times ledger size at N and 10N', () => {
  const read = (count: number) => {
    const input = fixture(count);
    const result = accountForAnswer(input.recording, {});
    expect(result.facts.calls).toHaveLength(Math.min(count, 50));
    return { count, ...input.work };
  };
  const small = read(8);
  const large = read(80);
  console.info('REWRITE_LEDGER_WORK', JSON.stringify({ small, large }));
  expect(large.keyDescriptors).toBeLessThanOrEqual(small.keyDescriptors * 10);
  expect(large.arrayReads + large.arrayDescriptors).toBeLessThanOrEqual(
    (small.arrayReads + small.arrayDescriptors) * 10,
  );
});

it('attribution points to the original ledger position across interleaved occurrences', () => {
  const input = fixture(2);
  input.rows.unshift({
    ...input.rows[0],
    callOccurrenceKey: [9, 8, 7, 6, 0],
    middleware: 'foreign-rule',
  });
  input.rows.push({ ...input.rows[1], middleware: 'final-rule' });
  const calls = accountForAnswer(input.recording, {}).facts.calls;
  expect(calls.map(({ rewrittenBy }) => rewrittenBy)).toEqual(['final-rule', 'rule-1']);
  expect(calls[0]?.pointers).toContainEqual({
    kind: 'state',
    key: 'middlewareDecisions',
    path: '/3/middleware',
  });
  expect(calls[1]?.pointers).toContainEqual({
    kind: 'state',
    key: 'middlewareDecisions',
    path: '/2/middleware',
  });
});
