/**
 * semantics/types — the semantic tool-result vocabulary, as a PURE leaf
 * (9.53.0, the `toolOutcome.ts` precedent).
 *
 * WHY IT LIVES HERE. Two sides read these words and neither may own the
 * other: the agent loop's dispatch boundary (core/agent/stages/toolCalls.ts)
 * recognizes the envelope at run time, and the `check:semantics` build gate
 * (lib/semantics/check.ts) judges the same shapes with no agent anywhere in
 * sight. Declaring the vocabulary in a leaf both sides import keeps the
 * dependency pointing the right way — the loop and the gate depend on the
 * words, never on each other.
 *
 * The one exception to "zero imports" is TYPE-ONLY and deliberate: the
 * envelope's `coverage` field ABSORBS the existing coverage vocabulary
 * (`CoverageItem` / `CoverageInput`, core/agent/coverage/types.ts — itself a
 * pure-data leaf) instead of duplicating it. Two spellings of "ground this
 * result does not cover" would eventually disagree; type-only imports erase
 * at runtime, so this module stays a runtime leaf.
 *
 * ## What the envelope is
 *
 * A tool that answers "how many IOPS did fc1/3 do last hour?" today returns
 * prose or an ad-hoc object, and every caveat that makes the number honest —
 * the collection interval, whether the values are counters that must not be
 * summed, when the world was actually measured, which clusters were not
 * collected — is re-implemented by hand inside every tool and held in place
 * by review. Culture scales to one disciplined author; it does not scale to
 * a hundred tools. The semantic envelope makes those caveats TYPED DATA that
 * travel with the values, so honesty is inherited, not re-authored — and so
 * a build gate can refuse a triage tool that forgot its own limits.
 *
 * It is a SIBLING recognizer beside the effects envelope and the coverage
 * primitives — its own reserved marker (`af_semantics`, the
 * `af_absent`/`af_coverage` family), never new keys on the effects envelope.
 * The three compose on one result: `{ content: semantic({…}), effects: […],
 * status }` is a tool that returns typed data AND proposes a transition.
 */

import type { CoverageDeclaration, CoverageItem } from '../../core/agent/coverage/types.js';

/**
 * The reserved key that makes a semantic envelope recognizable. Reserved
 * vocabulary on the tool-result wire (the `af_absent` / `af_coverage`
 * precedent): a plain object carrying `af_semantics: true` that validates
 * cleanly is an envelope; every other value any tool has ever returned keeps
 * its bytes.
 */
export const SEMANTICS_MARKER = 'af_semantics';

/**
 * One measured point. `t` is the tool's own clock words (an ISO string or an
 * epoch number — the library never reinterprets it), `entity` is what was
 * measured, `metric` names the measurement, `value` is the reading.
 */
export interface SemanticSeriesPoint {
  readonly t: string | number;
  readonly entity: string;
  readonly metric: string;
  readonly value: number | string | boolean | null;
}

/**
 * One row of typed facts about one entity. The columns are the tool's own —
 * this library requires only that every row says WHAT it is about.
 */
export interface SemanticFact {
  readonly entity: string;
  readonly [field: string]: unknown;
}

/** One typed relationship — "this VM rides that datastore", "this zone
 *  contains that WWPN". `kind` names the relationship in the tool's words. */
export interface SemanticEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly [field: string]: unknown;
}

/**
 * The grain — what one value MEANS, stated when it is not what a reader
 * would assume. This is the field that stops a model from adding
 * `jobs_local` to `jobs_replicated_in` and announcing a fleet size nobody
 * has.
 */
export interface SemanticGrain {
  /** The collection interval the values live on ('30m', '1h', 'daily'). */
  readonly interval?: string;
  /** How the values were folded ('avg', 'max', 'sum', 'count', …). */
  readonly aggregation?: string;
  /**
   * Whether the values are counters. MUST be stated (true or false) whenever
   * `aggregation` is counter-looking (see
   * {@link COUNTER_AGGREGATION_WORDS}): summing two counters double-counts,
   * and a reader cannot tell a counter from a gauge by looking at a number.
   */
  readonly is_counter?: boolean;
  /** What was folded away ('per-port rows collapsed to per-switch'). */
  readonly collapsed?: string;
}

/**
 * Where the values came from and how old they are. `measured_at` is when the
 * WORLD was measured — not when the tool ran; a tool that reads a nightly
 * export and answers in 4ms is serving yesterday.
 */
export interface SemanticProvenance {
  /** When the world was measured (the tool's own clock words). Required
   *  whenever the envelope carries `series` or `facts`. */
  readonly measured_at: string;
  /** How stale the data was when the tool answered, in seconds. */
  readonly age_seconds?: number;
  /** The system of record the values were read from. Required with
   *  `measured_at`. */
  readonly source: string;
  /** For file-fed collectors: the export the values rode in on. */
  readonly source_export_date?: string;
}

/**
 * The ask-vs-answer decision, as data. A tool that matched three volumes for
 * one WWN should not pick one silently — it should hand the question and the
 * candidates back, typed, so the loop (or a UI) can ask.
 */
export interface SemanticClarify {
  readonly question: string;
  /** The candidates the question is choosing between. May be empty — an open
   *  question is still a question. */
  readonly candidates: readonly unknown[];
}

