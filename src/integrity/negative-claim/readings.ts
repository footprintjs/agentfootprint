/**
 * readings — what makes two calls the SAME search, what makes one WIDER than another, and how
 * the reads of one search merge (design § 5.3).
 *
 * Pattern: every answer is read off the COMPOSED executed scope of each call (#199's
 *          `ComposedCoverage` items) — the tool, every filter in effect (a `whenOmitted` default
 *          composed as if sent), the `fixed` qualifiers, a host-filled identity filter by its
 *          reference, a period by its span resolved at dispatch, and the page asked for.
 *          Equivalent spellings of one executed span share a key; the same relative spelling
 *          at two dispatch instants does not. Never the tool name or
 *          the model-visible arguments alone. An inert argument is not in the scope, so it never
 *          splits a key; nor does a cap.
 * Role:    integrity/ layer (L3), read by `citation.ts`, `containment.ts` and `statement.ts`.
 *          Values compare by the library's one name rule (`lib/normalize.ts` · `sameName`);
 *          spans by the time layer's half-open ranges (`time/range.ts`).
 *
 * The merge: within one key a later read replaces only an UNREAD outcome; two reads that both
 * read and disagree — one empty, one with rows — are a disagreement, never settled by order.
 */

import { foldableWord, hasDigit, sameName, textOf } from '../../lib/normalize.js';
import { stableJson } from '../../lib/stableJson.js';
import type { ComposedItem, ComposedSpan } from '../../semantics/coverage/composedCoverage.js';
import type { DeclaredPeriod } from '../../semantics/coverage/period.js';
import { resultSpan } from '../../semantics/coverage/search/span.js';
import { instantOf } from '../../time/instant.js';
import { covers, fromInclusive, overlaps, sameRange, type TimeRange } from '../../time/range.js';
import type { SearchTool, TurnCall } from './types.js';

type SearchCheckedItem = ComposedItem;
type DeclaredTool = SearchTool;

// ─── values and spans ────────────────────────────────────────────────────

/** The value rule: strings by the one name rule (`sameName`); anything else by stable JSON. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return sameName(a, b);
  return stableJson(a) === stableJson(b);
}

/**
 * A value as a key spells it — one spelling for every value `sameValue` calls the same: a
 * string's text (`textOf`), with a foldable word lower-cased unless the text has a digit.
 */
export function spellValue(value: unknown): string {
  if (typeof value !== 'string') return `j:${stableJson(value) ?? 'undefined'}`;
  const text = textOf(value);
  if (hasDigit(text)) return `s:${text}`;
  return `s:${text
    .split(' ')
    .map((word) => (foldableWord(word) ? word.toLowerCase() : word))
    .join(' ')}`;
}

/** Whether `outer` holds all of `inner` (half-open). A malformed range holds nothing. */
export function holdsRange(outer: TimeRange, inner: TimeRange): boolean {
  try {
    return covers(outer, inner);
  } catch {
    return false;
  }
}

/** Whether two ranges share an instant. A malformed range is treated as overlapping. */
export function meets(a: TimeRange, b: TimeRange): boolean {
  try {
    return overlaps(a, b);
  } catch {
    return true;
  }
}

const msOf = (instant: string): number | undefined => instantOf(instant, 'lenient')?.ms;

/**
 * The parts of a read's `queried` time the store did not hold, half-open: all of it when `held`
 * is unknown, the parts outside `held` otherwise (#199's `span.ts` · `resultSpan` makes the
 * queried span half-open; the held one is made so the same way).
 */
export function unheldRanges(period: DeclaredPeriod): TimeRange[] {
  const queried = resultSpan(period);
  if (queried === undefined) return [];
  if (period.held === 'unknown') return [queried];
  let held: TimeRange;
  try {
    held = fromInclusive({ from: period.held.from, to: period.held.to });
  } catch {
    return [queried];
  }
  const [qf, qt, hf, ht] = [queried.from, queried.to, held.from, held.to].map(msOf);
  if (qf === undefined || qt === undefined || hf === undefined || ht === undefined)
    return [queried];
  if (ht <= qf || hf >= qt) return [queried];
  const out: TimeRange[] = [];
  if (qf < hf) out.push({ from: queried.from, to: held.from });
  if (ht < qt) out.push({ from: held.to, to: queried.to });
  return out;
}

/** A read's window: the span its period item ran with (dispatch time), else the result's. */
export function searchWindow(call: TurnCall): ComposedSpan | undefined {
  const item = (scopeOf(call) ?? []).find((i) => i.facet === 'period');
  if (item?.span !== undefined) return item.span;
  return call.row?.period === undefined ? undefined : resultSpan(call.row.period);
}

// ─── reads ───────────────────────────────────────────────────────────────

