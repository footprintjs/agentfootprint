/**
 * search/gaps — the ground one call's search did NOT cover, typed.
 *
 * Pattern: one pure composer per list; this one is the gaps.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * Each gap names the facet it bears on, so a checker decides relevance by
 * facet and never by reading prose:
 *
 *   • `argument-unsent` — any classified argument of any role but `inert` the
 *     call did not send, with no `whenOmitted`, or sent as an empty list: its
 *     default may live inside `execute`, and an empty list names nothing (it is
 *     never "every value"). Bears on that argument's facet (cap and page:
 *     completeness).
 *   • `cap-reached` — rows at the cap in effect (an argument's, or the
 *     declared server cap), rows that cannot be counted under a cap, or a
 *     server cap of `'unknown'`. Bears on completeness.
 *   • `paged` — a page argument sent, a result whose `paging.next` is not
 *     null, or a tool with a `page` argument whose result declares no
 *     `paging`. Bears on completeness.
 *   • `partial` — the tool declared its outcome `partial` or `pending`.
 *   • `period` — the declared period's verdict is not `covered`.
 *   • `scope` — the declaration's own constants.
 *   • `prose` — a hand-written `notChecked` / `cannotCover` item; no facet.
 *
 * Every `what` the library writes here names an ARGUMENT or a verdict, never
 * a value the call sent.
 */

import type { CoverageGap, GapFacet } from '../composedCoverage.js';
import { periodVerdict, type DeclaredPeriod } from '../period.js';
import type { CoverageItem } from '../types.js';
import type { ArgumentReading } from './inEffect.js';
import type { PagingDeclaration } from './resultFacts.js';
import type { SearchArgument, SearchRole, ToolSearch } from './types.js';
import type { ToolResultStatus } from '../../toolOutcome.js';

/** What the gap composer reads. */
export interface GapInput {
  readonly search: ToolSearch;
  readonly readings: ReadonlyArray<readonly [SearchArgument, ArgumentReading]>;
  /** How many rows the result carried; `undefined` when it cannot be counted. */
  readonly rows: number | undefined;
  readonly paging?: PagingDeclaration;
  readonly period?: DeclaredPeriod;
  readonly status?: ToolResultStatus;
  readonly handNotChecked: readonly CoverageItem[];
  readonly handCannotCover: readonly CoverageItem[];
}

/** The gaps, and the two plain lists every older reader prints. */
export interface ComposedGaps {
  readonly gaps: readonly CoverageGap[];
  readonly notChecked: readonly CoverageItem[];
  readonly cannotCover: readonly CoverageItem[];
}

/** The facet an unsent argument of each role bears on. */
function unsentFacet(arg: SearchArgument): GapFacet | undefined {
  const byRole: Readonly<Record<SearchRole, GapFacet | undefined>> = {
    population: 'population',
    filter: { filter: arg.name },
    period: 'period',
    source: 'source',
    cap: 'completeness',
    page: 'completeness',
    query: 'population',
    match: 'population',
    inert: undefined,
  };
  return byRole[arg.role];
}

/** A cap value in effect as a number, or `undefined` when it is no whole count. */
function capOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function unsentGaps(input: GapInput): CoverageGap[] {
  const out: CoverageGap[] = [];
  for (const [arg, reading] of input.readings) {
    if (reading.kind !== 'unsent' && reading.kind !== 'empty') continue;
    const bears = unsentFacet(arg);
    if (bears === undefined) continue;
    // An empty list names no value — like an unsent argument, its effect lives in `execute`.
    const what = reading.kind === 'empty' ? `${arg.name}: an empty list` : `${arg.name}: not sent`;
    out.push({ kind: 'argument-unsent', what, argument: arg.name, bears });
  }
  return out;
}

function capGaps(input: GapInput): CoverageGap[] {
  const out: CoverageGap[] = [];
  const atCap = (cap: number | undefined): boolean =>
    cap === undefined || input.rows === undefined || input.rows >= cap;
  for (const [arg, reading] of input.readings) {
    if (arg.role !== 'cap') continue;
    if (reading.kind !== 'sent' && reading.kind !== 'default') continue;
    if (atCap(capOf(reading.value))) {
      out.push({
        kind: 'cap-reached',
        what: `rows may stop at the cap (${arg.name})`,
        argument: arg.name,
        bears: 'completeness',
      });
    }
  }
  const server = input.search.limits?.cap;
  if (server !== undefined && (server === 'unknown' || atCap(server))) {
    out.push({
      kind: 'cap-reached',
      what: server === 'unknown' ? 'the server cap is unknown' : 'rows may stop at the server cap',
      bears: 'completeness',
    });
  }
  return out;
}

