/**
 * The semantic envelope — mint, recognition, projection (9.53.0).
 *
 * The property under test is a SPLIT: one envelope, two honest views. The
 * model must read a compact rendering-free projection (data + the caveats
 * that travel with it), the record must keep everything, and every value a
 * tool has ever returned before this release must keep its bytes — the
 * recognition strictness IS the zero-cost guarantee.
 *
 * Sections follow Convention 3: Unit (mint refusals + the strict
 * recognizer) · Functional (the rendered shape + the projection) · Edge ·
 * Regression (composition with the coverage funnel).
 */

import { describe, expect, it } from 'vitest';
import {
  composeNotCovered,
  explainSemantics,
  isCounterLookingAggregation,
  readSemantics,
  semantic,
  semanticsForModel,
  SEMANTICS_MARKER,
  SEMANTICS_NOTE,
  readCoverageResult,
  type ToolSemantics,
} from '../../../src/index.js';

const PROVENANCE = { measured_at: '2026-08-19T10:20:00Z', source: 'InfluxDB SwitchPortStats' };
const POINT = { t: '2026-08-19T10:00:00Z', entity: 'fc1/3', metric: 'avg_iops', value: 18450 };

const fullDecl = () => ({
  series: [POINT],
  grain: { interval: '30m', aggregation: 'avg', is_counter: false },
  provenance: { ...PROVENANCE, age_seconds: 600 },
  coverage: {
    checked: ['shq-fab-a: all 48 FC ports'],
    notChecked: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
    cannotCover: [{ what: 'host-side multipathing', why: 'no collector exists for it' }],
  },
  render: { default: 'table', columns: ['entity', 'value'], sort: 'value desc' },
});

// ─────────────────────────────────────────────────────────────────────────
// Unit — a declaration this library cannot honor is refused where it is typed
// ─────────────────────────────────────────────────────────────────────────