/** A call is a READ only when the caller says so; undeclared = `not-read` (§ 5.1). */
export const isRead = (call: TurnCall): boolean => call.effect === 'read';

/** The call's row is an `among` miss: it counts the names its source holds. */
export const isAmongRow = (call: TurnCall): boolean =>
  call.row?.checked.some((item) => item.facet === 'names') === true;

/** It ran and returned something the record can read as empty or not. */
export const returnedReading = (call: TurnCall): boolean =>
  call.outcome === 'ok' &&
  (call.emptiness === 'declared-absent' ||
    call.emptiness === 'undeclared-empty' ||
    call.emptiness === 'non-empty');

/** The composed executed scope: the row's, or the scope composed for a call with no row. */
export const scopeOf = (call: TurnCall): readonly SearchCheckedItem[] | undefined =>
  call.row?.checked ?? call.scope;

const SCOPE_FACETS = new Set<string>([
  'source',
  'subject',
  'population',
  'filter',
  'period',
  'page',
]);

const inScope = (item: SearchCheckedItem): boolean =>
  item.from !== 'result' && item.facet !== undefined && SCOPE_FACETS.has(item.facet);

/**
 * One item's value as the key spells it. A known period is its executed span,
 * normalized to instants so zone-offset spellings do not split one search.
 * A result's claimed queried period is never used to re-key the executed call.
 */
function valueOf(item: SearchCheckedItem): string {
  if (item.facet === 'period' && item.span !== undefined) {
    const from = instantOf(item.span.from, 'lenient');
    const to = instantOf(item.span.to, 'lenient');
    return from !== undefined && to !== undefined
      ? `span:${stableJson([from.ms, from.nanos, to.ms, to.nanos])}`
      : `invalid-span:${stableJson(item.span)}`;
  }
  if (item.any === true) return '*any';
  if (item.value !== undefined) return spellValue(item.value);
  return `what:${spellValue(item.what)}`;
}

/**
 * The page the call asked for: its `page` item, or — for a row that composed none — the value
 * of the tool's `page` argument.
 */
function pageOf(call: TurnCall, tool: DeclaredTool | undefined): string | undefined {
  if ((scopeOf(call) ?? []).some((item) => (item.facet as string) === 'page')) return undefined;
  const page = tool?.search?.arguments.find((a) => a.role === 'page');
  return page === undefined ? undefined : spellValue(call.arguments[page.name] ?? null);
}

/**
 * The reading key — or undefined when the call has no composed scope. `clock` is accepted for
 * the callers' symmetry and never read: the executed period was resolved at dispatch.
 */
export function readingKey(
  call: TurnCall,
  tool: DeclaredTool | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clock?: string,
): string | undefined {
  const items = scopeOf(call);
  if (items === undefined) return undefined;
  const entries = items
    .filter(inScope)
    .map((item) => [
      item.facet ?? '',
      item.argument ?? '',
      valueOf(item),
      item.from === 'host' ? 'host' : '',
    ])
    .map((entry) => entry.join('\u{1F}'))
    .sort();
  const page = pageOf(call, tool);
  return `${call.toolName}\u{0}${stableJson({ entries, page: page ?? null })}`;
}

// ─── the scope relation ──────────────────────────────────────────────────

/** A filter (or the population) the narrower search applied: its argument and value(s). */
export interface Narrowed {
  readonly argument: string;
  readonly values: readonly unknown[];
}

export interface ScopeRelation {
  /** `a` relative to `b`: `wider` = `a`'s scope holds all of `b`'s and more. */
  readonly relation: 'same' | 'wider' | 'narrower' | 'other';
  /** For `wider`: what `b` narrowed that `a` did not. */
  readonly narrowed: readonly Narrowed[];
  /** For `wider`: `b`'s window is strictly inside `a`'s. */
  readonly windowNarrowed: boolean;
}

const OTHER: ScopeRelation = Object.freeze({
  relation: 'other',
  narrowed: [],
  windowNarrowed: false,
});

function grouped(items: readonly SearchCheckedItem[]): Map<string, SearchCheckedItem[]> {
  const out = new Map<string, SearchCheckedItem[]>();
  for (const item of items.filter(inScope)) {
    const key = `${item.facet ?? ''}\u{1F}${item.argument ?? ''}`;
    out.set(key, [...(out.get(key) ?? []), item]);
  }
  return out;
}

type Step = 'equal' | 'wider' | 'narrower' | 'other';

const sameRangeSafe = (a: TimeRange, b: TimeRange): boolean => {
  try {
    return sameRange(a, b);
  } catch {
    return false;
  }
};

