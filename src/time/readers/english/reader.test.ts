import { describe, expect, it } from 'vitest';
import { englishTimeReader } from '../english.js';

describe('duration-zone token provenance', () => {
  for (const [text, token] of [
    ['last 1 hour in EST', 'EST'],
    ['last 1 hour America/New_York', 'America/New_York'],
    ['past 2h (UTC)', 'UTC'],
    ['the last hour in London time', 'London time'],
    ['last 40 minutes UTC+05:30', '+05:30'],
  ]) {
    it(`keeps the entire duration-zone phrase: ${text}`, async () => {
      const reading = await englishTimeReader().read(text!, { locale: 'en-US' });
      expect(reading.mentions).toHaveLength(1);
      expect(reading.mentions[0]).toMatchObject({ quote: text, parses: [{ zoneToken: token }] });
    });
  }
});

describe('ordinary singular lookbacks keep their complete attached zone', () => {
  it.each([
    ['last one hour in EST', 'hour', 'EST'],
    ['last an hour in EST', 'hour', 'EST'],
    ['last a minute in est', 'minute', 'est'],
    ['past one day in Eastern', 'day', 'Eastern'],
    ['past a week in Pacific time', 'week', 'Pacific time'],
    ['the last one hour in America/New_York', 'hour', 'America/New_York'],
    ['the past an hour in UTC', 'hour', 'UTC'],
  ])('reads the selected singular form %s', async (text, unit, token) => {
    const reading = await englishTimeReader().read(text, { locale: 'en-US' });
    expect(reading.mentions).toHaveLength(1);
    expect(reading.mentions[0]).toMatchObject({
      quote: text,
      parses: [{ relative: { unit, count: 1 }, zoneToken: token }],
    });
    expect(reading.mentions[0]).not.toHaveProperty('problem');
  });

  it.each([
    ['last 1 hour in est', 'est'],
    ['last 1 hour in Eastern', 'Eastern'],
    ['yesterday in Eastern', 'Eastern'],
    ['yesterday in eastern time', 'eastern time'],
  ])('does not shorten the explicitly zoned quote %s', async (text, token) => {
    const reading = await englishTimeReader().read(text, { locale: 'en-US' });
    expect(reading.mentions).toHaveLength(1);
    expect(reading.mentions[0]).toMatchObject({ quote: text, parses: [{ zoneToken: token }] });
    expect(reading.mentions[0]).not.toHaveProperty('problem');
  });

  it.each(['last 1 hour in storage', 'last one hour in storage'])(
    'leaves other words after in outside the time phrase: %s',
    async (text) => {
      const reading = await englishTimeReader().read(text, { locale: 'en-US' });
      expect(reading.mentions).toHaveLength(1);
      expect(reading.mentions[0]).toMatchObject({
        quote: text.slice(0, text.indexOf(' in ')),
        parses: [{ relative: { unit: 'hour', count: 1 } }],
      });
      expect(reading.mentions[0]?.parses[0]).not.toHaveProperty('zoneToken');
    },
  );

  it.each(['last two hours', 'next one hour'])(
    'keeps unselected duration forms unreadable: %s',
    async (text) => {
      const reading = await englishTimeReader().read(text, { locale: 'en-US' });
      expect(reading.mentions).toHaveLength(1);
      expect(reading.mentions[0]).toMatchObject({ problem: 'unreadable', parses: [] });
    },
  );
});

it('preserves no mention for an unrecognized multi-quantity phrase', async () => {
  const reading = await englishTimeReader().read('last a few hours', { locale: 'en-US' });
  expect(reading.mentions).toEqual([]);
});