function pagingGaps(input: GapInput): CoverageGap[] {
  const out: CoverageGap[] = [];
  const pages = input.readings.filter(([a]) => a.role === 'page');
  for (const [arg, reading] of pages) {
    if (reading.kind === 'sent') {
      out.push({
        kind: 'paged',
        what: `a page past the first (${arg.name})`,
        argument: arg.name,
        bears: 'completeness',
      });
    }
  }
  if (input.paging !== undefined && input.paging.next !== null) {
    out.push({ kind: 'paged', what: 'more pages after this one', bears: 'completeness' });
  } else if (input.paging === undefined && pages.length > 0) {
    out.push({
      kind: 'paged',
      what: 'whether more pages exist (no paging declared)',
      bears: 'completeness',
    });
  }
  return out;
}

/**
 * The read sees only what the caller's credential may see — declared
 * (`limits.byCredential`) or read off an argument the host fills from a
 * credential. One gap, whatever the count; it names no value and no credential.
 */
function credentialGaps(input: GapInput): CoverageGap[] {
  const filled = input.readings.some(([, reading]) => reading.kind === 'credential');
  if (input.search.limits?.byCredential !== true && !filled) return [];
  return [
    {
      kind: 'credential-limited',
      what: "within what the caller's credential may see",
      bears: 'population',
    },
  ];
}

/**
 * A `query` or `match` argument in effect: the population is what matched, by
 * a rule only the tool knows — a gap on the population, every call.
 */
function matchGaps(input: GapInput): CoverageGap[] {
  return input.readings
    .filter(
      ([a, r]) =>
        (a.role === 'query' || a.role === 'match') && (r.kind === 'sent' || r.kind === 'default'),
    )
    .map(([a]) => ({
      kind: 'match' as const,
      what: `${a.name}: matched by the tool's own rule`,
      argument: a.name,
      bears: 'population' as const,
    }));
}

/** `ranking: 'approximate'` — the rows nearest, never every row that fits. */
function rankingGaps(input: GapInput): CoverageGap[] {
  if (input.search.ranking !== 'approximate') return [];
  return [
    { kind: 'ranking', what: 'rows ranked by approximate similarity', bears: 'completeness' },
  ];
}

function statusGaps(input: GapInput): CoverageGap[] {
  if (input.status !== 'partial' && input.status !== 'pending') return [];
  return [
    { kind: 'partial', what: `the tool said its result is ${input.status}`, bears: 'completeness' },
  ];
}

function periodGaps(input: GapInput): CoverageGap[] {
  if (input.period === undefined) return [];
  const verdict = periodVerdict(input.period);
  return verdict === 'covered'
    ? []
    : [{ kind: 'period', what: `period: ${verdict}`, bears: 'period' }];
}

const proseGap = (item: CoverageItem): CoverageGap => ({
  kind: 'prose',
  what: item.what,
  ...(item.why !== undefined && { why: item.why }),
});

/**
 * Every gap of one call, in a fixed order, with the plain lists: the
 * composed gaps (but `period`, which the period row carries) and the
 * hand-written `notChecked` under `notChecked`; the declared constants and the
 * hand-written `cannotCover` under `cannotCover`.
 */
export function composeGaps(input: GapInput): ComposedGaps {
  const scope: CoverageGap[] = (input.search.gaps ?? []).map((g) => ({
    kind: 'scope',
    what: g.what,
    why: g.why,
    bears: g.bears,
  }));
  const composed = [
    ...unsentGaps(input),
    ...capGaps(input),
    ...pagingGaps(input),
    ...statusGaps(input),
    ...credentialGaps(input),
    ...matchGaps(input),
    ...rankingGaps(input),
  ];
  const gaps = [
    ...composed,
    ...periodGaps(input),
    ...scope,
    ...input.handNotChecked.map(proseGap),
    ...input.handCannotCover.map(proseGap),
  ];
  return {
    gaps,
    notChecked: [...composed.map((g) => ({ what: g.what })), ...input.handNotChecked],
    cannotCover: [
      ...scope.map((g) => ({ what: g.what, why: g.why as string, kind: 'scope' as const })),
      ...input.handCannotCover,
    ],
  };
}

/** The gap kinds that keep a row from being complete — and `prose`, which names no facet. */
export function blocksComplete(gap: CoverageGap): boolean {
  return gap.kind === 'argument-unsent' || gap.kind === 'prose' || gap.bears === 'completeness';
}
