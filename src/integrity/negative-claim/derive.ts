/** Evidence-owned interpretation. No model kind, label or summary enters these rules.
 * Each read keeps its own recorded scope; several reads never become a broader union. */
import type { ComposedItem } from '../../semantics/coverage/composedCoverage.js';
import { isAmongRow, sameValue, scopeOf } from './readings.js';
import type { NegativeKind, TurnCall } from './types.js';

/** Classify the fact a read could support; the existing checker still judges it.
 * Complete is a candidate only for nonempty readings, and must still satisfy
 * row.complete and all completeness/sequence rules. An unqualified empty list
 * never becomes absence or an indirectly asserted complete empty list. */
export function deriveCitationKind(reads: readonly TurnCall[]): NegativeKind | undefined {
  const kinds = reads.map((call): NegativeKind | undefined => {
    if (call.emptiness === 'declared-absent') return isAmongRow(call) ? 'not-found' : 'none';
    return call.emptiness === 'non-empty' && !isAmongRow(call) ? 'complete' : undefined;
  });
  const first = kinds[0];
  return first !== undefined && kinds.every((kind) => kind === first) ? first : undefined;
}

function subjects(call: TurnCall): readonly unknown[] {
  return (scopeOf(call) ?? []).filter((item) => item.facet === 'subject').map((item) => item.what);
}

/** Cross-tool peers need the app's same declared subject. Within one tool an
 * undeclared subject cannot prove a reading unrelated to its sibling. */
export function sameRecordedSubject(a: TurnCall, b: TurnCall): boolean {
  const left = subjects(a);
  const right = subjects(b);
  if (left.length === 0 || right.length === 0) return a.toolName === b.toolName;
  return left.some((l) => right.some((r) => sameValue(l, r)));
}

function populations(call: TurnCall): Map<string, ComposedItem[]> {
  const groups = new Map<string, ComposedItem[]>();
  for (const item of scopeOf(call) ?? []) {
    if (item.facet !== 'population' || item.argument === undefined) continue;
    groups.set(item.argument, [...(groups.get(item.argument) ?? []), item]);
  }
  return groups;
}

const concrete = (call: TurnCall, argument: string, items: readonly ComposedItem[]): boolean =>
  call.row !== undefined &&
  !call.row.gaps.some((gap) => gap.kind === 'match' && gap.argument === argument) &&
  items.length > 0 &&
  items.every((item) => item.any !== true && item.value !== undefined);

/** Only the runtime-admitted resolution attached to the sent value supplies
 * aliases. No token, substring or model-answer match establishes overlap. */
function names(item: ComposedItem): readonly unknown[] {
  return [
    item.value,
    item.resolved?.id,
    item.resolved?.name,
    ...(item.resolved?.aliases ?? []),
  ].filter((value) => value !== undefined);
}

/** Population values in one argument are alternatives; different arguments
 * are separate dimensions. A shared concrete dimension can prove disjointness.
 * Missing, differently named, or `any` dimensions cannot. */
export function populationsMayOverlap(a: TurnCall, b: TurnCall): boolean {
  const left = populations(a);
  const right = populations(b);
  for (const [argument, l] of left) {
    const r = right.get(argument);
    if (r === undefined || !concrete(a, argument, l) || !concrete(b, argument, r)) continue;
    if (
      !l.some((li) =>
        r.some((ri) => names(li).some((lv) => names(ri).some((rv) => sameValue(lv, rv)))),
      )
    )
      return false;
  }
  return true;
}
