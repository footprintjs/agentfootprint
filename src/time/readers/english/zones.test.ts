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

describe('ruled zone words preserve the written token', () => {
  const safe = ['EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PST', 'PDT', 'UTC', 'GMT'];
  for (const word of safe) {
    for (const token of [word.toLowerCase(), word[0] + word.slice(1).toLowerCase(), word]) {
      it(`recognizes ${token} without mapping or rewriting it`, () => {
        expect(readEnglishZoneCorrection(token)).toBe(token);
        const text = `last 1 hour in ${token}`;
        const atom: Atom = {
          kind: 'span',
          start: 0,
          end: 'last 1 hour'.length,
          relative: { unit: 'hour', count: 1 },
        };
        attachZone(text, atom);
        expect(atom.zoneToken).toBe(token);
        expect(atom.end).toBe(text.length);
      });
    }
  }

  it.each([
    'Eastern',
    'Central',
    'Mountain',
    'Pacific',
    'Eastern time',
    'central time',
    'mountain time',
    'pacific time',
  ])('recognizes the ruled regional spelling %s without choosing a zone', (token) => {
    expect(readEnglishZoneCorrection(token)).toBe(token);
    const text = `yesterday in ${token}`;
    const atom: Atom = {
      kind: 'day',
      start: 0,
      end: 'yesterday'.length,
      relative: { unit: 'day', offset: -1 },
    };
    attachZone(text, atom);
    expect(atom.zoneToken).toBe(token);
    expect(atom.end).toBe(text.length);
  });

  it.each(['west', 'wet', 'ist', 'mt', 'wEsT', 'eastern', 'central', 'mountain', 'pacific'])(
    'keeps risky lowercase or unqualified regional words unrecognized: %s',
    (token) => {
      expect(readEnglishZoneCorrection(token)).toBeUndefined();
      const text = `last 1 hour in ${token}`;
      const atom: Atom = {
        kind: 'span',
        start: 0,
        end: 'last 1 hour'.length,
        relative: { unit: 'hour', count: 1 },
      };
      attachZone(text, atom);
      expect(atom.zoneToken).toBeUndefined();
      expect(atom.end).toBe('last 1 hour'.length);
    },
  );

  it.each(['WEST', 'WET', 'IST', 'MT'])('retains existing capital-only token %s', (token) => {
    expect(readEnglishZoneCorrection(token)).toBe(token);
  });
});

describe('affirmative correction wrappers and real places', () => {
  it.each([
    ['in EST', 'EST'],
    ['in est', 'est'],
    ['No, EST', 'EST'],
    ['no, est', 'est'],
    ['Eastern time zone', 'Eastern'],
    ['in Central', 'Central'],
    ['in London time', 'London time'],
    ['No, New York time', 'New York time'],
  ])('consumes the affirmative correction %s', (text, token) => {
    expect(readEnglishZoneCorrection(text)).toBe(token);
  });

  it.each([
    'No time',
    'Wrong time',
    'Not Eastern time',
    'Bad Time',
    'Any time',
    'Same time',
    'Gotham time',
    'No, not EST',
    'no EST',
    'in EST or PST',
    'in storage',
    'Easternmost',
    'central',
  ])('does not turn non-places or unsupported corrections into zones: %s', (text) => {
    expect(readEnglishZoneCorrection(text)).toBeUndefined();
  });

  it('keeps an attached unknown place for the existing ask path, without accepting it as a whole correction', () => {
    const text = 'yesterday in Gotham time';
    const atom: Atom = {
      kind: 'day',
      start: 0,
      end: 'yesterday'.length,
      relative: { unit: 'day', offset: -1 },
    };
    attachZone(text, atom);
    expect(atom.zoneToken).toBe('Gotham time');
    expect(atom.end).toBe(text.length);
    expect(readEnglishZoneCorrection('Gotham time')).toBeUndefined();
  });
});
