/**
 * `integrity/unsupported-claim/evaluate.ts` · `compareClaimValues` — the one
 * declared normalization a claim that governs delivery is compared under.
 *
 * Test types:
 *   - UNIT      — each rule of the normalization on its own;
 *   - PROPERTY  — over a value matrix: reflexive on every JSON value,
 *                 symmetric everywhere, total (never throws) on any input;
 *   - SECURITY  — a value nested past the depth bound, or a cycle, is not
 *                 compared (no stack overflow), and an unknown `Claim`
 *                 anywhere inside a value is never read as agreement.
 *
 * The answer-validation row's pair-by-pair oracle lives in
 * `test/answer-validation/agentChecks.test.ts`, written by hand.
 */
import { describe, expect, it } from 'vitest';

import {
  claimValueKey,
  compareClaimValues,
} from '../../src/integrity/unsupported-claim/evaluate.js';
import { known, unknown } from '../../src/doors/maps.js';

describe('UNIT — the declared normalization', () => {
  it('text is trimmed and case-folded, and nothing else', () => {
    expect(compareClaimValues('Settled', ' settled\t')).toBe('agrees');
    expect(compareClaimValues('in progress', 'in  progress')).toBe('contradicts');
  });

  it('a plain decimal string and a number compare by value, both ways', () => {
    expect(compareClaimValues('42.50', 42.5)).toBe('agrees');
    expect(compareClaimValues(42.5, '42.50')).toBe('agrees');
    expect(compareClaimValues('-0.0', 0)).toBe('agrees');
    expect(compareClaimValues('42.50', 42.05)).toBe('contradicts');
  });

  it('two decimal strings compare digit for digit; a double at double precision', () => {
    expect(compareClaimValues('42.50', '42.5')).toBe('agrees');
    expect(compareClaimValues('9007199254740993', '9007199254740992')).toBe('contradicts');
    expect(compareClaimValues('9007199254740993', 9007199254740992)).toBe('agrees');
    expect(compareClaimValues(1e21, '1000000000000000000000')).toBe('agrees');
  });

  it('only the plain decimal grammar is a number: an exponent, a sign, padding or separators stay text', () => {
    for (const text of ['1e3', '+5', '007', '1,000', '0x1E', '.5', '5.']) {
      expect(compareClaimValues(text, Number(text.replace(',', '')) || 5)).toBe('incomparable');
    }
  });

  it('a number with a unit compares only with the same unit', () => {
    expect(compareClaimValues('1250 ms', '1250MS')).toBe('agrees');
    expect(compareClaimValues('1250 ms', '1300 ms')).toBe('contradicts');
    expect(compareClaimValues('1250 ms', '1.25 s')).toBe('incomparable');
    expect(compareClaimValues('1250 ms', 1250)).toBe('incomparable');
  });

  it('kinds that cannot be compared safely are incomparable', () => {
    expect(compareClaimValues([1], 1)).toBe('incomparable');
    expect(compareClaimValues({ a: 1 }, 1)).toBe('incomparable');
    expect(compareClaimValues([1], { 0: 1 })).toBe('incomparable');
    expect(compareClaimValues(true, 'true')).toBe('incomparable');
    expect(compareClaimValues(1, true)).toBe('incomparable');
  });

  it('an absence against a value is a difference; two absences agree', () => {
    expect(compareClaimValues(null, 1)).toBe('contradicts');
    expect(compareClaimValues(null, [1])).toBe('contradicts');
    expect(compareClaimValues(null, null)).toBe('agrees');
    expect(compareClaimValues(known(null, 'none'), 1)).toBe('contradicts');
  });

  it('lists item by item in order, objects key by key; a definite difference wins', () => {
    expect(compareClaimValues(['A', '1'], ['a', 1])).toBe('agrees');
    expect(compareClaimValues([1, 2], [2, 1])).toBe('contradicts');
    expect(compareClaimValues([1, 'x'], [1, ['x']])).toBe('incomparable');
    expect(compareClaimValues([1, 'x'], [2, ['x']])).toBe('contradicts');
    expect(compareClaimValues({ a: 'X', b: '2' }, { b: 2, a: 'x' })).toBe('agrees');
    expect(compareClaimValues({ a: 1 }, { a: 1, b: 2 })).toBe('contradicts');
  });

  it('a known(…) wrapper is read where the contract puts one — at the top of a value only', () => {
    expect(compareClaimValues(known(1250, 'src'), '1250')).toBe('agrees');
    expect(compareClaimValues(1250, known('1250', 'answer'))).toBe('agrees');
    // Inside a value it is the value's data: an object, compared as one.
    expect(compareClaimValues([known('Settled', 'src')], ['settled'])).toBe('incomparable');
    expect(compareClaimValues([known(1, 'x')], [known(1, 'x')])).toBe('agrees');
  });
});

