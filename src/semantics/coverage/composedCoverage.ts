/**
 * composedCoverage — the coverage row the LIBRARY composes for one call of a
 * tool that declares its search (`Tool.search`).
 *
 * Pattern: one row type, read by the claim checker. Pure data; TYPE-only
 *          imports, and one type guard.
 * Role:    the contract between the dispatch funnel that writes the row
 *          (`../../core/agent/stages/toolCalls.ts` · `declareCoverage`, via
 *          `search/compose.ts`) and every reader that judges a "not found",
 *          "none" or "the full list" against it.
 * Emits:   N/A.
 *
 * ## Why the library writes it, not the tool
 *
 * A tool author's prose about what a search covered is unreliable: a
 * registered study found that a note overstating what was checked made the
 * model's replies WORSE. So the tool declares, once and as typed data, what a
 * search is made of, and the library composes each call's row from the
 * arguments the call actually ran with. Composition can only under-claim: a
 * facet enters `checked` from a value the call sent, a declared default composed
 * as if sent, a declared fixed qualifier, the declared (or sent) source or a
 * host-filled identity key — and every classified argument none of those
 * covers is a bearing gap. The subject is an item too (`facet: 'subject'`):
 * the statement a checker writes from the row alone names it.
 *
 * ## The fields, as revision 5 of the design names them (§ 3.2)
 *
 * The row is a {@link DeclaredCoverage} — the same row `coverageDeclared`
 * holds for every tool — with these fields more: `composed`, `resultId`, typed
 * `checked` items, `complete` and `gaps` (and `overclaim`, written by the
 * dispatch-time overclaim check of a later release). Its `notChecked` and `cannotCover`
 * lists stay the plain-prose view every older reader (the limits block, the
 * answer account) already prints: the gaps' `what` / `why`, with no facet.
 */

import type { DeclaredPeriod } from './period.js';
import type { CoverageItem, DeclaredCoverage } from './types.js';

/**
 * What one composed item is ABOUT — the dimension a claim's scope is measured
 * on. `subject` is what the search looked for; `names` is an `among` miss's
 * count of the known names (`absent({ among })`).
 */
export type CoverageFacet = 'source' | 'subject' | 'population' | 'filter' | 'period' | 'names';

/**
 * Where a composed item came from — the four places of the under-claim proof,
 * and `result` for a fact the tool's result declared (it can only narrow, or
 * add a gap).
 *
 *   • `call`    — a value the call SENT (after the inputs layer's fill and any
 *                 before-tool rewrite: what the tool ran with);
 *   • `default` — a declared `whenOmitted` the call left out, composed as if
 *                 sent (the value form), or no narrowing (`{ any: true }`);
 *   • `fixed`   — a qualifier the tool always applies (`search.fixed`);
 *   • `tool`    — the declared source;
 *   • `result`  — a fact the result declared (its `period.queried` when no
 *                 period argument was in effect);
 *   • `host`    — an argument the host fills from the run's IDENTITY
 *                 (`hostFilled(…, { tenantId: fromIdentity('tenant') })`): a
 *                 filter in effect, its value by reference only. A
 *                 credential-filled argument is never composed.
 */
export type FacetOrigin = 'call' | 'default' | 'fixed' | 'tool' | 'result' | 'host';

/** The value of a host-filled facet — WHICH identity field, never the value itself. */
export interface IdentityReference {
  readonly identity: string;
}

/**
 * The entity a population value RESOLVED to, as the tool's result said
 * (`resolved: [{ argument, id, name?, aliases? }]`). Attached only to the item
 * for the value the call was SENT for, and only when that value is one of the
 * entity's own names (`id`, `name` or an alias): store data cannot bind
 * another entity's name.
 */
export interface ResolvedEntity {
  readonly id: string;
  readonly name?: string;
  readonly aliases?: readonly string[];
}

/** A half-open span of instants (`[from, to)`), ISO 8601 with a zone. */
export interface ComposedSpan {
  readonly from: string;
  readonly to: string;
}

/**
 * One piece of ground the library composed. `what` is library-composed text
 * — `<argument>: <value>`, `<argument>: any`, `<name>: <value>` for a fixed
 * qualifier, or the declared source's `what` — never a sentence the tool
 * wrote.
 */
