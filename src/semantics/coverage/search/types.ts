/**
 * search/types — what a tool declares about its search (`Tool.search`).
 *
 * Pattern: declaration vocabulary, pure data. Validated once at `defineTool`
 *          (`declaration.ts` · `assertToolSearch`) and at the MCP ingest door
 *          with the same rule; read by the funnel's composer (`compose.ts`).
 * Role:    semantics/ layer. TYPE-only.
 * Emits:   N/A.
 */

import type { GapFacet } from '../composedCoverage.js';

/**
 * What one input argument DOES to the ground a call covers — a closed set.
 *
 *   • `population` — which rows: one facet per value sent (a list gives one per item);
 *   • `filter`     — narrows the rows;
 *   • `period`     — the time read (the argument `Tool.period` names);
 *   • `source`     — picks the store: a sent value REPLACES the declared source;
 *   • `cap`        — at most this many rows;
 *   • `page`       — which page of the rows;
 *   • `inert`      — changes the bytes, not the ground (a format, a sort).
 */
export type SearchRole = 'population' | 'filter' | 'period' | 'source' | 'cap' | 'page' | 'inert';

/** A value a declaration may name — a default, a fixed qualifier's value. */
export type SearchScalar = string | number | boolean;

/** `whenOmitted: { any: true }` — omission narrows nothing. */
export interface AnyValue {
  readonly any: true;
}

/**
 * What `execute` does when the call leaves the argument out — TWO typed forms,
 * no third: the default VALUE `execute` applies (composed as if sent), or
 * `{ any: true }`. With neither, an unsent argument is a bearing gap: its
 * default may live inside `execute`.
 */
export type WhenOmitted = SearchScalar | readonly SearchScalar[] | AnyValue;

/** One input argument, classified. EVERY property of `inputSchema` needs one. */
export interface SearchArgument {
  readonly name: string;
  readonly role: SearchRole;
  readonly whenOmitted?: WhenOmitted;
  /**
   * The words a claim may use for each VALUE of a `filter` or `source`
   * argument — `{ critical: ['critical', 'sev1'] }`. Allowed on those two
   * roles only.
   */
  readonly said?: Readonly<Record<string, readonly string[]>>;
}

/** A thing the search is made of, and the words a claim may use for it. */
export interface SearchWords {
  readonly what: string;
  /** Non-empty. The ONLY vocabulary a prose claim's words are matched to. */
  readonly said: readonly string[];
}

/** A qualifier the tool ALWAYS applies — part of the search's scope. */
export interface SearchFixed {
  /** Not an input property; unique among the fixed qualifiers. */
  readonly name: string;
  readonly value: SearchScalar;
  /** Required: a claim that does not name the qualifier is wider than the search. */
  readonly said: readonly string[];
}

/** A ground the search NEVER reaches — a build-time constant. */
export interface SearchGap {
  readonly what: string;
  /** Required: a blind spot with no reason cannot be acted on or disproved. */
  readonly why: string;
  /** Required: the facet it bears on. */
  readonly bears: GapFacet;
}

/** Limits no input property carries. */
export interface SearchLimits {
  /** A server-side cap on the rows; `'unknown'` when the tool cannot say. */
  readonly cap: number | 'unknown';
}

/**
 * WHAT ONE CALL OF THIS TOOL SEARCHES — declared once; the library composes
 * each call's coverage from it and the arguments the call ran with.
 *
 * @example
 * ```ts
 * search: {
 *   source: { what: 'the incident store', said: ['the incident store'] },
 *   subject: { what: 'incidents', said: ['incident', 'incidents'] },
 *   fixed: [{ name: 'status', value: 'open', said: ['open'] }],
 *   arguments: [
 *     { name: 'service', role: 'population' },
 *     { name: 'window', role: 'period', whenOmitted: '2h' },
 *   ],
 *   complete: 'within-arguments',
 * }
 * ```
 */
export interface ToolSearch {
  readonly source: SearchWords;
  readonly subject: SearchWords;
  readonly fixed?: readonly SearchFixed[];
  readonly arguments: readonly SearchArgument[];
  /**
   * The tool's statement that a call is complete for the population, filters
   * and period in effect when no cap was reached and no page was open. Absent
   * = never complete.
   */
  readonly complete?: 'within-arguments';
  readonly gaps?: readonly SearchGap[];
  readonly limits?: SearchLimits;
}
