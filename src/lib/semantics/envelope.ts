/**
 * semantics/envelope — minting, recognizing and projecting the semantic
 * tool-result envelope (9.53.0).
 *
 * Pattern: minted by a helper, RECOGNIZED by the framework (the `absent()` /
 *          tool-effects precedent). A return shape the framework does not
 *          understand is a convention, and a convention cannot ride the
 *          record, feed a UI, or be refused by a build gate.
 * Role:    lib/ layer, pure. The dispatch loop calls `readSemantics` at the
 *          execute boundary; `semantic()` is what a tool author writes;
 *          `checkSemantics` (check.ts) judges the same shapes offline.
 * Emits:   N/A (the caller emits `agentfootprint.tools.semantics_declared`).
 *
 * ## Two views of one envelope — the design decision, stated
 *
 * The MODEL reads a compact, rendering-free projection
 * ({@link semanticsForModel}): the data (`series`/`facts`/`edges`), the
 * caveats that must travel with it (`grain`, `provenance`), the composed
 * `not_covered` prose, a non-null `clarify`, and the static note. Dropped
 * from the model's view: the `af_semantics` marker (machine-only), `render`
 * (a UI hint — the tool never renders, and a model parroting rendering
 * directives is noise), the three-list `coverage` detail (it rides the
 * coverage channel and the record; the model reads the composed
 * `not_covered` lines instead), and a `clarify: null` (a stated non-question
 * is a fact for the record, not something the model acts on).
 *
 * The RECORD gets everything: the full envelope — render, coverage,
 * marker and all — lands on the `tools.semantics_declared` event BEFORE the
 * result ceiling is measured, so grain and provenance survive to recordings
 * and UIs even when the content itself is refused as oversized. The
 * `coverage` field is additionally declared through the SAME channel the
 * `coverage()` primitive uses (`tools.coverage_declared`, tracked state, the
 * final-answer limits block) — absorbed, never duplicated.
 *
 * ## One rule set, two doors
 *
 * `semantic()` refuses a declaration this vocabulary cannot honor at the
 * CALL SITE (the `absent()` law) — so a minted envelope is honest by
 * construction: series carry their grain, data carries its provenance,
 * counter-looking aggregations state `is_counter`. `semanticIssues()` judges
 * the RENDERED shape — the same rules over a value somebody may have built
 * by hand — and is what recognition and the `check:semantics` gate both
 * stand on. Recognition is STRICT (the zero-cost guarantee): a marker-
 * bearing value with any issue is NOT recognized — it keeps its bytes on
 * the data path (dev-warned, and named field-by-field by the gate), because
 * this library does not half-apply a shape it cannot fully honor.
 */

import { normalizeCoverageList } from '../../core/agent/coverage/items.js';
import type { Coverage, CoverageItem } from '../../core/agent/coverage/types.js';
import {
  COUNTER_AGGREGATION_WORDS,
  SEMANTICS_MARKER,
  SEMANTICS_NOTE,
  type SemanticCoverage,
  type SemanticDeclaration,
  type ToolSemantics,
} from './types.js';

/** The codes an envelope can be faulted with — shared by recognition (any
 *  issue ⇒ not recognized) and the `check:semantics` gate (issues become
 *  findings under these same names). */
export type SemanticIssueCode =
  | 'malformed-semantics'
  | 'series-without-grain'
  | 'counter-aggregation-unstated'
  | 'data-without-provenance';

