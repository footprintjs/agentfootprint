/**
 * The standing fold — `core/agent/assessment/assess.ts` · `assessAnswer` — over
 * hand-built committed records.
 *
 * Test types:
 *   - UNIT      — each reason from its one row; the value by precedence; the
 *                 support rule; the turn boundary; the checkpoint; caller errors;
 *   - PROPERTY  — over 3,000 generated records: never "known" without a
 *                 supporting row and no reason; a reason ⇔ `unknown`;
 *                 `not-applicable` ⇔ nothing ran, nothing fired, nothing
 *                 supports; the owner's word follows the value; total, pure,
 *                 deterministic;
 *   - SECURITY  — a library-written user frame never opens a turn (it is not a
 *                 person's message); a malformed stored ask is not an ask; the
 *                 fold never reads an event, however loud.
 */

import { describe, expect, it } from 'vitest';

import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';
import { REASONS, reasonEntry } from '../../../../src/core/agent/assessment/reasons.js';
import type {
  AnswerAssessment,
  AssessmentReason,
} from '../../../../src/core/agent/assessment/types.js';
import { absent, coverage } from '../../../../src/index.js';

type State = Record<string, unknown>;
const run = (state: State, checkpoint?: unknown) =>
  assessAnswer({
    snapshot: { sharedState: state },
    ...(checkpoint !== undefined && { checkpoint }),
  });

const user = (content: string) => ({ role: 'user', content });
const tool = (toolCallId: string, result: unknown, toolName = 'lookup') => ({
  role: 'tool',
  toolCallId,
  toolName,
  content: typeof result === 'string' ? result : JSON.stringify(result),
});
const reasonsOf = (a: AnswerAssessment) => a.reasons.map((r) => r.reason);
const absenceRow = (toolCallId: string, extra: Record<string, unknown> = {}) => ({
  kind: 'absence',
  toolName: 'lookup',
  toolCallId,
  iteration: 1,
  lookedFor: 'x',
  checked: [{ what: 'the inventory' }],
  notChecked: [],
  cannotCover: [],
  ...extra,
});
const ledgerRow = (toolCallId: string, extra: Record<string, unknown> = {}) => ({
  kind: 'ledger',
  toolName: 'lookup',
  toolCallId,
  iteration: 1,
  checked: [{ what: 'switch A' }],
  notChecked: [],
  cannotCover: [],
  ...extra,
});

describe('UNIT — the value, by precedence', () => {
  it('nothing on the record → not-applicable / not-assessed (never a guess)', () => {
    const a = assessAnswer({});
    expect(a).toEqual({
      assessment: 'not-applicable',
      standing: 'not-assessed',
      reasons: [],
      checked: [],
      turnFrom: 'whole-history',
    });
  });

  it('rows came back and nothing fired → unrefuted / consistent — NEVER known from silence', () => {
    const a = run({ history: [user('q'), tool('c1', [{ id: 1 }])] });
    expect(a.assessment).toBe('unrefuted');
    expect(a.standing).toBe('consistent');
    expect(a.checked).toEqual([
      { layer: 3, check: 'tool-coverage', ran: 0, of: 1, witness: [] },
      {
        layer: 3,
        check: 'result-shape',
        ran: 1,
        of: 1,
        witness: [{ kind: 'history', index: 1, path: '/toolCallId', toolCallId: 'c1' }],
      },
    ]);
    // A declared boundary with no gap is a membership pass too: still consistent, never known.
    const bounded = run({
      history: [user('q'), tool('c1', coverage([{ id: 1 }], { checked: ['all of A'] }))],
      coverageDeclared: [ledgerRow('c1')],
    });
    expect(bounded.standing).toBe('consistent');
    expect(bounded.support).toBeUndefined();
  });

  it('known needs a SUPPORTING row: a passed ENFORCE answer check for these bytes', () => {
    const passed = { mode: 'enforce', status: 'passed', candidateDigest: 'sha256:abc', checked: 2 };
    const a = run({ answerValidation: passed });
    expect(a).toMatchObject({
      assessment: 'known',
      standing: 'known',
      support: { kind: 'answer-validation', reportDigest: 'sha256:abc' },
    });
    // Observe mode, or a report that names no bytes, supports nothing — the check still ran.
    expect(run({ answerValidation: { ...passed, mode: 'observe' } }).standing).toBe('consistent');
    const { candidateDigest: _d, ...noDigest } = passed;
    void _d;
    expect(run({ answerValidation: noDigest }).standing).toBe('consistent');
  });

  it('a reason outranks support: known is never reported beside a fired reason', () => {
    const a = run({
      answerValidation: { mode: 'enforce', status: 'passed', candidateDigest: 'd' },
      stoppedEarly: { reason: 'max-iterations', iteration: 5, pendingToolCalls: 1 },
    });
    expect(a.assessment).toBe('unknown');
    expect(a.standing).toBe('not-sure');
    expect(a.support).toBeUndefined();
  });

  it('ask outranks not sure; reasons come in the table’s order', () => {
    const checkpoint = {
      sharedState: {
        history: [user('volumes last year?'), tool('c0', [])],
      },
      pauseData: {
        awaitingInput: {
          id: 'year',
          question: 'Which year?',
          fields: [{ id: 'year', type: 'number', required: true }],
          status: 'awaiting_input',
          requestId: 'r-1',
          supplied: {},
          origins: {},
          missing: ['year'],
          origin: { originalRequest: 'volumes last year?', toolCallId: 'c1' },
        },
      },
    };
    const a = assessAnswer({ checkpoint });
    expect(reasonsOf(a)).toEqual(['asked', 'empty-undeclared']);
    expect(a.standing).toBe('ask');
    expect(a.reasons[0]).toEqual({
      reason: 'asked',
      witness: [{ kind: 'checkpoint', path: '/pauseData/awaitingInput/requestId' }],
    });
  });
});