/**
 * Rendering HINTS — the tool never renders. A UI that understands them draws
 * a better table; one that does not loses nothing, because everything load-
 * bearing is in the data fields. Dropped from the model's view entirely.
 */
export interface SemanticRender {
  /** The default presentation ('table', 'chart', 'prose', …). A hint. */
  readonly default: string;
  /** Column order for a tabular view. */
  readonly columns?: readonly string[];
  /** Sort hint ('avg_iops desc'). */
  readonly sort?: string;
  /** A note about what filtering already happened ('replicas excluded'). */
  readonly filter_note?: string;
  /** Chart-shape hint ('line per entity'). */
  readonly chart_hint?: string;
}

/**
 * The envelope's coverage, normalized — the SAME three-list vocabulary the
 * `coverage()` / `absent()` primitives speak (checked / not checked / cannot
 * cover), in the snake_case spelling every rendered tool shape uses because
 * a model reads it more often than code does. Declared through
 * {@link SemanticDeclaration.coverage} with the exact `CoverageDeclaration`
 * input the `coverage()` primitive takes; the dispatch loop declares it
 * through the same channel (`tools.coverage_declared`, tracked state, the
 * final-answer limits block) — absorbed, never duplicated.
 */
export interface SemanticCoverage {
  readonly checked?: readonly CoverageItem[];
  readonly not_checked?: readonly CoverageItem[];
  readonly cannot_cover?: readonly CoverageItem[];
}

/**
 * What a tool author passes to `semantic()`. At least one of `series`,
 * `facts`, `edges` or a non-null `clarify` must be present — an envelope
 * with no data and no question declares nothing.
 *
 * `not_covered` is deliberately NOT here: the prose list on the rendered
 * envelope is DERIVED from `coverage` (not checked + cannot cover), so the
 * two can never disagree. Declaring coverage is how not_covered is said.
 */
export interface SemanticDeclaration {
  readonly series?: readonly SemanticSeriesPoint[];
  readonly facts?: readonly SemanticFact[];
  readonly edges?: readonly SemanticEdge[];
  readonly grain?: SemanticGrain;
  readonly provenance?: SemanticProvenance;
  /** The coverage()-vocabulary declaration this envelope absorbs. */
  readonly coverage?: CoverageDeclaration;
  /** `null` states "ambiguity was considered; there is none" — a fact, kept
   *  on the record. Omit the field to say nothing. */
  readonly clarify?: SemanticClarify | null;
  readonly render?: SemanticRender;
}

/**
 * The rendered semantic envelope — the exact object a tool hands back.
 * Field names are snake_case and English on purpose (the `ToolAbsence`
 * precedent): this value is read by a language model far more often than by
 * code, and `af_semantics` is the only field that exists for the machine.
 */
export interface ToolSemantics {
  readonly af_semantics: true;
  readonly series?: readonly SemanticSeriesPoint[];
  readonly facts?: readonly SemanticFact[];
  readonly edges?: readonly SemanticEdge[];
  readonly grain?: SemanticGrain;
  readonly provenance?: SemanticProvenance;
  readonly coverage?: SemanticCoverage;
  /** DERIVED from `coverage` (not checked + cannot cover), one prose line
   *  per item — never author-set, so the list and the lists cannot drift. */
  readonly not_covered?: readonly string[];
  readonly clarify?: SemanticClarify | null;
  readonly render?: SemanticRender;
  /** The static sentence. Never interpolated — see `envelope.ts`. */
  readonly note: string;
}

/**
 * The declared class of a tool's RESULTS — what kind of answer this tool
 * gives, stated by whoever wrote it (`defineTool({ resultClass })`; the
 * `capabilities` law: declared, never inferred). The `check:semantics` gate
 * keys its per-class rules on it:
 *
 *   • `'triage'` — a verdict about health or fault. Every sample result must
 *     declare coverage: a triage that cannot say what it did NOT check turns
 *     "everything looks fine" into a claim about ground it never stood on.
 *   • `'inventory'` — a population listing. Every sample result must declare
 *     coverage ("4 of 5 clusters"), and one with `facts` but no `render`
 *     hint is warned at.
 *
 * Two classes, deliberately closed: each carries a rule the gate can PROVE.
 * A class with no rule would be dead vocabulary.
 */
export type ToolResultClass = 'triage' | 'inventory';

/** The closed set, as data — validators and docs read one list. */
export const RESULT_CLASSES: readonly ToolResultClass[] = ['triage', 'inventory'];

/**
 * Aggregation words that suggest the values are counters — the words that
 * make `grain.is_counter` REQUIRED (stated true or false). Matched as whole
 * tokens, singular or plural, case-insensitive.
 */
export const COUNTER_AGGREGATION_WORDS: readonly string[] = [
  'sum',
  'count',
  'total',
  'cumulative',
  'counter',
  'delta',
];

/**
 * The static sentence every semantic envelope carries in the model's view.
 * Never interpolated (the `ABSENCE_NOTE` law): everything else the model
 * reads is the tool's own data, and a note that quoted any of it back would
 * hand the evidence corpus a second copy of values it already indexes.
 */
export const SEMANTICS_NOTE =
  'Typed data, not prose. `grain` and `provenance` are caveats that travel with the ' +
  'numbers: check `is_counter` before summing values from a series, read `measured_at` ' +
  '(and `age_seconds`) as how old the data is, and treat everything under `not_covered` ' +
  'as ground this result does NOT cover — a clean look here says nothing about it.';
