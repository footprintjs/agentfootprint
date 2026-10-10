/**
 * semantics/envelope — minting, recognizing and projecting the semantic
 * tool-result envelope (9.53.0).
 *
 * Pattern: minted by a helper, RECOGNIZED by the framework (the `absent()` /
 *          tool-effects precedent). A return shape the framework does not
 *          understand is a convention, and a convention cannot ride the
 *          record, feed a UI, or be refused by a build gate.
 * Role:    lib/ layer, pure. The dispatch loop calls `readSemantics` at the
 *          execute boundary; `describedResult()` is what a tool author writes;
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
 * ## One rule set for authoring and recognition
 *
 * The mint refuses a declaration this vocabulary cannot honor at the
 * CALL SITE (the `absent()` law) — so a minted envelope is honest by
 * construction: series carry their grain, data carries its provenance,
 * counter-looking aggregations state `is_counter`. `semanticIssues()` judges
 * the RENDERED shape — the same rules over a value somebody may have built
 * by hand — and is what recognition and the `check:semantics` gate both
 * stand on. Recognition is STRICT (the zero-cost guarantee): a marker-
 * bearing value with any issue is NOT recognized — it keeps its bytes on
 * the data path (dev-warned, and named field-by-field by the gate), because
 * this library does not half-apply a shape it cannot fully honor.
 *
 * ## One authoring door, one unchanged wire
 *
 * `describedResult()` declares camelCase names, then `mintSemantics` applies
 * the same rule set used to recognize stored snake_case envelopes. Validation
 * and record reading keep one owner; old wire records never need an adapter.
 */

import { normalizeCoverageList } from '../../core/agent/coverage/items.js';
import {
  copyPeriod,
  mintPeriod,
  noteWithClause,
  periodProblem,
  readPeriod,
  servedPeriod,
  type DeclaredPeriod,
} from '../../core/agent/coverage/period.js';
import { refusal, refuseUnknownKeys } from '../../core/agent/coverage/refusal.js';
import type {
  Coverage,
  CoverageDeclaration,
  CoverageItem,
} from '../../core/agent/coverage/types.js';
import {
  COUNTER_AGGREGATION_WORDS,
  SEMANTICS_MARKER,
  SEMANTICS_NOTE,
  type DescribedResultDeclaration,
  type SemanticClarify,
  type SemanticCoverage,
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
  // Honesty step 7b: what the read behind the data covered in time. An OLDER
  // reader refuses a whole envelope that carries it (this set is its law), so
  // the changelog names the floor.
  'period',
  'coverage',
  'not_covered',
  'clarify',
  'render',
  'note',
]);
const GRAIN_KEYS = new Set(['interval', 'aggregation', 'is_counter', 'collapsed']);
const PROVENANCE_KEYS = new Set(['measured_at', 'age_seconds', 'source', 'source_export_date']);
const COVERAGE_KEYS = new Set(['checked', 'not_checked', 'cannot_cover']);
/**
 * The keys a {@link SemanticClarify} has — spelled the same in declarations
 * and recorded envelopes — tied to the type in BOTH directions.
 */
export const CLARIFY_DECLARATION_KEYS: readonly string[] = Object.keys({
  question: true,
  candidates: true,
} satisfies Record<keyof SemanticClarify, true>);
const CLARIFY_KEYS = new Set(CLARIFY_DECLARATION_KEYS);
const RENDER_KEYS = new Set(['default', 'columns', 'sort', 'filter_note', 'chart_hint']);

/**
 * The six fields whose WIRE name is snake_case — the only names a declaration
 * door may spell differently. Everything else (`interval`, `source`,
 * `default`, the data rows, the eight top-level fields) is one word on both
 * sides.
 */
export type SpelledField =
  | 'is_counter'
  | 'measured_at'
  | 'age_seconds'
  | 'source_export_date'
  | 'filter_note'
  | 'chart_hint';

/** How one door's author spells each {@link SpelledField}. */
export type Spelling = Readonly<Record<SpelledField, string>>;

/** The wire's own spelling — what `semanticIssues`, recognition, the gate
 *  speak. */
export const WIRE_SPELLING: Spelling = {
  is_counter: 'is_counter',
  measured_at: 'measured_at',
  age_seconds: 'age_seconds',
  source_export_date: 'source_export_date',
  filter_note: 'filter_note',
  chart_hint: 'chart_hint',
};

/** The objects inside a declaration whose keys a door checks by name. */
export type DeclaredObject = 'grain' | 'provenance' | 'coverage' | 'clarify' | 'render';

