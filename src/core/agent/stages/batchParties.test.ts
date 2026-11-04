import { expect, it } from 'vitest';
import { hasUnbindableCallId } from './batchParties.js';

it.each([
  ['object', {}],
  ['array', []],
  [
    'callable',
    () => {
      throw new Error('An ID must never be invoked');
    },
  ],
  ['symbol', Symbol('unsupported ID')],
  ['bigint', 7n],
])('refuses an unsupported %s ID without converting it', (_name, id) => {
  expect(hasUnbindableCallId([{ id, name: 'target' }])).toBe(true);
});

it('refuses an object ID without reading conversion hooks or getters', () => {
  let reads = 0;
  const id = Object.defineProperties(
    {},
    Object.fromEntries(
      ['toJSON', 'toString', 'valueOf'].map((key) => [
        key,
        {
          get: () => {
            reads++;
            throw new Error('An ID must never be coerced');
          },
        },
      ]),
    ),
  );
  Object.defineProperty(id, Symbol.toPrimitive, {
    get: () => {
      reads++;
      throw new Error('An ID must never be coerced');
    },
  });
  expect(hasUnbindableCallId([{ id, name: 'target' }])).toBe(true);
  expect(reads).toBe(0);
});

it('refuses an accessor ID without invoking its getter', () => {
  let reads = 0;
  const call = {
    name: 'target',
    get id() {
      reads++;
      throw new Error('The ID getter must not run');
    },
  };
  expect(hasUnbindableCallId([call])).toBe(true);
  expect(reads).toBe(0);
});

it('retains the existing primitive and wide non-asking ID domain', () => {
  const ids = ['', undefined, null, false, true, 0, -0, 7, NaN, Infinity, 'x'.repeat(2000)];
  const calls = [
    ...ids.map((id) => ({ id, name: 'target' })),
    ...Array.from({ length: 1030 }, () => ({ id: 'duplicate', name: 'target' })),
    { name: 'target' },
  ];
  expect(hasUnbindableCallId(calls)).toBe(false);
});
