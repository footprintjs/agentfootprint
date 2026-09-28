/**
 * The standing fold over the declared-sources rows (honesty layer 2, step 5) —
 * pure, over hand-built committed records.
 *
 * Test types (Convention 3):
 *   - UNIT      — each current row's reason: a traced source fires nothing and
 *                 supports nothing (`consistent`, never `known`); a reading
 *                 fires `argument-read`; a result the model set aside fires
 *                 `value-contingent`, and so does a `ContingentRow` of this
 *                 turn (stamped, or unstamped on a call of this turn) —
 *                 never one of an earlier turn; an unstamped row declared on
 *                 the ANSWER counts on a first turn, and on a later one only
 *                 where the ledger shows it is this turn's; a failed claim fires
 *                 `argument-unverified` on ANY argument; a free argument the
 *                 model assumed fires nothing; the `argument-sources` check
 *                 counts the rows the check judged and the ones it reached a
 *                 verdict on; an `answered` row supersedes the `asked` one;
 *   - PROPERTY  — over generated argument rows: a verdict row never makes the
 *                 answer `known`, and every row with `claimed` is counted by
 *                 `argument-sources`.
 */

import { describe, expect, it } from 'vitest';

import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';

type State = Record<string, unknown>;

const run = (state: State) => assessAnswer({ snapshot: { sharedState: state } });
const reasons = (state: State) => run(state).reasons.map((r) => r.reason);

const row = (over: Record<string, unknown>) => ({
  kind: 'argument',
  turn: 1,
  toolCallId: 'c1',
  toolName: 'search_logs',
  iteration: 1,
  argument: 'window',
  rule: 'ask',
  ...over,
});

const state = (...rows: object[]): State => ({
  turnNumber: 1,
  history: [{ role: 'user', content: 'errors?' }],
  findingsLedger: rows,
});

