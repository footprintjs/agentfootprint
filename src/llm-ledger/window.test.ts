/**
 * window — the ledger's instant validator and the window on it (case table 5.4).
 *
 * Unit: each grammar rule accepts and refuses by name. The differential against
 * `time/instant.ts` · `instantOf` lives in `test/llm-ledger/window-differential.test.ts`
 * (it needs a repository helper and a file outside this folder).
 */
import { describe, expect, it } from 'vitest';

import { instantMs, isUtcInstant, readWindow } from './window.js';

describe('instantMs — the grammar', () => {
  it.each([
    ['2026-11-25T10:00:00Z', Date.UTC(2026, 10, 25, 10, 0, 0)],
    ['2026-11-25T10:00:00.5Z', Date.UTC(2026, 10, 25, 10, 0, 0, 500)],
    ['2026-11-25T10:00:00.05Z', Date.UTC(2026, 10, 25, 10, 0, 0, 50)],
    ['2026-11-25T10:00:00.123Z', Date.UTC(2026, 10, 25, 10, 0, 0, 123)],
    ['2026-11-25T10:00:00+02:00', Date.UTC(2026, 10, 25, 8, 0, 0)],
    ['2026-11-25T10:00:00-07:30', Date.UTC(2026, 10, 25, 17, 30, 0)],
    ['2026-11-25T10:00:00-00:00', Date.UTC(2026, 10, 25, 10, 0, 0)],
    ['2024-02-29T23:59:59Z', Date.UTC(2024, 1, 29, 23, 59, 59)],
    ['2000-02-29T00:00:00Z', Date.UTC(2000, 1, 29)],
    ['2026-01-01T00:00:00+23:59', Date.UTC(2026, 0, 1) - (23 * 60 + 59) * 60_000],
  ])('accepts %s', (text, ms) => {
    expect(instantMs(text)).toBe(ms);
  });

  it('reads years 0–99 as written, never as 1900–1999', () => {
    const date = new Date(0);
    date.setUTCFullYear(5, 0, 1);
    expect(instantMs('0005-01-01T00:00:00Z')).toBe(date.getTime());
  });

  it.each([
    ['lower-case t', '2026-11-25t10:00:00Z'],
    ['lower-case z', '2026-11-25T10:00:00z'],
    ['no zone', '2026-11-25T10:00:00'],
    ['no seconds', '2026-11-25T10:00Z'],
    ['a leap second', '2026-12-31T23:59:60Z'],
    ['four fraction digits', '2026-11-25T10:00:00.1234Z'],
    ['an empty fraction', '2026-11-25T10:00:00.Z'],
    ['a day past the month', '2026-02-29T10:00:00Z'],
    ['day zero', '2026-11-00T10:00:00Z'],
    ['month 13', '2026-13-01T10:00:00Z'],
    ['hour 24', '2026-11-25T24:00:00Z'],
    ['minute 60', '2026-11-25T10:60:00Z'],
    ['an offset hour of 24', '2026-11-25T10:00:00+24:00'],
    ['an offset minute of 60', '2026-11-25T10:00:00+01:60'],
    ['an offset without a colon', '2026-11-25T10:00:00+0100'],
    ['a space for T', '2026-11-25 10:00:00Z'],
    ['a date alone', '2026-11-25'],
    ['leading space', ' 2026-11-25T10:00:00Z'],
    ['trailing text', '2026-11-25T10:00:00Z.'],
    ['a five-digit year', '12026-11-25T10:00:00Z'],
    ['full-width digits', '２026-11-25T10:00:00Z'],
  ])('refuses %s', (_name, text) => {
    expect(instantMs(text)).toBeUndefined();
  });

  it('refuses what is not a string', () => {
    for (const value of [undefined, null, 0, Date.UTC(2026, 0, 1), new Date(), {}, ['x']])
      expect(instantMs(value)).toBeUndefined();
  });

  it('isUtcInstant takes only the Z spelling', () => {
    expect(isUtcInstant('2026-11-25T10:00:00Z')).toBe(true);
    expect(isUtcInstant('2026-11-25T10:00:00.250Z')).toBe(true);
    expect(isUtcInstant('2026-11-25T10:00:00+00:00')).toBe(false);
    expect(isUtcInstant('2026-11-25T10:00:00-00:00')).toBe(false);
    expect(isUtcInstant('2026-11-25T10:00Z')).toBe(false);
  });
});

describe('readWindow — half-open, from before to, exactly two keys', () => {
  const FROM = '2026-11-25T10:00:00Z';
  const TO = '2026-11-25T11:00:00+01:00';

  it('returns a fresh frozen copy, the strings as written', () => {
    const input = { from: FROM, to: '2026-11-25T12:00:00+01:00' };
    const window = readWindow(input);
    expect(window).toEqual(input);
    expect(window).not.toBe(input);
    expect(Object.isFrozen(window)).toBe(true);
  });

  it('refuses an empty window (from equal to to, in another offset)', () => {
    expect(readWindow({ from: FROM, to: TO })).toBeUndefined();
  });

  it('refuses a window that runs backwards', () => {
    expect(readWindow({ from: '2026-11-25T11:00:00Z', to: FROM })).toBeUndefined();
  });

  it('a millisecond is enough', () => {
    expect(readWindow({ from: FROM, to: '2026-11-25T10:00:00.001Z' })).toBeDefined();
  });

  it.each([
    ['an extra key', { from: FROM, to: '2026-11-25T12:00:00Z', zone: 'UTC' }],
    ['a missing key', { from: FROM }],
    ['an array', [FROM, '2026-11-25T12:00:00Z']],
    ['null', null],
    ['a string', `${FROM}/2026-11-25T12:00:00Z`],
    ['a bad end', { from: FROM, to: '2026-11-25T12:00Z' }],
    [
      'a class instance',
      new (class W {
        from = FROM;
        to = '2026-11-25T12:00:00Z';
      })(),
    ],
  ])('refuses %s', (_name, value) => {
    expect(readWindow(value)).toBeUndefined();
  });

  it('never calls a getter, on either end', () => {
    let called = 0;
    const lateTo = {
      from: FROM,
      get to() {
        called++;
        return '2026-11-25T12:00:00Z';
      },
    };
    const lateFrom = {
      get from() {
        called++;
        return FROM;
      },
      to: '2026-11-25T12:00:00Z',
    };
    expect(readWindow(lateTo)).toBeUndefined();
    expect(readWindow(lateFrom)).toBeUndefined();
    expect(called).toBe(0);
  });
});
