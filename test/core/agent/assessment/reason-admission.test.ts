import { describe, expect, it } from 'vitest';
import { assessAnswer } from '../../../../src/observe.js';
import {
  assessmentDataOf,
  standingFactsOf,
  standingLineOf,
} from '../../../../src/core/agent/assessment/compose.js';
import { REASONS } from '../../../../src/core/agent/assessment/reasons.js';
import { REASON_WITNESS_CLASSES } from '../../../../src/core/agent/assessment/reasonClasses.js';
import type { AssessmentReason } from '../../../../src/core/agent/assessment/types.js';
import { MAX_ENTERED_TOOL_CALLS } from '../../../../src/core/agent/honesty/enteredToolCalls.js';

type Row = Readonly<Record<string, unknown>>;
type Seed = {
  readonly state?: Row;
  readonly message?: Row;
  readonly before?: readonly Row[];
};

const CALL = { toolCallId: 'current', toolName: 'lookup', iteration: 1, turn: 2 };
const WINDOW_DROP = {
  ...CALL,
  kind: 'result-dropped-from-window',
  callOccurrenceKey: [1, 0, 0, 0, 0],
  strategy: 'sliding-window',
};
const PERSON = { role: 'user', content: 'Read the current index.' };
const PROPOSAL = {
  role: 'assistant',
  content: '',
  toolCalls: [{ id: CALL.toolCallId, name: CALL.toolName, args: { window: '4h' } }],
};
const RESULT = {
  role: 'tool',
  toolCallId: CALL.toolCallId,
  toolName: CALL.toolName,
  content: '{"data":1}',
};
const EARLIER = [
  { role: 'user', content: 'Read the earlier index.' },
  { ...PROPOSAL, toolCalls: [{ id: 'earlier', name: CALL.toolName, args: { window: '2h' } }] },
  { ...RESULT, toolCallId: 'earlier', toolResultExecution: 'returned' },
];
const NOT_ENTERED = { toolResultExecution: 'not-entered', outcome: 'refused' };
const THREW = { toolResultExecution: 'threw', outcome: 'failed' };
const RETURNED = { toolResultExecution: 'returned' };
const DENIED = { ...RETURNED, toolResultDisposition: 'withheld', content: 'Unavailable.' };
const REWRITTEN = {
  ...RETURNED,
  toolResultDisposition: 'rewritten',
  content: '{"publicRows":[1]}',
};
const NOT_SERVED = { toolResultExecution: 'returned-unserved', outcome: 'failed' };

function ledger(row: Row): Seed {
  return { state: { findingsLedger: [{ ...CALL, ...row }] } };
}

function argument(fields: Row): Seed {
  return ledger({ kind: 'argument', argument: 'window', rule: 'assume', value: '4h', ...fields });
}

function period(verdict: string, extra: Row = {}): Seed {
  return ledger({ kind: 'period', verdict, ...extra });
}

function integrity(finding: string): Seed {
  return ledger({ kind: 'integrity-finding', finding, tools: [CALL.toolName] });
}

function validation(status: string, checks: readonly Row[] = []): Seed {
  return { state: { answerValidation: { mode: 'observe', status, checks } } };
}

function coverage(kind: 'ledger' | 'absence', extra: Row = {}): Seed {
  return { state: { coverageDeclared: [{ ...CALL, kind, checked: ['public rows'], ...extra }] } };
}