describe('UNIT — the declared-sources rows, reason by reason', () => {
  it('a traced source fires nothing and supports nothing: consistent, never known', () => {
    for (const source of [
      { source: 'said', matched: 'quote', claimed: 'user' },
      { source: 'said', matched: 'phrase', claimed: 'user' },
      { source: 'answered', claimed: 'turn', earlier: true },
      { source: 'result', result: 't1', claimed: 'result' },
      { source: 'app', claimed: 'app' },
    ]) {
      const a = run(state(row({ value: '7d', ...source })));
      expect(a.reasons).toEqual([]);
      expect(a.assessment).toBe('unrefuted');
      expect(a.standing).toBe('consistent');
      expect(a.support).toBeUndefined();
    }
  });

  it('a reading fires argument-read', () => {
    expect(
      reasons(state(row({ source: 'said', reading: true, claimed: 'user', value: '7d' }))),
    ).toEqual(['argument-read']);
  });

  it('a result the model had set aside fires value-contingent', () => {
    expect(
      reasons(state(row({ source: 'result', result: 't1', setAside: 'noise', claimed: 'result' }))),
    ).toEqual(['value-contingent']);
  });

  it('a failed claim fires argument-unverified on ANY argument — a free one included', () => {
    expect(
      reasons(
        state(
          row({
            argument: 'service',
            rule: undefined,
            source: 'model',
            claimed: 'user',
            failed: 'quote-not-found',
          }),
        ),
      ),
    ).toEqual(['argument-unverified']);
    // …while a free argument the model simply assumed fires nothing (no rule, no claim broken).
    expect(
      reasons(
        state(row({ argument: 'service', rule: undefined, source: 'model', claimed: 'assumed' })),
      ),
    ).toEqual([]);
  });

  it('the answered row supersedes the asked one: the ask settled, nothing fires', () => {
    expect(
      reasons(
        state(
          row({ asked: 'unverified', proposed: '24h', claimed: 'user', reading: true }),
          row({ source: 'answered', value: '1h', proposed: '24h' }),
        ),
      ),
    ).toEqual([]);
  });

  it('a ContingentRow of this turn fires value-contingent — an earlier turn’s does not', () => {
    const contingent = (over: Record<string, unknown>) => ({
      kind: 'contingent',
      value: 'fc1/7',
      carriers: [{ toolCallId: 't0', standing: 'ruled-out' }],
      iteration: 1,
      ...over,
    });
    const withResult = (...rows: object[]): State => ({
      turnNumber: 2,
      history: [
        { role: 'user', content: 'q' },
        { role: 'tool', toolCallId: 'c7', content: '[{"id":1}]' },
      ],
      findingsLedger: rows,
    });
    expect(reasons(withResult(contingent({ declaredOn: 'answer', turn: 2 })))).toEqual([
      'value-contingent',
    ]);
    expect(reasons(withResult(contingent({ declaredOn: 'answer', turn: 1 })))).toEqual([]);
    // Unstamped (no layer armed): a call of this turn counts; a call of another does not.
    expect(reasons(withResult(contingent({ declaredOn: { toolCallId: 'c7' } })))).toEqual([
      'value-contingent',
    ]);
    expect(reasons(withResult(contingent({ declaredOn: { toolCallId: 'zz' } })))).toEqual([]);
  });

  it('an UNSTAMPED row declared on the answer is this turn’s only where the ledger shows it', () => {
    const onAnswer = (over: Record<string, unknown> = {}) => ({
      kind: 'contingent',
      declaredOn: 'answer',
      value: 'srv-1',
      carriers: [{ toolCallId: 't0', standing: 'noise' }],
      iteration: 1,
      ...over,
    });
    // The reviewer's record: turn 2, a turn-1 answer's row, nothing of turn 2 on the
    // ledger — an earlier turn's answer must not make this one "not sure".
    const turnTwo = (...rows: object[]): State => ({
      turnNumber: 2,
      history: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'tool', toolCallId: 'c7', content: '[{"id":1}]' },
        { role: 'assistant', content: 'a2' },
      ],
      findingsLedger: rows,
    });
    expect(run(turnTwo(onAnswer())).standing).toBe('consistent');
    expect(reasons(turnTwo(onAnswer()))).toEqual([]);
    // …it IS this turn's when it names a result of this turn itself,
    expect(
      reasons(turnTwo(onAnswer({ carriers: [{ toolCallId: 'c7', standing: 'noise' }] }))),
    ).toEqual(['value-contingent']);
    // …or follows a row that names a call of this turn (a row cannot name a call
    // before the call exists),
    const standingOnC7 = {
      kind: 'standing',
      toolCallId: 'c7',
      standing: 'noise',
      assertions: [],
      declaredOn: 'answer',
      iteration: 2,
    };
    expect(reasons(turnTwo(standingOnC7, onAnswer()))).toEqual(['value-contingent']);
    // …never when it comes BEFORE that row (it was filed in an earlier turn),
    expect(reasons(turnTwo(onAnswer(), standingOnC7))).toEqual([]);
    // …and a row stamped with THIS turn shows where the turn began too.
    expect(reasons(turnTwo({ ...standingOnC7, toolCallId: 'zz', turn: 2 }, onAnswer()))).toEqual([
      'value-contingent',
    ]);
    // A first turn has no earlier one: its unstamped answer row is its own.
    expect(reasons({ ...turnTwo(onAnswer()), turnNumber: 1 })).toEqual(['value-contingent']);
  });

  it('`argument-sources` counts the judged rows, and the ones that reached a verdict', () => {
    const a = run(
      state(
        row({ toolCallId: 'c1', source: 'said', matched: 'quote', claimed: 'user' }),
        row({ toolCallId: 'c2', source: 'model', claimed: 'result', failed: 'uncheckable' }),
        row({ toolCallId: 'c3', source: 'default', value: '2h' }), // unarmed: no claim
      ),
    );
    expect(a.checked.find((c) => c.check === 'argument-sources')).toEqual({
      layer: 2,
      check: 'argument-sources',
      ran: 1,
      of: 2,
      witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/claimed' }],
    });
    // No row judged → no check printed (an unarmed check is not a reason, and not listed).
    expect(
      run(state(row({ source: 'default', value: '2h' }))).checked.some(
        (c) => c.check === 'argument-sources',
      ),
    ).toBe(false);
  });
});

describe('PROPERTY — a verdict row never makes the answer "known" (2,000 generated rows)', () => {
  it('whatever the source, claim or flags', () => {
    let seed = 1234567;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    for (let i = 0; i < 2000; i += 1) {
      const over: Record<string, unknown> = {
        source: pick(['said', 'answered', 'result', 'app', 'default', 'model']),
        claimed: pick(['user', 'result', 'turn', 'app', 'assumed', 'none', undefined]),
        rule: pick(['ask', 'assume', undefined]),
      };
      if (next() < 0.2) over.reading = true;
      if (next() < 0.2) over.setAside = pick(['open', 'noise', 'ruled-out']);
      if (next() < 0.2) over.failed = pick(['quote-not-found', 'not-in-result', 'uncheckable']);
      const a = run(state(row(over)));
      expect(a.assessment).not.toBe('known');
      if (over.claimed !== undefined) {
        expect(a.checked.find((c) => c.check === 'argument-sources')?.of).toBe(1);
      }
    }
  });
});
