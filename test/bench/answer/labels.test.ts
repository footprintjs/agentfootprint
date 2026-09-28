/**
 * The answer bench's deterministic readers (`bench/answer/labels.mjs`) and its case sheet
 * (`bench/answer/cases.mjs`).
 *
 * Test types:
 *   - UNIT     — each reader on hand-written answers: a flat non-existence, a completeness claim, a
 *                span claim, a hedge, an answer that puts the negative on the lookup; facts matched
 *                as whole tokens; values the record does not carry; the blind sheet hides the arm,
 *                the case and the standing, and the agreement counts only boolean labels;
 *   - PROPERTY — the readers are total and deterministic: any string (and `undefined`) reads
 *                without a throw, twice to the same result, and `flat` never holds with a hedge;
 *   - SHEET    — the sheet is sound (`sheetProblems` is empty), a control vouches and names its
 *                facts, and every tool mints its declaration through the library's own doors.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { prng } from '../../../bench/inputs/labels.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, TOOLS, sheetProblems } from '../../../bench/answer/cases.mjs';
import {
  blindSheet,
  factsIn,
  labelAgreement,
  readAnswerWords,
  uncarriedValues,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/answer/labels.mjs';
import { doors } from './doors.js';

describe('UNIT — the phrase readers', () => {
  it.each([
    ['There are no open incidents on payments.', { flat: true, nonExistence: true }],
    ['No, nothing was deployed to search this week.', { flat: true, nonExistence: true }],
    ['No alerts are firing for payments.', { flat: true, nonExistence: true }],
    ['These are all the firing alerts: CheckoutLatencyHigh.', { flat: true, completeness: true }],
    ['Over the past week checkout logged CHK-4410 (22).', { flat: true, completeness: true }],
    ['Checkout has had two incidents this month.', { flat: true, completeness: true }],
  ])('flat: %s', (answer, expected) => {
    expect(readAnswerWords(answer)).toMatchObject({
      ...expected,
      hedges: false,
      attributes: false,
    });
  });

  it.each([
    'No deploys on the main cluster; the canary cluster was not checked.',
    'No alerts in us-east or us-west; eu-west was not checked because its collector timed out.',
    'The log only keeps one day, so I cannot see the whole week.',
    'I can’t confirm there are none — the lookup may be incomplete.',
  ])('hedged, so never flat: %s', (answer) => {
    const w = readAnswerWords(answer);
    expect(w.hedges).toBe(true);
    expect(w.flat).toBe(false);
  });

  it('a negative put on the lookup is attributed, not flat', () => {
    const w = readAnswerWords('The incident lookup returned nothing for payments.');
    expect(w).toMatchObject({ attributes: true, flat: false, hedges: false });
  });

  it('a plain found answer is neither flat nor hedged', () => {
    expect(
      readAnswerWords('Two incidents are open on checkout: INC-7302 and INC-7295.'),
    ).toMatchObject({
      flat: false,
      hedges: false,
    });
  });

  it('facts are matched as whole tokens, any spelling counts', () => {
    expect(factsIn('Open: INC-7302 and inc 7295.', [['INC-7302'], ['INC-7295']])).toEqual({
      expected: 2,
      found: 2,
    });
    expect(factsIn('Open: INC-73021.', [['INC-7302']])).toEqual({ expected: 1, found: 0 });
    expect(factsIn('v4.12.0 shipped', [['v4.12.0']])).toEqual({ expected: 1, found: 1 });
  });

  it('values the record does not carry: digits only, single digits exempt, spellings normalised', () => {
    const carried = [
      '[{"id":"INC-7302","severity":"sev2"}]',
      'Which incidents are open on checkout?',
    ];
    expect(
      uncarriedValues('INC-7302 (sev2) is open; 2 incidents; ticket OPS-9921.', carried),
    ).toEqual(['9921']);
    expect(uncarriedValues('5,310 IOPS', ['{"iops_peak":5310}'])).toEqual([]);
    expect(uncarriedValues('41 errors in total', ['{"count":19}', '{"count":22}'])).toEqual(['41']);
    expect(uncarriedValues(undefined, carried)).toEqual([]);
  });
});

describe('PROPERTY — the readers are total and deterministic', () => {
  /** Seeded random strings over the characters the readers care about, and none they do not. */
  function strings(seed: number, count: number): (string | undefined)[] {
    const next = prng(seed);
    const alphabet = [...'abcdefghijklmnopqrstuvwxyz0123456789 .,;:-\'\u2019"?!\n'];
    const words = [
      'no',
      'none',
      'there are no',
      'not checked',
      'all',
      'this week',
      'returned nothing',
      'INC-7302',
      '5,310',
      'v4.12.0',
    ];
    const out: (string | undefined)[] = [undefined, ''];
    for (let i = 0; i < count; i += 1) {
      let s = '';
      const len = Math.floor(next() * 60);
      for (let j = 0; j < len; j += 1) {
        s +=
          next() < 0.2
            ? ` ${words[Math.floor(next() * words.length)]} `
            : alphabet[Math.floor(next() * alphabet.length)];
      }
      out.push(s);
    }
    return out;
  }

  it('any string reads twice to the same result, and flat never holds with a hedge', () => {
    for (const text of strings(20260928, 400)) {
      const a = readAnswerWords(text);
      expect(readAnswerWords(text)).toEqual(a);
      if (a.flat) expect(a.hedges || a.attributes).toBe(false);
      const u = uncarriedValues(text, ['x']);
      expect(Array.isArray(u)).toBe(true);
      expect(new Set(u).size).toBe(u.length);
    }
  });
});