describe('UNIT — each reason from its one row', () => {
  it('declared-absent and coverage-gap from the coverage rows', () => {
    const a = run({
      history: [
        user('q'),
        tool('c1', absent({ what: 'x', checked: ['inv'], notChecked: ['off VMs'] })),
      ],
      coverageDeclared: [absenceRow('c1', { notChecked: [{ what: 'off VMs' }] })],
    });
    expect(reasonsOf(a)).toEqual(['coverage-gap', 'declared-absent']);
    expect(a.reasons.every((r) => r.layer === 3)).toBe(true);
    expect(a.reasons[1]!.witness).toEqual([
      { kind: 'state', key: 'coverageDeclared', path: '/0/kind' },
    ]);
  });

  it('declared-absent from an EMPTY rowset inside a declared boundary (the one emptiness reader)', () => {
    const a = run({
      history: [user('q'), tool('c1', coverage([], { checked: ['switch A'] }))],
      coverageDeclared: [ledgerRow('c1')],
    });
    expect(reasonsOf(a)).toEqual(['declared-absent']);
    expect(a.reasons[0]!.witness).toEqual([
      { kind: 'history', index: 1, path: '/toolCallId', toolCallId: 'c1' },
    ]);
  });

  it('empty-undeclared: an empty rowset with no coverage row; the app’s rowsAt counts too', () => {
    expect(reasonsOf(run({ history: [user('q'), tool('c1', [])] }))).toEqual(['empty-undeclared']);
    const wrapper = { history: [user('q'), tool('c1', { volumes: [] }, 'vols')] };
    // No rowsAt: the shape is not declared, so nothing can be told — never a guess.
    expect(run(wrapper).standing).toBe('not-assessed');
    const declared = assessAnswer(
      { snapshot: { sharedState: wrapper } },
      { tools: { vols: { rowsAt: 'volumes' } } },
    );
    expect(reasonsOf(declared)).toEqual(['empty-undeclared']);
  });

  it('a JSON-text envelope the run filed no row for is data, not a declaration', () => {
    // The history bytes of a recognized absence and of an unrecognized JSON-text one are the same.
    const a = run({ history: [user('q'), tool('c1', absent({ what: 'x', checked: ['inv'] }))] });
    expect(a.reasons).toEqual([]);
    expect(a.standing).toBe('not-assessed');
  });

  it('sources-conflict only when a witness names a call of THIS turn', () => {
    const conflict = (ids: string[]) => ({
      kind: 'conflict',
      key: 'host h1 · state',
      witnesses: ids.map((toolCallId) => ({
        toolCallId,
        subject: { kind: 'host', id: 'h1' },
        predicate: 'state',
      })),
      iteration: 2,
    });
    const history = [user('earlier'), tool('old1', [1]), user('now'), tool('c1', [1])];
    const now = run({ history, findingsLedger: [conflict(['old1', 'c1'])] });
    expect(reasonsOf(now)).toEqual(['sources-conflict']);
    expect(now.reasons[0]!.witness).toEqual([
      { kind: 'state', key: 'findingsLedger', path: '/0/kind' },
    ]);
    // A conflict carried from an earlier turn, about earlier calls, is not this answer's.
    expect(run({ history, findingsLedger: [conflict(['old1', 'old2'])] }).reasons).toEqual([]);
  });

  it('value-unsupported / value-survived-revision from unsupportedValues (one row, one reason)', () => {
    const uv = { values: [{ value: 'srv-99' }], candidates: 3, revised: false, refused: false };
    const a = run({ unsupportedValues: uv });
    expect(reasonsOf(a)).toEqual(['value-unsupported']);
    expect(a.checked).toEqual([
      {
        layer: 4,
        check: 'names-and-numbers',
        ran: 1,
        of: 1,
        witness: [{ kind: 'state', key: 'unsupportedValues', path: '/candidates' }],
      },
    ]);
    expect(reasonsOf(run({ unsupportedValues: { ...uv, revised: true } }))).toEqual([
      'value-survived-revision',
    ]);
  });

  it('stopped-early, answer-check-failed, check-unreachable', () => {
    expect(reasonsOf(run({ stoppedEarly: { reason: 'cost-budget', iteration: 3 } }))).toEqual([
      'stopped-early',
    ]);
    const report = (status: string) => ({ mode: 'observe', status });
    expect(reasonsOf(run({ answerValidation: report('failed') }))).toEqual(['answer-check-failed']);
    const unreachable = run({ answerValidation: report('unverified') });
    expect(reasonsOf(unreachable)).toEqual(['check-unreachable']);
    expect(unreachable.reasons[0]!.layer).toBeUndefined(); // a reason of every layer
  });
});