/** One fault, naming the field so a refusal can teach and a gate can point. */
export interface SemanticIssue {
  readonly code: SemanticIssueCode;
  /** The offending / missing field, dot-pathed ('grain.is_counter'). */
  readonly field: string;
  readonly message: string;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whole-token match against {@link COUNTER_AGGREGATION_WORDS}, singular or
 *  plural, case-insensitive — 'sum' and 'Counts' look like counters,
 *  'summary' does not. */
export function isCounterLookingAggregation(aggregation: string): boolean {
  const tokens = aggregation.toLowerCase().split(/[^a-z]+/);
  return tokens.some(
    (t) =>
      COUNTER_AGGREGATION_WORDS.includes(t) ||
      (t.endsWith('s') && COUNTER_AGGREGATION_WORDS.includes(t.slice(0, -1))),
  );
}

const ENVELOPE_KEYS = new Set([
  SEMANTICS_MARKER,
  'series',
  'facts',
  'edges',
  'grain',
  'provenance',
  'coverage',
  'not_covered',
  'clarify',
  'render',
  'note',
]);
const GRAIN_KEYS = new Set(['interval', 'aggregation', 'is_counter', 'collapsed']);
const PROVENANCE_KEYS = new Set(['measured_at', 'age_seconds', 'source', 'source_export_date']);
const COVERAGE_KEYS = new Set(['checked', 'not_checked', 'cannot_cover']);
const CLARIFY_KEYS = new Set(['question', 'candidates']);
const RENDER_KEYS = new Set(['default', 'columns', 'sort', 'filter_note', 'chart_hint']);

/** Compose the `not_covered` prose lines FROM coverage — the one derivation,
 *  used by the mint and by the drift check, so the two can never disagree. */
export function composeNotCovered(coverage: SemanticCoverage): readonly string[] {
  const items = [...(coverage.not_checked ?? []), ...(coverage.cannot_cover ?? [])];
  return items.map((i) => (i.why !== undefined ? `${i.what} — ${i.why}` : i.what));
}

function malformed(field: string, message: string): SemanticIssue {
  return { code: 'malformed-semantics', field, message };
}

/** Detach one clarify declaration for the candidate envelope. A non-object
 *  passes through untouched so the validator can name it. */
function copyClarify(clarify: unknown): unknown {
  if (!isPlainObject(clarify)) return clarify;
  return {
    question: clarify.question,
    candidates: Array.isArray(clarify.candidates)
      ? [...clarify.candidates]
      : clarify.candidates ?? [],
  };
}

function checkItemList(
  issues: SemanticIssue[],
  field: string,
  list: unknown,
  requireWhy: boolean,
): readonly CoverageItem[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    issues.push(malformed(field, `\`${field}\` must be an array of { what, why? } items.`));
    return [];
  }
  const items: CoverageItem[] = [];
  list.forEach((raw, i) => {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.what)) {
      issues.push(
        malformed(
          `${field}[${i}]`,
          `\`${field}[${i}]\` names no ground — each item is { what, why? }.`,
        ),
      );
      return;
    }
    if (raw.why !== undefined && !isNonEmptyString(raw.why)) {
      issues.push(
        malformed(`${field}[${i}].why`, `\`${field}[${i}]\` has a \`why\` that says nothing.`),
      );
      return;
    }
    if (requireWhy && raw.why === undefined) {
      issues.push(
        malformed(
          `${field}[${i}].why`,
          `\`${field}[${i}]\` ('${raw.what.trim()}') has no \`why\` — a permanent blind spot is a ` +
            `claim about capability, and a claim with no reason cannot be acted on or disproved.`,
        ),
      );
      return;
    }
    items.push({
      what: raw.what,
      ...(raw.why !== undefined && { why: raw.why as string }),
    });
  });
  return items;
}

/**
 * Judge one RENDERED envelope shape against the whole rule set. Empty = a
 * well-formed envelope this library can honor. Non-empty = the faults, each
 * naming its field.
 *
 * Called with values that carry the marker; on anything else it reports the
 * missing marker rather than guessing.
 */
