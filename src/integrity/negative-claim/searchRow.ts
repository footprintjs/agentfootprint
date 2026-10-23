/**
 * searchRow — the PR 2 shapes this checker reads, as LOCAL STAND-INS.
 *
 * TO BE REPLACED on rebase by PR 2's exported types (`Tool.search` and the composed coverage
 * row it makes `declareCoverage` file): one edit, this file only — every other module of the
 * checker imports these names from here. Field for field with
 * `docs/design/2026-10-negative-claims.md` (revision 5) § 3.1 (the declaration), § 3.2 (the
 * composed row, `resultId` included) and § 3.3 (`among`).
 *
 * One addition the note's § 3.2 example does not show: the row carries the search's SUBJECT
 * as a checked item (`facet: 'subject'`, `from: 'tool'`), because the statement (§ 5.1) is
 * written from the row alone and names the subject. PR 2 composes it from `search.subject.what`.
 */

import type { DeclaredPeriod } from '../../semantics/coverage/period.js';

/**
 * The facet a checked item stands for. `names` is `among`'s count of known names; `page` the page
 * the call asked for.
 */
export type SearchFacet =
  | 'source'
  | 'subject'
  | 'population'
  | 'filter'
  | 'period'
  | 'names'
  | 'page';

/** Where a checked item came from (§ 3.2, § 3.4's five places plus the result). */
export type SearchItemFrom = 'call' | 'default' | 'fixed' | 'host' | 'result' | 'tool';

/** The entity a population value was resolved to — for the value the call was sent for only. */
export interface SearchResolved {
  readonly id: string;
  readonly name?: string;
  readonly aliases?: readonly string[];
}

/** One composed item of a search's scope — a `CoverageItem` with typed fields. */
export interface SearchCheckedItem {
  readonly what: string;
  readonly facet?: SearchFacet;
  readonly argument?: string;
  /** The value in effect. A host-filled one is a REFERENCE (`{ identity: 'tenant' }`), never the value. */
  readonly value?: unknown;
  /** The filter narrowed nothing (`whenOmitted: { any: true }`). */
  readonly any?: true;
  readonly from?: SearchItemFrom;
  readonly resolved?: SearchResolved;
  /** `among` (§ 3.3): how many names the source holds, which source, when it was measured. */
  readonly count?: number;
  readonly source?: string;
  readonly measuredAt?: string;
}

/** What a gap bears on (§ 3.1, § 3.2). A filter gap names the VALUES it concerns; none = every value. */
export type GapBears =
  | 'source'
  | 'population'
  | 'period'
  | 'completeness'
  | { readonly filter: string; readonly values?: readonly unknown[] };

/** The typed gaps of § 3.2. */
export type SearchGapKind =
  | 'scope'
  | 'argument-unsent'
  | 'cap-reached'
  | 'paged'
  | 'partial'
  | 'period'
  | 'prose';

export interface SearchGap {
  readonly kind: SearchGapKind;
  readonly what: string;
  readonly why?: string;
  readonly argument?: string;
  /** Absent only on a `prose` gap — a hand-written `notChecked` names no facet. */
  readonly bears?: GapBears;
}

/** The row `declareCoverage` commits for one call of a `search` tool (or an `among` miss). */
export interface ComposedSearchRow {
  readonly kind: 'absence' | 'ledger';
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly iteration: number;
  /** The library-minted result identity (`claim-result/<ns>/<runId>/<ordinal>`). */
  readonly resultId?: string;
  /** Only a local first-party tool composes `'local'`; a remote declaration establishes nothing. */
  readonly composed: 'local' | 'remote';
  readonly lookedFor?: string;
  readonly checked: readonly SearchCheckedItem[];
  readonly complete: boolean;
  readonly gaps: readonly SearchGap[];
  readonly period?: DeclaredPeriod;
  /** Codes the dispatch-time overclaim check marked on this row (§ 4). */
  readonly overclaim?: readonly string[];
}

/** An input property's role (§ 3.1). */
export type SearchArgumentRole =
  | 'population'
  | 'filter'
  | 'period'
  | 'source'
  | 'cap'
  | 'page'
  | 'inert';

export interface SearchArgument {
  readonly name: string;
  readonly role: SearchArgumentRole;
  /** A default composed as if sent, or `{ any: true }`. */
  readonly whenOmitted?: unknown;
  /** A filter value's words: `{ critical: ['critical', 'sev1'] }`. */
  readonly said?: Readonly<Record<string, readonly string[]>>;
}

/** `Tool.search` (§ 3.1) — the words and roles this checker reads. */
export interface SearchDeclaration {
  readonly source: { readonly what: string; readonly said?: readonly string[] };
  readonly subject: { readonly what: string; readonly said: readonly string[] };
  readonly fixed?: readonly {
    readonly name: string;
    readonly value: unknown;
    readonly said: readonly string[];
  }[];
  readonly arguments: readonly SearchArgument[];
  readonly complete?: 'within-arguments';
  /** A server-side cap no input property carries. */
  readonly limits?: { readonly cap: number | 'unknown' };
}

/** A tool as the checker sees it: its `search`, and `Tool.period`'s argument and spelling. */
export interface DeclaredTool {
  readonly name: string;
  readonly search?: SearchDeclaration;
  readonly period?: {
    readonly argument: string;
    readonly spelling: 'lookback' | 'signed-lookback' | 'iso-range' | 'wall-range';
  };
}