const SEEDS: Readonly<Record<AssessmentReason, Seed>> = {
  asked: { state: { pausedToolCallId: 'question' } },
  'argument-asked': {
    state: { argumentAsk: { waiting: { requestId: 'question' }, iteration: 2 } },
  },
  'argument-assumed': argument({ source: 'default' }),
  'argument-unverified': argument({ source: 'model' }),
  'argument-read': argument({ source: 'said', reading: true }),
  'value-contingent': argument({ source: 'result', setAside: 'open' }),
  'unsupported-argument': integrity('unsupported-argument'),
  'call-not-completed': { message: NOT_ENTERED },
  'result-cut': {
    state: {
      libraryResultLimits: [
        { ...CALL, kind: 'result-cut', keptChars: 10, maxChars: 100, totalChars: 300 },
      ],
    },
  },
  'placed-unread': {
    state: {
      libraryResultLimits: [{ ...CALL, kind: 'placed-unread', ref: 'art_0123456789012345678901' }],
    },
  },
  'times-without-zone': {
    state: {
      libraryResultLimits: [
        { ...CALL, kind: 'times-without-zone', naiveCount: 1, ref: 'art_0123456789012345678901' },
      ],
    },
  },
  'result-withheld': { message: DENIED },
  'result-dropped-from-window': {
    state: {
      settledToolCalls: [
        {
          callOccurrenceKey: [1, 0, 0, 0, 0],
          execution: 'returned',
          delivery: 'native',
        },
        {
          callOccurrenceKey: [2, 0, 0, 0, 0],
          execution: 'not-entered',
          outcome: 'refused',
        },
      ],
      settledToolCallsComplete: true,
      libraryResultLimits: [WINDOW_DROP],
    },
  },
  'work-not-finished': { message: { reportedStatus: 'pending' } },
  'coverage-gap': coverage('ledger', { notChecked: ['late arrivals'] }),
  'declared-absent': coverage('absence'),
  'empty-undeclared': { message: { content: '[]' } },
  'period-not-held': period('not-held'),
  'period-partly-held': period('partly-held'),
  'period-unknown': period('unknown'),
  'period-undeclared': period('undeclared'),
  'period-differs-from-asked': period('covered', { differs: { missing: [], extra: [] } }),
  'period-beyond-retention': period('covered', { beyondRetention: true }),
  'sources-conflict': {
    ...ledger({
      kind: 'conflict',
      key: 'total',
      witnesses: ['earlier', CALL.toolCallId].map((toolCallId) => ({
        toolCallId,
        subject: { kind: 'index', id: 'fixture' },
        predicate: 'total',
      })),
    }),
    before: EARLIER,
  },
  'column-type-mismatch': integrity('column-type-mismatch'),
  'missing-column': integrity('missing-column'),
  'value-unsupported': { state: { unsupportedValues: { candidates: [{ value: '3322' }] } } },
  'value-survived-revision': {
    state: { unsupportedValues: { candidates: [{ value: '3322' }], revised: true } },
  },
  'derived-from-reading': ledger({ kind: 'time-derived', values: ['2026-03-03'] }),
  'script-unmatched': ledger({ kind: 'script-shown', label: 'unmatched' }),
  'stopped-early': { state: { stoppedEarly: { reason: 'max-iterations', iteration: 2 } } },
  'steps-unfinished': ledger({ kind: 'steps-unfinished' }),
  'step-skipped': ledger({ kind: 'step-skipped', policy: 'advance' }),
  'negative-prose-unverified': ledger({ kind: 'negative-claim-note' }),
  'invariant-violation': integrity('invariant-violation'),
  'unsupported-claim': integrity('unsupported-claim'),
  'claim-unsettled': ledger({ kind: 'claim-unsettled', field: 'total' }),
  'claim-exceeds-search': validation('passed', [
    { id: 'agent:negative-claims:0', disposition: 'checked-fail' },
  ]),
  'declaration-overclaimed': validation('passed', [
    {
      ...CALL,
      id: 'agent:negative-claims:declaration:0',
      disposition: 'not-applicable',
      reason: 'declaration-overclaimed',
      tools: [CALL.toolName],
    },
  ]),
  'answer-check-failed': validation('failed'),
  'check-unreachable': validation('unverified'),
};

const ANSWER_CONTINGENT: Seed = {
  ...ledger({
    kind: 'contingent',
    declaredOn: 'answer',
    value: '3322',
    carriers: [{ toolCallId: 'earlier', standing: 'open' }],
  }),
  before: EARLIER,
};
const RETENTION_REFUSAL = ledger({
  kind: 'call-window',
  how: 'refused',
  refused: 'beyond-retention',
});

function assessmentOf(seed: Seed, execution: Row) {
  return assessAnswer({
    snapshot: {
      sharedState: {
        turnNumber: CALL.turn,
        history: [
          ...(seed.before ?? []),
          PERSON,
          PROPOSAL,
          { ...RESULT, ...seed.message, ...execution },
        ],
        ...seed.state,
      },
    },
  });
}

function reasonsOf(seed: Seed, execution: Row) {
  return assessmentOf(seed, execution).reasons.map(({ reason }) => reason);
}