export function semanticIssues(value: unknown): readonly SemanticIssue[] {
  if (!isPlainObject(value)) {
    return [malformed(SEMANTICS_MARKER, 'a semantic envelope is a plain object.')];
  }
  if (value[SEMANTICS_MARKER] !== true) {
    return [
      malformed(
        SEMANTICS_MARKER,
        `\`${SEMANTICS_MARKER}\` must be exactly \`true\` — the marker is the vocabulary.`,
      ),
    ];
  }
  const issues: SemanticIssue[] = [];
  for (const key of Object.keys(value)) {
    if (!ENVELOPE_KEYS.has(key)) {
      issues.push(
        malformed(
          key,
          `carries '${key}', which is not a field this vocabulary has. The fields are: series, ` +
            `facts, edges, grain, provenance, coverage, clarify, render (not_covered and note ` +
            `are derived).`,
        ),
      );
    }
  }

  // ── series ──
  const series = value.series;
  if (series !== undefined) {
    if (!Array.isArray(series) || series.length === 0) {
      issues.push(
        malformed(
          'series',
          '`series` must be a non-empty array of { t, entity, metric, value } points — omit the field to say nothing.',
        ),
      );
    } else {
      series.forEach((p, i) => {
        if (!isPlainObject(p)) {
          issues.push(malformed(`series[${i}]`, `\`series[${i}]\` is not a point object.`));
          return;
        }
        if (typeof p.t !== 'string' && typeof p.t !== 'number') {
          issues.push(
            malformed(
              `series[${i}].t`,
              `\`series[${i}].t\` must be the measurement time (an ISO string or an epoch number).`,
            ),
          );
        }
        if (!isNonEmptyString(p.entity)) {
          issues.push(
            malformed(
              `series[${i}].entity`,
              `\`series[${i}].entity\` must name what was measured.`,
            ),
          );
        }
        if (!isNonEmptyString(p.metric)) {
          issues.push(
            malformed(`series[${i}].metric`, `\`series[${i}].metric\` must name the measurement.`),
          );
        }
        if (!('value' in p)) {
          issues.push(
            malformed(
              `series[${i}].value`,
              `\`series[${i}]\` has no \`value\` — a point with no reading is not a point.`,
            ),
          );
        }
      });
    }
  }

  // ── facts ──
  const facts = value.facts;
  if (facts !== undefined) {
    if (!Array.isArray(facts) || facts.length === 0) {
      issues.push(
        malformed(
          'facts',
          '`facts` must be a non-empty array of rows — omit the field to say nothing.',
        ),
      );
    } else {
      facts.forEach((f, i) => {
        if (!isPlainObject(f) || !isNonEmptyString(f.entity)) {
          issues.push(
            malformed(
              `facts[${i}].entity`,
              `\`facts[${i}]\` must say WHAT it is about — every row needs a non-empty \`entity\`.`,
            ),
          );
        }
      });
    }
  }

  // ── edges ──
  const edges = value.edges;
  if (edges !== undefined) {
    if (!Array.isArray(edges) || edges.length === 0) {
      issues.push(
        malformed(
          'edges',
          '`edges` must be a non-empty array of { from, to, kind } — omit the field to say nothing.',
        ),
      );
    } else {
      edges.forEach((e, i) => {
        if (
          !isPlainObject(e) ||
          !isNonEmptyString(e.from) ||
          !isNonEmptyString(e.to) ||
          !isNonEmptyString(e.kind)
        ) {
          issues.push(
            malformed(
              `edges[${i}]`,
              `\`edges[${i}]\` must carry non-empty \`from\`, \`to\` and \`kind\`.`,
            ),
          );
        }
      });
    }
  }

  // ── grain ──
  const grain = value.grain;
  if (grain !== undefined) {
    if (!isPlainObject(grain)) {
      issues.push(
        malformed(
          'grain',
          '`grain` must be an object ({ interval?, aggregation?, is_counter?, collapsed? }).',
        ),
      );
    } else {
      for (const key of Object.keys(grain)) {
        if (!GRAIN_KEYS.has(key))
          issues.push(malformed(`grain.${key}`, `\`grain.${key}\` is not a grain field.`));
      }
      let says = false;
      for (const key of ['interval', 'aggregation', 'collapsed'] as const) {
        if (grain[key] !== undefined) {
          if (!isNonEmptyString(grain[key])) {
            issues.push(
              malformed(`grain.${key}`, `\`grain.${key}\` must be a non-empty string or omitted.`),
            );
          } else says = true;
        }
      }
      if (grain.is_counter !== undefined) {
        if (typeof grain.is_counter !== 'boolean') {
          issues.push(
            malformed(
              'grain.is_counter',
              '`grain.is_counter` must be a boolean — "stated" means true or false, never prose.',
            ),
          );
        } else says = true;
      }
      if (!says && issues.every((i) => !i.field.startsWith('grain'))) {
        issues.push(
          malformed(
            'grain',
            '`grain` says nothing — state at least one of interval, aggregation, is_counter, collapsed, or omit the field.',
          ),
        );
      }
      if (
        isNonEmptyString(grain.aggregation) &&
        isCounterLookingAggregation(grain.aggregation) &&
        typeof grain.is_counter !== 'boolean'
      ) {
        issues.push({
          code: 'counter-aggregation-unstated',
          field: 'grain.is_counter',
          message:
            `grain.aggregation is '${grain.aggregation.trim()}', which is counter-looking, and ` +
            `\`is_counter\` is not stated. Summing counters double-counts, and a reader cannot ` +
            `tell a counter from a gauge by looking at a number — state \`is_counter: true\` or ` +
            `\`is_counter: false\`.`,
        });
      }
    }
  }

  // ── provenance ──
  const provenance = value.provenance;
  const hasData = series !== undefined || facts !== undefined;
  if (provenance !== undefined) {
    if (!isPlainObject(provenance)) {
      issues.push(
        malformed(
          'provenance',
          '`provenance` must be an object ({ measured_at, source, age_seconds?, source_export_date? }).',
        ),
      );
    } else {
      for (const key of Object.keys(provenance)) {
        if (!PROVENANCE_KEYS.has(key))
          issues.push(
            malformed(`provenance.${key}`, `\`provenance.${key}\` is not a provenance field.`),
          );
      }
      if (!isNonEmptyString(provenance.measured_at)) {
        issues.push({
          code: 'data-without-provenance',
          field: 'provenance.measured_at',
          message:
            '`provenance.measured_at` must say when the WORLD was measured — a tool reading a ' +
            'nightly export and answering in 4ms is serving yesterday, and only this field says so.',
        });
      }
      if (!isNonEmptyString(provenance.source)) {
        issues.push({
          code: 'data-without-provenance',
          field: 'provenance.source',
          message: '`provenance.source` must name the system of record the values were read from.',
        });
      }
      if (
        provenance.age_seconds !== undefined &&
        (typeof provenance.age_seconds !== 'number' ||
          !Number.isFinite(provenance.age_seconds) ||
          provenance.age_seconds < 0)
      ) {
        issues.push(
          malformed(
            'provenance.age_seconds',
            '`provenance.age_seconds` must be a finite number ≥ 0 or omitted.',
          ),
        );
      }
      if (
        provenance.source_export_date !== undefined &&
        !isNonEmptyString(provenance.source_export_date)
      ) {
        issues.push(
          malformed(
            'provenance.source_export_date',
            '`provenance.source_export_date` must be a non-empty string or omitted.',
          ),
        );
      }
    }
  } else if (hasData) {
    issues.push({
      code: 'data-without-provenance',
      field: 'provenance',
      message:
        'carries series/facts with no `provenance` — `provenance.measured_at` and ' +
        '`provenance.source` are required whenever the envelope carries data: a number with ' +
        'no age and no source cannot be trusted or audited.',
    });
  }

  // ── series ⇒ grain ──
  if (series !== undefined && grain === undefined) {
    issues.push({
      code: 'series-without-grain',
      field: 'grain',
      message:
        'carries `series` with no `grain` — a time-series with no stated interval/aggregation ' +
        'reads as whatever the reader assumes, which is how counters get summed and windows get ' +
        'compared across different intervals.',
    });
  }

  // ── coverage (rendered) + not_covered derivation ──
  const coverage = value.coverage;
  let renderedCoverage: SemanticCoverage | undefined;
  if (coverage !== undefined) {
    if (!isPlainObject(coverage)) {
      issues.push(
        malformed(
          'coverage',
          '`coverage` must be an object of { checked?, not_checked?, cannot_cover? } item lists.',
        ),
      );
    } else {
      for (const key of Object.keys(coverage)) {
        if (!COVERAGE_KEYS.has(key)) {
          issues.push(
            malformed(
              `coverage.${key}`,
              `\`coverage.${key}\` is not a coverage list — the three are checked, not_checked, cannot_cover.`,
            ),
          );
        }
      }
      const checked = checkItemList(issues, 'coverage.checked', coverage.checked, false);
      const notChecked = checkItemList(issues, 'coverage.not_checked', coverage.not_checked, false);
      const cannotCover = checkItemList(
        issues,
        'coverage.cannot_cover',
        coverage.cannot_cover,
        true,
      );
      if (checked.length + notChecked.length + cannotCover.length === 0) {
        issues.push(
          malformed(
            'coverage',
            '`coverage` names no ground at all — declare at least one item, or omit the field.',
          ),
        );
      } else {
        renderedCoverage = {
          ...(checked.length > 0 && { checked }),
          ...(notChecked.length > 0 && { not_checked: notChecked }),
          ...(cannotCover.length > 0 && { cannot_cover: cannotCover }),
        };
      }
    }
  }
  const notCovered = value.not_covered;
  if (notCovered !== undefined) {
    if (coverage === undefined) {
      issues.push(
        malformed(
          'not_covered',
          '`not_covered` is DERIVED from `coverage` (not checked + cannot cover) — declare `coverage` instead of writing the prose by hand, so the two cannot disagree.',
        ),
      );
    } else if (!Array.isArray(notCovered) || !notCovered.every(isNonEmptyString)) {
      issues.push(malformed('not_covered', '`not_covered` must be an array of non-empty strings.'));
    } else if (renderedCoverage !== undefined) {
      const derived = composeNotCovered(renderedCoverage);
      const same =
        derived.length === notCovered.length && derived.every((l, i) => l === notCovered[i]);
      if (!same) {
        issues.push(
          malformed(
            'not_covered',
            '`not_covered` disagrees with what `coverage` derives — it is a derived field; drop it (the mint composes it) or fix the coverage lists.',
          ),
        );
      }
    }
  }

  // ── clarify ──
  const clarify = value.clarify;
  if (clarify !== undefined && clarify !== null) {
    if (!isPlainObject(clarify)) {
      issues.push(
        malformed(
          'clarify',
          '`clarify` must be { question, candidates } or null (null states "ambiguity was considered; there is none").',
        ),
      );
    } else {
      for (const key of Object.keys(clarify)) {
        if (!CLARIFY_KEYS.has(key))
          issues.push(malformed(`clarify.${key}`, `\`clarify.${key}\` is not a clarify field.`));
      }
      if (!isNonEmptyString(clarify.question)) {
        issues.push(malformed('clarify.question', '`clarify.question` must ask something.'));
      }
      if (!Array.isArray(clarify.candidates)) {
        issues.push(
          malformed(
            'clarify.candidates',
            '`clarify.candidates` must be an array (empty is fine — an open question is still a question).',
          ),
        );
      }
    }
  }

  // ── render ──
  const render = value.render;
  if (render !== undefined) {
    if (!isPlainObject(render)) {
      issues.push(
        malformed(
          'render',
          '`render` must be an object ({ default, columns?, sort?, filter_note?, chart_hint? }).',
        ),
      );
    } else {
      for (const key of Object.keys(render)) {
        if (!RENDER_KEYS.has(key))
          issues.push(malformed(`render.${key}`, `\`render.${key}\` is not a render hint.`));
      }
      if (!isNonEmptyString(render.default)) {
        issues.push(
          malformed(
            'render.default',
            "`render.default` must name the default presentation ('table', 'chart', 'prose', …).",
          ),
        );
      }
      if (
        render.columns !== undefined &&
        (!Array.isArray(render.columns) ||
          render.columns.length === 0 ||
          !render.columns.every(isNonEmptyString))
      ) {
        issues.push(
          malformed(
            'render.columns',
            '`render.columns` must be a non-empty array of column names or omitted.',
          ),
        );
      }
      for (const key of ['sort', 'filter_note', 'chart_hint'] as const) {
        if (render[key] !== undefined && !isNonEmptyString(render[key])) {
          issues.push(
            malformed(`render.${key}`, `\`render.${key}\` must be a non-empty string or omitted.`),
          );
        }
      }
    }
  }

  // ── note ──
  if (value.note !== undefined && typeof value.note !== 'string') {
    issues.push(
      malformed('note', "`note` is the library's static sentence — a string, or omitted."),
    );
  }

  // ── the envelope must declare SOMETHING ──
  if (
    series === undefined &&
    facts === undefined &&
    edges === undefined &&
    (clarify === undefined || clarify === null)
  ) {
    issues.push(
      malformed(
        SEMANTICS_MARKER,
        'declares nothing — an envelope needs data (series, facts or edges) or a question ' +
          '(clarify). Caveats with nothing to caveat are not a result.',
      ),
    );
  }

  return issues;
}

