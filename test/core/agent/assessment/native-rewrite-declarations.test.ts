import { describe, expect, it } from 'vitest';

import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';
import {
  assessmentDataOf,
  standingFactsOf,
  standingLineOf,
} from '../../../../src/core/agent/assessment/compose.js';
import { toolSettlementOf } from '../../../../src/core/agent/honesty/settledToolCalls.js';
import type { MiddlewareDecision } from '../../../../src/core/agent/middleware/types.js';
import type { CallOccurrenceKey } from '../../../../src/lib/callOccurrence.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';
import { absent } from '../../../../src/semantics/coverage/absent.js';
import { coverage } from '../../../../src/semantics/coverage/ledger.js';
import type { DeclaredCoverage } from '../../../../src/semantics/coverage/types.js';

const key = [1, 2, 3, 4, 0] as const;
const otherKey = [1, 2, 3, 4, 1] as const;
const call = { toolCallId: 'reused', toolName: 'lookup', iteration: 1 };
const queried = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
const person = { role: 'user', content: 'Read the public index.' };
type State = Readonly<Record<string, unknown>>;

function nativeCoverage(
  kind: DeclaredCoverage['kind'] = 'ledger',
  gap = 'native unexamined scope',
  callOccurrenceKey: CallOccurrenceKey = key,
): DeclaredCoverage {
  return {
    ...call,
    callOccurrenceKey,
    kind,
    checked: [{ what: 'native examined scope' }],
    notChecked: [{ what: gap }],
    cannotCover: [],
  };
}

function nativePeriod(verdict = 'not-held', callOccurrenceKey: CallOccurrenceKey = key) {
  return { ...call, callOccurrenceKey, kind: 'period', turn: 1, verdict };
}

function result(
  content: unknown = 'Public summary.',
  fields: Partial<LLMMessage> = {},
): LLMMessage {
  return {
    role: 'tool',
    ...call,
    callOccurrenceKey: key,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    toolResultExecution: 'returned',
    toolResultDisposition: 'rewritten',
    ...fields,
  };
}

function record(
  message: LLMMessage,
  rows: readonly DeclaredCoverage[] = [],
  periods: readonly State[] = [],
  options: { readonly retained?: boolean; readonly legacy?: boolean } = {},
): State {
  const settlement = toolSettlementOf(message, rows);
  if (settlement === undefined) throw new Error('Fixture has no admitted settlement.');
  return {
    turnNumber: 1,
    history: [
      person,
      ...(options.retained === false
        ? []
        : [
            {
              role: 'assistant',
              content: '',
              toolCalls: [
                {
                  id: call.toolCallId,
                  name: call.toolName,
                  args: {},
                  callOccurrenceKey: message.callOccurrenceKey,
                },
              ],
            },
            message,
          ]),
    ],
    coverageDeclared: rows,
    findingsLedger: periods,
    enteredToolCalls: [{ callOccurrenceKey: message.callOccurrenceKey, entered: true }],
    enteredToolCallsComplete: true,
    ...(!options.legacy && {
      settledToolCalls: [settlement],
      settledToolCallsComplete: true,
    }),
  };
}

const assess = (state: State) => assessAnswer({ snapshot: { sharedState: state } });
const kinds = (state: State) => assess(state).reasons.map(({ reason }) => reason);
const stateWitness = (name: string, index: number, field: string) => ({
  kind: 'state',
  key: name,
  path: `/${index}/${field}`,
});
const servedWitness = {
  kind: 'history',
  index: 2,
  path: '/toolCallId',
  toolCallId: call.toolCallId,
};

