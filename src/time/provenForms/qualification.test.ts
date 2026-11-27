import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { completeClock, draftClock, readRunTime } from '../clock.js';
import { checkReading } from '../reader.js';
import { englishTimeReader, readEnglishTime } from '../readers/english.js';
import { DEFAULT_TIME_POLICY } from '../resolve.js';
import { clockRow, timeReadingRows } from '../rowsBuild.js';
import { provenLookback } from './proof.js';
import { provenLookbackOf } from './qualification.js';

const at = { turn: 1, iteration: 1 };
const now = '2026-11-01T09:30:00Z';
const time = readRunTime({ now, zone: 'UTC' });
if ('problem' in time) throw new Error(time.problem);
const clock = clockRow(completeClock(draftClock(time.value, {}), 0), at);
const reader = englishTimeReader();
const phrase = 'last 2 hours';

function rows(text: string) {
  return timeReadingRows({
    mentions: checkReading(text, readEnglishTime(text), reader.id),
    clock,
    policy: DEFAULT_TIME_POLICY,
    reader,
    tzdata: provenLookback.runtime.tz,
    at,
  });
}

describe('fresh benchmark qualification', () => {
  beforeEach(() => {
    const format = Intl.DateTimeFormat;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) =>
      format(locales, { timeZone: 'UTC', ...options }),
    );
    vi.stubGlobal('process', {
      ...process,
      versions: { ...process.versions, ...provenLookback.runtime },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(provenLookback.phrases)('admits the measured literal %s', (text) => {
    expect(provenLookbackOf(reader, text, clock, rows(text))?.endpoint).toMatchObject({
      cutoff: now,
      end: 'exclusive',
    });
  });

  it('requires the measured reader, scope, unique reading, and exact phrase', () => {
    const exact = rows(phrase);
    expect(
      provenLookbackOf({ ...reader, read: readEnglishTime.bind(null) }, phrase, clock, exact),
    ).toBeUndefined();
    expect(
      provenLookbackOf(reader, phrase, { ...clock, zoneSource: 'unknown' }, exact),
    ).toBeUndefined();
    expect(provenLookbackOf(reader, phrase, clock, [...exact, ...exact])).toBeUndefined();
    const attached = 'last 2 hours before the outage';
    expect(provenLookbackOf(reader, attached, clock, rows(attached))).toBeUndefined();
    const written = '2026-11-13 2:00 PM to 4:15 PM UTC';
    expect(provenLookbackOf(reader, written, clock, rows(written))).toBeUndefined();
  });

  it('disables new qualification when the runtime changes', () => {
    vi.stubGlobal('process', { ...process, versions: { ...process.versions, tz: '2027a' } });
    expect(provenLookbackOf(reader, phrase, clock, rows(phrase))).toBeUndefined();
  });
});