/**
 * Say "here is typed data, with the caveats that make it honest" in a shape
 * the framework recognizes, the record keeps whole, and a build gate can
 * refuse.
 *
 * Returns the value a tool's `execute` should return. The framework
 * recognizes it at the dispatch boundary: the MODEL reads the compact
 * projection ({@link semanticsForModel}), the FULL envelope rides the typed
 * `agentfootprint.tools.semantics_declared` event, and a declared `coverage`
 * flows through the same channel `coverage()` uses.
 *
 * Refuses (throws, at the call site — the `absent()` law) any declaration
 * this vocabulary cannot honor: series without grain, data without
 * provenance, a counter-looking aggregation with `is_counter` unstated, and
 * every malformed shape — each refusal names the field and the fix.
 *
 * @example a per-port IOPS tool
 *   return semantic({
 *     series: rows.map((r) => ({ t: r.time, entity: r.port, metric: 'avg_iops', value: r.iops })),
 *     grain: { interval: '30m', aggregation: 'avg', is_counter: false },
 *     provenance: { measured_at: latestSampleTime, source: 'InfluxDB SwitchPortStats' },
 *     coverage: {
 *       checked: ['shq-fab-a: all 48 FC ports'],
 *       notChecked: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
 *     },
 *     render: { default: 'table', columns: ['entity', 'value'], sort: 'value desc' },
 *   });
 */