describe('UNIT — this turn only', () => {
  it('reads after the last message a PERSON said; earlier turns’ results are not this answer’s', () => {
    const a = run({ history: [user('t1'), tool('c0', []), user('t2'), tool('c2', [{ id: 1 }])] });
    expect(a.standing).toBe('consistent');
    expect(a.turnFrom).toBe('person');
  });

  it('a library-written user frame never opens a turn (SECURITY: it is not a person)', () => {
    const history = [
      user('t2'),
      tool('c1', []),
      user('[schema check] your answer was not valid JSON'),
      { role: 'user', content: 'delivered by an injection', injectedBy: { id: 'note' } },
      tool('c2', [{ id: 1 }]),
    ];
    const a = run({ history });
    // c1's empty result is still this turn's: the frames after it did not start a new turn.
    expect(reasonsOf(a)).toEqual(['empty-undeclared']);
  });

  it('no person message on the record → every result is read, and the fold says so', () => {
    const a = run({ history: [tool('c1', [])] });
    expect(a.turnFrom).toBe('whole-history');
    expect(reasonsOf(a)).toEqual(['empty-undeclared']);
  });

  it('a checkpoint alone stands in for the snapshot', () => {
    const a = assessAnswer({
      checkpoint: { sharedState: { history: [user('q'), tool('c1', [])] } },
    });
    expect(reasonsOf(a)).toEqual(['empty-undeclared']);
  });

  it('a malformed stored ask is not an ask (SECURITY: read, never guessed)', () => {
    const a = assessAnswer({
      checkpoint: { sharedState: {}, pauseData: { awaitingInput: { status: 'awaiting_input' } } },
    });
    expect(a.reasons).toEqual([]);
  });
});

describe('UNIT — caller errors throw; the record is read, never refused', () => {
  it('a record that is not an object', () => {
    expect(() => assessAnswer(null as never)).toThrow(TypeError);
    expect(() => assessAnswer('run' as never)).toThrow(/the record must be an object/);
  });

  it('declarations: the rowsAt rule the account also keeps', () => {
    const rec = { snapshot: { sharedState: {} } };
    expect(() => assessAnswer(rec, { tools: { t: { rowsAt: '' } } })).toThrow(/non-empty key/);
    expect(() => assessAnswer(rec, { tools: { t: { rowsAt: 'a.b' } } })).toThrow(/top-level key/);
    expect(() => assessAnswer(rec, { tools: 'x' as never })).toThrow(/keyed by tool name/);
    // The account's whole declarations object is accepted as-is: the fold reads only `tools`.
    expect(() =>
      assessAnswer(rec, { id: 'app', skills: {}, tools: { t: { rowsAt: 'rows' } } } as never),
    ).not.toThrow();
  });

  it('an unreadable snapshot is an empty record — not assessed, never a throw', () => {
    expect(assessAnswer({ snapshot: 'garbage' }).standing).toBe('not-assessed');
    expect(assessAnswer({ snapshot: { sharedState: [] } }).standing).toBe('not-assessed');
  });

  it('the fold never reads an event: a recording’s events are ignored, however loud', () => {
    const loud = {
      snapshot: { sharedState: { history: [user('q'), tool('c1', [{ id: 1 }])] } },
      events: [
        { type: 'agentfootprint.tools.absent', payload: { toolCallId: 'c1' } },
        { type: 'agentfootprint.integrity.context_error', payload: {} },
      ],
    };
    expect(assessAnswer(loud as never).standing).toBe('consistent');
  });
});