describe('native declarations remain evidence after an allowed replacement', () => {
  it.each([
    { legacy: false, retained: true },
    { legacy: false, retained: false },
    { legacy: true, retained: true },
  ])('keeps original coverage, absence and period ($legacy, $retained)', (options) => {
    const a = assess(record(result(), [nativeCoverage('absence')], [nativePeriod()], options));
    expect(a.standing).toBe('not-sure');
    expect(a.reasons.map(({ reason }) => reason)).toEqual([
      'coverage-gap',
      'declared-absent',
      'period-not-held',
    ]);
    expect(a.reasons.find(({ reason }) => reason === 'coverage-gap')?.witness).toEqual([
      stateWitness('coverageDeclared', 0, 'kind'),
    ]);
    expect(a.reasons.find(({ reason }) => reason === 'period-not-held')?.witness).toEqual([
      stateWitness('findingsLedger', 0, 'verdict'),
    ]);
    expect(a.checked.find(({ check }) => check === 'result-period')).toEqual({
      layer: 3,
      check: 'result-period',
      ran: 1,
      of: 1,
      witness: [stateWitness('findingsLedger', 0, 'verdict')],
    });
  });

  it.each([null, false, 0, '', { publicRows: [1] }])(
    'a primitive or plain replacement cannot clear native limits: %j',
    (replacement) => {
      expect(
        kinds(record(result(replacement), [nativeCoverage('absence')], [nativePeriod()])),
      ).toEqual(['coverage-gap', 'declared-absent', 'period-not-held']);
    },
  );

  it('a plain-text replacement keeps the call counted for tool coverage', () => {
    // `declarationsForResult · declared` reads the native rows, not the replacement's door.
    const { toolResultDisposition: _rewritten, ...native } = result();
    for (const message of [result(), native as LLMMessage])
      expect(
        assess(record(message, [nativeCoverage()])).checked.find(
          ({ check }) => check === 'tool-coverage',
        ),
      ).toMatchObject({ ran: 1, of: 1 });
  });

  it('adds an undeclared empty replacement beside the original declarations', () => {
    expect(kinds(record(result([]), [nativeCoverage('absence')], [nativePeriod()]))).toEqual([
      'coverage-gap',
      'declared-absent',
      'empty-undeclared',
      'period-not-held',
    ]);
  });

  it('adds the replacement period beside the original period', () => {
    const replacement = coverage('Public summary.', {
      checked: ['public scope'],
      period: { queried, held: 'unknown' },
    });
    const a = assess(record(result(replacement), [nativeCoverage()], [nativePeriod()]));
    expect(a.reasons.find(({ reason }) => reason === 'period-not-held')?.witness).toEqual([
      stateWitness('findingsLedger', 0, 'verdict'),
    ]);
    expect(a.reasons.find(({ reason }) => reason === 'period-unknown')?.witness).toEqual([
      servedWitness,
    ]);
    expect(a.reasons.map(({ reason }) => reason)).toContain('coverage-gap');
  });

  it.each(['coverage-gap', 'declared-absent'] as const)(
    'keeps distinct native and replacement witnesses for %s',
    (reason) => {
      const replacement =
        reason === 'coverage-gap'
          ? coverage('Public summary.', { checked: ['public scope'], notChecked: ['same text'] })
          : absent({ what: 'public item', checked: ['public scope'] });
      const row = nativeCoverage(reason === 'declared-absent' ? 'absence' : 'ledger', 'same text');
      const a = assess(record(result(replacement), [row]));
      expect(a.reasons.find((entry) => entry.reason === reason)?.witness).toEqual([
        stateWitness('coverageDeclared', 0, 'kind'),
        servedWitness,
      ]);
    },
  );

  it('a complete replacement never overwrites an original gap or absence', () => {
    const replacement = coverage('Public summary.', { checked: ['all public scope'] });
    expect(kinds(record(result(replacement), [nativeCoverage('absence')]))).toEqual([
      'coverage-gap',
      'declared-absent',
    ]);
  });

  it('reads the existing occurrence-linked after-tool decision in an older recording', () => {
    const message = result('Public summary.', { toolResultDisposition: undefined });
    const decision: MiddlewareDecision = {
      ...call,
      callOccurrenceKey: key,
      middleware: 'summary-rule',
      moment: 'after-tool',
      at: 'tool',
      outcome: 'allow',
      changed: true,
      why: 'Return a public summary.',
      before: { privateValue: 'hidden native result' },
      after: 'Public summary.',
    };
    const state = {
      ...record(message, [nativeCoverage('absence')], [nativePeriod()], { legacy: true }),
      middlewareDecisions: [decision],
    };
    expect(kinds(state)).toEqual(['coverage-gap', 'declared-absent', 'period-not-held']);
    expect(JSON.stringify(assessmentDataOf(assess(state)))).not.toContain('hidden native result');
  });
});