export function semantic(decl: SemanticDeclaration): ToolSemantics {
  const fn = 'semantic';
  // Deliberately not the isPlainObject guard: its predicate would REPLACE
  // the declared field types with an index signature for the rest of the
  // function (SemanticDeclaration is all-optional, hence assignable).
  if (typeof decl !== 'object' || decl === null || Array.isArray(decl)) {
    throw new Error(
      `${fn}: takes a declaration — { series?, facts?, edges?, grain?, provenance?, coverage?, ` +
        `clarify?, render? } with at least one of series/facts/edges/clarify.`,
    );
  }
  const DECL_KEYS = new Set([
    'series',
    'facts',
    'edges',
    'grain',
    'provenance',
    'coverage',
    'clarify',
    'render',
  ]);
  for (const key of Object.keys(decl)) {
    if (DECL_KEYS.has(key)) continue;
    if (key === 'not_covered') {
      throw new Error(
        `${fn}: \`not_covered\` is derived, never declared — declare \`coverage\` ` +
          `({ notChecked, cannotCover }) and the prose list is composed from it, so the two ` +
          `can never disagree.`,
      );
    }
    throw new Error(
      `${fn}: '${key}' is not a field this vocabulary has. The fields are: series, facts, ` +
        `edges, grain, provenance, coverage, clarify, render.`,
    );
  }

  // Coverage first — the coverage() vocabulary, normalized by the SAME
  // validator the coverage()/absent() primitives use (one validator, three
  // doors), then respelled snake_case for the rendered envelope.
  let coverage: SemanticCoverage | undefined;
  if (decl.coverage !== undefined) {
    if (!isPlainObject(decl.coverage)) {
      throw new Error(
        `${fn}: \`coverage\` must be a { checked?, notChecked?, cannotCover? } declaration.`,
      );
    }
    const cov = decl.coverage as SemanticDeclaration['coverage'] & object;
    const checked = normalizeCoverageList(fn, 'checked', cov.checked, false);
    const notChecked = normalizeCoverageList(fn, 'notChecked', cov.notChecked, false);
    const cannotCover = normalizeCoverageList(fn, 'cannotCover', cov.cannotCover, true);
    if (checked.length + notChecked.length + cannotCover.length === 0) {
      throw new Error(
        `${fn}: \`coverage\` names no ground at all — declare at least one item across ` +
          `checked/notChecked/cannotCover, or omit the field (absent means "not declared", ` +
          `never "nothing there").`,
      );
    }
    coverage = {
      ...(checked.length > 0 && { checked }),
      ...(notChecked.length > 0 && { not_checked: notChecked }),
      ...(cannotCover.length > 0 && { cannot_cover: cannotCover }),
    };
  }

  const notCovered = coverage !== undefined ? composeNotCovered(coverage) : [];
  const candidate: Record<string, unknown> = {
    [SEMANTICS_MARKER]: true,
    ...(decl.series !== undefined && { series: [...decl.series] }),
    ...(decl.facts !== undefined && { facts: [...decl.facts] }),
    ...(decl.edges !== undefined && { edges: [...decl.edges] }),
    ...(decl.grain !== undefined && { grain: { ...decl.grain } }),
    ...(decl.provenance !== undefined && { provenance: { ...decl.provenance } }),
    ...(coverage !== undefined && { coverage }),
    ...(notCovered.length > 0 && { not_covered: notCovered }),
    ...('clarify' in decl &&
      decl.clarify !== undefined && {
        clarify: decl.clarify === null ? null : copyClarify(decl.clarify),
      }),
    ...(decl.render !== undefined && { render: { ...decl.render } }),
    note: SEMANTICS_NOTE,
  };

  // One rule set, one implementation: the mint judges its own candidate with
  // the exact validator recognition and the gate use, and refuses the first
  // fault at the call site.
  const issues = semanticIssues(candidate);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(`${fn}: ${first.message} (field: ${first.field})`);
  }
  return candidate as unknown as ToolSemantics;
}

