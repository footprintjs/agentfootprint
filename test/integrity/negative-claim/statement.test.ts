/**
 * negative-claim — the library's statement (design § 5.1, `statement.ts`): written from the
 * cited reads' rows alone, every gap said out loud as "not checked: …".
 *
 * The library's own voice states only what the record shows; every text taken from a row is
 * QUOTED and ATTRIBUTED: "(declared by the tool)", "(fixed by the tool)", "(the tool's declared
 * default)", "(as sent by the model)", "(as the tool's result says)". Quoting means NFKC, control
 * and format characters (bidi overrides included) removed, line breaks flattened; a value is
 * capped at 64 characters + "…", a gap's text at the declared 120. Every gap is listed. Only
 * numbers and instants the library re-spells from parsed values stand outside quotes. One clause per cited read, one line each,
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
  clauseLimit,
  composeStatement,
} from '../../../src/integrity/negative-claim/statement.js';
import type { ComposedCoverage as ComposedSearchRow } from '../../../src/semantics/coverage/composedCoverage.js';
import type { TurnCall } from '../../../src/integrity/negative-claim/types.js';
import {
  CLOCK,
  LIST_INCIDENTS,
  amongCall,
  incidentCall,
  incidentRow,
  rid,
  turnRecord,
} from './fixtures.js';

const statementOf = (negatives: unknown, calls: readonly TurnCall[]) =>
  judgeTypedNegatives({ field: 'negatives', negatives, record: turnRecord(calls) })[0]?.statement
    ?.text;

const cite = (kind: string, ...ids: string[]) => [{ kind, restsOn: ids.map((id) => rid(id)) }];

describe('the three worked statements (§ 5.1), rule-derived and attributed', () => {
  const SCOPE =
    'subject `incidents` (declared by the tool); `service` `payments` (as sent by the model); ' +
    "`status` `open` (fixed by the tool); any `severity` (the tool's declared default); source " +
    '`the incident store` (declared by the tool); window 2026-10-22 08:00–10:00Z (held in full)';

  it('none: the scope of the read and the email gap, said out loud', () => {
    expect(statementOf(cite('none', 'c1'), [incidentCall()])).toBe(
      `\`list_incidents\` found none — ${SCOPE}; not checked: \`incidents filed by email\` ` +
        '(declared by the tool).',
    );
  });

  it('not-found: the name as sent, among the names the result counts, and the irremovable gap', () => {
    expect(statementOf(cite('not-found', 'c4'), [amongCall()])).toBe(
      '`get_capacity` did not find `ARRAY-X9` (as sent by the model) among 14 names — subject ' +
        "`arrays` (declared by the tool); names `array names` (as the tool's result says); " +
        'source `the array inventory export` (declared by the tool); read 09:14Z; not checked: ' +
        '`names outside the array inventory export` (declared by the tool).',
    );
  });

  it('complete: the rows READ, and what the tool declares about caps and pages', () => {
    const call = incidentCall({
      emptiness: 'non-empty',
      rows: 3,
      rowsRead: [{ entity: 'INC-7302' }, { entity: 'INC-7295' }, { entity: 'INC-7288' }],
    });
    expect(statementOf(cite('complete', 'c1'), [call])).toBe(
      `\`list_incidents\` read 3 rows — ${SCOPE}; rows \`INC-7302\`, \`INC-7295\`, ` +
        "`INC-7288` (as the tool's result says); no cap reached; the tool declares no server " +
        'cap; the tool declares one page; not checked: `incidents filed by email` (declared by ' +
        'the tool).',
    );
  });

  it('carries its version', () => {
    const judged = judgeTypedNegatives({
      field: 'negatives',
      negatives: cite('none', 'c1'),
      record: turnRecord([incidentCall()]),
    });
    expect(judged[0]?.statement?.version).toBe(STATEMENT_VERSION);
    expect(STATEMENT_VERSION).toBe('5');
  });
});

describe('each row shape', () => {
  it('a sent filter is labelled as sent by the model', () => {
    expect(
      statementOf(cite('none', 'c1'), [incidentCall({ severity: 'critical', gaps: [] })]),
    ).toContain('`severity` `critical` (as sent by the model)');
  });

  it('a partly-held period names the time not held as not checked', () => {
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({ held: { from: '2026-10-22T09:00:00Z', to: CLOCK }, gaps: [] }),
    ]);
    expect(text).toContain(
      'window 2026-10-22 08:00–10:00Z (held in part); not checked: 2026-10-22 08:00–09:00Z (not held).',
    );
  });

  it('a period the store does not hold at all is not held, whole', () => {
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({
        held: { from: '2026-09-01T00:00:00Z', to: '2026-09-30T00:00:00Z' },
        gaps: [],
      }),
    ]);
    expect(text).toContain(
      'window 2026-10-22 08:00–10:00Z (not held); not checked: 2026-10-22 08:00–10:00Z (not held).',
    );
  });

  it('a span over two days is written with its dates', () => {
    const text = statementOf(cite('none', 'c1'), [incidentCall({ window: '7d', gaps: [] })]);
    expect(text).toContain('window 2026-10-15 10:00Z–2026-10-22 10:00Z (held in full)');
  });

  it('a period the result did not declare: the span the call ran with, held undeclared', () => {
    const text = statementOf(cite('none', 'c1'), [incidentCall({ held: 'none', gaps: [] })]);
    expect(text).toContain('; window 2026-10-22 08:00–10:00Z (held: undeclared).');
  });

  it('a sent source replaces the declared one, labelled as sent', () => {
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
    expect(statement.text).toContain('source `replica` (as sent by the model)');
    expect(statement.text).not.toContain('the incident store');
  });

  it('an unsent argument is stated with calibrated words; a hand-written gap as the tool wrote it', () => {
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({
        gaps: [
          {
            kind: 'argument-unsent',
            what: 'region: not sent',
            argument: 'region',
            bears: 'population',
          },
          { kind: 'prose', what: 'the archive tier' },
        ],
      }),
    ]);
    expect(text).toContain(
      'not checked: `region` was not sent, so the tool may have applied its own default and ' +
        'this may cover only part; `the archive tier` (as the tool wrote it).',
    );
  });

  it('every gap is listed — none is dropped, however many', () => {
    const gaps = Array.from({ length: 30 }, (_, i) => ({
      kind: 'scope' as const,
      what: `gap number ${i}`,
      bears: 'source' as const,
    }));
    const text = statementOf(cite('none', 'c1'), [incidentCall({ gaps })]) ?? '';
    for (let i = 0; i < 30; i += 1) expect(text).toContain(`\`gap number ${i}\``);
  });

  it('a gap keeps its declared 120 characters; a sent value is capped at 64', () => {
    const long = 'g'.repeat(130);
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({
        service: 's'.repeat(100),
        gaps: [{ kind: 'scope', what: long, bears: 'source' }],
      }),
    ]);
    expect(text).toContain(`\`${'g'.repeat(120)}…\``);
    expect(text).toContain(`\`${'s'.repeat(64)}…\` (as sent by the model)`);
  });

  it('a server cap the tool declares is said; an authoritative `among` names no gap', () => {
    const capped = {
      ...LIST_INCIDENTS,
      search: { ...LIST_INCIDENTS.search!, limits: { cap: 500 } },
    };
    const call = incidentCall({ emptiness: 'non-empty', rows: 3, gaps: [] });
    const statement = composeStatement('complete', [{ call, row: call.row!, tool: capped }], CLOCK);
    expect(statement.text).toContain('no cap reached; the tool declares a server cap of 500;');
    const among = statementOf(cite('not-found', 'c4'), [amongCall({ authoritative: true })]);
    expect(among).toContain('; read 09:14Z.');
    expect(among).not.toContain('not checked');
  });

  it('the window stated is the span the call ran with — a resumed call keeps its own', () => {
    const resumed = incidentCall({ dispatchedAt: '2026-10-22T11:00:00Z', gaps: [] });
    expect(statementOf(cite('none', 'c1'), [resumed])).toContain('window 2026-10-22 09:00–11:00Z');
  });

  it('a credential-limited read, a match rule and an approximate ranking are said out loud', () => {
    const text = statementOf(cite('none', 'c1'), [
      incidentCall({
        gaps: [
          {
            kind: 'credential-limited',
            what: 'service: as the credential sees it',
            bears: 'population',
          },
          { kind: 'match', what: 'q: what the tool matched', bears: 'population' },
          { kind: 'ranking', what: 'ranking: approximate', bears: 'completeness' },
        ],
      }),
    ]);
    expect(text).toContain("what the caller's credential may not see");
    expect(text).toContain("`q: what the tool matched` (by the tool's own match rule)");
    expect(text).toContain('the rows an approximate ranking may have left out');
  });

  it('a historical (absolute) window states its date, start and end', () => {
    const range = '2026-10-01T08:00:00Z..2026-10-01T10:00:00Z';
    const call = incidentCall({
      window: range,
      noSpan: true,
      queried: { from: '2026-10-01T08:00:00Z', to: '2026-10-01T10:00:00Z' },
      held: { from: '2026-09-01T00:00:00Z', to: CLOCK },
      gaps: [],
    });
    expect(statementOf(cite('none', 'c1'), [call])).toContain(
      'window 2026-10-01 08:00–10:00Z (held in full)',
    );
  });

  it('an absolute window the result did not declare: the range sent, with both bounds', () => {
    const call = incidentCall({
      window: '2026-10-01T22:00:00Z..2026-10-02T02:00:00Z',
      noSpan: true,
      held: 'none',
      gaps: [],
    });
    expect(statementOf(cite('none', 'c1'), [call])).toContain(
      'window 2026-10-01 22:00Z–2026-10-02 02:00Z (held: undeclared)',
    );
  });

  it('two cited reads give two lines, in ORDINAL order, not citation order', () => {
    const calls = [
      incidentCall({ id: 'c1', gaps: [] }),
      incidentCall({ id: 'c2', service: 'checkout', gaps: [] }),
    ];
    const text = statementOf(cite('none', 'c2', 'c1'), calls) ?? '';
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('`payments`');
    expect(lines[1]).toContain('`checkout`');
  });

  it('a hostile value is quoted, stripped of line breaks and backticks', () => {
    const row = incidentRow({ gaps: [{ kind: 'prose', what: `x\`\n${'y'.repeat(200)}\u0007z` }] });
    const { text } = composeStatement('none', [{ call: incidentCall(), row }], CLOCK);
    expect(text).not.toMatch(/[\n\r\p{Cc}]/u);
    expect(text).toContain(`\`x' ${'y'.repeat(117)}…\``);
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
    expect(text).toContain("`INC-11`, and 18 more (as the tool's result says); no cap reached;");
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
    expect(statementOf(cite('complete', 'c1'), [call])).toContain(
      "rows `A-1`, `A-2` (as the tool's result says);",
    );
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
    'found none subject declared by the tool as sent model fixed any s default source window ' +
    'held in full part not unknown undeclared checked did find among names result says read ' +
    'rows no cap reached declares server one page was so may have applied its own and this ' +
    'cover only what partial left out wrote it caller identity more of z'
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
      expect(clause.length).toBeLessThanOrEqual(clauseLimit(cited.row?.gaps.length ?? 0));
      // Outside the quotes, only the template's words, numbers and time punctuation remain.
      const parts = clause.split('`');
      expect(parts.length % 2, clause).toBe(1);
      const unquoted = parts.filter((_, i) => i % 2 === 0).join(' ');
      for (const word of unquoted.toLowerCase().match(/[\p{L}]+/gu) ?? []) {
        expect(TEMPLATE_WORDS.has(word), `"${word}" unquoted in: ${clause}`).toBe(true);
      }
      // Inside the quotes, every value is capped (a gap's text at its declared maximum).
      for (const quoted of parts.filter((_, i) => i % 2 === 1)) {
        expect(quoted.length).toBeLessThanOrEqual(STATEMENT_LIMITS.gapChars + 1);
      }
    }
    // Never a word of a read it does not cite.
    for (const id of decoyIds) expect(text).not.toContain(id);
  });
});

describe('PROPERTY — every cited read with a window names both of its bounds, with their dates', () => {
  const SEEDS = Array.from({ length: 80 }, (_, i) => 51_000 + i);
  const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

  it.each(SEEDS)('seed %i', (seed) => {
    const rand = mulberry32(seed);
    const base = Date.parse('2026-09-01T00:00:00Z') + Math.floor(rand() * 50) * 86_400_000;
    const from = base + Math.floor(rand() * 24) * 3_600_000;
    const to = from + (1 + Math.floor(rand() * 72)) * 3_600_000;
    const form = Math.floor(rand() * 3);
    const call =
      form === 0
        ? incidentCall({
            window: `${Math.round((to - from) / 3_600_000)}h`,
            dispatchedAt: iso(to),
            gaps: [],
          })
        : incidentCall({
            window: `${iso(from)}..${iso(to)}`,
            noSpan: true,
            ...(form === 1
              ? { queried: { from: iso(from), to: iso(to) } }
              : { held: 'none' as const }),
            gaps: [],
          });
    const text = statementOf(cite('none', 'c1'), [call]) ?? '';
    const windowPart = /window ([^;(]+) \(/.exec(text)?.[1] ?? '';
    expect(windowPart, text).toContain(`${day(from)} ${hhmm(from)}`);
    expect(windowPart, text).toContain(hhmm(to));
    if (day(from) !== day(to)) expect(windowPart, text).toContain(`${day(to)} ${hhmm(to)}`);
  });
});