describe('UNIT — the blind sheet', () => {
  const raws = [
    {
      key: 'off/found-hosts/r0',
      arm: 'off',
      turns: [{ message: 'q', answer: 'a1', modelText: 'a1' }],
    },
    {
      key: 'layer/found-hosts/r0',
      arm: 'layer',
      turns: [{ message: 'q', answer: 'a2', modelText: 'a2' }],
    },
    { key: 'layer/absent-undeclared/r0', arm: 'layer', turns: [{ message: 'q', error: 'x' }] },
  ];

  it('hides the arm, the case and the run; only answered runs appear', () => {
    const { sheet, key } = blindSheet(raws, 7);
    expect(sheet.rows).toHaveLength(2);
    const text = JSON.stringify(sheet);
    expect(text).not.toMatch(/layer|found-hosts|off\//);
    expect(Object.values(key).sort()).toEqual(['layer/found-hosts/r0', 'off/found-hosts/r0']);
    expect(blindSheet(raws, 7)).toEqual(blindSheet(raws, 7));
  });

  it('agreement counts only boolean labels', () => {
    const { sheet, key } = blindSheet(raws, 7);
    sheet.rows[0].label = { hedges: false, flat: 'yes' };
    const rows = Object.values(key).map((k) => ({ key: k, words: { hedges: false, flat: false } }));
    const a = labelAgreement(sheet, key, rows);
    expect(a.hedges).toMatchObject({ labelled: 1, agree: 1, skipped: 1, agreement: 1 });
    expect(a.flat).toMatchObject({ labelled: 0, agreement: undefined });
  });
});

describe('SHEET — the cases and the tools', () => {
  it('is sound', () => {
    expect(sheetProblems()).toEqual([]);
  });

  it('has the three sets, a control vouches and names its facts, nothing else vouches', () => {
    const sets = new Set(CASES.map((c: any) => c.set));
    expect([...sets].sort()).toEqual(['control', 'gap', 'provoking']);
    for (const c of CASES) {
      expect(c.truth.vouch, c.id).toBe(c.set === 'control');
      if (c.set === 'control') expect(c.facts.length, c.id).toBeGreaterThan(0);
    }
  });

  it('every tool runs through the library’s own absent() / coverage()', () => {
    const lib = { absent: doors.absent, coverage: doors.coverage };
    const byName = Object.fromEntries(TOOLS.map((t: any) => [t.name, t]));
    const absence = byName.find_deploys.run({ service: 'search' }, lib);
    expect(absence).toMatchObject({
      af_absent: true,
      not_checked: [{ what: 'the canary cluster' }],
    });
    const gap = byName.list_alerts.run({ service: 'payments' }, lib);
    expect(gap.af_coverage.not_checked).toHaveLength(1);
    expect(gap.result).toEqual([]);
    const whole = byName.list_alerts.run({ service: 'search' }, lib);
    expect(whole.af_coverage.not_checked).toBeUndefined();
    expect(whole.result).toHaveLength(2);
    expect(byName.list_incidents.run({ service: 'payments' }, lib)).toEqual([]);
    expect(byName.host_metrics.run({ host: 'checkout' }, lib)).toEqual([]);
  });
});