describe('UNIT — the reason table', () => {
  it('covers the union, once each, and names the class of each', () => {
    const union: readonly AssessmentReason[] = [
      'asked',
      'declared-absent',
      'coverage-gap',
      'empty-undeclared',
      'sources-conflict',
      'value-unsupported',
      'value-survived-revision',
      'stopped-early',
      'answer-check-failed',
      'check-unreachable',
    ];
    expect([...REASONS.map((r) => r.reason)].sort()).toEqual([...union].sort());
    expect(REASONS.filter((r) => r.class === 'ask').map((r) => r.reason)).toEqual(['asked']);
    expect(Object.isFrozen(REASONS)).toBe(true);
    expect(() => reasonEntry('nope' as AssessmentReason)).toThrow(/no table entry/);
  });
});

describe('PROPERTY — the laws hold over 3,000 generated records', () => {
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const next = rng(9_27_2026);
  const chance = (p: number) => next() < p;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;

  function record(): { snapshot: { sharedState: State }; checkpoint?: unknown } {
    const history: unknown[] = [];
    const coverageDeclared: unknown[] = [];
    const calls = Math.floor(next() * 4);
    if (chance(0.3)) history.push(user('earlier'), tool('old', []));
    if (chance(0.9)) history.push(user('question'));
    for (let i = 0; i < calls; i++) {
      const id = `c${i}`;
      const kind = Math.floor(next() * 6);
      if (kind === 0) {
        history.push(tool(id, absent({ what: 'x', checked: ['c'] })));
        coverageDeclared.push(
          absenceRow(id, chance(0.5) ? { cannotCover: [{ what: 'y', why: 'z' }] } : {}),
        );
      } else if (kind === 1) {
        history.push(tool(id, coverage(pick([[], [1]]), { checked: ['c'] })));
        coverageDeclared.push(ledgerRow(id, chance(0.5) ? { notChecked: [{ what: 'n' }] } : {}));
      } else {
        history.push(tool(id, pick([[], [{ a: 1 }], { rows: [] }, 'text', 'Error: down'])));
      }
      if (chance(0.1)) history.push(user('[evidence check] values not found: x'));
    }
    const state: State = { history };
    if (coverageDeclared.length > 0) state.coverageDeclared = coverageDeclared;
    if (chance(0.15)) state.unsupportedValues = { values: [], candidates: 2, revised: chance(0.5) };
    if (chance(0.1)) state.stoppedEarly = { reason: 'max-iterations', iteration: 9 };
    if (chance(0.3)) {
      state.answerValidation = {
        mode: pick(['enforce', 'observe']),
        status: pick(['passed', 'passed', 'failed', 'unverified']),
        ...(chance(0.8) && { candidateDigest: 'd' }),
      };
    }
    if (chance(0.15)) {
      state.findingsLedger = [
        {
          kind: 'conflict',
          key: 'k',
          witnesses: [
            {
              toolCallId: pick(['c0', 'old', 'zz']),
              subject: { kind: 'h', id: '1' },
              predicate: 'p',
            },
          ],
          iteration: 1,
        },
      ];
    }
    return { snapshot: { sharedState: state } };
  }

  it('never known without support; a reason ⇔ unknown; not assessed ⇔ nothing at all', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const r = record();
      const frozen = JSON.stringify(r);
      const a = assessAnswer(r);
      expect(JSON.stringify(r)).toBe(frozen); // pure
      expect(assessAnswer(r)).toEqual(a); // deterministic
      seen.add(a.standing);
      // Never "known" from silence.
      if (a.assessment === 'known') {
        expect(a.support).toBeDefined();
        expect(a.reasons).toEqual([]);
      } else {
        expect(a.support).toBeUndefined();
      }
      expect(a.reasons.length > 0).toBe(a.assessment === 'unknown');
      const ran = a.checked.some((c) => c.ran > 0);
      if (a.assessment === 'not-applicable') expect(ran).toBe(false);
      if (a.assessment === 'unrefuted') expect(ran).toBe(true);
      // The owner's word follows the value alone.
      const word = {
        known: 'known',
        unrefuted: 'consistent',
        'not-applicable': 'not-assessed',
        unknown: a.reasons.some((x) => x.reason === 'asked') ? 'ask' : 'not-sure',
      }[a.assessment];
      expect(a.standing).toBe(word);
      for (const c of a.checked) expect(c.ran).toBeLessThanOrEqual(c.of);
    }
    // Every word but `ask` (which needs a checkpoint) was reached — the property ran on all of them.
    expect([...seen].sort()).toEqual(['consistent', 'known', 'not-assessed', 'not-sure']);
  });
});