export interface ComposedItem extends CoverageItem {
  readonly facet: CoverageFacet;
  /** The input argument (or fixed qualifier) this facet is — absent for the declared source. */
  readonly argument?: string;
  /**
   * The value in effect, RAW. Absent when `any` is set and for the declared
   * source; an {@link IdentityReference} for a host-filled facet.
   */
  readonly value?: unknown;
  /**
   * The value (or `resolved`) came from outside the declaration — the call or
   * the result — so a writer that puts it in a statement QUOTES it, strips it
   * to one line and caps it. Stored raw here; marked, never rewritten.
   */
  readonly quote?: true;
  /** Omission narrows nothing (`whenOmitted: { any: true }`). */
  readonly any?: true;
  readonly from: FacetOrigin;
  /** The entity a population value resolved to — see {@link ResolvedEntity}. */
  readonly resolved?: ResolvedEntity;
  /**
   * The declared words for this facet value — `source.said`, a fixed
   * qualifier's `said`, a filter value's `said` entry. Carried on the row so a
   * checker reading committed rows only can match a claim's words; never
   * served to the model.
   */
  readonly said?: readonly string[];
  /** `among` (a `names` facet): how many names the source holds. */
  readonly count?: number;
  /** `among` (a `names` facet): which source the names were read from. */
  readonly source?: string;
  /** `among` (a `names` facet): when that source was measured. */
  readonly measuredAt?: string;
  /**
   * A period facet's span: a relative window (`'2h'`) resolved against the
   * TURN's clock, so the same spelling in one turn is the same span; or the
   * result's own `period.queried` (`from: 'result'`).
   */
  readonly span?: ComposedSpan;
}

/** A filter facet a gap bears on, and the values it concerns (absent = every value). */
export interface FilterFacet {
  readonly filter: string;
  readonly values?: readonly (string | number | boolean)[];
}

/**
 * The facet a gap BEARS on — the closed vocabulary a checker decides
 * relevance by. `completeness` is the facet of a cap and of paging: rows the
 * search did not return could be any rows.
 */
export type GapFacet = 'source' | 'population' | 'period' | 'completeness' | FilterFacet;

/** Every kind of gap. A reader never switches exhaustively over it. */
export type CoverageGapKind =
  | 'argument-unsent'
  | 'cap-reached'
  | 'paged'
  | 'period'
  | 'partial'
  | 'credential-limited'
  | 'scope'
  | 'prose';

/**
 * One piece of ground the call did NOT cover, typed.
 *
 *   • `argument-unsent` — a classified argument the call did not send and the
 *     declaration gives no `whenOmitted` for: its default may live inside
 *     `execute`, so it bears on that argument's facet.
 *   • `cap-reached` — the rows reached the cap in effect (an argument's, or the
 *     declared server cap), or the server cap is `'unknown'`.
 *   • `paged` — a page argument was sent, the result's `paging.next` is not
 *     null, or a tool with a `page` argument returned no `paging`.
 *   • `period` — the declared period's verdict is not `covered`.
 *   • `partial` — the tool declared its outcome `partial` (or `pending`): the
 *     result is never held in full.
 *   • `credential-limited` — the read sees only what the caller's credential
 *     may see (`limits.byCredential`, or an argument `hostFilled` fills from a
 *     credential). Bears on the population; names no value and no credential.
 *   • `scope` — a declared constant (`search.gaps`).
 *   • `prose` — a hand-written `notChecked` / `cannotCover` item. It names no
 *     facet, so it bears on every claim, and a row with one is never complete.
 */
export interface CoverageGap {
  readonly kind: CoverageGapKind;
  /** Library-composed for every kind but `scope` and `prose` (the author's words). */
  readonly what: string;
  readonly why?: string;
  /** The facet it bears on. Absent only on `prose`: it bears on everything. */
  readonly bears?: GapFacet;
  /** The argument the gap is about (`argument-unsent`, `cap-reached`, `paged`). */
  readonly argument?: string;
}

/**
 * What the funnel composes for one call of a `search` tool — revision 5's
 * § 3.2 row, field for field, with the subject as a `checked` item.
 *
 * `composed: 'remote'` marks a row whose declaration arrived over MCP or from a
 * `ToolProvider`: it is composed the same way so a reader sees one shape, it
 * is never `complete`, and it establishes nothing.
 */
export interface ComposedCoverage extends DeclaredCoverage {
  readonly composed: 'local' | 'remote';
  /**
   * The row's ADDRESS — the library-minted result identity
   * (`claim-result/<namespace>/<runId>/<ordinal>`, minted by
   * `integrity/claim-binding/capture.ts` · `resultIdentityOf`). Never a
   * provider's call id: those repeat across iterations, branches, resume legs
   * and turns, and some providers mint none.
   */
  readonly resultId: string;
  readonly checked: readonly ComposedItem[];
  /**
   * True only for a LOCAL row whose declaration says `complete:
   * 'within-arguments'` and that carries no `argument-unsent`, no
   * `completeness` gap and no `prose` gap. Absent `complete` in the
   * declaration = never complete.
   */
  readonly complete: boolean;
  readonly gaps: readonly CoverageGap[];
  /** As on every row — the period the result declared. */
  readonly period?: DeclaredPeriod;
  /**
   * Codes the dispatch-time overclaim check marked on this row (design § 4) —
   * written by that check, never by composition; absent when none.
   */
  readonly overclaim?: readonly string[];
}

/** Whether a `coverageDeclared` row was composed by the library from a `search`. */
export function isComposedCoverage(row: DeclaredCoverage): row is ComposedCoverage {
  const r = row as Partial<ComposedCoverage>;
  return (r.composed === 'local' || r.composed === 'remote') && Array.isArray(r.gaps);
}