/** The objects inside a declaration a door copies into their wire spelling. */
export type RespelledObject = 'grain' | 'provenance' | 'render';

/**
 * How the authoring door spells its declaration and translates it to the
 * wire. The rule set is shared with record recognition; only field spelling
 * differs between authoring refusals and stored-record findings.
 */
export interface DeclarationDoor {
  /** The helper's name, for the one refusal that names the call itself. */
  readonly name: string;
  /** The top-level keys a declaration may carry. */
  readonly declarationKeys: readonly string[];
  /** The keys that would hand-write the DERIVED `not_covered` prose list. */
  readonly derivedKeys: readonly string[];
  /** Each object a declaration may carry, with the keys it has in this
   *  door's spelling — refused BEFORE anything is copied. */
  readonly objectKeys: ReadonlyArray<readonly [field: DeclaredObject, known: readonly string[]]>;
  /** Copy one declared object into the wire's spelling, keeping key order.
   *  What it does with a value that is not a plain object is the door's own
   *  call: the rule set names whatever reaches the candidate. */
  readonly toWire: (field: RespelledObject, value: unknown) => unknown;
  /** How this door's author spells the six snake_case wire fields. */
  readonly spelling: Spelling;
}

/** Compose the `not_covered` prose lines FROM coverage — the one derivation,
 *  used by the mint and by the drift check, so the two can never disagree. */
export function composeNotCovered(coverage: SemanticCoverage): readonly string[] {
  const items = [...(coverage.not_checked ?? []), ...(coverage.cannot_cover ?? [])];
  return items.map((i) => (i.why !== undefined ? `${i.what} — ${i.why}` : i.what));
}

function malformed(field: string, message: string): SemanticIssue {
  return { code: 'malformed-semantics', field, message };
}

/**
 * The fault for an EMPTY data list — `series: []`, `facts: []`, `edges: []` —
 * which names the one door for "nothing matched": `absent()`.
 *
 * The rule itself is unchanged (a data list is never empty, so "nothing
 * matched" has exactly one door). What changed is the advice: it used to say
 * "omit the field to say nothing", and following it on the found branch's
 * only data field walked straight into the next refusal ("this result
 * declares nothing"). And the fault is data-dependent — a tool with no empty
 * branch passes every test that has rows and refuses on its first empty read
 * in production, where the MODEL reads this text in place of the data — so it
 * says the branch to write, in the author's own helper names. One core, so
 * the declaration door and the `check:semantics` gate say the same.
 */
function emptyDataList(field: 'series' | 'facts' | 'edges'): SemanticIssue {
  return malformed(
    field,
    `\`${field}\` is empty — if nothing matched, return absent({ what, checked }) instead.`,
  );
}

/**
 * Detach one declared data list (`series`, `facts`, `edges`) for the candidate
 * envelope. A list — or any other iterable a plain-JavaScript author handed
 * over, which always minted — is copied into a fresh array. A value that is
 * NOT a list passes through untouched so the rule set names it for what it is:
 * a spread would have thrown a `TypeError` on a plain object or a number (a
 * crash that does not read as a refusal, in the one place the model reads
 * it), and turned a string into its characters, refused as a malformed ROW.
 */