/**
 * Recognize (or decline to recognize) a value as a semantic envelope —
 * STRICT, and the strictness is the zero-cost guarantee. Only a plain object
 * whose `af_semantics` is exactly `true` AND that passes the whole rule set
 * qualifies; every other value any tool has ever returned takes the path it
 * always took, byte for byte.
 *
 * `undefined` means "not an envelope this library can honor" — a marker-
 * bearing value with faults stays DATA (never half-applied); the dispatch
 * loop dev-warns it and `check:semantics` names every fault.
 */
export function readSemantics(value: unknown): ToolSemantics | undefined {
  if (!isPlainObject(value) || value[SEMANTICS_MARKER] !== true) return undefined;
  if (semanticIssues(value).length > 0) return undefined;
  return value as unknown as ToolSemantics;
}

/**
 * Name what is wrong with a value that CARRIES the marker but was not
 * recognized. `undefined` for values without the marker (they are data, not
 * near-misses) and for well-formed envelopes. Diagnosis only — never changes
 * what any value does.
 */
export function explainSemantics(value: unknown): readonly SemanticIssue[] | undefined {
  if (!isPlainObject(value) || value[SEMANTICS_MARKER] !== true) return undefined;
  const issues = semanticIssues(value);
  return issues.length > 0 ? issues : undefined;
}