describe('standing reason admission by witness', () => {
  it('classifies every reason and both kinds of mixed witness', () => {
    expect(new Set(REASON_WITNESS_CLASSES.map(({ reason }) => reason))).toEqual(
      new Set(REASONS.map(({ reason }) => reason)),
    );
    expect(REASON_WITNESS_CLASSES.filter(({ witness }) => witness === 'answer')).toEqual([
      { reason: 'value-contingent', witness: 'answer', class: 'turn' },
    ]);
    expect(REASON_WITNESS_CLASSES.filter(({ witness }) => witness === 'retention-refusal')).toEqual(
      [{ reason: 'period-beyond-retention', witness: 'retention-refusal', class: 'settlement' }],
    );
  });

  it.each(REASON_WITNESS_CLASSES.filter((row) => row.class === 'input' || row.class === 'result'))(
    '$reason ($witness) needs the execution its $class witness describes',
    ({ reason, class: kind }) => {
      const seed = SEEDS[reason];
      expect.soft(reasonsOf(seed, RETURNED), 'dispatched control').toEqual([reason]);
      expect
        .soft(reasonsOf(seed, NOT_ENTERED), 'refused occurrence')
        .toEqual(['call-not-completed']);
      if (kind === 'input') {
        expect
          .soft(reasonsOf(seed, THREW), 'entered, then threw')
          .toEqual([reason, 'call-not-completed']);
      } else {
        expect.soft(reasonsOf(seed, THREW), 'entered, then threw').toEqual(['call-not-completed']);
        expect
          .soft(reasonsOf(seed, NOT_SERVED), 'returned without delivery')
          .toEqual(['call-not-completed']);
        expect.soft(reasonsOf(seed, DENIED), 'after-tool denial').toEqual(['result-withheld']);
        // The model records a conflict after reading the served rewrite. The other
        // witnesses describe native data that this replacement no longer carries.
        expect
          .soft(reasonsOf(seed, REWRITTEN), 'served rewrite')
          .toEqual(
            ['sources-conflict', 'result-cut', 'placed-unread'].includes(reason) ? [reason] : [],
          );
      }
    },
  );

  it.each(REASON_WITNESS_CLASSES.filter((row) => row.class === 'turn'))(
    '$reason ($witness) is still read when another call was refused',
    ({ reason, witness }) => {
      const seed = witness === 'answer' ? ANSWER_CONTINGENT : SEEDS[reason];
      expect(reasonsOf(seed, NOT_ENTERED)).toEqual(
        expect.arrayContaining(['call-not-completed', reason]),
      );
    },
  );

  it.each(REASON_WITNESS_CLASSES.filter((row) => row.class === 'settlement'))(
    '$reason ($witness) is read from the settlement itself',
    ({ reason, witness }) => {
      const seed = witness === 'retention-refusal' ? RETENTION_REFUSAL : SEEDS[reason];
      const execution = reason === 'result-withheld' ? DENIED : NOT_ENTERED;
      const reasons = reasonsOf(seed, execution);
      expect(reasons).toContain(reason);
      if (witness === 'retention-refusal') {
        expect(reasons).toEqual(['call-not-completed', 'period-beyond-retention']);
      }
    },
  );

  it('a bounded result-limit record cannot silently clear the standing', () => {
    for (const state of [
      { libraryResultLimitsIncomplete: true },
      { libraryResultLimits: new Array(2_000) },
    ]) {
      const assessment = assessmentOf({ state }, RETURNED);
      expect(assessment.standing).toBe('not-sure');
      expect(assessment.reasons.map(({ reason }) => reason)).toEqual(['check-unreachable']);
      expect(
        standingLineOf(
          assessmentDataOf(assessment),
          [],
          false,
          standingFactsOf(assessment, new Map()),
        ),
      ).toContain("the record could not keep every limit on this turn's tool results");
    }
  });

  it('window evidence shares the saved receipt limit with other fact kinds', () => {
    const seed = SEEDS['result-dropped-from-window'];
    const otherLimits = Array.from({ length: MAX_ENTERED_TOOL_CALLS }, (_, index) => ({
      ...CALL,
      toolCallId: `earlier-${index}`,
      turn: CALL.turn - 1,
      kind: 'result-cut',
      keptChars: 10,
      maxChars: 100,
      totalChars: 300,
    }));
    const assessWith = (prefix: readonly Row[]) =>
      assessmentOf(
        { ...seed, state: { ...seed.state, libraryResultLimits: [...prefix, WINDOW_DROP] } },
        NOT_ENTERED,
      );

    const atLimit = assessWith(otherLimits.slice(1));
    expect(
      atLimit.reasons.find(({ reason }) => reason === 'result-dropped-from-window')?.witness,
    ).toEqual([
      {
        kind: 'state',
        key: 'libraryResultLimits',
        path: `/${MAX_ENTERED_TOOL_CALLS - 1}/strategy`,
      },
    ]);

    const beyondLimit = assessWith(otherLimits);
    const beyondReasons = beyondLimit.reasons.map(({ reason }) => reason);
    expect(beyondReasons).toContain('check-unreachable');
    expect(beyondReasons).not.toContain('result-dropped-from-window');
  });

  it('an incomplete entry record says which check could not reach a verdict', () => {
    const assessment = assessmentOf(
      { state: { enteredToolCalls: { complete: false, entries: [] } } },
      RETURNED,
    );
    const witness = assessment.reasons.find(({ reason }) => reason === 'check-unreachable');
    expect(witness?.witness).toEqual([
      { kind: 'state', key: 'enteredToolCalls', path: '/complete' },
    ]);
    expect(
      standingLineOf(
        assessmentDataOf(assessment),
        [],
        false,
        standingFactsOf(assessment, new Map()),
      ),
    ).toContain('the record could not establish tool entry for every checked call');
  });

  it('describes the answer when the answer used a set-aside result', () => {
    const assessment = assessmentOf(ANSWER_CONTINGENT, NOT_ENTERED);
    const line = standingLineOf(
      assessmentDataOf(assessment),
      [],
      false,
      standingFactsOf(assessment, new Map()),
    );
    expect(line).toContain('a value in the answer came from a result the model');
    expect(line).not.toContain('a value a call ran with');
  });
});
