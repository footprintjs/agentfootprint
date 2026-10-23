/** Runtime prose observation is bounded before it touches evidence. Checkpoint
 * admission validates plain data; it never executes values embedded in a row. */
import { describe, expect, it, vi } from 'vitest';
import { observeNegativeProse } from '../../../src/core/agent/negativeClaims/prose.js';
import { negativeProseRowIsWellFormed } from '../../../src/core/agent/findings/negativeProse.js';
import type { TurnRecord } from '../../../src/integrity/negative-claim/types.js';

const TEXT = 'Payments has never had a single incident, anywhere, ever.';
const EMPTY: TurnRecord = {
  leg: { namespace: 'synthetic-prose-review', runId: 'synthetic-run' },
  turn: 1,
  clock: '2026-10-23T12:00:00.000Z',
  calls: [],
  ledgerComplete: true,
  tools: {},
};
// An actual dispatched read supplies the anchor. Its sent label does not claim
// a resolved identity: these tests exercise observation, never establishment.
const READ: TurnRecord = {
  ...EMPTY,
  calls: [
    {
      resultId: 'claim-result/synthetic-prose-review/synthetic-run/1',
      toolName: 'read_incidents',
      turn: 1,
      batch: 1,
      dispatched: true,
      outcome: 'ok',
      effect: 'read',
      arguments: { service: 'payments' },
    },
  ],
};
const observe = (value: unknown, record = READ) => observeNegativeProse(value, record, 'negatives');
const poisonedRecord = () => {
  const read = vi.fn(() => {
    throw new Error('Evidence must not be read after a budget refusal.');
  });
  return { read, record: new Proxy({} as TurnRecord, { get: read }) };
};
const expectInputLimit = (value: unknown): void => {
  const poison = poisonedRecord();
  expect(observe(value, poison.record)).toEqual([
    expect.objectContaining({ kind: 'negative-claim-note', field: '/', code: 'input-limit' }),
  ]);
  expect(poison.read).not.toHaveBeenCalled();
};