/**
 * The MODEL's view of one recognized envelope — compact and rendering-free.
 *
 * Keeps: the data (`series`/`facts`/`edges`), the caveats that must travel
 * with it (`grain`, `provenance`), the composed `not_covered` prose, a
 * non-null `clarify`, and the static note. Drops: the marker, `render`
 * (UI hint), the three-list `coverage` detail (rides the coverage channel
 * and the record), and a `clarify: null`. Shallow-copied so the history
 * entry is not the object the tool still holds.
 */
export function semanticsForModel(sem: ToolSemantics): Record<string, unknown> {
  return {
    ...(sem.series !== undefined && { series: sem.series.map((p) => ({ ...p })) }),
    ...(sem.facts !== undefined && { facts: sem.facts.map((f) => ({ ...f })) }),
    ...(sem.edges !== undefined && { edges: sem.edges.map((e) => ({ ...e })) }),
    ...(sem.grain !== undefined && { grain: { ...sem.grain } }),
    ...(sem.provenance !== undefined && { provenance: { ...sem.provenance } }),
    ...(sem.not_covered !== undefined &&
      sem.not_covered.length > 0 && { not_covered: [...sem.not_covered] }),
    ...(sem.clarify !== undefined &&
      sem.clarify !== null && {
        clarify: { question: sem.clarify.question, candidates: [...sem.clarify.candidates] },
      }),
    note: typeof sem.note === 'string' ? sem.note : SEMANTICS_NOTE,
  };
}

/** The envelope's coverage in the normalized three-list shape the coverage
 *  machinery reads — how `readCoverageResult` absorbs a semantic envelope's
 *  boundary into the one coverage channel. */
export function coverageOfSemantics(sem: ToolSemantics): Coverage {
  return {
    checked: sem.coverage?.checked ?? [],
    notChecked: sem.coverage?.not_checked ?? [],
    cannotCover: sem.coverage?.cannot_cover ?? [],
  };
}
