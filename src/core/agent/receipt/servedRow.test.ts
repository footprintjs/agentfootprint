import { describe, expect, it } from 'vitest';
import { servedHistoryRow } from './servedRow.js';

const consumer = 'call-llm#7';

describe('served history row', () => {
  it('records only ascending half-open ranges for complete history entries', () => {
    expect(servedHistoryRow(consumer, [false, true, true, false, true, false, true])).toEqual({
      kind: 'served',
      version: 1,
      consumer,
      served: [
        {
          key: 'history',
          elements: [
            [1, 3],
            [4, 5],
            [6, 7],
          ],
        },
      ],
    });
  });

  it.each([{ entries: [] }, { entries: [false, false] }])(
    'lists no key for $entries',
    ({ entries }) => {
      expect(servedHistoryRow(consumer, entries)).toEqual({
        kind: 'served',
        version: 1,
        consumer,
        served: [],
      });
    },
  );

  it('bounds the row only when another range would be omitted', () => {
    const entries = [...Array.from({ length: 127 }, (_, index) => index % 2 === 0), true];
    const elements = Array.from({ length: 64 }, (_, index) => [index * 2, index * 2 + 1]);
    elements[63] = [126, 128];
    const complete = {
      kind: 'served',
      version: 1,
      consumer,
      served: [{ key: 'history', elements }],
    };
    expect(servedHistoryRow(consumer, entries)).toEqual(complete);
    expect(servedHistoryRow(consumer, [...entries, false, true])).toEqual({
      ...complete,
      bounded: true,
    });
  });
});
