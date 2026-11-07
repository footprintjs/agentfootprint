import { expect, it } from 'vitest';
import { isCorrectedMeaning } from './meaning.js';

const range = { from: '2026-11-06T16:01:00Z', to: '2026-11-06T18:01:00.001Z' };
it('admits only an absolute correction or the exact canonical elapsed duration', () => {
  expect(isCorrectedMeaning({}, range)).toBe(true);
  expect(isCorrectedMeaning({ lookback: '2h' }, range)).toBe(true);
  for (const value of [
    null,
    [],
    new Date(),
    Object.create({ quote: 'raw' }),
    { quote: 'raw' },
    { lookback: '1h' },
    { lookback: '2h', raw: 'words' },
    { lookback: '2 hours' },
    { lookback: undefined },
  ])
    expect(isCorrectedMeaning(value, range)).toBe(false);
});
it('rejects a sub-millisecond or changed endpoint rather than approximating a duration', () => {
  expect(isCorrectedMeaning({ lookback: '2h' }, { ...range, to: '2026-11-06T18:01:00Z' })).toBe(
    false,
  );
  expect(
    isCorrectedMeaning({ lookback: '2h' }, { ...range, to: '2026-11-06T18:01:00.001001Z' }),
  ).toBe(false);
});
it('never invokes a getter while validating the correction projection', () => {
  let reads = 0;
  const value = Object.defineProperty({}, 'lookback', {
    enumerable: true,
    get() {
      reads++;
      return '2h';
    },
  });
  expect(isCorrectedMeaning(value, range)).toBe(false);
  expect(reads).toBe(0);
});

it('keeps equal nanosecond remainders without rounding either endpoint', () => {
  expect(
    isCorrectedMeaning(
      { lookback: '2h' },
      {
        from: '2026-11-06T16:01:00.123456789Z',
        to: '2026-11-06T18:01:00.124456789Z',
      },
    ),
  ).toBe(true);
});