describe('runtime negative prose — whole-answer preflight', () => {
  it('a claim phrase without any dispatched read has no data anchor', () => {
    expect(observe({ summary: TEXT }, EMPTY)).toEqual([]);
  });

  for (const [label, value, code] of [
    ['total characters', { a: TEXT, b: ' '.repeat(65_536) }, 'input-limit'],
    ['total strings', { values: Array.from({ length: 257 }, () => TEXT) }, 'input-limit'],
    ['cross-field claims', { values: Array.from({ length: 33 }, () => TEXT) }, 'too-many-claims'],
    [
      '8,000 code notes under a long field',
      { ['x'.repeat(4095)]: Array.from({ length: 8000 }, () => '`none`.').join(' ') },
      'too-many-claims',
    ],
    [
      '30 claims plus 3 code notes',
      {
        claims: Array.from({ length: 30 }, () => TEXT),
        examples: Array.from({ length: 3 }, () => '`none`.'),
      },
      'too-many-claims',
    ],
    ['long field address', { ['x'.repeat(4097)]: TEXT }, 'input-limit'],
  ] as const) {
    it(`${label} returns one whole-answer note before any evidence property is read`, () => {
      const poison = poisonedRecord();
      const rows = observe(value, poison.record);
      expect(rows).toEqual([
        expect.objectContaining({ kind: 'negative-claim-note', field: '/', code }),
      ]);
      expect(poison.read).not.toHaveBeenCalled();
    });
  }

  it('exactly 65,536 UTF-16 code units are admitted', () => {
    expect(observe({ summary: ' '.repeat(65_536) })).toEqual([]);
  });

  it('the text budget counts UTF-16 units, including surrogate pairs', () => {
    const atLimit = { summary: '😀'.repeat(32_768) };
    expect(
      observe(atLimit).some(
        (row) => row.kind === 'negative-claim-note' && row.code === 'input-limit',
      ),
    ).toBe(false);
    const poison = poisonedRecord();
    expect(observe({ summary: `${atLimit.summary} ` }, poison.record)).toEqual([
      expect.objectContaining({ code: 'input-limit' }),
    ]);
    expect(poison.read).not.toHaveBeenCalled();
  });

  it('exactly 256 strings are admitted, including empty strings', () => {
    expect(observe({ values: Array.from({ length: 256 }, () => '') })).toEqual([]);
  });

  it('32 claims across separate fields are judged, rather than 32 being a per-field multiplier', () => {
    const rows = observe({ values: Array.from({ length: 32 }, () => TEXT) });
    expect(rows).toHaveLength(32);
    expect(rows.every((row) => row.kind === 'negative-claim')).toBe(true);
    expect(rows[31]?.field).toBe('/values/31');
  });

  it('32 code notes fit the same whole-answer detection budget as 32 claims', () => {
    const rows = observe({ examples: Array.from({ length: 32 }, () => '`none`.') });
    expect(rows).toHaveLength(32);
    expect(
      rows.every((row) => row.kind === 'negative-claim-note' && row.code === 'in-code-block'),
    ).toBe(true);
  });

  it('closed citation kinds and valid handles spend no prose field or detection budget', () => {
    const poison = poisonedRecord();
    const citations = Array.from({ length: 32 }, () => ({
      kind: 'none',
      restsOn: Array.from({ length: 16 }, () => 'r1'),
    }));
    expect(observe({ negatives: citations }, poison.record)).toEqual([]);
    expect(poison.read).not.toHaveBeenCalled();
  });

  it('free-form about is still prose while library statements are absent from the original candidate', () => {
    const rows = observe({ negatives: [{ kind: 'none', about: TEXT, restsOn: ['r1'] }] });
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'negative-claim', field: '/negatives/0/about' }),
    ]);
  });

  it('a value outside the closed citation protocol is not silently skipped', () => {
    const rows = observe({ negatives: [{ kind: TEXT, restsOn: [TEXT] }] });
    expect(rows.map((row) => row.field)).toEqual(['/negatives/0/kind', '/negatives/0/restsOn/0']);
  });

  it('a typed-like key outside the configured citation field is ordinary model prose', () => {
    const rows = observeNegativeProse({ negatives: [{ kind: TEXT }] }, READ, 'citations');
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'negative-claim', field: '/negatives/0/kind' }),
    ]);
  });

  it('closed protocol values outside the configured citation field still spend the string budget', () => {
    const citations = Array.from({ length: 32 }, () => ({
      kind: 'none',
      restsOn: Array.from({ length: 16 }, () => 'r1'),
    }));
    const poison = poisonedRecord();
    expect(observeNegativeProse({ negatives: citations }, poison.record, 'citations')).toEqual([
      expect.objectContaining({ kind: 'negative-claim-note', field: '/', code: 'input-limit' }),
    ]);
    expect(poison.read).not.toHaveBeenCalled();
  });

  it('nested field addresses use JSON pointer escaping', () => {
    const rows = observe({ 'a/b~c': [{ note: TEXT }] });
    expect(rows[0]?.field).toBe('/a~1b~0c/0/note');
  });

  it('shares matching work across admitted fields and replaces prior findings on exhaustion', () => {
    const names = Array.from({ length: 7 }, (_, index) =>
      Array.from({ length: 300 }, (_, position) => (position === index ? 'A' : 'a')).join(' '),
    );
    const record: TurnRecord = {
      ...READ,
      calls: [
        ...READ.calls,
        ...names.map((name, index) => ({
          ...READ.calls[0],
          resultId: `claim-result/synthetic-prose-review/synthetic-run/${index + 2}`,
          toolName: 'lookup_name',
          arguments: { lookup: name },
        })),
      ],
    };
    const text = `There are no ${'a '.repeat(1000)}items.`;
    expect(observe(TEXT, record)).toEqual([
      expect.objectContaining({ kind: 'negative-claim', notes: ['entity-unresolved'] }),
    ]);
    // Each field fits by itself. Only the combined work should refuse the
    // answer, discarding the previously collected genuine observation too.
    expect(observe(text, record)).toEqual([]);
    expect(observe(text, record)).toEqual([]);
    const candidate = { summary: TEXT, first: text, second: text, later: TEXT };
    expect(observe(candidate, record)).toEqual([
      expect.objectContaining({
        kind: 'negative-claim-note',
        field: '/',
        code: 'input-limit',
        span: { start: 0, end: 2 * (TEXT.length + text.length) },
      }),
    ]);
  });

  it('charges resolution work even when a public subject is a cheap data anchor', () => {
    const names = Array.from({ length: 7 }, (_, index) =>
      Array.from({ length: 300 }, (_, position) => (position === index ? 'A' : 'a')).join(' '),
    );
    const record: TurnRecord = {
      ...READ,
      tools: {
        lookup_name: {
          name: 'lookup_name',
          search: {
            subject: { what: 'items', said: ['items'] },
            source: { what: 'store', said: ['store'] },
            arguments: [{ name: 'lookup', role: 'population' }],
          },
        },
      },
      calls: names.map((name, index) => ({
        ...READ.calls[0],
        resultId: `claim-result/synthetic-prose-review/synthetic-run/${index + 1}`,
        toolName: 'lookup_name',
        arguments: { lookup: name },
        scope: [
          {
            from: 'call',
            facet: 'population',
            what: 'lookup',
            argument: 'lookup',
            value: name,
            resolved: { id: `item-${index}`, name },
          },
        ],
      })),
    };
    const text = `There are no ${'a '.repeat(1000)}items.`;
    expect(observe(text, record)).toEqual([
      expect.objectContaining({ kind: 'negative-claim', notes: ['entity-unresolved'] }),
    ]);
    expect(observe({ first: text, second: text }, record)).toEqual([
      expect.objectContaining({ kind: 'negative-claim-note', field: '/', code: 'input-limit' }),
    ]);
  });
});

