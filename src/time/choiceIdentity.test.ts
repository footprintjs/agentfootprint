import { describe, expect, it } from 'vitest';
import { timeChoiceIdentity } from './choiceIdentity.js';
import type { TimeCandidate, TimeNote } from './resolveRecord.js';

const RANGE = { from: '2026-01-10T08:00:00Z', to: '2026-01-10T09:00:00Z' } as const;

function candidate(changes: Partial<TimeCandidate> = {}): TimeCandidate {
  return {
    window: { kind: 'lookback', duration: '1h' },
    range: RANGE,
    zone: 'America/Los_Angeles',
    grain: 'hour',
    said: ['duration', 'zone'],
    implied: [],
    anchor: 'message',
    reader: { id: 'rule:en', kind: 'rule' },
    notes: [],
    reading: {},
    parse: 0,
    ...changes,
  };
}

describe('timeChoiceIdentity', () => {
  it('keeps two zone meanings over the same elapsed UTC interval distinct', () => {
    expect(timeChoiceIdentity(candidate())).not.toBe(
      timeChoiceIdentity(candidate({ zone: 'Asia/Kolkata' })),
    );
  });

  it('keeps regional and fixed abbreviation readings distinct even at equal winter offsets', () => {
    const region = candidate({
      reading: { abbreviation: 'zone' },
      notes: [{ kind: 'zone-read', token: 'PST', as: 'abbreviation' }],
    });
    const literal = candidate({
      reading: { abbreviation: 'literal' },
      notes: [{ kind: 'zone-read', token: 'PST', as: 'abbreviation-literal' }],
    });
    expect(timeChoiceIdentity(region)).not.toBe(timeChoiceIdentity(literal));
    expect(timeChoiceIdentity(literal)).not.toBe(
      timeChoiceIdentity({ ...region, zone: 'Etc/GMT+8' }),
    );
  });

  it('retains the literal meaning carried by a zone-read note', () => {
    expect(
      timeChoiceIdentity(
        candidate({ notes: [{ kind: 'zone-read', token: 'PST', as: 'abbreviation-literal' }] }),
      ),
    ).toBe(timeChoiceIdentity(candidate({ reading: { abbreviation: 'literal' } })));
    expect(timeChoiceIdentity(candidate({ reading: { abbreviation: 'literal' } }))).not.toBe(
      timeChoiceIdentity(candidate()),
    );
  });

  it('does not invent another meaning from parse position or a duplicate date-order reading', () => {
    const first = candidate({ reading: { dateOrder: 'MDY', year: 'current' } });
    const second = candidate({ reading: { dateOrder: 'DMY', year: 'said' }, parse: 7 });
    expect(timeChoiceIdentity(first)).toBe(timeChoiceIdentity(second));
    expect(timeChoiceIdentity(candidate({ reader: { id: 'another-reader', kind: 'model' } }))).toBe(
      timeChoiceIdentity(first),
    );
  });

  it('does distinguish date-order readings that produce different actual intervals', () => {
    const first = candidate({ reading: { dateOrder: 'MDY' } });
    const second = candidate({
      range: { from: '2026-10-01T08:00:00Z', to: '2026-10-01T09:00:00Z' },
      reading: { dateOrder: 'DMY' },
    });
    expect(timeChoiceIdentity(first)).not.toBe(timeChoiceIdentity(second));
  });

  it('compares exact instants rather than their offset spelling or millisecond rounding', () => {
    expect(timeChoiceIdentity(candidate())).toBe(
      timeChoiceIdentity(
        candidate({
          range: { from: '2026-01-10T00:00:00-08:00', to: '2026-01-10T01:00:00-08:00' },
        }),
      ),
    );
    const precise = (nanos: string) =>
      candidate({
        range: {
          from: `2026-01-10T08:00:00.00000000${nanos}Z`,
          to: '2026-01-10T09:00:00Z',
        },
      });
    expect(timeChoiceIdentity(precise('1'))).not.toBe(timeChoiceIdentity(precise('2')));
  });

  it('keeps explicit numeric offsets distinct without creating a second offset grammar', () => {
    const offset = (value: string) =>
      candidate({ notes: [{ kind: 'offset-said', offset: value }] });
    expect(timeChoiceIdentity(offset('-08'))).toBe(timeChoiceIdentity(offset('-08:00')));
    expect(timeChoiceIdentity(offset('-08:00'))).not.toBe(timeChoiceIdentity(offset('-07:00')));
    expect(timeChoiceIdentity(offset('-00:00'))).toBe(timeChoiceIdentity(offset('+00:00')));
    expect(timeChoiceIdentity(offset('-08:00'))).not.toBe(timeChoiceIdentity(candidate()));
    expect(timeChoiceIdentity(offset('unread:a,b'))).not.toBe(
      timeChoiceIdentity(offset('unread:a"],["b')),
    );
  });

  it('does not depend on note order, duplicate offset notes or source token spelling', () => {
    const notes: readonly TimeNote[] = [
      { kind: 'offset-said', offset: '-08:00' },
      { kind: 'zone-read', token: 'PST', as: 'abbreviation-literal' },
      { kind: 'offset-said', offset: '-08' },
    ];
    const first = candidate({ notes });
    const second = candidate({
      notes: [
        { kind: 'zone-read', token: 'pst', as: 'abbreviation-literal' },
        { kind: 'offset-said', offset: '-0800' },
      ],
    });
    expect(timeChoiceIdentity(first)).toBe(timeChoiceIdentity(second));
    expect(first.notes).toBe(notes);
    expect(first.notes).toEqual(notes);
  });

  it('keeps candidate identities stable when a request bank is reordered or restored as data', () => {
    const bank = [candidate(), candidate({ zone: 'Asia/Kolkata' })];
    const expected = bank.map(timeChoiceIdentity);
    expect([...bank].reverse().map(timeChoiceIdentity)).toEqual([...expected].reverse());
    expect(bank.map((entry) => timeChoiceIdentity(structuredClone(entry)))).toEqual(expected);
  });

  it('keeps elapsed and absolute windows distinct even when their current instants agree', () => {
    expect(timeChoiceIdentity(candidate())).not.toBe(
      timeChoiceIdentity(candidate({ window: { kind: 'range', range: RANGE } })),
    );
  });

  it('retains the elapsed duration interpretation rather than only its current endpoints', () => {
    expect(timeChoiceIdentity(candidate())).not.toBe(
      timeChoiceIdentity(candidate({ window: { kind: 'lookback', duration: '2h' } })),
    );
    // These spellings have the same meaning under the ONE existing grammar.
    expect(timeChoiceIdentity(candidate())).toBe(
      timeChoiceIdentity(candidate({ window: { kind: 'lookback', duration: '60m' } })),
    );
  });

  it('does not collapse different unmeasurable duration spellings to one missing number', () => {
    const unmeasured = (duration: string) => candidate({ window: { kind: 'lookback', duration } });
    expect(timeChoiceIdentity(unmeasured('10000000000000000000h'))).not.toBe(
      timeChoiceIdentity(unmeasured('10000000000000000001h')),
    );
  });

  it('preserves the anchor and grain used to interpret the window', () => {
    expect(timeChoiceIdentity(candidate())).not.toBe(
      timeChoiceIdentity(candidate({ anchor: 'previous-window' })),
    );
    expect(timeChoiceIdentity(candidate())).not.toBe(
      timeChoiceIdentity(candidate({ anchor: 'none' })),
    );
    expect(timeChoiceIdentity(candidate())).not.toBe(
      timeChoiceIdentity(candidate({ grain: 'minute' })),
    );
  });

  it.each([
    { from: '2026-01-10T08:00:00', to: RANGE.to },
    { from: '2026-02-30T08:00:00Z', to: RANGE.to },
    { from: RANGE.to, to: RANGE.from },
    { from: RANGE.from, to: RANGE.from },
  ])(
    'refuses a non-strict or unordered range without offering a replacement grammar: %o',
    (range) => {
      expect(() => timeChoiceIdentity(candidate({ range }))).toThrow(
        'timeChoiceIdentity: a strict, ordered time range is required.',
      );
    },
  );
});
