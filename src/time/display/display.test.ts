import { expect, it } from 'vitest';
import {
  readTimeDisplay,
  displayFieldOf,
  displayOfTurn,
  displayPresentationOf,
} from '../display.js';
import { presentRange, presentSpan } from '../present.js';

it.each(['UTC', 'GMT', 'America/New_York', 'Asia/Kolkata', 'Asia/Kathmandu'])(
  'admits the existing IANA policy for %s',
  (viewerZone) => {
    expect(readTimeDisplay({ viewerZone })).toEqual({ purpose: 'display-only', viewerZone });
  },
);
it.each(
  [
    undefined,
    null,
    {},
    [],
    'America/New_York',
    { viewerZone: 'PST' },
    { viewerZone: '+05:30' },
    { viewerZone: 'No/SuchZone' },
    { viewerZone: 'UTC', purpose: 'display-only' },
  ].map((value) => ({ value })),
)('does not mint a display from malformed $value', ({ value }) => {
  expect(readTimeDisplay(value)).toBeUndefined();
});

it('does not call a declared getter, including on the recorded metadata', () => {
  let reads = 0;
  const value = Object.defineProperty({ purpose: 'display-only' }, 'viewerZone', {
    enumerable: true,
    get() {
      reads++;
      return 'America/New_York';
    },
  });
  expect(readTimeDisplay(value)).toBeUndefined();
  expect(displayPresentationOf({ display: value })).toEqual({ viewerDisplayUnavailable: true });
  expect(reads).toBe(0);
});

it('separates an absent display from metadata that was hidden or could not be read', () => {
  expect(displayFieldOf({})).toEqual({});
  expect(displayPresentationOf({})).toEqual({});
  for (const display of ['[REDACTED]', null, {}, { purpose: 'clock', viewerZone: 'UTC' }]) {
    expect(displayPresentationOf({ display })).toEqual({ viewerDisplayUnavailable: true });
  }
  expect(displayPresentationOf({ display: readTimeDisplay({ viewerZone: 'UTC' }) })).toEqual({
    viewerZone: 'UTC',
  });
});

it('treats an unreadable record as unavailable instead of failing its action', () => {
  const display = new Proxy(
    {},
    {
      ownKeys() {
        throw Error('unreadable record');
      },
    },
  );
  expect(displayPresentationOf({ display })).toEqual({ viewerDisplayUnavailable: true });
});

it('keeps both DST offsets and the exact cutoff digits in the viewer label', () => {
  const source = { zone: 'America/New_York', viewerZone: 'America/Los_Angeles' };
  const text = presentSpan(
    '2026-11-01T08:30:00.123456789Z',
    '2026-11-01T09:30:00.987654321Z',
    source,
    'exact',
  );
  expect(text).toContain('viewer display:');
  expect(text).toContain('UTC-07:00');
  expect(text).toContain('UTC-08:00');
  expect(text).toContain('123456789');
  expect(text).toContain('987654321');
});

it('does not reinterpret a legacy day in the viewer calendar', () => {
  const label = presentRange(
    { from: '2026-11-13T08:00:00Z', to: '2026-11-14T08:00:00Z' },
    { zone: 'America/Los_Angeles', viewerZone: 'America/New_York' },
    'day',
  );
  expect(label).toContain('2026-11-13 America/Los_Angeles');
  expect(label).toContain('03:00');
  expect(label).toContain('2026-11-14');
  expect(label).toContain('end excluded');
});

it('labels unavailable display evidence without guessing its zone', () => {
  const text = presentSpan('2026-11-13T11:00:00Z', '2026-11-13T13:00:00Z', {
    zone: 'UTC',
    ...displayPresentationOf({ display: '[REDACTED]' }),
  });
  expect(text).toContain('viewer display unavailable');
  expect(text).not.toContain('America/');
});

it('keeps one declaration per turn through replay without inheriting or guessing conflicts', () => {
  const display = readTimeDisplay({ viewerZone: 'America/New_York' });
  const rows = [
    { kind: 'clock', turn: 1, display },
    { kind: 'clock', turn: 1 },
  ];
  expect(displayOfTurn(rows, 1)).toEqual({ display });
  expect(displayOfTurn(rows, 2)).toEqual({});
  expect(displayOfTurn([...rows, { kind: 'clock', turn: 1, display }], 1)).toEqual({
    display: undefined,
  });
});
