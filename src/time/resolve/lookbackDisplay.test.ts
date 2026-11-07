import { describe, expect, it } from 'vitest';
import { resolveMention, chooseReading } from '../resolve.js';
import { DEFAULT_TIME_POLICY } from '../resolveRecord.js';
import { timeAskOf } from '../readingAsk.js';
import { defaultTimeAskMessages } from '../../locales/timeAsk.js';

const clock = { now: '2026-11-06T18:01:00Z', zone: 'America/Los_Angeles' };
const reader = { id: 'test', version: '1', kind: 'rule' as const, locale: 'en-US' };
const relative = { unit: 'hour', count: 1 } as const;

describe('elapsed display does not invent an unstated conversion', () => {
  for (const token of ['EST', 'India time', '+05:30']) {
    it(`keeps ${token} unconverted and proposes UTC without an extra zone question`, () => {
      const parses = [{ relative, zoneToken: token }];
      const result = resolveMention(parses, clock, reader, true, DEFAULT_TIME_POLICY);
      expect(result.needsZone).toBe(false);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        zone: 'UTC',
        notes: expect.arrayContaining([{ kind: 'zone-unconverted', token }]),
      });
      const choice = chooseReading(result, DEFAULT_TIME_POLICY, 'rule', undefined, true);
      expect(choice).toEqual({ by: 'open', remaining: [0], open: ['confirm'] });
      const ask = timeAskOf(
        {
          kind: 'time-reading',
          turn: 1,
          iteration: 1,
          mentions: 1,
          mention: 0,
          quote: `last 1 hour in ${token}`,
          parses,
          reader,
          tzdata: 'test',
          candidates: result.candidates,
          choice,
        },
        defaultTimeAskMessages,
      );
      expect(ask!.field.format).toBe('time-range');
      expect(ask!.field.labels![0]).toContain(token);
      expect(ask!.field.labels![0]).toContain('UTC');
      expect(ask!.field.labels![0]).toContain('not converted');
    });
  }
  it('still asks when an unreadable zone changes a civil boundary', () => {
    const result = resolveMention(
      [{ relative: { unit: 'day', offset: -1 }, zoneToken: 'EST' }],
      clock,
      reader,
    );
    expect(result.needsZone).toBe(true);
    expect(result.candidates).toEqual([]);
  });
});