function copyDataList(value: unknown): unknown {
  if (typeof value === 'string' || typeof value !== 'object' || value === null) return value;
  const iterate = (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator];
  return typeof iterate === 'function' ? [...(value as Iterable<unknown>)] : value;
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
 * THE provenance rule — one present `provenance` object, in the wire's
 * spelling, judged; every fault, each naming its field the way `s` spells it.
 * `issuesIn` asks it for a described result, and `coverage/absent.ts` asks it
 * for an absence's `provenance` (honesty step 7b), so the two doors cannot
 * disagree about what a well-formed source and time is: `measured_at` and
 * `source` required, `age_seconds` a finite number ≥ 0, `source_export_date`
 * a non-empty string, no other key.
 */
export function provenanceIssues(provenance: unknown, s: Spelling): SemanticIssue[] {
  const measuredAt = s.measured_at;
  const ageSeconds = s.age_seconds;
  const sourceExportDate = s.source_export_date;
  if (!isPlainObject(provenance)) {
    return [
      malformed(
        'provenance',
        `\`provenance\` must be an object ({ ${measuredAt}, source, ${ageSeconds}?, ${sourceExportDate}? }).`,
      ),
    ];
  }
  const issues: SemanticIssue[] = [];
  for (const key of Object.keys(provenance)) {
    if (!PROVENANCE_KEYS.has(key))
      issues.push(
        malformed(`provenance.${key}`, `\`provenance.${key}\` is not a provenance field.`),
      );
  }
  if (!isNonEmptyString(provenance.measured_at)) {
    issues.push({
      code: 'data-without-provenance',
      field: `provenance.${measuredAt}`,
      message:
        `\`provenance.${measuredAt}\` must say when the WORLD was measured — a tool reading a ` +
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
        `provenance.${ageSeconds}`,
        `\`provenance.${ageSeconds}\` must be a finite number ≥ 0 or omitted.`,
      ),
    );
  }
  if (
    provenance.source_export_date !== undefined &&
    !isNonEmptyString(provenance.source_export_date)
  ) {
    issues.push(
      malformed(
        `provenance.${sourceExportDate}`,
        `\`provenance.${sourceExportDate}\` must be a non-empty string or omitted.`,
      ),
    );
  }
  return issues;
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
  return issuesIn(value, WIRE_SPELLING);
}

/**
 * The rule set itself, over the wire-spelled `value`, naming each field the
 * way `s` spells it. Recognition and the gate pass the wire's
 * own spelling; `describedResult()` passes camelCase, so its author reads
 * `grain.isCounter` for the field they wrote. Only the six {@link
 * SpelledField}s differ, and only in the words — never in what is judged.
 */
function issuesIn(value: unknown, s: Spelling): SemanticIssue[] {
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
          `this result carries '${key}', which is not a field this vocabulary has. The ` +
            `fields are: series, facts, edges, grain, provenance, period, coverage, clarify, ` +
            `render (not_covered and note are derived).`,
        ),
      );
    }
  }

  // ── series ──
  const series = value.series;
  if (series !== undefined) {
    if (Array.isArray(series) && series.length === 0) {
      issues.push(emptyDataList('series'));
    } else if (!Array.isArray(series)) {
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
    if (Array.isArray(facts) && facts.length === 0) {
      issues.push(emptyDataList('facts'));
    } else if (!Array.isArray(facts)) {
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
    if (Array.isArray(edges) && edges.length === 0) {
      issues.push(emptyDataList('edges'));
    } else if (!Array.isArray(edges)) {
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
  const isCounter = s.is_counter;
  if (grain !== undefined) {
    if (!isPlainObject(grain)) {
      issues.push(
        malformed(
          'grain',
          `\`grain\` must be an object ({ interval?, aggregation?, ${isCounter}?, collapsed? }).`,
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
              `grain.${isCounter}`,
              `\`grain.${isCounter}\` must be a boolean — "stated" means true or false, never prose.`,
            ),
          );
        } else says = true;
      }
      if (!says && issues.every((i) => !i.field.startsWith('grain'))) {
        issues.push(
          malformed(
            'grain',
            `\`grain\` says nothing — state at least one of interval, aggregation, ${isCounter}, collapsed, or omit the field.`,
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
          field: `grain.${isCounter}`,
          message:
            `grain.aggregation is '${grain.aggregation.trim()}', which is counter-looking, and ` +
            `\`${isCounter}\` is not stated. Summing counters double-counts, and a reader cannot ` +
            `tell a counter from a gauge by looking at a number — state \`${isCounter}: true\` or ` +
            `\`${isCounter}: false\`.`,
        });
      }
    }
  }

  // ── provenance ── (the ONE rule, `provenanceIssues`, which `absent()` asks too)
  const provenance = value.provenance;
  const hasData = series !== undefined || facts !== undefined;
  if (provenance !== undefined) {
    issues.push(...provenanceIssues(provenance, s));
  } else if (hasData) {
    issues.push({
      code: 'data-without-provenance',
      field: 'provenance',
      message:
        `this result carries series/facts with no \`provenance\` — \`provenance.${s.measured_at}\` and ` +
        '`provenance.source` are required whenever the envelope carries data: a number with ' +
        'no age and no source cannot be trusted or audited.',
    });
  }

  // ── period ── (honesty step 7b — the ONE rule, `coverage/period.ts` · `periodProblem`).
  // Judged in the WIRE's spelling whatever the door: the candidate a mint judges
  // carries a period `mintPeriod` already refused in its author's words, so a
  // fault here is always one read off an envelope minted elsewhere.
  if (value.period !== undefined) {
    const problem = periodProblem(value.period, 'wire');
    if (problem !== undefined) issues.push(malformed(problem.field, problem.message));
  }

  // ── series ⇒ grain ──
  if (series !== undefined && grain === undefined) {
    issues.push({
      code: 'series-without-grain',
      field: 'grain',
      message:
        'this result carries `series` with no `grain` — a time-series with no stated ' +
        'interval/aggregation reads as whatever the reader assumes, which is how counters get ' +
        'summed and windows get compared across different intervals.',
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
          `\`render\` must be an object ({ default, columns?, sort?, ${s.filter_note}?, ${s.chart_hint}? }).`,
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
      for (const [key, spelled] of [
        ['sort', 'sort'],
        ['filter_note', s.filter_note],
        ['chart_hint', s.chart_hint],
      ] as const) {
        if (render[key] !== undefined && !isNonEmptyString(render[key])) {
          issues.push(
            malformed(
              `render.${spelled}`,
              `\`render.${spelled}\` must be a non-empty string or omitted.`,
            ),
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
        'this result declares nothing — an envelope needs data (series, facts or edges) or a ' +
          'question (clarify). Caveats with nothing to caveat are not a result.',
      ),
    );
  }

  return issues;
}

/**
 * The declared `coverage`, normalized by the SAME validator the
 * `coverage()`/`absent()` primitives use (one validator, three doors), then
 * respelled snake_case for the rendered envelope. `undefined` when none was
 * declared.
 */
function mintedCoverage(declared: unknown): SemanticCoverage | undefined {
  if (declared === undefined) return undefined;
  if (!isPlainObject(declared)) {
    throw refusal(`\`coverage\` must be a { checked?, notChecked?, cannotCover? } declaration.`);
  }
  const cov = declared as CoverageDeclaration;
  const checked = normalizeCoverageList('checked', cov.checked, false);
  const notChecked = normalizeCoverageList('notChecked', cov.notChecked, false);
  const cannotCover = normalizeCoverageList('cannotCover', cov.cannotCover, true);
  if (checked.length + notChecked.length + cannotCover.length === 0) {
    throw refusal(
      `\`coverage\` names no ground at all — declare at least one item across ` +
        `checked/notChecked/cannotCover, or omit the field (absent means "not declared", ` +
        `never "nothing there").`,
    );
  }
  return {
    ...(checked.length > 0 && { checked }),
    ...(notChecked.length > 0 && { not_checked: notChecked }),
    ...(cannotCover.length > 0 && { cannot_cover: cannotCover }),
  };
}

/**
 * The ONE mint behind `describedResult()`. Refuses (throws, at the call site — the `absent()` law) any
 * declaration this vocabulary cannot honor, in the door's own words; returns
 * the rendered envelope otherwise.
 *
 * In order: the declaration must be an object; a hand-written `not_covered`
 * is refused as derived; every key the declaration and its objects carry must
 * be one the door reads (a casing slip names the spelling meant); coverage is
 * normalized; the candidate is built in the WIRE spelling; and the whole rule
 * set judges it, naming each field as the door's author spelled it.
 */
export function mintSemantics(
  decl: DescribedResultDeclaration,
  door: DeclarationDoor,
): ToolSemantics {
  // Deliberately not the isPlainObject guard: its predicate would REPLACE
  // the declared field types with an index signature for the rest of the
  // function (each declaration type is assignable to it, so it narrows).
  if (typeof decl !== 'object' || decl === null || Array.isArray(decl)) {
    // The accepted fields come from the authoring vocabulary itself.
    const fields = door.declarationKeys.map((key) => `${key}?`).join(', ');
    throw refusal(
      `${door.name}() takes a declaration — { ${fields} } with at least one of ` +
        `series/facts/edges/clarify.`,
    );
  }
  const derived = door.derivedKeys.find((key) => Object.prototype.hasOwnProperty.call(decl, key));
  if (derived !== undefined) {
    throw refusal(
      `\`${derived}\` is derived, never declared — declare \`coverage\` ` +
        `({ notChecked, cannotCover }) and the prose list is composed from it, so the two ` +
        `can never disagree.`,
    );
  }
  refuseUnknownKeys(decl, door.declarationKeys);
  for (const [field, known] of door.objectKeys) {
    const nested: unknown = decl[field];
    if (isPlainObject(nested)) refuseUnknownKeys(nested, known, field);
  }

  const coverage = mintedCoverage(decl.coverage);
  const notCovered = coverage !== undefined ? composeNotCovered(coverage) : [];
  // Honesty step 7b: a top-level `period`, minted by the ONE period rule set
  // (refused in the author's own camelCase words).
  const period = 'period' in decl ? mintPeriod((decl as { period?: unknown }).period) : undefined;
  const candidate: Record<string, unknown> = {
    [SEMANTICS_MARKER]: true,
    ...(decl.series !== undefined && { series: copyDataList(decl.series) }),
    ...(decl.facts !== undefined && { facts: copyDataList(decl.facts) }),
    ...(decl.edges !== undefined && { edges: copyDataList(decl.edges) }),
    ...(decl.grain !== undefined && { grain: door.toWire('grain', decl.grain) }),
    ...(decl.provenance !== undefined && {
      provenance: door.toWire('provenance', decl.provenance),
    }),
    ...(period !== undefined && { period }),
    ...(coverage !== undefined && { coverage }),
    ...(notCovered.length > 0 && { not_covered: notCovered }),
    ...('clarify' in decl &&
      decl.clarify !== undefined && {
        clarify: decl.clarify === null ? null : copyClarify(decl.clarify),
      }),
    ...(decl.render !== undefined && { render: door.toWire('render', decl.render) }),
    note: SEMANTICS_NOTE,
  };

  // One rule set, one implementation: the mint judges its own candidate with
  // the exact validator recognition and the gate use, and refuses the first
  // fault at the call site — in the words the door's author wrote.
  const issues = issuesIn(candidate, door.spelling);
  if (issues.length > 0) {
    const first = issues[0];
    throw refusal(`${first.message} (field: ${first.field})`);
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

// LENS · tool-result · persistent-history
// reads: the declared ToolSemantics envelope only — a compact projection that may not overclaim coverage
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * The MODEL's view of one recognized envelope — compact and rendering-free.
 *
 * Keeps: the data (`series`/`facts`/`edges`), the caveats that must travel
 * with it (`grain`, `provenance`), the composed `not_covered` prose, a
 * non-null `clarify`, and the static note. Drops: the marker, `render`
 * (UI hint), the three-list `coverage` detail (rides the coverage channel
 * and the record), and a `clarify: null`. Shallow-copied so the history
 * entry is not the object the tool still holds.
 *
 * The period is served as the tool declared it — plus, when the store did not
 * hold all of the time the read asked about, the verdict word inside it and
 * that word's one clause after the note (`coverage/period.ts` ·
 * `servedPeriod`; honesty step 7b, bench round 1). A `covered` period and an
 * envelope with none are served byte for byte as before.
 */
export function semanticsForModel(sem: ToolSemantics): Record<string, unknown> {
  const served = servedPeriod(sem.period);
  const note = typeof sem.note === 'string' ? sem.note : SEMANTICS_NOTE;
  return {
    ...(sem.series !== undefined && { series: sem.series.map((p) => ({ ...p })) }),
    ...(sem.facts !== undefined && { facts: sem.facts.map((f) => ({ ...f })) }),
    ...(sem.edges !== undefined && { edges: sem.edges.map((e) => ({ ...e })) }),
    ...(sem.grain !== undefined && { grain: { ...sem.grain } }),
    ...(sem.provenance !== undefined && { provenance: { ...sem.provenance } }),
    // Served as the tool declared it (honesty step 7b), with the verdict word
    // when the store did not hold all of it.
    ...(sem.period !== undefined && {
      period: served?.period ?? periodOnWireCopy(sem.period),
    }),
    ...(sem.not_covered !== undefined &&
      sem.not_covered.length > 0 && { not_covered: [...sem.not_covered] }),
    ...(sem.clarify !== undefined &&
      sem.clarify !== null && {
        clarify: { question: sem.clarify.question, candidates: [...sem.clarify.candidates] },
      }),
    note: served === undefined ? note : noteWithClause(note, served.clause),
  };
}

/** A wire period as detached plain data — the projection's copy. */
function periodOnWireCopy(period: NonNullable<ToolSemantics['period']>): unknown {
  return {
    queried: { from: period.queried.from, to: period.queried.to },
    held: period.held === 'unknown' ? 'unknown' : { from: period.held.from, to: period.held.to },
    ...(period.read_at !== undefined && { read_at: period.read_at }),
  };
}

/**
 * The period a RECOGNIZED envelope declared, in the record's camelCase form
 * (honesty step 7b) — `undefined` when it declared none. Recognition already
 * held the period to the rule set (a fault keeps the whole envelope data), so
 * this is a read, never a judgement.
 */
export function periodOfSemantics(sem: ToolSemantics): DeclaredPeriod | undefined {
  const read = readPeriod(sem.period);
  return read.period === undefined ? undefined : copyPeriod(read.period);
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
