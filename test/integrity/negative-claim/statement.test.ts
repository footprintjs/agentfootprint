/**
 * negative-claim — the library's statement (design § 5.1, `statement.ts`): written from the
 * cited reads' rows alone, every gap said out loud as "not checked: …".
 *
 * Every text taken from a row — a sent value AND the declaration's own words (tool, subject,
 * source, qualifiers, a gap's text) — is QUOTED data attributed to the tool ("as the tool names
 * them"): NFKC, control and format characters (bidi overrides included) removed, line breaks
 * flattened, each value capped at 64 characters + "…". Only numbers and instants the library
 * re-spells from parsed values stand outside quotes. One clause per cited read, one line each,
 * in ordinal order. `complete` states the rows READ (their count and identities, capped), never a
 * list the model wrote.
 *
 * The note's three worked statements are pinned in their RULE-derived form: a statement may say
 * only what the rows hold ("names outside that export" is not in any row; the plural subject is
 * not singularised) and must state every facet and gap (the third example's `{ any }` filter and
 * email gap).
 *
 * Test types: unit (each worked statement; each row shape) · property (seeded: a clause is one
 * line, holds no unquoted row text, never names a word of a read it does not cite, and never
 * exceeds the stated length).
 */
import { describe, expect, it } from 'vitest';

import { judgeTypedNegatives } from '../../../src/integrity/negative-claim/judge.js';
import {
  STATEMENT_LIMITS,
  STATEMENT_VERSION,
  composeStatement,
} from '../../../src/integrity/negative-claim/statement.js';
import type { ComposedSearchRow } from '../../../src/integrity/negative-claim/searchRow.js';
import type { TurnCall } from '../../../src/integrity/negative-claim/types.js';
import { CLOCK, amongCall, incidentCall, incidentRow, rid, turnRecord } from './fixtures.js';

const statementOf = (negatives: unknown, calls: readonly TurnCall[]) =>
  judgeTypedNegatives({ field: 'negatives', negatives, record: turnRecord(calls) })[0]?.statement
    ?.text;

const cite = (kind: string, ...ids: string[]) => [{ kind, restsOn: ids.map((id) => rid(id)) }];

describe('the three worked statements (§ 5.1), rule-derived', () => {
  it('none: the scope of the read and the email gap, said out loud', () => {
    expect(statementOf(cite('none', 'c1'), [incidentCall()])).toBe(
      '`list_incidents` found none — as the tool names them: subject `incidents`; for ' +
        '`service: payments`; scope `status: open`, any `severity`; source `the incident ' +
        'store`; window 08:00–10:00Z (held in full); not checked: `incidents filed by email`.',
    );
  });

  it('not-found: the name among the export, its read time and its irremovable gap', () => {
    expect(statementOf(cite('not-found', 'c4'), [amongCall()])).toBe(
      '`get_capacity` did not find `ARRAY-X9` among 14 names — as the tool names them: ' +
        'subject `arrays`; for `array_id: ARRAY-X9`; names `array names`; source `the ' +
        'array inventory export`; read 09:14Z; not checked: `names outside the array ' +
        'inventory export`.',
    );
  });

  it('complete: the rows READ, by count and identity — and the gap still stated', () => {
    const call = incidentCall({
      emptiness: 'non-empty',
      rows: 3,
      rowsRead: [{ entity: 'INC-7302' }, { entity: 'INC-7295' }, { entity: 'INC-7288' }],
    });
    expect(statementOf(cite('complete', 'c1'), [call])).toBe(
      '`list_incidents` read 3 rows — as the tool names them: subject `incidents`; for ' +
        '`service: payments`; scope `status: open`, any `severity`; source `the incident ' +
        'store`; window 08:00–10:00Z (held in full); rows `INC-7302`, `INC-7295`, `INC-7288`; ' +
        'no cap reached, one page; not checked: `incidents filed by email`.',
    );
  });

  it('carries its version', () => {
    const judged = judgeTypedNegatives({
      field: 'negatives',
      negatives: cite('none', 'c1'),
      record: turnRecord([incidentCall()]),
    });
    expect(judged[0]?.statement?.version).toBe(STATEMENT_VERSION);
    expect(STATEMENT_VERSION).toBe('1');
  });
});

