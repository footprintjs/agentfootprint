import { describe, expect, it } from 'vitest';
import { englishTimeReader } from '../english.js';

describe('bare hour/day lookbacks', () => {
  it.each([
    ['last hour', 'hour', undefined],
    ['past hour', 'hour', undefined],
    ['last day', 'day', undefined],
    ['past day', 'day', undefined],
    ['the last hour', 'hour', undefined],
    ['the past day', 'day', undefined],
    ['last hour in est', 'hour', 'est'],
    ['past day (America/New_York)', 'day', 'America/New_York'],
    ['the last hour in Eastern', 'hour', 'Eastern'],
    ['the last week', 'week', undefined],
    ['the past week', 'week', undefined],
    ['last one week in EST', 'week', 'EST'],
    ['last an hour', 'hour', undefined],
    ['past a day', 'day', undefined],
  ])('reads the complete phrase %s', async (text, unit, token) => {
    const reading = await englishTimeReader().read(text!, { locale: 'en-US' });
    expect(reading.mentions).toHaveLength(1);
    expect(reading.mentions[0]).toMatchObject({
      quote: text,
      parses: [{ relative: { unit, count: 1 } }],
    });
    expect(reading.mentions[0]).not.toHaveProperty('problem');
    if (token === undefined) expect(reading.mentions[0]?.parses[0]).not.toHaveProperty('zoneToken');
    else expect(reading.mentions[0]?.parses[0]?.zoneToken).toBe(token);
  });

  it.each(['last week', 'past week', 'last minute'])(
    'keeps the unselected bare form unreadable: %s',
    async (text) => {
      const reading = await englishTimeReader().read(text, { locale: 'en-US' });
      expect(reading.mentions).toHaveLength(1);
      expect(reading.mentions[0]).toMatchObject({ problem: 'unreadable', parses: [] });
    },
  );

  it.each(['blast hour', 'last hourly', 'past daylight'])(
    'does not read a partial word: %s',
    async (text) => {
      expect((await englishTimeReader().read(text, { locale: 'en-US' })).mentions).toEqual([]);
    },
  );

  it('keeps unrelated words after a bare lookback out of its quote', async () => {
    const reading = await englishTimeReader().read('show last hour in storage', {
      locale: 'en-US',
    });
    expect(reading.mentions).toHaveLength(1);
    expect(reading.mentions[0]).toMatchObject({
      quote: 'last hour',
      parses: [{ relative: { unit: 'hour', count: 1 } }],
    });
    expect(reading.mentions[0]?.parses[0]).not.toHaveProperty('zoneToken');
  });
});

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
