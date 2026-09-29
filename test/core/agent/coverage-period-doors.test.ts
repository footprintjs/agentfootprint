/**
 * The period on the three result doors, and `provenance` on `absent()` (honesty
 * layer 3, step 7b) — minted, recognized, served and filed.
 *
 * The properties under test:
 *   1. ONE SHAPE, THREE DOORS. `absent({ …, period })`, `coverage(v, { …,
 *      period })` and `describedResult({ …, period })` mint the same wire
 *      period (`queried`, `held`, `read_at`) by the one rule set; `semantic()`,
 *      the deprecated door, gains nothing (its unknown-key refusal refuses it).
 *   2. ONE PROVENANCE. `absent({ …, provenance })` takes the shape, the
 *      spelling and the rule set `describedResult()` takes, and mints the same
 *      snake_case wire. `coverage()` takes none (adopted Q34).
 *   3. READ, NEVER REPAIRED. On `af_absent` and `af_coverage` a malformed
 *      period (or an absence's provenance) is left off the record and named
 *      once per tool in dev mode; the model still reads what the tool wrote. On
 *      `af_semantics` it is one more fault — the envelope stays data.
 *   4. THE CHANNEL. `readCoverageResult` carries each declaration's period (and
 *      an absence's provenance); a described result with only a period files a
 *      `'ledger'` fact with three empty lists.
 *   5. SERVED AS DECLARED, PLUS ITS VERDICT (bench round 1). `servedToModel`
 *      strips nothing of it and the projection passes a described result's
 *      period through — with the verdict word inside it and that word's one
 *      clause after the note when the store did not hold all of the time asked
 *      (an absence then drops its completeness claims); nothing is added to a
 *      `covered` period. The tool's own output never carries the word. An
 *      absence's period and provenance ground (tool knowledge, not the
 *      caller's echo); the served word and clause never do.
 *   6. BYTE IDENTITY. A door given no period (and `absent()` no provenance)
 *      mints the bytes it always minted.
 *
 * Sections follow Convention 3: Unit · Functional · Recognition · Security ·
 * Byte identity. The loop is test/core/agent/results/layer.test.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';

import {
  absent,
  coverage,
  describedResult,
  explainSemantics,
  readCoverageResult,
  readSemantics,
  semantic,
  semanticsForModel,
} from '../../../src/index.js';
import { checkSemantics as gate } from '../../../src/lib/semantics/index.js';
import { absenceEvidenceProjection } from '../../../src/core/agent/coverage/evidence.js';
import { ABSENCE_NOTE, ABSENCE_NOTE_HELD_ONLY } from '../../../src/core/agent/coverage/absent.js';
import { COVERAGE_NOTE } from '../../../src/core/agent/coverage/ledger.js';
import {
  _resetPeriodWarnings,
  PERIOD_VERDICT_CLAUSES,
  servedPeriod,
  unservedPeriod,
} from '../../../src/core/agent/coverage/period.js';
import { servedToModel } from '../../../src/core/agent/coverage/read.js';
import { SEMANTICS_NOTE } from '../../../src/lib/semantics/types.js';
import { REFUSED_PREFIX } from '../../../src/core/agent/coverage/refusal.js';

const Q = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
const HELD = { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' };
const PERIOD = { queried: Q, held: HELD, readAt: '2026-09-26T10:00:03Z' };
const WIRE_PERIOD = { queried: Q, held: HELD, read_at: '2026-09-26T10:00:03Z' };
const SOURCE = { measuredAt: '2026-09-26T02:00:00Z', source: 'nightly backup export' };
// One period per verdict, over the same asked-about hour.
const COVERED = { queried: Q, held: { from: '2026-08-27T10:00:00Z', to: '2026-09-26T10:00:00Z' } };
const PARTLY = { queried: Q, held: { from: '2026-08-27T09:30:00Z', to: '2026-09-26T09:30:00Z' } };
const UNKNOWN = { queried: Q, held: 'unknown' as const };
type Camel = { queried: typeof Q; held: typeof Q | 'unknown'; readAt?: string };
const mintedWire = (p: Camel): Record<string, unknown> => ({
  queried: { ...p.queried },
  held: p.held === 'unknown' ? 'unknown' : { ...p.held },
  ...(p.readAt !== undefined && { read_at: p.readAt }),
});

const refusalOf = (mint: () => unknown): string => {
  try {
    mint();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal, and the door minted');
};

afterEach(() => {
  _resetPeriodWarnings();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// Unit — the three doors mint one wire period
// ─────────────────────────────────────────────────────────────────────────

describe('unit: absent({ …, provenance, period })', () => {
  it('mints both on the wire, after the lists and before retry_returns_the_same', () => {
    const minted = absent({
      what: 'failed backup runs for host-103',
      checked: ['every job in the 02:00 export'],
      provenance: SOURCE,
      period: PERIOD,
    });
    expect(Object.keys(minted)).toEqual([
      'af_absent',
      'outcome',
      'looked_for',
      'checked',
      'provenance',
      'period',
      'retry_returns_the_same',
      'note',
    ]);
    expect(minted.provenance).toEqual({
      measured_at: '2026-09-26T02:00:00Z',
      source: 'nightly backup export',
    });
    expect(minted.period).toEqual(WIRE_PERIOD);
  });

  it('provenance: the describedResult() rule set in camelCase — measuredAt and source both required', () => {
    expect(
      refusalOf(() =>
        absent({ what: 'x', checked: ['y'], provenance: { measuredAt: 'now' } as never }),
      ),
    ).toBe(
      `${REFUSED_PREFIX}\`provenance.source\` must name the system of record the values were ` +
        'read from. (field: provenance.source)',
    );
    expect(
      refusalOf(() =>
        absent({
          what: 'x',
          checked: ['y'],
          provenance: { measured_at: 'now', source: 's' } as never,
        }),
      ),
    ).toContain(
      "'provenance.measured_at' is not a field this vocabulary has — did you mean `measuredAt`?",
    );
    expect(
      refusalOf(() =>
        absent({ what: 'x', checked: ['y'], provenance: { ...SOURCE, ageSeconds: -1 } }),
      ),
    ).toContain('`provenance.ageSeconds` must be a finite number ≥ 0 or omitted.');
    expect(
      refusalOf(() => absent({ what: 'x', checked: ['y'], provenance: 'yesterday' as never })),
    ).toContain(
      '`provenance` must be an object ({ measuredAt, source, ageSeconds?, sourceExportDate? }).',
    );
  });

  it('provenance mints the SAME wire describedResult() mints for the same declaration', () => {
    const provenance = { ...SOURCE, ageSeconds: 28_800, sourceExportDate: '2026-09-26' };
    const viaAbsent = absent({ what: 'x', checked: ['y'], provenance }).provenance;
    const viaDescribed = describedResult({ facts: [{ entity: 'e' }], provenance }).provenance;
    expect(JSON.stringify(viaAbsent)).toBe(JSON.stringify(viaDescribed));
  });

  it('null reads as omitted for both (a JSON producer’s missing value); checked stays required', () => {
    const minted = absent({
      what: 'x',
      checked: ['y'],
      provenance: null as never,
      period: null as never,
    });
    expect(minted).not.toHaveProperty('provenance');
    expect(minted).not.toHaveProperty('period');
    expect(refusalOf(() => absent({ what: 'x', checked: [], period: PERIOD }))).toContain(
      '`checked` must name at least one source',
    );
  });

  it('a malformed period is refused at the line, in camelCase', () => {
    expect(
      refusalOf(() =>
        absent({
          what: 'x',
          checked: ['y'],
          period: { queried: Q, held: HELD, read_at: 'x' } as never,
        }),
      ),
    ).toContain("'period.read_at' is not a field this vocabulary has — did you mean `readAt`?");
  });
});

describe('unit: coverage(value, { …, period })', () => {
  it('mints the period inside af_coverage — after the lists, before the note, before result', () => {
    const covered = coverage('2 of 2 backup runs succeeded', {
      checked: ['every job in the 02:00 export'],
      period: PERIOD,
    });
    expect(Object.keys(covered)).toEqual(['af_coverage', 'result']);
    expect(Object.keys(covered.af_coverage)).toEqual(['checked', 'period', 'note']);
    expect(covered.af_coverage.period).toEqual(WIRE_PERIOD);
  });

  it('a period IS a declared boundary — a ledger with only a period is accepted', () => {
    const covered = coverage('ok', { period: { queried: Q, held: 'unknown' } });
    expect(Object.keys(covered.af_coverage)).toEqual(['period', 'note']);
    expect(refusalOf(() => coverage('ok', {}))).toContain('all three lists are empty');
  });

  it('takes no provenance (adopted Q34) — refused, naming the fields it has', () => {
    expect(refusalOf(() => coverage('ok', { checked: ['a'], provenance: SOURCE } as never))).toBe(
      `${REFUSED_PREFIX}'provenance' is not a field this vocabulary has. The fields are: ` +
        'checked, notChecked, cannotCover, period, inProgress.',
    );
  });
});

describe('unit: describedResult({ …, period }) — and semantic() gains nothing', () => {
  it('a top-level period on af_semantics, after provenance', () => {
    const env = describedResult({
      facts: [{ entity: 'host-103', ok: false }],
      provenance: SOURCE,
      period: PERIOD,
    });
    expect(Object.keys(env)).toEqual(['af_semantics', 'facts', 'provenance', 'period', 'note']);
    expect(env.period).toEqual(WIRE_PERIOD);
    expect(readSemantics(env)).toBe(env);
  });

  it('the model reads it as declared, plus the verdict word and its clause when not covered', () => {
    const view = semanticsForModel(
      describedResult({ facts: [{ entity: 'h' }], provenance: SOURCE, period: PERIOD }),
    );
    expect(Object.keys(view)).toEqual(['facts', 'provenance', 'period', 'note']);
    expect(view.period).toEqual({ ...WIRE_PERIOD, verdict: 'not-held' });
    expect(view.note).toBe(`${SEMANTICS_NOTE} ${PERIOD_VERDICT_CLAUSES['not-held']}`);
    const covered = semanticsForModel(
      describedResult({ facts: [{ entity: 'h' }], provenance: SOURCE, period: COVERED }),
    );
    expect(covered.period).toEqual(mintedWire(COVERED));
    expect(covered.note).toBe(SEMANTICS_NOTE);
  });

  it('a malformed period is refused at the call site, in camelCase', () => {
    expect(
      refusalOf(() =>
        describedResult({
          facts: [{ entity: 'h' }],
          provenance: SOURCE,
          period: { queried: { from: '09:00', to: '10:00' }, held: 'unknown' },
        }),
      ),
    ).toMatch(/^refused: `period\.queried\.from` must be an ISO 8601 instant with a zone/);
  });

  it('semantic(), the deprecated door, refuses the key — its declaration gains no field', () => {
    expect(
      refusalOf(() =>
        semantic({
          facts: [{ entity: 'h' }],
          provenance: { measured_at: 'now', source: 's' },
          period: PERIOD,
        } as never),
      ),
    ).toBe(
      `${REFUSED_PREFIX}'period' is not a field this vocabulary has. The fields are: series, ` +
        'facts, edges, grain, provenance, coverage, clarify, render.',
    );
  });

  it('check:semantics: a triage result that declares a period states a boundary (in time)', () => {
    const report = gate([
      {
        name: 'backup_runs',
        resultClass: 'triage',
        results: [
          describedResult({ facts: [{ entity: 'h' }], provenance: SOURCE, period: PERIOD }),
        ],
      },
    ]);
    expect(report.findings.filter((f) => f.code === 'triage-without-coverage')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Recognition — the one channel reads it, never repairs it
// ─────────────────────────────────────────────────────────────────────────

describe('recognition: readCoverageResult carries the period (and an absence’s provenance)', () => {
  it('an absence: the record’s camelCase period and provenance', () => {
    const reading = readCoverageResult(
      absent({ what: 'x', checked: ['y'], provenance: SOURCE, period: PERIOD }),
    );
    expect(reading?.declared[0]).toMatchObject({
      kind: 'absence',
      provenance: SOURCE,
      period: PERIOD,
    });
  });

  it('coverage(absent(…)): each declaration keeps its own period', () => {
    const outer = { queried: Q, held: 'unknown' as const };
    const reading = readCoverageResult(
      coverage(absent({ what: 'x', checked: ['y'], period: PERIOD }), {
        checked: ['z'],
        period: outer,
      }),
    );
    expect(reading?.status).toBe('absent');
    expect(reading?.declared.map((d) => [d.kind, d.period])).toEqual([
      ['ledger', outer],
      ['absence', PERIOD],
    ]);
  });

  it('a described result with ONLY a period files a ledger fact whose three lists are empty', () => {
    const reading = readCoverageResult(
      describedResult({ facts: [{ entity: 'h' }], provenance: SOURCE, period: PERIOD }),
    );
    expect(reading).toEqual({
      declared: [
        {
          kind: 'ledger',
          coverage: { checked: [], notChecked: [], cannotCover: [] },
          period: PERIOD,
        },
      ],
    });
    // …and one with neither declares nothing, as always.
    expect(
      readCoverageResult(describedResult({ facts: [{ entity: 'h' }], provenance: SOURCE })),
    ).toBeUndefined();
  });

  it('a malformed period on af_absent is LEFT OFF the record — the absence is still an absence', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const foreign = {
        af_absent: true,
        outcome: 'nothing_found',
        looked_for: 'x',
        checked: [{ what: 'y' }],
        period: { queried: { from: 'yesterday', to: 'today' }, held: 'unknown' },
        retry_returns_the_same: true,
        note: 'minted elsewhere',
      };
      const once = readCoverageResult(foreign, 'backup_runs');
      readCoverageResult(foreign, 'backup_runs');
      expect(once?.status).toBe('absent');
      expect(once?.declared[0]).not.toHaveProperty('period');
      const warnings = warn.mock.calls.map((c) => String(c[0]));
      expect(
        warnings.filter((w) => w.includes("tool 'backup_runs' returned a period")),
      ).toHaveLength(1);
      // The model still reads what the tool wrote.
      expect(servedToModel(foreign)).toBe(foreign);
    } finally {
      disableDevMode();
    }
  });

  it('a malformed provenance on af_absent is left off the record too, named once per tool', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const reading = readCoverageResult(
        {
          af_absent: true,
          looked_for: 'x',
          checked: [{ what: 'y' }],
          provenance: { measured_at: 'now' },
        },
        'backup_runs',
      );
      expect(reading?.declared[0]).not.toHaveProperty('provenance');
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        "tool 'backup_runs' returned a provenance the record cannot carry",
      );
    } finally {
      disableDevMode();
    }
  });

  it('a malformed period on af_semantics is one more fault — the whole envelope stays data', () => {
    const foreign = {
      af_semantics: true,
      facts: [{ entity: 'h' }],
      provenance: { measured_at: 'now', source: 's' },
      period: { queried: Q, held: 'all of it' },
      note: 'x',
    };
    expect(readSemantics(foreign)).toBeUndefined();
    expect(explainSemantics(foreign)?.[0]).toMatchObject({
      code: 'malformed-semantics',
      field: 'period.held',
    });
  });

  it('period: null on af_semantics is a fault too — never read as "no period declared"', () => {
    // The strict door's law: a key present with a value it cannot read keeps
    // the whole envelope data — a JSON null is not an omission here.
    const foreign = {
      af_semantics: true,
      facts: [{ entity: 'h' }],
      provenance: { measured_at: 'now', source: 's' },
      period: null,
      note: 'x',
    };
    expect(readSemantics(foreign)).toBeUndefined();
    expect(explainSemantics(foreign)).toEqual([
      expect.objectContaining({ code: 'malformed-semantics', field: 'period' }),
    ]);
  });

  it('a well-formed period minted elsewhere (a Python helper, snake_case) is recognized as is', () => {
    const foreign = {
      af_semantics: true,
      facts: [{ entity: 'h' }],
      provenance: { measured_at: 'now', source: 's' },
      period: { queried: Q, held: 'unknown', read_at: '2026-09-26T10:00:03+02:00' },
      note: 'any note',
    };
    expect(readSemantics(foreign)).toBe(foreign);
    expect(readCoverageResult(foreign)?.declared[0]?.period).toEqual({
      queried: Q,
      held: 'unknown',
      readAt: '2026-09-26T10:00:03+02:00',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Served bytes — the verdict word and its one clause (bench round 1)
// ─────────────────────────────────────────────────────────────────────────

describe('served bytes: the verdict word and its one clause (bench round 1)', () => {
  it('servedPeriod: a word and a clause for every verdict but covered', () => {
    expect(servedPeriod(mintedWire(PERIOD))).toMatchObject({
      period: { ...WIRE_PERIOD, verdict: 'not-held' },
      clause: PERIOD_VERDICT_CLAUSES['not-held'],
    });
    expect(servedPeriod(mintedWire(PARTLY))?.verdict).toBe('partly-held');
    expect(servedPeriod(mintedWire(UNKNOWN))?.verdict).toBe('unknown');
    expect(servedPeriod(mintedWire(COVERED))).toBeUndefined();
    expect(servedPeriod(undefined)).toBeUndefined();
    expect(servedPeriod({ queried: Q, held: 'unknown', verdict: 'unknown' })).toBeUndefined();
  });

  it('every clause is static: no digit, no instant — the times stay in the typed data', () => {
    for (const clause of Object.values(PERIOD_VERDICT_CLAUSES)) {
      expect(clause).not.toMatch(/\d/);
      expect(clause).toContain('`period.queried`');
    }
    expect(ABSENCE_NOTE_HELD_ONLY).not.toMatch(/\d/);
  });

  it('an absence the store did not hold drops its completeness claims; unknown keeps them', () => {
    const notHeld = servedToModel(absent({ what: 'x', checked: ['y'], period: PERIOD })) as {
      note: string;
    };
    expect(notHeld.note).toBe(`${ABSENCE_NOTE_HELD_ONLY} ${PERIOD_VERDICT_CLAUSES['not-held']}`);
    expect(notHeld.note).not.toContain('nothing was substituted');
    const partly = servedToModel(absent({ what: 'x', checked: ['y'], period: PARTLY })) as {
      note: string;
    };
    expect(partly.note).toBe(`${ABSENCE_NOTE_HELD_ONLY} ${PERIOD_VERDICT_CLAUSES['partly-held']}`);
    const unknown = servedToModel(absent({ what: 'x', checked: ['y'], period: UNKNOWN })) as {
      note: string;
      period: Record<string, unknown>;
    };
    expect(unknown.note).toBe(`${ABSENCE_NOTE} ${PERIOD_VERDICT_CLAUSES.unknown}`);
    expect(unknown.period).toEqual({ ...mintedWire(UNKNOWN), verdict: 'unknown' });
  });

  it('a ledger serves its own word and clause; the absence it bounds serves its own', () => {
    const served = servedToModel(
      coverage(absent({ what: 'x', checked: ['y'], period: PERIOD }), {
        checked: ['z'],
        period: PARTLY,
      }),
    ) as { af_coverage: Record<string, unknown>; result: Record<string, unknown> };
    expect(served.af_coverage.period).toEqual({ ...mintedWire(PARTLY), verdict: 'partly-held' });
    expect(served.af_coverage.note).toBe(
      `${COVERAGE_NOTE} ${PERIOD_VERDICT_CLAUSES['partly-held']}`,
    );
    expect((served.result.period as Record<string, unknown>).verdict).toBe('not-held');
  });

  it('covered, undeclared, malformed: the same reference, byte for byte', () => {
    const covered = absent({ what: 'x', checked: ['y'], period: COVERED });
    expect(servedToModel(covered)).toBe(covered);
    const bare = absent({ what: 'x', checked: ['y'] });
    expect(servedToModel(bare)).toBe(bare);
    const ledger = coverage(1, { checked: ['z'], period: COVERED });
    expect(servedToModel(ledger)).toBe(ledger);
    const view = semanticsForModel(
      describedResult({ facts: [{ entity: 'h' }], provenance: SOURCE }),
    );
    expect(view).not.toHaveProperty('period');
    expect(view.note).toBe(SEMANTICS_NOTE);
  });

  it('what the model was served reads back as the period the tool declared — no dev warning', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      _resetPeriodWarnings();
      const reading = readCoverageResult(
        JSON.parse(
          JSON.stringify(servedToModel(absent({ what: 'x', checked: ['y'], period: PERIOD }))),
        ),
        'backup_runs',
      );
      expect(reading?.declared[0]?.period).toEqual(PERIOD);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      disableDevMode();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Security — served as declared, grounds as tool knowledge, never the echo
// ─────────────────────────────────────────────────────────────────────────

describe('security: what the model is served, and what may ground', () => {
  it('servedToModel strips short/kind, keeps the period and provenance, adds only the verdict', () => {
    const minted = absent({
      what: 'x',
      checked: [{ what: 'every job', short: 'jobs' }],
      provenance: SOURCE,
      period: PERIOD,
    });
    const served = servedToModel(minted) as Record<string, unknown>;
    expect(served.period).toEqual({ ...WIRE_PERIOD, verdict: 'not-held' });
    expect(served.provenance).toEqual(minted.provenance);
    expect(JSON.stringify(served)).not.toContain('"short"');
    // The tool's own output keeps the bytes it declared.
    expect(minted.period).toEqual(WIRE_PERIOD);
    expect(minted.note).toBe(ABSENCE_NOTE);
  });

  it('the served verdict word and clause never ground — the tool’s own period still does', () => {
    const minted = absent({ what: 'x', checked: ['y'], period: PERIOD });
    const projected = absenceEvidenceProjection(servedToModel(minted)) as Record<string, unknown>;
    expect(projected.period).toEqual(WIRE_PERIOD);
    expect(String(projected.note)).not.toContain('period.verdict');
    const view = semanticsForModel(
      describedResult({ facts: [{ entity: 'h' }], provenance: SOURCE, period: PARTLY }),
    );
    const own = absenceEvidenceProjection(JSON.parse(JSON.stringify(view))) as Record<
      string,
      unknown
    >;
    expect(own.period).toEqual(mintedWire(PARTLY));
    expect(own.note).toBe(SEMANTICS_NOTE);
    const ledger = servedToModel(
      coverage(absent({ what: 'x', checked: ['y'], period: UNKNOWN }), {
        checked: ['z'],
        period: PARTLY,
      }),
    );
    expect(JSON.stringify(absenceEvidenceProjection(ledger))).not.toContain('verdict');
    // A word the library did not derive — one that disagrees with the instants — is the tool's.
    const forged = { ...mintedWire(PARTLY), verdict: 'covered' };
    expect(unservedPeriod(forged)).toBe(forged);
  });

  it('an absence’s period and provenance are the TOOL speaking — they ground; looked_for still does not', () => {
    const projected = absenceEvidenceProjection(
      absent({ what: 'invented-host-9', checked: ['y'], provenance: SOURCE, period: PERIOD }),
    ) as Record<string, unknown>;
    expect(projected).not.toHaveProperty('looked_for');
    expect(projected.period).toEqual(WIRE_PERIOD);
    expect(projected.provenance).toMatchObject({ source: 'nightly backup export' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Byte identity — no period declared, no byte moved
// ─────────────────────────────────────────────────────────────────────────

describe('byte identity: a door given no period mints what it always minted', () => {
  it('absent() — the pre-7b bytes', () => {
    expect(JSON.stringify(absent({ what: 'x', checked: ['y'], tryInstead: 'z' }))).toBe(
      '{"af_absent":true,"outcome":"nothing_found","looked_for":"x","checked":[{"what":"y"}],' +
        '"retry_returns_the_same":true,"try_instead":"z","note":' +
        JSON.stringify(absent({ what: 'a', checked: ['b'] }).note) +
        '}',
    );
  });

  it('coverage() — the pre-7b bytes', () => {
    const covered = coverage(1, { checked: ['y'] });
    expect(JSON.stringify(covered)).toBe(
      `{"af_coverage":{"checked":[{"what":"y"}],"note":${JSON.stringify(
        covered.af_coverage.note,
      )}},"result":1}`,
    );
  });

  it('readCoverageResult — no period key on a fact that declared none', () => {
    const reading = readCoverageResult(absent({ what: 'x', checked: ['y'] }));
    expect(reading?.declared[0]).not.toHaveProperty('period');
    expect(reading?.declared[0]).not.toHaveProperty('provenance');
  });
});