describe('each row shape', () => {
  it('a sent filter is stated as sent', () => {
    expect(
      statementOf(cite('none', 'c1'), [incidentCall({ severity: 'critical', gaps: [] })]),
    ).toBe(
      '`list_incidents` found none — as the tool names them: subject `incidents`; for ' +
        '`service: payments`; scope `status: open`, `severity: critical`; source `the incident ' +
        'store`; window 08:00–10:00Z (held in full).',
    );
  });

  it('a partly-held period names the time not held as not checked', () => {
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({ held: { from: '2026-10-22T09:00:00Z', to: CLOCK }, gaps: [] }),
    ]);
    expect(text).toContain(
      'window 08:00–10:00Z (held in part); not checked: 08:00–09:00Z (not held).',
    );
  });

  it('a period the store does not hold at all is not held, whole', () => {
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({
        held: { from: '2026-09-01T00:00:00Z', to: '2026-09-30T00:00:00Z' },
        gaps: [],
      }),
    ]);
    expect(text).toContain('window 08:00–10:00Z (not held); not checked: 08:00–10:00Z (not held).');
  });

  it('a span over two days is written with its dates', () => {
    const text = statementOf(cite('none', 'c1'), [incidentCall({ window: '7d', gaps: [] })]);
    expect(text).toContain('window 2026-10-15 10:00Z–2026-10-22 10:00Z (held in full)');
  });

  it('a period facet with no declared period says so', () => {
    const text = statementOf(cite('none', 'c1'), [incidentCall({ held: 'none', gaps: [] })]);
    expect(text).toContain('; window `window: 2h` (held: undeclared).');
  });

  it('a sent source replaces the declared one', () => {
    const row = incidentRow({ gaps: [] });
    const sent: ComposedSearchRow = {
      ...row,
      checked: row.checked.map((item) =>
        item.facet === 'source'
          ? { what: 'db: replica', facet: 'source', argument: 'db', value: 'replica', from: 'call' }
          : item,
      ),
    };
    const statement = composeStatement('none', [{ call: incidentCall(), row: sent }], CLOCK);
    expect(statement.text).toContain('source `db: replica`');
    expect(statement.text).not.toContain('the incident store');
  });

  it('every gap kind is stated by its own words: an unsent argument and a hand-written gap', () => {
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({
        gaps: [
          {
            kind: 'argument-unsent',
            what: 'region: not sent, its default undeclared',
            argument: 'region',
            bears: 'population',
          },
          { kind: 'prose', what: 'the archive tier' },
        ],
      }),
    ]);
    expect(text).toContain(
      'not checked: `region: not sent, its default undeclared`, `the archive tier`.',
    );
  });

  it('an authoritative `among` names no gap', () => {
    const text = statementOf(cite('not-found', 'c4'), [amongCall({ authoritative: true })]);
    expect(text).toContain('; read 09:14Z.');
    expect(text).not.toContain('not checked');
  });

  it('two cited reads give two lines, in ORDINAL order, not citation order', () => {
    const calls = [
      incidentCall({ id: 'c1', gaps: [] }),
      incidentCall({ id: 'c2', service: 'checkout', gaps: [] }),
    ];
    const text = statementOf(cite('none', 'c2', 'c1'), calls) ?? '';
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('`service: payments`');
    expect(lines[1]).toContain('`service: checkout`');
  });

  it('a hostile value is quoted, stripped of line breaks and backticks, and capped', () => {
    const row = incidentRow({ gaps: [{ kind: 'prose', what: `x\`\n${'y'.repeat(200)}\u0007z` }] });
    const { text } = composeStatement('none', [{ call: incidentCall(), row }], CLOCK);
    expect(text).not.toMatch(/[\n\r\p{Cc}]/u);
    expect(text).toContain(`\`x' ${'y'.repeat(61)}…\``);
  });

  it('format characters and bidi overrides are removed, and text is NFKC', () => {
    const row = incidentRow({
      gaps: [{ kind: 'prose', what: 'safe\u202Eevil\u200B ｐａｙ\u2066x' }],
    });
    const { text } = composeStatement('none', [{ call: incidentCall(), row }], CLOCK);
    expect(text).toContain('`safeevil payx`');
    expect(text).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B]/);
  });

  it('identities of the rows read are capped, the rest counted', () => {
    const rowsRead = Array.from({ length: 30 }, (_, i) => ({ entity: `INC-${i}` }));
    const call = incidentCall({ emptiness: 'non-empty', rows: 30, rowsRead, gaps: [] });
    const text = statementOf(cite('complete', 'c1'), [call]) ?? '';
    expect(text).toContain('`INC-11`, and 18 more; no cap reached, one page.');
    expect(text).not.toContain('INC-12');
  });

  it('the identity column a tool declares names the rows', () => {
    const call: TurnCall = {
      ...incidentCall({
        emptiness: 'non-empty',
        rows: 2,
        rowsRead: [{ incident_id: 'A-1' }, { incident_id: 'A-2' }],
        gaps: [],
      }),
      idColumn: 'incident_id',
    };
    expect(statementOf(cite('complete', 'c1'), [call])).toContain('rows `A-1`, `A-2`;');
  });
});