/** `a` against `b` for one group of items. */
function compareGroup(
  a: readonly SearchCheckedItem[],
  b: readonly SearchCheckedItem[],
  narrowed: Narrowed[],
  window: { narrowed: boolean },
): Step {
  const first = a[0] as SearchCheckedItem;
  const facet = first.facet;
  const spell = (items: readonly SearchCheckedItem[]) =>
    new Set(items.map((item) => `${valueOf(item)}\u{1F}${item.from === 'host' ? 'host' : ''}`));
  if (facet === 'population') {
    const sa = spell(a);
    const sb = spell(b);
    const aExtra = [...sa].some((v) => !sb.has(v));
    const bExtra = [...sb].some((v) => !sa.has(v));
    if (aExtra && bExtra) return 'other';
    if (aExtra) {
      narrowed.push({ argument: first.argument ?? '', values: b.map((item) => item.value) });
      return 'wider';
    }
    return bExtra ? 'narrower' : 'equal';
  }
  if (a.length !== 1 || b.length !== 1)
    return stableJson([...spell(a)].sort()) === stableJson([...spell(b)].sort())
      ? 'equal'
      : 'other';
  const ia = first;
  const ib = b[0] as SearchCheckedItem;
  if (
    facet === 'filter' &&
    ia.from !== 'fixed' &&
    ia.from !== 'host' &&
    ib.from !== 'fixed' &&
    ib.from !== 'host'
  ) {
    if (ia.any === true && ib.any === true) return 'equal';
    if (ia.any === true) {
      narrowed.push({ argument: ib.argument ?? '', values: [ib.value] });
      return 'wider';
    }
    if (ib.any === true) return 'narrower';
  }
  if (facet === 'period') {
    const pa = ia.span;
    const pb = ib.span;
    if (pa !== undefined && pb !== undefined) {
      if (sameRangeSafe(pa, pb)) return 'equal';
      if (holdsRange(pa, pb)) {
        window.narrowed = true;
        return 'wider';
      }
      return holdsRange(pb, pa) ? 'narrower' : 'other';
    }
    // One known window and one unresolved window are not proved to be the
    // same search even when the arguments contain the same relative words.
    if (pa !== undefined || pb !== undefined) return 'other';
  }
  return valueOf(ia) === valueOf(ib) && (ia.from === 'host') === (ib.from === 'host')
    ? 'equal'
    : 'other';
}

/**
 * How `a`'s composed scope relates to `b`'s. Different tools are always `other`. A period
 * compares the spans the calls ran with before any unresolved spelling — no clock is needed.
 */
export function scopeRelation(
  a: TurnCall,
  b: TurnCall,
  tool: DeclaredTool | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _clock?: string,
): ScopeRelation {
  const ia = scopeOf(a);
  const ib = scopeOf(b);
  if (a.toolName !== b.toolName || ia === undefined || ib === undefined) return OTHER;
  if (pageOf(a, tool) !== pageOf(b, tool)) return OTHER;
  const ga = grouped(ia);
  const gb = grouped(ib);
  const keys = new Set([...ga.keys(), ...gb.keys()]);
  const narrowed: Narrowed[] = [];
  const window = { narrowed: false };
  let wider = false;
  let narrower = false;
  for (const key of keys) {
    const xa = ga.get(key);
    const xb = gb.get(key);
    if (xa === undefined || xb === undefined) return OTHER;
    const step = compareGroup(xa, xb, narrowed, window);
    if (step === 'other') return OTHER;
    if (step === 'wider') wider = true;
    if (step === 'narrower') narrower = true;
  }
  if (wider && narrower) return OTHER;
  if (!wider)
    return { relation: narrower ? 'narrower' : 'same', narrowed: [], windowNarrowed: false };
  return {
    relation: 'wider',
    narrowed: narrowed.sort((x, y) =>
      x.argument < y.argument ? -1 : x.argument > y.argument ? 1 : 0,
    ),
    windowNarrowed: window.narrowed,
  };
}

// ─── the merge ───────────────────────────────────────────────────────────

const emptyClass = (call: TurnCall): 'empty' | 'rows' | 'other' =>
  call.emptiness === 'non-empty'
    ? 'rows'
    : call.emptiness === 'declared-absent' || call.emptiness === 'undeclared-empty'
    ? 'empty'
    : 'other';

/** The reads of one key, in order, merged. */
export function mergeKeyReadings(calls: readonly TurnCall[]): {
  readonly reading?: TurnCall;
  readonly disagree: boolean;
} {
  let reading: TurnCall | undefined;
  let disagree = false;
  for (const call of calls) {
    if (call.outcome !== 'ok') continue;
    if (reading === undefined) {
      reading = call;
      continue;
    }
    const pair = new Set([emptyClass(reading), emptyClass(call)]);
    if (pair.has('empty') && pair.has('rows')) disagree = true;
  }
  return { reading, disagree };
}
