import { describe, expect, it } from 'vitest';
import { readEnglishZoneCorrection } from '../english.js';
import { attachZone } from './zones.js';
import type { Atom } from './types.js';

describe('the shared English zone correction grammar', () => {
  it.each([
    ['EST', 'EST'],
    ['EST time zone', 'EST'],
    ['Please present it in EST time zone', 'EST'],
    ['please display the results in America/New_York.', 'America/New_York'],
    ['show the range in UTC+05:30 time zone', '+05:30'],
    ['London time', 'London time'],
    [' (PST) time zone ', 'PST'],
  ])('consumes the entire affirmative correction %s', (text, token) => {
    expect(readEnglishZoneCorrection(text)).toBe(token);
  });

  it.each([
    'no',
    'not EST',
    'Please do not present it in EST time zone',
    'Please present it not in EST time zone',
    'EST or EDT',
    'EST time zone, not PST',
    'EST yesterday',
    'EST time zone and delete the history',
    'ESTish',
    'Please present it in (EST time zone',
    'EST) time zone',
    '',
    ' '.repeat(4097),
  ])('does not discard negation, conflict or unsupported text in %s', (text) => {
    expect(readEnglishZoneCorrection(text)).toBeUndefined();
  });

  it('uses the same attached token and span rather than another zone lexer', () => {
    const atom: Atom = {
      kind: 'span',
      start: 0,
      end: 'last hour'.length,
      relative: { unit: 'hour', count: 1 },
    };
    const text = 'last hour in EST';
    attachZone(text, atom);
    expect(atom.zoneToken).toBe(readEnglishZoneCorrection('EST time zone'));
    expect(atom.end).toBe(text.length);
  });
});