describe('unit: semantic() refusals teach at the call site', () => {
  it('refuses series without grain — the rule the gate also enforces, one implementation', () => {
    expect(() => semantic({ series: [POINT], provenance: PROVENANCE })).toThrow(
      /series[\s\S]*grain[\s\S]*counters get summed/,
    );
  });

  it('refuses data without provenance, naming the two required fields', () => {
    expect(() => semantic({ series: [POINT], grain: { interval: '30m' } })).toThrow(
      /measured_at[\s\S]*source/,
    );
    expect(() => semantic({ facts: [{ entity: 'fc1/3', state: 'up' }] })).toThrow(
      /measured_at[\s\S]*source/,
    );
  });

  it('refuses a counter-looking aggregation with is_counter unstated — stated means true OR false', () => {
    expect(() =>
      semantic({
        series: [POINT],
        grain: { interval: '30m', aggregation: 'sum' },
        provenance: PROVENANCE,
      }),
    ).toThrow(/counter-looking[\s\S]*is_counter/);
    // Stated false is a statement, not a default — it passes.
    const ok = semantic({
      series: [POINT],
      grain: { interval: '30m', aggregation: 'sum', is_counter: false },
      provenance: PROVENANCE,
    });
    expect(ok.grain?.is_counter).toBe(false);
  });

  it('refuses an envelope that declares nothing — caveats with nothing to caveat', () => {
    expect(() => semantic({ grain: { interval: '30m' } })).toThrow(/declares nothing/);
    expect(() => semantic({})).toThrow(/declares nothing/);
  });

  it('refuses hand-written not_covered — the prose is DERIVED from coverage', () => {
    expect(() => semantic({ facts: [{ entity: 'x' }], not_covered: ['stuff'] } as never)).toThrow(
      /derived, never declared/,
    );
  });

  it('refuses unknown fields, naming the vocabulary', () => {
    expect(() => semantic({ facts: [{ entity: 'x' }], tables: {} } as never)).toThrow(
      /'tables' is not a field this vocabulary has/,
    );
  });

  it('refuses a cannotCover entry with no why — the coverage() validator, absorbed not duplicated', () => {
    expect(() =>
      semantic({
        facts: [{ entity: 'x' }],
        provenance: PROVENANCE,
        coverage: { cannotCover: ['the peer fabric'] },
      }),
    ).toThrow(/cannotCover[\s\S]*why/);
  });

  it('refuses a facts row with no entity — every row says WHAT it is about', () => {
    expect(() => semantic({ facts: [{ size_tb: 12 }] as never, provenance: PROVENANCE })).toThrow(
      /entity/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the rendered shape and the two views
// ─────────────────────────────────────────────────────────────────────────

describe('functional: the rendered envelope', () => {
  it('derives not_covered from coverage (notChecked + cannotCover), what — why', () => {
    const sem = semantic(fullDecl());
    expect(sem.not_covered).toEqual([
      'the peer fabric — this collector is scoped to one fabric',
      'host-side multipathing — no collector exists for it',
    ]);
    expect(sem[SEMANTICS_MARKER as 'af_semantics']).toBe(true);
    expect(sem.note).toBe(SEMANTICS_NOTE);
    // The coverage lists are the normalized snake_case respelling.
    expect(sem.coverage?.checked).toEqual([{ what: 'shq-fab-a: all 48 FC ports' }]);
    expect(sem.coverage?.cannot_cover?.[0]?.why).toBe('no collector exists for it');
  });

  it('a clarify: null is KEPT — a stated non-question is a fact', () => {
    const sem = semantic({ facts: [{ entity: 'x' }], provenance: PROVENANCE, clarify: null });
    expect(sem.clarify).toBeNull();
  });

  it('the model projection drops the marker, render and the coverage detail; keeps the caveats', () => {
    const sem = semantic(fullDecl());
    const view = semanticsForModel(sem);
    expect(view).not.toHaveProperty(SEMANTICS_MARKER);
    expect(view).not.toHaveProperty('render');
    expect(view).not.toHaveProperty('coverage');
    expect(view.series).toEqual([POINT]);
    expect(view.grain).toEqual({ interval: '30m', aggregation: 'avg', is_counter: false });
    expect(view.provenance).toEqual({ ...PROVENANCE, age_seconds: 600 });
    expect(view.not_covered).toEqual(sem.not_covered);
    expect(view.note).toBe(SEMANTICS_NOTE);
  });

  it('the projection keeps a real clarify and drops a null one', () => {
    const asked = semantic({
      facts: [{ entity: 'vol-00EE' }],
      provenance: PROVENANCE,
      clarify: { question: 'Which array did you mean?', candidates: ['SHPMAX-1', 'SHPMAX-2'] },
    });
    expect(semanticsForModel(asked).clarify).toEqual({
      question: 'Which array did you mean?',
      candidates: ['SHPMAX-1', 'SHPMAX-2'],
    });
    const silent = semantic({ facts: [{ entity: 'x' }], provenance: PROVENANCE, clarify: null });
    expect(semanticsForModel(silent)).not.toHaveProperty('clarify');
  });

  it('the projection is detached — mutating it does not touch the envelope', () => {
    const sem = semantic(fullDecl());
    const view = semanticsForModel(sem) as { series: Array<Record<string, unknown>> };
    view.series[0]!.value = 0;
    expect(sem.series?.[0]?.value).toBe(18450);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit — recognition is strict, and the strictness is the zero-cost guarantee
// ─────────────────────────────────────────────────────────────────────────

describe('unit: readSemantics recognition', () => {
  it('recognizes exactly what semantic() mints', () => {
    const sem = semantic(fullDecl());
    expect(readSemantics(sem)).toBe(sem);
  });

  it('declines every unmarked shape a tool has ever returned — including near-misses', () => {
    expect(readSemantics('prose')).toBeUndefined();
    expect(readSemantics(null)).toBeUndefined();
    expect(readSemantics([POINT])).toBeUndefined();
    expect(readSemantics({ series: [POINT], grain: {} })).toBeUndefined(); // no marker
    expect(readSemantics({ af_semantics: 'true', series: [POINT] })).toBeUndefined(); // marker not `true`
  });

  it('declines a marker-bearing envelope with faults — never half-applied — and explainSemantics names them', () => {
    const broken = { af_semantics: true, series: [POINT] }; // no grain, no provenance
    expect(readSemantics(broken)).toBeUndefined();
    const faults = explainSemantics(broken);
    expect(faults).toBeDefined();
    const codes = (faults ?? []).map((f) => f.code);
    expect(codes).toContain('series-without-grain');
    expect(codes).toContain('data-without-provenance');
    // Unmarked values are data, not near-misses: nothing to explain.
    expect(explainSemantics({ series: [POINT] })).toBeUndefined();
  });

  it('flags hand-written not_covered that disagrees with coverage — the derivation is the law', () => {
    const sem = semantic(fullDecl()) as ToolSemantics;
    const drifted = { ...sem, not_covered: ['something else entirely'] };
    expect(readSemantics(drifted)).toBeUndefined();
    expect(explainSemantics(drifted)?.some((f) => f.field === 'not_covered')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge
// ─────────────────────────────────────────────────────────────────────────

describe('edge: counter-word matching and composition helpers', () => {
  it('matches counter words as whole tokens, singular or plural — never substrings', () => {
    expect(isCounterLookingAggregation('sum')).toBe(true);
    expect(isCounterLookingAggregation('Counts')).toBe(true);
    expect(isCounterLookingAggregation('cumulative-total')).toBe(true);
    expect(isCounterLookingAggregation('summary')).toBe(false);
    expect(isCounterLookingAggregation('avg')).toBe(false);
    expect(isCounterLookingAggregation('discounted')).toBe(false);
  });

  it('composeNotCovered folds nothing from checked — only the two not-covered lists', () => {
    expect(composeNotCovered({ checked: [{ what: 'the fcns database' }] })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — the coverage funnel absorbs the envelope's boundary
// ─────────────────────────────────────────────────────────────────────────

describe('regression: readCoverageResult absorbs a semantic coverage as a ledger', () => {
  it('a semantic envelope WITH coverage declares one ledger through the one funnel', () => {
    const reading = readCoverageResult(semantic(fullDecl()));
    expect(reading).toBeDefined();
    expect(reading?.status).toBeUndefined(); // a boundary says nothing about the outcome
    expect(reading?.declared).toHaveLength(1);
    expect(reading?.declared[0]?.kind).toBe('ledger');
    expect(reading?.declared[0]?.coverage.notChecked[0]?.what).toBe('the peer fabric');
  });

  it('a semantic envelope WITHOUT coverage declares no boundary — exactly like a bare result', () => {
    const sem = semantic({ facts: [{ entity: 'x' }], provenance: PROVENANCE });
    expect(readCoverageResult(sem)).toBeUndefined();
  });
});