describe('UNIT — one exact key per value, for reading several values at once', () => {
  it('equal keys exactly when the values are the same as written', () => {
    expect(claimValueKey('42.50')).toBe(claimValueKey(42.5));
    expect(claimValueKey(' Settled')).toBe(claimValueKey('settled'));
    expect(claimValueKey(1e21)).toBe(claimValueKey('1000000000000000000000'));
    expect(claimValueKey(1.5e-7)).toBe(claimValueKey('0.00000015'));
    expect(claimValueKey(known(1250, 'src'))).toBe(claimValueKey('1250'));
    expect(claimValueKey(['A', { b: '2' }])).toBe(claimValueKey(['a', { b: 2 }]));
    // A double cannot tell these apart; their keys can.
    expect(claimValueKey('9007199254740993')).not.toBe(claimValueKey(9007199254740992));
    expect(claimValueKey('1250 ms')).not.toBe(claimValueKey(1250));
  });

  it('injective: values that do not agree never share a key, however they are spelled', () => {
    // Shapes a naive join would collide: separators and brackets inside text,
    // keys that look like two keys, a number against its text, nesting.
    const tricky: readonly unknown[] = [
      ['a,b'],
      ['a', 'b'],
      ['a', 'b,'],
      { 'a,b': 1 },
      { a: 1, b: 1 },
      { 'a":n:1e1,"b': 1 },
      'n:1e1',
      1,
      '1 ms',
      ['1 ms'],
      [['1']],
      [[1], []],
      [[1, []]],
      { a: [] },
      { a: {} },
      'null',
      null,
      'true',
      true,
      '[]',
      [],
      '{}',
      {},
    ];
    for (const a of tricky) {
      for (const b of tricky) {
        if (compareClaimValues(a, b) !== 'agrees') {
          expect(claimValueKey(a)).not.toBe(claimValueKey(b));
        }
      }
    }
  });

  it('no key for what cannot be compared', () => {
    for (const value of [
      undefined,
      Number.NaN,
      () => 1,
      new Date(0),
      unknown('absent'),
      { kind: 'known', value: 1, evidence: 'x', note: 'y' },
    ]) {
      expect(claimValueKey(value)).toBeUndefined();
    }
  });
});

describe('PROPERTY — reflexive, symmetric, total', () => {
  const values: readonly unknown[] = [
    null,
    true,
    false,
    0,
    -0,
    1,
    -1.5,
    42.5,
    1e21,
    9007199254740992,
    '',
    ' ',
    '0',
    '42.50',
    '42.5',
    '02139',
    '1,250',
    '1250 ms',
    '1.25 s',
    'Settled',
    'settled ',
    'unknown',
    [],
    [1, 'a'],
    ['A', 1],
    {},
    { a: 1 },
    { a: '1' },
    { a: [1, { b: 'X' }] },
    known(1, 'src'),
    known(null, 'src'),
  ];

  it('every JSON value agrees with itself', () => {
    for (const value of values) expect(compareClaimValues(value, value)).toBe('agrees');
  });

  it('the verdict does not depend on which side settled', () => {
    for (const a of values) {
      for (const b of values) expect(compareClaimValues(a, b)).toBe(compareClaimValues(b, a));
    }
  });

  it('never throws, whatever it is handed', () => {
    const odd: readonly unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => 1,
      Symbol('s'),
      10n,
      new Date(0),
      new Map([[1, 1]]),
      Object.create(null) as unknown,
      unknown('absent'),
    ];
    for (const a of [...odd, ...values]) {
      for (const b of [...odd, ...values]) expect(() => compareClaimValues(a, b)).not.toThrow();
    }
    // What is not a JSON value is never read as agreement.
    for (const a of odd.slice(0, 7)) expect(compareClaimValues(a, a)).toBe('incomparable');
  });
});

describe('SECURITY — depth, cycles and unknowns', () => {
  it('a value nested past the depth bound is not compared — and does not overflow the stack', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(compareClaimValues(deep, deep)).toBe('incomparable');
  });

  it('a cycle is not compared', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(compareClaimValues(loop, loop)).toBe('incomparable');
  });

  it('a wrapper nested inside the answer is its data — never unwrapped into agreement', () => {
    // The delivered JSON says `a` is an object; it is compared as one.
    const wrapped = (value: unknown) => ({ kind: 'known', value, evidence: 'the model' });
    expect(compareClaimValues({ a: 1 }, { a: wrapped(1) })).toBe('incomparable');
    expect(compareClaimValues({ s: 'pending' }, { s: wrapped('pending') })).toBe('incomparable');
    expect(compareClaimValues([2], [wrapped(2)])).toBe('incomparable');
    // …and so is any Claim-shaped object inside a value, on either side.
    expect(compareClaimValues([unknown('x')], [1])).toBe('incomparable');
  });

  it('a wrapper carrying any other key is not read, on either side', () => {
    const extra = { kind: 'known', value: 1250, evidence: 'x', note: 'y' };
    expect(compareClaimValues(1250, extra)).toBe('incomparable');
    expect(compareClaimValues(extra, 1250)).toBe('incomparable');
    expect(compareClaimValues(1250, { kind: 'known', value: 1250, evidence: 7 })).toBe(
      'incomparable',
    );
  });

  it('equal keys always compare as agreement (the key never says more than the comparison)', () => {
    const values: readonly unknown[] = [
      0,
      -0,
      '0',
      42.5,
      '42.50',
      'Settled',
      ' settled',
      '1250 ms',
      '1250MS',
      [1, '2'],
      ['1', 2],
      { a: 'X' },
      { a: 'x ' },
      known(7, 's'),
      '7',
    ];
    for (const a of values) {
      for (const b of values) {
        if (claimValueKey(a) === claimValueKey(b)) expect(compareClaimValues(a, b)).toBe('agrees');
      }
    }
  });
});