// ── Property ─────────────────────────────────────────────────────────────────────────────────

/** mulberry32 — this repo carries no fast-check; a seeded generator is the precedent. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The template's own words — written here, independently of `statement.ts`. */
const TEMPLATE_WORDS = new Set(
  (
    'found none as the tool names them subject for scope any source window held in full part ' +
    'not undeclared unknown checked did find among read rows no cap reached one page and more z'
  ).split(' '),
);

const HOSTILE = [
  '`',
  '\n',
  '\r',
  '\u0007',
  '\u{2028}',
  '\u{202E}',
  '\u{200B}',
  '— ',
  '; not checked: ',
  ' (held in full)',
];

describe('PROPERTY — the statement is one line per clause, quotes every row value, says nothing else', () => {
  const SEEDS = Array.from({ length: 80 }, (_, i) => 9001 + i);

  it.each(SEEDS)('seed %i', (seed) => {
    const rand = mulberry32(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
    const decoyIds: string[] = [];
    const marker = (tag: string) => {
      const length = Math.floor(rand() * 120);
      const id = `${tag}${Math.floor(rand() * 1e9).toString(36)}x`;
      if (tag === 'd') decoyIds.push(id);
      let text = id;
      while (text.length < length) text += rand() < 0.3 ? pick(HOSTILE) : 'm';
      return text;
    };
    const rowWith = (tag: string, id: string): ComposedSearchRow => {
      const base = incidentRow({
        id,
        gaps: Array.from({ length: Math.floor(rand() * 20) }, () => ({
          kind: 'scope' as const,
          what: marker(tag),
          bears: 'source' as const,
        })),
        held: pick(['none', 'unknown', { from: '2026-10-22T09:00:00Z', to: CLOCK }] as const),
      });
      return {
        ...base,
        toolName: marker(tag),
        checked: base.checked.map((item) => ({
          ...item,
          what: marker(tag),
          ...(item.argument === undefined ? {} : { argument: marker(tag) }),
          ...(item.value === undefined ? {} : { value: marker(tag) }),
        })),
      };
    };
    const kind = pick(['none', 'complete'] as const);
    const rowsRead = Array.from({ length: Math.floor(rand() * 30) }, () => ({
      entity: marker('q'),
    }));
    const cited: TurnCall = {
      ...incidentCall({
        id: 'c1',
        emptiness: kind === 'none' ? 'declared-absent' : 'non-empty',
        rows: rowsRead.length,
        rowsRead,
      }),
      row: rowWith('q', 'c1'),
    };
    const decoy: TurnCall = {
      ...incidentCall({ id: 'c9', service: 'elsewhere' }),
      row: rowWith('d', 'c9'),
    };
    const [judged] = judgeTypedNegatives({
      field: 'negatives',
      negatives: cite(kind, 'c1'),
      record: turnRecord([cited, decoy]),
    });
    expect(judged?.row.code).toBe('established');
    const statement = judged?.statement;
    expect(statement).toBeDefined();
    const { clauses = [], text = '' } = statement ?? {};

    expect(text).toBe(clauses.join('\n'));
    for (const clause of clauses) {
      expect(clause).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
      expect(clause.length).toBeLessThanOrEqual(STATEMENT_LIMITS.clauseChars);
      // Outside the quotes, only the template's words, numbers and time punctuation remain.
      const parts = clause.split('`');
      expect(parts.length % 2, clause).toBe(1);
      const unquoted = parts.filter((_, i) => i % 2 === 0).join(' ');
      for (const word of unquoted.toLowerCase().match(/[\p{L}]+/gu) ?? []) {
        expect(TEMPLATE_WORDS.has(word), `"${word}" unquoted in: ${clause}`).toBe(true);
      }
      // Inside the quotes, every value is capped.
      for (const quoted of parts.filter((_, i) => i % 2 === 1)) {
        expect(quoted.length).toBeLessThanOrEqual(STATEMENT_LIMITS.valueChars + 1);
      }
    }
    // Never a word of a read it does not cite.
    for (const id of decoyIds) expect(text).not.toContain(id);
  });
});
