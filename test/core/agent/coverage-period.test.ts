/**
 * `coverage/period.ts` — the ONE period shape, its ONE rule set, and the ONE
 * verdict (honesty layer 3, step 7b).
 *
 * The properties under test:
 *   1. ONE RULE SET. `periodProblem` decides what a well-formed period is, and
 *      every door asks it: the mint refuses (`mintPeriod`, `refused: …` in the
 *      author's camelCase), the reader reads without repair (`readPeriod`,
 *      the wire's snake_case). A mint and a read cannot disagree.
 *   2. INSTANTS, EXACTLY. An ISO 8601 instant WITH a zone, compared as an
 *      instant — offsets folded, fractions to the nanosecond, years before 100
 *      kept, impossible days refused. No clock is read; no duration is parsed.
 *   3. ONE VERDICT. `periodVerdict` over the declared instants, bounds
 *      inclusive: covered · partly-held · not-held · unknown.
 *
 * Sections follow Convention 3: Unit (the rule set, field by field; the
 * verdict; the line; the row's door) · Boundary (the edges of an instant and of
 * a span) · Property (seeded random periods against a reference comparison;
 * mint ∘ read round-trips) · Security (a refusal never copies a document; the
 * line's words are static around the tool's own instants). Integration lives in
 * test/core/agent/results/layer.test.ts; performance in
 * test/core/agent/results/performance.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  leastHeld,
  mintPeriod,
  PERIOD_ROW_VERDICTS,
  PERIOD_WIRE,
  periodLine,
  periodProblem,
  periodRowIsWellFormed,
  periodVerdict,
  readPeriod,
  type DeclaredPeriod,
} from '../../../src/core/agent/coverage/period.js';
import { REFUSED_PREFIX } from '../../../src/core/agent/coverage/refusal.js';
import * as barrel from '../../../src/index.js';

const span = (from: string, to: string) => ({ from, to });
const Q = span('2026-09-26T09:00:00Z', '2026-09-26T10:00:00Z');
const HELD = span('2026-08-27T02:00:00Z', '2026-09-26T02:00:00Z');

const refusalOf = (mint: () => unknown): string => {
  try {
    mint();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal, and the mint accepted it');
};

// ─────────────────────────────────────────────────────────────────────────
// Unit — the rule set
// ─────────────────────────────────────────────────────────────────────────

describe('unit: the rule set — what a well-formed period is', () => {
  it('accepts a queried span, a held span or the literal unknown, and an optional readAt', () => {
    expect(periodProblem({ queried: Q, held: HELD }, 'camel')).toBeUndefined();
    expect(periodProblem({ queried: Q, held: 'unknown' }, 'camel')).toBeUndefined();
    expect(
      periodProblem({ queried: Q, held: HELD, readAt: '2026-09-26T10:00:03Z' }, 'camel'),
    ).toBeUndefined();
    expect(
      periodProblem({ queried: Q, held: HELD, read_at: '2026-09-26T10:00:03Z' }, 'wire'),
    ).toBeUndefined();
  });

  it('refuses a period that is not an object, naming the keys it has in the reader’s spelling', () => {
    expect(periodProblem('last hour', 'camel')).toEqual({
      field: 'period',
      message: '`period` must be { queried, held, readAt? } — got "last hour".',
    });
    expect(periodProblem([Q], 'wire')?.message).toContain('{ queried, held, read_at? }');
  });

  it('refuses an unknown key, naming the spelling meant when it is a casing slip', () => {
    expect(
      periodProblem({ queried: Q, held: HELD, read_at: '2026-09-26T10:00:03Z' }, 'camel'),
    ).toEqual({
      field: 'period.read_at',
      message:
        "'period.read_at' is not a field this vocabulary has — did you mean `readAt`? The " +
        'fields of `period` are: queried, held, readAt.',
    });
    expect(periodProblem({ queried: Q, held: HELD, readAt: 'x' }, 'wire')?.message).toContain(
      'did you mean `read_at`?',
    );
    expect(periodProblem({ queried: Q, held: HELD, window: '2h' }, 'camel')?.message).toBe(
      "'period.window' is not a field this vocabulary has. The fields of `period` are: queried, held, readAt.",
    );
    expect(periodProblem({ queried: { ...Q, until: 'x' }, held: HELD }, 'camel')?.field).toBe(
      'period.queried.until',
    );
  });

  it('refuses a missing queried and a missing held, saying what each one is', () => {
    expect(periodProblem({ held: HELD }, 'camel')?.field).toBe('period.queried');
    expect(periodProblem({ queried: Q }, 'camel')).toMatchObject({
      field: 'period.held',
      message: expect.stringContaining("or 'unknown' said out loud"),
    });
    expect(periodProblem({ queried: Q, held: null }, 'camel')?.field).toBe('period.held');
  });

  it('refuses a held that is any other word — only the literal unknown is a word here', () => {
    expect(periodProblem({ queried: Q, held: 'all of it' }, 'camel')).toEqual({
      field: 'period.held',
      message: '`period.held` is "all of it" — it must be { from, to } or the literal \'unknown\'.',
    });
    expect(periodProblem({ queried: Q, held: 'UNKNOWN' }, 'camel')?.field).toBe('period.held');
  });

  it('refuses a span that runs backwards, and accepts a point (from equal to to)', () => {
    expect(
      periodProblem(
        { queried: span('2026-09-26T10:00:00Z', '2026-09-26T09:00:00Z'), held: HELD },
        'camel',
      ),
    ).toEqual({
      field: 'period.queried',
      message:
        '`period.queried.from` (2026-09-26T10:00:00Z) is after `period.queried.to` ' +
        '(2026-09-26T09:00:00Z) — a span runs forward.',
    });
    expect(
      periodProblem(
        { queried: span('2026-09-26T10:00:00Z', '2026-09-26T10:00:00Z'), held: HELD },
        'camel',
      ),
    ).toBeUndefined();
  });

  it('refuses a value that is not an instant with a zone — never guessed', () => {
    for (const bad of [
      '2026-09-26T08:00:00', // no zone: any of 24 hours
      '2026-09-26', // a date, not an instant
      '2026-09-26 08:00:00Z', // a space is not ISO 8601
      'yesterday',
      '1727337600', // an epoch in a string is not ISO 8601
      '2026-02-30T00:00:00Z', // a day that does not exist
      '2026-09-26T24:00:00Z',
      '2026-09-26T08:60:00Z',
      '2026-09-26T08:00:00+24:00',
      '2026-9-26T08:00:00Z',
    ]) {
      const problem = periodProblem(
        { queried: span(bad, '2026-09-26T10:00:00Z'), held: HELD },
        'camel',
      );
      expect(problem?.field, bad).toBe('period.queried.from');
      expect(problem?.message, bad).toContain('must be an ISO 8601 instant with a zone');
    }
    expect(
      periodProblem({ queried: span(1727337600 as never, Q.to), held: HELD }, 'camel')?.field,
    ).toBe('period.queried.from');
  });
});

describe('unit: the doors — mint refuses, read never repairs', () => {
  it('mintPeriod: the wire spelling, a fresh object, readAt → read_at, key order fixed', () => {
    const declared = { readAt: '2026-09-26T10:00:03Z', held: HELD, queried: Q };
    const wire = mintPeriod(declared)!;
    expect(JSON.stringify(wire)).toBe(
      '{"queried":{"from":"2026-09-26T09:00:00Z","to":"2026-09-26T10:00:00Z"},' +
        '"held":{"from":"2026-08-27T02:00:00Z","to":"2026-09-26T02:00:00Z"},' +
        '"read_at":"2026-09-26T10:00:03Z"}',
    );
    expect(wire.queried).not.toBe(declared.queried);
    expect(mintPeriod({ queried: Q, held: 'unknown' })).toEqual({ queried: Q, held: 'unknown' });
  });

  it('mintPeriod: undefined and null are "not declared"', () => {
    expect(mintPeriod(undefined)).toBeUndefined();
    expect(mintPeriod(null)).toBeUndefined();
  });

  it('mintPeriod: every refusal starts refused: and names the field the author wrote', () => {
    expect(refusalOf(() => mintPeriod({ queried: Q, held: HELD, read_at: 'x' }))).toBe(
      `${REFUSED_PREFIX}'period.read_at' is not a field this vocabulary has — did you mean ` +
        '`readAt`? The fields of `period` are: queried, held, readAt.',
    );
    expect(refusalOf(() => mintPeriod({ queried: Q, held: HELD, readAt: 'now' }))).toMatch(
      /^refused: `period\.readAt` must be an ISO 8601 instant with a zone/,
    );
  });

  it('readPeriod: the record’s camelCase form; a malformed period comes back as a problem', () => {
    expect(readPeriod({ queried: Q, held: HELD, read_at: '2026-09-26T10:00:03Z' })).toEqual({
      period: { queried: Q, held: HELD, readAt: '2026-09-26T10:00:03Z' },
    });
    expect(readPeriod(undefined)).toEqual({});
    expect(readPeriod(null)).toEqual({});
    const bad = readPeriod({ queried: Q, held: 'soon' });
    expect(bad.period).toBeUndefined();
    expect(bad.problem?.field).toBe('period.held');
  });

  it('the wire spelling is published as data — every key and the literal unknown', () => {
    expect(PERIOD_WIRE).toEqual({
      key: 'period',
      queried: 'queried',
      held: 'held',
      from: 'from',
      to: 'to',
      readAt: 'read_at',
      heldUnknown: 'unknown',
    });
    expect(Object.isFrozen(PERIOD_WIRE)).toBe(true);
    // …and the mint really spells the wire that way.
    const wire = mintPeriod({ queried: Q, held: 'unknown', readAt: Q.to }) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(wire)).toEqual([PERIOD_WIRE.queried, PERIOD_WIRE.held, PERIOD_WIRE.readAt]);
    expect(wire[PERIOD_WIRE.held]).toBe(PERIOD_WIRE.heldUnknown);
  });

  it('the barrel publishes the shape, the rule, the wire and the row — and nothing internal', () => {
    expect(barrel.periodVerdict).toBe(periodVerdict);
    expect(barrel.PERIOD_WIRE).toBe(PERIOD_WIRE);
    expect('mintPeriod' in barrel).toBe(false);
    expect('periodProblem' in barrel).toBe(false);
  });
});

describe('unit: the verdict — one pure rule over the declared instants', () => {
  const verdict = (queried: { from: string; to: string }, held: DeclaredPeriod['held']) =>
    periodVerdict({ queried, held });

  it('covered — the store holds every instant asked for (bounds inclusive)', () => {
    expect(verdict(Q, span('2026-09-26T00:00:00Z', '2026-09-26T12:00:00Z'))).toBe('covered');
    expect(verdict(Q, Q)).toBe('covered');
  });

  it('not-held — the data ends before, or starts after, the period asked about', () => {
    expect(verdict(Q, HELD)).toBe('not-held'); // the 02:00 export, asked about 09:00–10:00
    expect(verdict(Q, span('2026-09-26T10:00:01Z', '2026-09-27T00:00:00Z'))).toBe('not-held');
  });

  it('partly-held — some of it: an overlap on either side, or a store inside the period', () => {
    expect(verdict(Q, span('2026-09-26T09:30:00Z', '2026-09-26T12:00:00Z'))).toBe('partly-held');
    expect(verdict(Q, span('2026-09-26T00:00:00Z', '2026-09-26T09:30:00Z'))).toBe('partly-held');
    expect(verdict(Q, span('2026-09-26T09:15:00Z', '2026-09-26T09:45:00Z'))).toBe('partly-held');
    // touching at one instant is holding that instant — inclusive bounds.
    expect(verdict(Q, span('2026-09-26T00:00:00Z', '2026-09-26T09:00:00Z'))).toBe('partly-held');
  });

  it('unknown — the tool said it cannot vouch for what the store holds', () => {
    expect(verdict(Q, 'unknown')).toBe('unknown');
  });

  it('compares INSTANTS: an offset is folded, never read as a local clock', () => {
    // 11:00+02:00 is 09:00Z — the same instant as the queried start.
    expect(verdict(Q, span('2026-09-26T11:00:00+02:00', '2026-09-26T12:00:00+02:00'))).toBe(
      'covered',
    );
    expect(verdict(Q, span('2026-09-26T11:00:01+02:00', '2026-09-26T12:00:00+02:00'))).toBe(
      'partly-held',
    );
  });

  it('keeps the fraction to the nanosecond — two instants one nanosecond apart differ', () => {
    const q = span('2026-09-26T09:00:00.000000001Z', '2026-09-26T09:00:00.000000002Z');
    expect(
      verdict(q, span('2026-09-26T09:00:00.000000001Z', '2026-09-26T09:00:00.000000002Z')),
    ).toBe('covered');
    expect(
      verdict(q, span('2026-09-26T09:00:00.000000002Z', '2026-09-26T09:00:00.000000003Z')),
    ).toBe('partly-held');
    expect(
      verdict(q, span('2026-09-26T09:00:00.000000003Z', '2026-09-26T09:00:00.000000009Z')),
    ).toBe('not-held');
  });

  it('throws a TypeError naming the fault when handed a period that is not well formed', () => {
    expect(() => periodVerdict({ queried: Q, held: 'soon' as never })).toThrow(
      /^periodVerdict: `period\.held` is "soon"/,
    );
  });

  it('leastHeld: a call that declared two periods gets the least held — never more than the weakest', () => {
    expect(leastHeld(['covered', 'not-held'])).toBe('not-held');
    expect(leastHeld(['unknown', 'partly-held', 'covered'])).toBe('partly-held');
    expect(leastHeld(['covered', 'unknown'])).toBe('unknown');
    expect(leastHeld(['covered'])).toBe('covered');
    expect(leastHeld([])).toBeUndefined();
  });
});

describe('unit: the person’s line — the period as the tool declared it', () => {
  it('queried and held, instants verbatim, no verdict word', () => {
    expect(periodLine('backup_runs', { queried: Q, held: HELD })).toBe(
      'backup_runs queried 2026-09-26T09:00:00Z to 2026-09-26T10:00:00Z; the store holds ' +
        '2026-08-27T02:00:00Z to 2026-09-26T02:00:00Z',
    );
  });

  it('held unknown, said out loud; readAt when declared', () => {
    expect(
      periodLine('search_logs', { queried: Q, held: 'unknown', readAt: '2026-09-26T10:00:03Z' }),
    ).toBe(
      'search_logs queried 2026-09-26T09:00:00Z to 2026-09-26T10:00:00Z; what the store holds ' +
        'is unknown (read at 2026-09-26T10:00:03Z)',
    );
  });
});

describe('unit: the row’s door — the checkpoint refuses what the layer never files', () => {
  const row = {
    kind: 'period',
    turn: 1,
    toolCallId: 'c1',
    toolName: 'backup_runs',
    iteration: 1,
    verdict: 'not-held',
  };

  it('accepts every verdict the layer files, with or without the ToolPeriod’s argument', () => {
    for (const verdict of PERIOD_ROW_VERDICTS) {
      expect(periodRowIsWellFormed({ ...row, verdict }), verdict).toBe(true);
    }
    expect(periodRowIsWellFormed({ ...row, argument: 'window' })).toBe(true);
  });

  it('refuses a missing stamp, an unknown verdict, an empty argument, a non-numeric turn', () => {
    expect(periodRowIsWellFormed({ ...row, verdict: 'held' })).toBe(false);
    expect(periodRowIsWellFormed({ ...row, turn: '1' })).toBe(false);
    expect(periodRowIsWellFormed({ ...row, argument: '' })).toBe(false);
    const { toolName: _toolName, ...noName } = row;
    void _toolName;
    expect(periodRowIsWellFormed(noName)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Boundary — the edges of an instant and of a span
// ─────────────────────────────────────────────────────────────────────────

describe('boundary: the edges of an instant', () => {
  const ok = (at: string): boolean =>
    periodProblem({ queried: span(at, at), held: 'unknown' }, 'camel') === undefined;

  it('accepts: seconds omitted, a 9-digit fraction, -00:00, lower-case t and z, a leap second', () => {
    expect(ok('2026-09-26T08:00Z')).toBe(true);
    expect(ok('2026-09-26T08:00:00.123456789Z')).toBe(true);
    expect(ok('2026-09-26T08:00:00-00:00')).toBe(true);
    expect(ok('2026-09-26t08:00:00z')).toBe(true);
    expect(ok('2016-12-31T23:59:60Z')).toBe(true);
    expect(ok('2026-09-26T08:00:00+23:59')).toBe(true);
  });

  it('refuses: a 10-digit fraction, a fraction with no seconds, a 3-digit offset hour', () => {
    expect(ok('2026-09-26T08:00:00.1234567890Z')).toBe(false);
    expect(ok('2026-09-26T08:00.5Z')).toBe(false);
    expect(ok('2026-09-26T08:00:00+123:00')).toBe(false);
  });

  it('leap years: 29 February exists in 2024 and 2000, not in 2023 or 1900', () => {
    expect(ok('2024-02-29T00:00:00Z')).toBe(true);
    expect(ok('2000-02-29T00:00:00Z')).toBe(true);
    expect(ok('2023-02-29T00:00:00Z')).toBe(false);
    expect(ok('1900-02-29T00:00:00Z')).toBe(false);
  });

  it('years before 100 are those years — never read as 19xx', () => {
    // Year 0099 is BEFORE 1999: a span from 1999 back to 0099 runs backwards.
    expect(
      periodProblem(
        { queried: span('1999-01-01T00:00:00Z', '0099-01-01T00:00:00Z'), held: 'unknown' },
        'camel',
      )?.message,
    ).toContain('a span runs forward');
    expect(ok('0001-01-01T00:00:00Z')).toBe(true);
    expect(ok('9999-12-31T23:59:59Z')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property — seeded random periods against a reference comparison
// ─────────────────────────────────────────────────────────────────────────

describe('property: the verdict agrees with a reference comparison, and mint ∘ read round-trips', () => {
  let seed = 7_2026_0927;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const int = (n: number): number => Math.floor(rnd() * n);
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');

  /** A random instant on one day, as nanoseconds since midnight (BigInt), and its ISO spelling with a random offset. */
  const instant = (): { ns: bigint; iso: string } => {
    const seconds = int(24 * 3600);
    const nanos = int(1_000_000_000);
    const offsetMinutes = (int(2) === 0 ? 1 : -1) * int(14 * 60 + 1);
    const local = seconds + offsetMinutes * 60 + 24 * 3600; // shift into a positive local clock
    const day = 25 + Math.floor(local / 86400);
    const inDay = local % 86400;
    const off =
      offsetMinutes === 0
        ? 'Z'
        : `${offsetMinutes > 0 ? '+' : '-'}${pad(
            Math.floor(Math.abs(offsetMinutes) / 60),
            2,
          )}:${pad(Math.abs(offsetMinutes) % 60, 2)}`;
    const iso = `2026-09-${pad(day, 2)}T${pad(Math.floor(inDay / 3600), 2)}:${pad(
      Math.floor((inDay % 3600) / 60),
      2,
    )}:${pad(inDay % 60, 2)}.${pad(nanos, 9)}${off}`;
    return { ns: BigInt(seconds) * 1_000_000_000n + BigInt(nanos), iso };
  };
  const ordered = () => {
    const a = instant();
    const b = instant();
    return a.ns <= b.ns ? [a, b] : [b, a];
  };

  it('2,000 periods: periodVerdict equals the reference over exact nanoseconds', () => {
    for (let i = 0; i < 2000; i += 1) {
      const [qf, qt] = ordered();
      const [hf, ht] = ordered();
      const unknown = int(10) === 0;
      const reference = unknown
        ? 'unknown'
        : hf!.ns <= qf!.ns && qt!.ns <= ht!.ns
        ? 'covered'
        : qt!.ns < hf!.ns || qf!.ns > ht!.ns
        ? 'not-held'
        : 'partly-held';
      const period: DeclaredPeriod = {
        queried: span(qf!.iso, qt!.iso),
        held: unknown ? 'unknown' : span(hf!.iso, ht!.iso),
      };
      expect(periodVerdict(period), JSON.stringify(period)).toBe(reference);
    }
  });

  it('2,000 periods: read(mint(p)) is p — the two doors agree on every well-formed period', () => {
    for (let i = 0; i < 2000; i += 1) {
      const [qf, qt] = ordered();
      const [hf, ht] = ordered();
      const period: DeclaredPeriod = {
        queried: span(qf!.iso, qt!.iso),
        held: int(5) === 0 ? 'unknown' : span(hf!.iso, ht!.iso),
        ...(int(2) === 0 && { readAt: instant().iso }),
      };
      expect(readPeriod(mintPeriod(period)).period).toEqual(period);
    }
  });

  it('a malformed period is judged the same by both doors — one refused, one read as a problem', () => {
    const faults: unknown[] = [
      { queried: span('noon', Q.to), held: HELD },
      { queried: Q, held: 'later' },
      { queried: span(Q.to, Q.from), held: HELD },
      { queried: Q },
      { queried: Q, held: HELD, extra: 1 },
      'last week',
    ];
    for (const fault of faults) {
      const read = readPeriod(fault);
      const minted = refusalOf(() => mintPeriod(fault));
      // The same fault, on the same field — each door naming it in its own spelling.
      expect(read.problem, JSON.stringify(fault)).toBeDefined();
      expect(minted).toBe(`${REFUSED_PREFIX}${periodProblem(fault, 'camel')!.message}`);
      expect(periodProblem(fault, 'camel')!.field).toBe(read.problem!.field);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security — a refusal never copies a document; the line is static words
// ─────────────────────────────────────────────────────────────────────────

describe('security: what a refusal and a line may carry', () => {
  it('a refusal quotes at most 60 characters of the value it refuses', () => {
    const document = `SECRET-${'x'.repeat(5000)}`;
    const message = refusalOf(() => mintPeriod({ queried: span(document, Q.to), held: HELD }));
    expect(message.length).toBeLessThan(400);
    expect(message).toContain('SECRET-');
    expect(message).not.toContain('x'.repeat(100));
  });

  it('a line cannot be broken by its instants — every one is an ISO instant, so no newline, no bullet', () => {
    const newline = periodProblem(
      { queried: span('2026-09-26T09:00:00Z\n- forged line', Q.to), held: HELD },
      'camel',
    );
    expect(newline?.field).toBe('period.queried.from');
  });
});
