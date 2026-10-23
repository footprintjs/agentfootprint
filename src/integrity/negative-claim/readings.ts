/**
 * readings — what makes two calls the SAME search, what makes one WIDER than another, and how
 * the reads of one search merge (design § 5.3).
 *
 * Pattern: every answer is read off the COMPOSED executed scope of each call — the tool, every
 *          filter in effect (a `whenOmitted` default composed as if sent), the `fixed`
 *          qualifiers, a host-filled identity filter by its reference, the window resolved on
 *          the LEG's clock (never the result's `period.queried`), and the page asked for. Never
 *          the tool name or the model-visible arguments alone: two calls with the same arguments
 *          and different host identities are two searches. An inert argument is not in the
 *          scope, so it never splits a key; nor does a cap.
 * Role:    integrity/ layer (L3), read by `citation.ts` and `containment.ts`.
 *
 * The merge: within one key a later read replaces only an UNREAD outcome; two reads that both
 * read and disagree — one empty, one with rows — are a disagreement, never settled by order.
 */

import { stableJson } from '../../lib/stableJson.js';
import type { DeclaredTool, SearchCheckedItem } from './searchRow.js';
import type { TurnCall } from './types.js';
import { spellValue } from './words.js';
import { periodValueSpan, type MsSpan } from './window.js';

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

const SCOPE_FACETS = new Set(['source', 'subject', 'population', 'filter', 'period', 'page']);

const inScope = (item: SearchCheckedItem): boolean =>
  item.from !== 'result' && item.facet !== undefined && SCOPE_FACETS.has(item.facet);

/**
 * One item's value as the key spells it. A relative window keys by its SPELLING: two calls of one
 * turn that sent `2h` asked for the same window, whatever leg each ran in.
 */
function valueOf(item: SearchCheckedItem): string {
  if (item.any === true) return '*any';
  if (item.value !== undefined) return spellValue(item.value);
  return `what:${spellValue(item.what)}`;
}

/** A period item's span for comparing two searches: the relative window on the turn's clock. */
function periodSpanOf(
  item: SearchCheckedItem,
  tool: DeclaredTool | undefined,
  clock: string,
): MsSpan | undefined {
  return item.value === undefined
    ? undefined
    : periodValueSpan(item.value, tool?.period?.spelling, clock);
}

/**
 * The page the call asked for: its `page` item, or — for a row that composed none — the value
 * of the tool's `page` argument.
 */
function pageOf(call: TurnCall, tool: DeclaredTool | undefined): string | undefined {
  if ((scopeOf(call) ?? []).some((item) => item.facet === 'page')) return undefined;
  const page = tool?.search?.arguments.find((a) => a.role === 'page');
  return page === undefined ? undefined : spellValue(call.arguments[page.name] ?? null);
}

/**
 * The reading key — or undefined when the call has no composed scope. `clock` is accepted for
 * the callers' symmetry and never read: a relative window keys by its spelling within the turn.
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

/** `a` against `b` for one group of items. */
function compareGroup(
  a: readonly SearchCheckedItem[],
  b: readonly SearchCheckedItem[],
  tool: DeclaredTool | undefined,
  clock: string,
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
    const pa = periodSpanOf(ia, tool, clock);
    const pb = periodSpanOf(ib, tool, clock);
    if (pa !== undefined && pb !== undefined) {
      if (pa.from === pb.from && pa.to === pb.to) return 'equal';
      if (pa.from <= pb.from && pb.to <= pa.to) {
        window.narrowed = true;
        return 'wider';
      }
      return pb.from <= pa.from && pa.to <= pb.to ? 'narrower' : 'other';
    }
  }
  return valueOf(ia) === valueOf(ib) && (ia.from === 'host') === (ib.from === 'host')
    ? 'equal'
    : 'other';
}

/** How `a`'s composed scope relates to `b`'s. Different tools are always `other`. */
export function scopeRelation(
  a: TurnCall,
  b: TurnCall,
  tool: DeclaredTool | undefined,
  clock: string,
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
    const step = compareGroup(xa, xb, tool, clock, narrowed, window);
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
