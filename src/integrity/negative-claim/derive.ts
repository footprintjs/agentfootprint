/** Evidence-owned scope and absence spelling. The model selects a claim; native
 * reads determine whether it holds. Several reads never become a broader union. */
import { textOf } from '../../lib/normalize.js';
import type { ComposedItem } from '../../semantics/coverage/composedCoverage.js';
import { isAmongRow, sameValue, scopeOf } from './readings.js';
import { holdsName, tokensOf } from './matcher.js';
import type { NegativeKind, TurnCall } from './types.js';

/** Only normalize the absence family, after every cited read explicitly declares
 * absence. Never turn a negative into complete, or downgrade requested completeness. */
export function deriveCitationKind(
  requested: NegativeKind,
  reads: readonly TurnCall[],
): NegativeKind | undefined {
  if (
    requested === 'complete' ||
    !reads.every((call) => call.outcome === 'ok' && call.emptiness === 'declared-absent')
  )
    return requested;
  const kinds = reads.map((call): NegativeKind => (isAmongRow(call) ? 'not-found' : 'none'));
  const first = kinds[0];
  return first !== undefined && kinds.every((kind) => kind === first) ? first : undefined;
}

const SUBJECT_LIMIT = 256;
const scalar = (value: unknown): value is string | number =>
  (typeof value === 'string' && value.length > 0 && value.length <= SUBJECT_LIMIT) ||
  (typeof value === 'number' && Number.isFinite(value));

/** Each recorded population value remains a separate subject. An unavailable,
 * all-populations or non-scalar subject cannot be validated against model prose. */
function subjectsOf(call: TurnCall): readonly (string | number)[] | undefined {
  const population = (scopeOf(call) ?? []).filter((item) => item.facet === 'population');
  if (population.length === 0) {
    const name = isAmongRow(call) ? call.row?.lookedFor : undefined;
    return scalar(name) ? [name] : undefined;
  }
  if (
    population.length > SUBJECT_LIMIT ||
    population.some((item) => item.from === 'host' || item.any === true || !scalar(item.value))
  )
    return undefined;
  return population.map((item) => item.value as string | number);
}

/** Canonical public population values only; never model text or a first-value
 * shortcut. The delivery adapter may expose a scalar only when this has one value. */
export function derivedSubjects(reads: readonly TurnCall[]): readonly (string | number)[] {
  const result: (string | number)[] = [];
  for (const call of reads) {
    const values = subjectsOf(call);
    if (values === undefined) return [];
    for (const value of values) {
      if (!result.some((known) => sameValue(known, value))) result.push(value);
      if (result.length > SUBJECT_LIMIT) return [];
    }
  }
  return result;
}

/** Bounded text normalization, without deleting hidden characters or accents. */
function normalized(value: string | number): string | undefined {
  const raw = String(value);
  if (raw.length > SUBJECT_LIMIT) return undefined;
  const text = textOf(raw);
  return text.length > 0 && text.length <= SUBJECT_LIMIT * 4 && !/[\p{Cc}\p{Cf}]/u.test(text)
    ? text
    : undefined;
}

/** A supplied label must contain EVERY recorded subject. This checks the label's
 * scope only; its surrounding prose and any negative wording remain unchecked. */
export function aboutContainsSubjects(about: string | number, reads: readonly TurnCall[]): boolean {
  const phrase = normalized(about);
  const values = derivedSubjects(reads);
  const tokens = phrase === undefined ? [] : tokensOf(phrase);
  return (
    phrase !== undefined &&
    values.length > 0 &&
    values.every((value) => {
      const subject = normalized(value);
      return (
        subject !== undefined && (sameValue(phrase, subject) || holdsName(phrase, tokens, subject))
      );
    })
  );
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
