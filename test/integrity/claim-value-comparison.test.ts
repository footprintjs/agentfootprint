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
  claimShapeOf,
  claimValueKey,
  compareClaimValues,
} from '../../src/integrity/unsupported-claim/evaluate.js';
import { known, unknown } from '../../src/doors/maps.js';

describe('UNIT — the declared normalization', () => {
  it('text: Unicode NFC, trimmed, inner spaces collapsed, a word case-folded — and nothing else', () => {
    expect(compareClaimValues('Settled', ' settled\t')).toBe('agrees');
    expect(compareClaimValues('in progress', 'in  progress')).toBe('agrees');
    expect(compareClaimValues('in progress', 'in_progress')).toBe('contradicts');
    expect(compareClaimValues('caf\u00e9', 'cafe\u0301')).toBe('agrees'); // NFC and NFD
    expect(compareClaimValues('Straße', 'STRASSE')).toBe('agrees'); // a real case fold
    expect(compareClaimValues('settled', 'pending')).toBe('contradicts');
  });

  it('case agrees only where it cannot carry meaning — both directions', () => {
    // Agrees: a plain word of more than three letters, first letter or whole word.
    for (const [a, b] of [
      ['settled', 'Settled'],
      ['settled', 'SETTLED'],
      ['Settled', 'SETTLED'],
      ['true', 'TRUE'],
      ['Settled Today', 'settled today'],
      ['Straße', 'STRASSE'],
      ['STRAẞE', 'Straße'],
    ]) {
      expect(compareClaimValues(a, b)).toBe('agrees');
      expect(compareClaimValues(b, a)).toBe('agrees');
    }
    // Not compared: short words, mixed case, units, letters with other marks, ß/ss in one case.
    for (const [a, b] of [
      ['MW', 'mW'],
      ['Mb', 'MB'],
      ['mS', 'ms'],
      ['Co', 'CO'],
      ['Yes', 'yes'],
      ['dQwXyZaBcDe', 'DqWxYzAbCdE'],
      ['iPhone', 'IPHONE'],
      ['sETTLED', 'settled'],
      ['N/A', 'n/a'],
      ['New York', 'new york'],
      ['Masse', 'Maße'],
      ['STRAẞE', 'STRASSE'],
      ['ılık', 'ilik'],
      ['ISPARTA', 'ısparta'],
      ['İstanbul', 'istanbul'],
    ]) {
      expect(compareClaimValues(a, b)).toBe('incomparable');
      expect(compareClaimValues(b, a)).toBe('incomparable');
    }
    // A real difference still contradicts.
    expect(compareClaimValues('settled', 'pending')).toBe('contradicts');
    expect(compareClaimValues('MW', 'kW')).toBe('contradicts');
  });

  it('a dot-grouped or comma decimal is a format: agrees only as written', () => {
    expect(compareClaimValues('1.250', 1.25)).toBe('incomparable');
    expect(compareClaimValues('1.250', '1.25')).toBe('incomparable');
    expect(compareClaimValues('12.345.678', 12345678)).toBe('incomparable');
    expect(compareClaimValues('1,5', '1,50')).toBe('incomparable');
    expect(compareClaimValues('1.250', '1.250')).toBe('agrees');
    // Not dot-grouped: a leading zero, or four digits before the point.
    expect(compareClaimValues('0.125', 0.125)).toBe('agrees');
    expect(compareClaimValues('1250.000', 1250)).toBe('agrees');
  });

  it("an identifier's case may matter: text with a digit that differs only in case is not compared", () => {
    expect(compareClaimValues('aB3xZ9', 'Ab3Xz9')).toBe('incomparable');
    expect(compareClaimValues('ORD-44710', 'ord-44710')).toBe('incomparable');
    expect(compareClaimValues('ORD-44710', 'ORD-44711')).toBe('contradicts');
    expect(compareClaimValues('ORD-44710', ' ORD-44710 ')).toBe('agrees');
  });

  it('formatted values — a currency symbol, thousands separators, a date or a time — agree only as written', () => {
    for (const [a, b] of [
      ['$1,250.00', '$1,250'],
      ['1,250', '1,250.0'],
      ['€42.50', '€42.5'],
      ['2026-01-01', '2026-01-01T00:00:00Z'],
      ['2026-01-01', '2026-01-02'],
      ['09:14', '9:14'],
      ['01/02/2026', '1/2/2026'],
      ['Jan 5, 2026', 'January 5, 2026'],
      ['1 250 000', '1250000'],
    ]) {
      expect(compareClaimValues(a, b)).toBe('incomparable');
    }
    expect(compareClaimValues('$1,250', '$1,250')).toBe('agrees');
    expect(compareClaimValues('2026-01-01', ' 2026-01-01')).toBe('agrees');
  });

  it('a difference only in how a number inside text is spelled is not compared', () => {
    expect(compareClaimValues('USD 42.50', 'USD 42.5')).toBe('incomparable');
    expect(compareClaimValues('v1.20', 'v1.2')).toBe('incomparable');
    expect(compareClaimValues('ORD-044710', 'ORD-44710')).toBe('incomparable');
    expect(compareClaimValues('USD 42.50', 'USD 43.50')).toBe('contradicts');
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

  it('a number with a unit compares only with the same unit, written exactly — case included', () => {
    expect(compareClaimValues('1250 ms', '1250ms')).toBe('agrees');
    expect(compareClaimValues('42.50 USD', '42.5 USD')).toBe('agrees');
    expect(compareClaimValues('1250 ms', '1300 ms')).toBe('contradicts');
    expect(compareClaimValues('1250 ms', '1.25 s')).toBe('incomparable');
    expect(compareClaimValues('1250 ms', 1250)).toBe('incomparable');
    // A unit's case is part of the unit: megawatts are not milliwatts.
    expect(compareClaimValues('5 MW', '5 mW')).toBe('incomparable');
    expect(compareClaimValues('100 Mb', '100 MB')).toBe('incomparable');
    expect(compareClaimValues('1250 ms', '1250MS')).toBe('incomparable');
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
    expect(compareClaimValues(['Settled', '1'], ['settled', 1])).toBe('agrees');
    // …a one-letter word keeps its case (short words can carry meaning).
    expect(compareClaimValues(['A', '1'], ['a', 1])).toBe('incomparable');
    expect(compareClaimValues([1, 2], [2, 1])).toBe('contradicts');
    expect(compareClaimValues([1, 'x'], [1, ['x']])).toBe('incomparable');
    expect(compareClaimValues([1, 'x'], [2, ['x']])).toBe('contradicts');
    expect(compareClaimValues({ a: 'Paid', b: '2' }, { b: 2, a: 'paid' })).toBe('agrees');
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
    expect(claimValueKey(['Settled', { b: '2' }])).toBe(claimValueKey(['settled', { b: 2 }]));
    // A double cannot tell these apart; their keys can.
    expect(claimValueKey('9007199254740993')).not.toBe(claimValueKey(9007199254740992));
    expect(claimValueKey('1250 ms')).not.toBe(claimValueKey(1250));
    // The text rules, exactly: a word folds, a unit and an identifier keep their case.
    expect(claimValueKey('Settled')).toBe(claimValueKey('settled'));
    expect(claimValueKey('Masse')).not.toBe(claimValueKey('Maße'));
    expect(claimValueKey('MW')).not.toBe(claimValueKey('mW'));
    expect(claimValueKey('ılık')).not.toBe(claimValueKey('ilik'));
    expect(claimValueKey('caf\u00e9')).toBe(claimValueKey('cafe\u0301'));
    expect(claimValueKey('5 MW')).not.toBe(claimValueKey('5 mW'));
    expect(claimValueKey('aB3xZ9')).not.toBe(claimValueKey('Ab3Xz9'));
    expect(claimValueKey('$1,250.00')).not.toBe(claimValueKey('$1,250'));
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

  it('a wrapper of either kind is read only when well formed', () => {
    // `known` needs its `evidence`, `unknown` its `reason`; neither carries more.
    expect(compareClaimValues(5, { kind: 'known', value: 5 })).toBe('incomparable');
    expect(compareClaimValues({ kind: 'known', value: 5 }, 5)).toBe('incomparable');
    expect(compareClaimValues({ kind: 'unknown', reason: 'r', value: 5 }, 5)).toBe('incomparable');
    expect(claimValueKey({ kind: 'known', value: 5 })).toBeUndefined();
    expect(claimValueKey({ kind: 'unknown', reason: 'r', value: 5 })).toBeUndefined();
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
      '1250ms',
      '5 MW',
      '5 mW',
      'Straße',
      'STRASSE',
      'STRAẞE',
      'MASSE',
      'Masse',
      'Maße',
      'ılık',
      'ilik',
      'ILIK',
      'İlik',
      'MW',
      'mW',
      'true',
      'TRUE',
      'True',
      '1.250',
      1.25,
      'caf\u00e9',
      'cafe\u0301',
      'aB3xZ9',
      'Ab3Xz9',
      '$1,250',
      '$1,250.00',
      'USD 42.50',
      'USD 42.5',
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

describe('UNIT — what a value at the top of a claim is, by its shape', () => {
  it("doubt words are read after the comparison's own normalization", () => {
    for (const word of ['unknown', 'Unknown', ' UNKNOWN ', 'unk\u006eown']) {
      expect(claimShapeOf(word)).toEqual({ kind: 'doubt', declared: false });
    }
    expect(claimShapeOf(null)).toEqual({ kind: 'doubt', declared: false });
    expect(claimShapeOf('unknowns')).toEqual({ kind: 'value', face: 'unknowns', declared: false });
  });

  it('well-formed Claims are declared; anything Claim-shaped and not well formed is malformed', () => {
    expect(claimShapeOf(unknown('no clock'))).toEqual({ kind: 'doubt', declared: true });
    expect(claimShapeOf(known(5, 'src'))).toEqual({ kind: 'value', face: 5, declared: true });
    expect(claimShapeOf(known(null, 'src'))).toEqual({ kind: 'value', face: null, declared: true });
    for (const bad of [
      { kind: 'known', value: 5 },
      { kind: 'known', value: 5, evidence: 7 },
      { kind: 'known', value: 5, evidence: 'x', note: 1 },
      { kind: 'known', value: 5, evidence: undefined },
      { kind: 'unknown', reason: 'r', evidence: undefined },
      { kind: 'known', evidence: 'x' },
      { kind: 'unknown', reason: 'r', value: 5 },
      { kind: 'unknown' },
      { kind: 'not-applicable', evidence: 'x', value: 5 },
      { kind: 'not-applicable' },
    ]) {
      expect(claimShapeOf(bad)).toEqual({ kind: 'malformed' });
    }
    // An object with some other `kind` is plain data.
    expect(claimShapeOf({ kind: 'refund', amount: 5 })).toEqual({
      kind: 'value',
      face: { kind: 'refund', amount: 5 },
      declared: false,
    });
  });
});
