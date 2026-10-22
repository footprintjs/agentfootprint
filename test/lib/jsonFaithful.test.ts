/**
 * isJsonFaithful — true exactly when JSON writes a value down so that reading
 * it back gives the same value (JSON's two equivalences aside: an
 * `undefined`-valued property reads back absent, `-0` reads back `0`).
 */

import { describe, expect, it } from 'vitest';
import { isJsonFaithful, MAX_JSON_DEPTH } from '../../src/lib/jsonFaithful.js';

class Point {
  constructor(readonly x: number) {}
}

describe('isJsonFaithful — what JSON writes down faithfully', () => {
  it.each([
    ['null', null],
    ['true', true],
    ['a string', 'refund'],
    ['an empty string', ''],
    ['an integer', 42],
    ['a fraction', 0.1],
    ['-0 (JSON reads it back as 0)', -0],
    ['an empty array', []],
    ['an empty object', {}],
    ['nested values', { a: [1, { b: 'x', c: [null, true] }], d: { e: { f: 2 } } }],
    ['an object without a prototype', Object.assign(Object.create(null) as object, { a: 1 })],
    ['an undefined-valued property (JSON reads it back absent)', { a: 1, b: undefined }],
  ])('accepts %s', (_label, value) => {
    expect(isJsonFaithful(value)).toBe(true);
  });

  it('accepts a value shared by two siblings — a shared reference is not a cycle', () => {
    const shared = { n: 1 };
    expect(isJsonFaithful({ a: shared, b: shared, c: [shared, shared] })).toBe(true);
  });

  it('accepts nesting up to the depth limit', () => {
    let deep: unknown = 1;
    for (let i = 0; i < MAX_JSON_DEPTH; i++) deep = [deep];
    expect(isJsonFaithful(deep)).toBe(true);
  });
});

describe('isJsonFaithful — what JSON would change, refused', () => {
  const holey = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const named = Object.assign([1, 2], { note: 'kept by an array, dropped by JSON' });
  const withSymbol = { a: 1, [Symbol('s')]: 2 };
  const withGetter = Object.defineProperty({}, 'a', { get: () => 1, enumerable: true });
  const hidden = Object.defineProperty({ a: 1 }, 'b', { value: 2, enumerable: false });

  it.each([
    ['undefined at the top', undefined],
    ['undefined in an array (JSON writes null)', [1, undefined]],
    ['an array with a hole', holey],
    ['an array with a named property', named],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity in an object', { n: -Infinity }],
    ['a bigint', 10n],
    ['a symbol', Symbol('s')],
    ['a function', () => 1],
    ['a Date', new Date(0)],
    ['a Map', new Map([['a', 1]])],
    ['a Set', new Set([1])],
    ['a RegExp', /x/],
    ['an Error', new Error('x')],
    ['a typed array', new Uint8Array([1])],
    ['a class instance', new Point(1)],
    ['a boxed string', new String('x')], // eslint-disable-line no-new-wrappers
    ['an object with a symbol key', withSymbol],
    ['an object with a getter', withGetter],
    ['an object with a non-enumerable property', hidden],
    ['a Date nested deep', { a: [{ b: { when: new Date(0) } }] }],
  ])('refuses %s', (_label, value) => {
    expect(isJsonFaithful(value)).toBe(false);
  });

  it('refuses a cycle through an object and through an array', () => {
    const object: Record<string, unknown> = { a: 1 };
    object.self = object;
    const array: unknown[] = [1];
    array.push(array);
    expect(isJsonFaithful(object)).toBe(false);
    expect(isJsonFaithful(array)).toBe(false);
  });

  it('refuses nesting past the depth limit', () => {
    let deep: unknown = 1;
    for (let i = 0; i <= MAX_JSON_DEPTH; i++) deep = [deep];
    expect(isJsonFaithful(deep)).toBe(false);
  });

  it('never throws — a value it cannot read is not faithful', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('no');
        },
      },
    );
    expect(isJsonFaithful(hostile)).toBe(false);
    expect(isJsonFaithful({ nested: hostile })).toBe(false);
  });

  it('agrees with a JSON round trip on every value it accepts', () => {
    const accepted = [
      { a: 1, b: 'two', c: [true, null, { d: 0.5 }] },
      { z: 1, a: 2 },
      [[], {}, ''],
    ];
    for (const value of accepted) {
      expect(isJsonFaithful(value)).toBe(true);
      expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
    }
  });
});
