import { expect, it } from 'vitest';
import { defaultTimeAskMessages } from '../../src/locales/timeAsk.js';
import type { TimeAskMessages } from '../../src/time/ask.js';
import { timeAskOf } from '../../src/time/readingAsk.js';
import { englishTimeReader, readEnglishTime } from '../../src/time/readers/english.js';
import { chooseReading, DEFAULT_TIME_POLICY, resolveMention } from '../../src/time/resolve.js';

it('an app supplying the complete old catalog gets defaults for additive messages', () => {
  const {
    'choice.unconverted': unconverted,
    'reply.correction': correction,
    ...old
  } = defaultTimeAskMessages;
  void [unconverted, correction];
  const messages: TimeAskMessages = old;
  const reader = englishTimeReader(),
    mention = readEnglishTime('last 1 hour in EST').mentions[0]!;
  const resolution = resolveMention(
    mention.parses,
    { now: '2026-11-06T18:01:00Z', zone: 'UTC' },
    reader,
    true,
    DEFAULT_TIME_POLICY,
  );
  const ask = timeAskOf(
    {
      kind: 'time-reading',
      turn: 1,
      iteration: 0,
      mention: 0,
      mentions: 1,
      tzdata: 'test',
      reader: { id: reader.id, version: reader.version, kind: reader.kind, locale: reader.locale },
      ...mention,
      candidates: resolution.candidates,
      choice: chooseReading(resolution, DEFAULT_TIME_POLICY, reader.kind, undefined, true),
    },
    messages,
  );
  expect(ask?.field.labels?.[0]).toContain('was not converted');
  expect(ask).not.toHaveProperty('correction');
});
