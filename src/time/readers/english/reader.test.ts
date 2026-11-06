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