describe('admission and privacy controls remain independent of rewriting', () => {
  it('the unchanged native delivery keeps its original declaration witnesses', () => {
    const state = record(
      result('Native result.', { toolResultDisposition: undefined }),
      [nativeCoverage('absence')],
      [nativePeriod()],
    );
    expect(kinds(state)).toEqual(['coverage-gap', 'declared-absent', 'period-not-held']);
  });

  it.each(['not-entered', 'threw', 'returned-unserved'] as const)(
    '%s cannot admit original declarations',
    (toolResultExecution) => {
      const state = record(
        result('Notice.', { toolResultExecution }),
        [nativeCoverage('absence')],
        [nativePeriod()],
      );
      expect(kinds(state)).not.toContain('coverage-gap');
      expect(kinds(state)).not.toContain('declared-absent');
      expect(kinds(state)).not.toContain('period-not-held');
    },
  );

  it('withheld data stays anonymous and cannot supply native limits', () => {
    const state = record(
      result('Unavailable.', { toolResultDisposition: 'withheld' }),
      [nativeCoverage('absence', 'private scope')],
      [nativePeriod()],
    );
    expect(assess(state).reasons).toEqual([
      { reason: 'result-withheld', layer: 3, witness: [], source: { kind: 'run' } },
    ]);
  });

  it('a later allowed occurrence with the same provider id cannot admit the earlier rows', () => {
    const state = record(
      result('Public summary.', { callOccurrenceKey: otherKey }),
      [nativeCoverage('absence')],
      [nativePeriod()],
    );
    expect(kinds(state)).toEqual([]);
  });

  it('a rewritten settlement alone cannot invent missing native declarations', () => {
    expect(kinds(record(result()))).toEqual([]);
  });

  it('ambiguous settlement evidence remains unknown instead of admitting declarations', () => {
    const state = record(result(), [nativeCoverage('absence')], [nativePeriod()]);
    const settlement = toolSettlementOf(result());
    expect(kinds({ ...state, settledToolCalls: [settlement, settlement] })).toEqual([
      'check-unreachable',
    ]);
  });

  it('legacy eviction cannot invent delivery proof for an original coverage row', () => {
    const state = record(result(), [nativeCoverage('absence')], [], {
      legacy: true,
      retained: false,
    });
    expect(kinds(state)).toEqual([]);
  });

  it('native shape findings do not become facts about a replacement', () => {
    const finding = {
      ...call,
      callOccurrenceKey: key,
      turn: 1,
      kind: 'integrity-finding',
      finding: 'missing-column',
      tools: [call.toolName],
    };
    expect(kinds(record(result(), [], [finding]))).toEqual([]);
    expect(
      kinds(record(result('Native result.', { toolResultDisposition: undefined }), [], [finding])),
    ).toEqual(['missing-column']);
  });

  it('hidden payload differences cannot change the public assessment or standing line', () => {
    const publicView = (hidden: string) => {
      const decision: MiddlewareDecision = {
        ...call,
        callOccurrenceKey: key,
        middleware: 'summary-rule',
        moment: 'after-tool',
        at: 'tool',
        outcome: 'allow',
        changed: true,
        why: 'Return a public summary.',
        before: { nativeValue: hidden },
        after: 'Public summary.',
      };
      const state = {
        ...record(result('Public summary.'), [nativeCoverage('absence')], [nativePeriod()]),
        middlewareDecisions: [decision],
      };
      const a = assess(state);
      return {
        assessment: a,
        line: standingLineOf(assessmentDataOf(a), [], false, standingFactsOf(a, new Map())),
      };
    };
    const sentinels = ['HIDDEN_NATIVE_ALPHA', 'HIDDEN_NATIVE_BETA_LONGER'] as const;
    const first = publicView(sentinels[0]);
    const second = publicView(sentinels[1]);
    expect(first).toEqual(second);
    for (const view of [first, second]) {
      for (const hidden of sentinels) expect(JSON.stringify(view)).not.toContain(hidden);
    }
  });
});