describe('runtime negative prose — unreadable candidates are noted', () => {
  it('does not invoke a model/parser-owned getter', () => {
    const getter = vi.fn(() => TEXT);
    const value = Object.defineProperty({}, 'summary', { enumerable: true, get: getter });
    expectInputLimit(value);
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not call a toJSON function', () => {
    const toJSON = vi.fn(() => ({ summary: TEXT }));
    expectInputLimit({ toJSON });
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('notes cycles before reading evidence', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expectInputLimit(value);
  });

  for (const [name, value] of [
    ['non-JSON class', new Date('2026-10-23T12:00:00Z')],
    ['non-finite number', { value: Infinity }],
    ['symbol', { value: Symbol('not-json') }],
    ['sparse array', new Array(2)],
    ['over one megabyte', { summary: 'x'.repeat(1024 * 1024) }],
  ] as const) {
    it(`notes ${name} without reading evidence`, () => {
      expectInputLimit(value);
    });
  }
});

const CLAIM = {
  kind: 'negative-claim',
  field: '/summary',
  claim: 'none',
  span: { start: 13, end: 22 },
  phraseId: 'none.never-had',
  packVersion: '1',
  notes: ['entity-unresolved'],
  results: [],
  iteration: 2,
  turn: 1,
};
const NOTE = {
  kind: 'negative-claim-note',
  field: '/',
  code: 'input-limit',
  span: { start: 0, end: 65_537 },
  packVersion: '1',
  iteration: 2,
  turn: 1,
};

describe('negative prose checkpoint row admission', () => {
  it('accepts real observed claim and code-block rows after JSON round-trip', () => {
    const rows = observe({ summary: TEXT, example: `\`\`\`text\n${TEXT}\n\`\`\`` });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const stored = { ...row, iteration: 2, turn: 1 };
      const restored = JSON.parse(JSON.stringify(stored));
      expect(restored).toEqual(stored);
      expect(negativeProseRowIsWellFormed(restored)).toBe(true);
    }
  });

  it('accepts a bounded global note and optional dated stale evidence', () => {
    expect(negativeProseRowIsWellFormed(NOTE)).toBe(true);
    expect(
      negativeProseRowIsWellFormed({
        ...CLAIM,
        staleSince: { turn: 1, readAt: '2026-10-22T12:00:00.000Z' },
      }),
    ).toBe(true);
  });

  for (const [name, value] of [
    ['null', null],
    ['array', []],
    ['wrong kind', { ...CLAIM, kind: 'supported-fact' }],
    ['missing iteration', { ...CLAIM, iteration: undefined }],
    ['fractional iteration', { ...CLAIM, iteration: 0.5 }],
    ['turn zero', { ...CLAIM, turn: 0 }],
    ['missing turn', { ...CLAIM, turn: undefined }],
    ['backward span', { ...CLAIM, span: { start: 10, end: 9 } }],
    ['negative span', { ...CLAIM, span: { start: -1, end: 2 } }],
    ['unknown claim kind', { ...CLAIM, claim: 'not-found' }],
    ['unknown note code', { ...NOTE, code: 'looked-up-and-verified' }],
    ['unknown claim note', { ...CLAIM, notes: ['looked-up-and-verified'] }],
    ['non-string result', { ...CLAIM, results: [123] }],
    ['non-string candidate', { ...CLAIM, candidates: [null] }],
    ['invalid stale turn', { ...CLAIM, staleSince: { turn: -1 } }],
  ] as const) {
    it(`refuses ${name}`, () => {
      expect(negativeProseRowIsWellFormed(value)).toBe(false);
    });
  }

  for (const at of ['kind', 'span', 'nested-span'] as const) {
    it(`refuses ${at} accessors without invoking them`, () => {
      const getter = vi.fn(() => (at === 'kind' ? CLAIM.kind : CLAIM.span));
      const row =
        at === 'nested-span'
          ? {
              ...CLAIM,
              span: Object.defineProperty({ end: 22 }, 'start', { enumerable: true, get: getter }),
            }
          : Object.defineProperty({ ...CLAIM }, at, { enumerable: true, get: getter });
      expect(negativeProseRowIsWellFormed(row)).toBe(false);
      expect(getter).not.toHaveBeenCalled();
    });
  }
});
