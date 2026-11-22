import { expect, it } from 'vitest';
import { accountForAnswer } from '../../src/answer-account/account.js';
import type { AnswerAccount, ToolCallFact } from '../../src/answer-account/types.js';
import type { Recording } from '../../src/observe.js';
import { assertP7, deniedLeaves } from './helpers.js';

function fixture(where?: string, privateValue = 'rewritten-private-sentinel') {
  const key = [1, 2, 3, 4, 0];
  const call = { toolCallId: 'one', toolName: 'lookup', callOccurrenceKey: key };
  const state = {
    turnNumber: 1,
    settledToolCalls: [{ callOccurrenceKey: key, execution: 'returned', delivery: 'rewritten' }],
    ...(where === 'native' && { privateNative: privateValue }),
    ...(where === 'source-path' && { privateSourcePath: privateValue }),
    ...(where === 'unknown-delivery' && { unknownSettlement: { delivery: privateValue } }),
  };
  const recording = {
    snapshot: { sharedState: state },
    events: [
      {
        type: 'agentfootprint.stream.tool_start',
        payload: { ...call, args: where === 'args' ? { privateValue } : {} },
        meta: {},
      },
      {
        type: 'agentfootprint.middleware.decision',
        payload: {
          ...call,
          middleware: 'summary-rule',
          at: 'tool',
          moment: 'after-tool',
          outcome: 'allow',
          changed: true,
          ...(where === 'why' && { why: privateValue }),
        },
        meta: {},
      },
      {
        type: 'agentfootprint.stream.tool_end',
        payload: {
          ...call,
          entered: true,
          durationMs: 0,
          result: where === 'result' ? { privateValue } : 'summary',
        },
        meta: {},
      },
    ],
  } as unknown as Recording;
  const original = accountForAnswer(recording, {});
  const withRule = (rewrittenBy: string): AnswerAccount => ({
    ...original,
    facts: {
      ...original.facts,
      calls: [
        {
          toolCallId: 'one',
          toolName: 'lookup',
          outcome: 'ran',
          emptiness: 'unknown',
          pointers: [],
          rewrittenBy,
        } satisfies ToolCallFact,
      ],
    },
  });
  return { recording, withRule };
}

it('closed delivery metadata does not collide with the public rewrittenBy field name', () => {
  const { recording, withRule } = fixture();
  expect(deniedLeaves(recording)).not.toContain('rewritten');
  expect(() => assertP7(withRule('summary-rule'), recording)).not.toThrow();
});

it.each(['args', 'result', 'why', 'native', 'source-path', 'unknown-delivery'])(
  'the unchanged substring/privacy gate still kills a %s leak beside rewrittenBy',
  (where) => {
    const sentinel =
      where === 'source-path'
        ? '/private/source/payload-sentinel.ts'
        : 'rewritten-private-sentinel';
    const { recording, withRule } = fixture(where, sentinel);
    expect(deniedLeaves(recording)).toContain(sentinel);
    expect(() => assertP7(withRule(sentinel), recording)).toThrow(
      /denied leaf reached the response/,
    );
  },
);

it.each(['rewritte', 'ewritten'])(
  'unknown proper substring %s is still denied, never exempted by the closed word',
  (sentinel) => {
    const { recording, withRule } = fixture('unknown-delivery', sentinel);
    expect(deniedLeaves(recording)).toContain(sentinel);
    expect(() => assertP7(withRule(sentinel), recording)).toThrow(
      /denied leaf reached the response/,
    );
  },
);
