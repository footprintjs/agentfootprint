/**
 * conflictsOf — the exclusion comparison, pure.
 *
 * Pattern: pure function over a finite assertion set. No I/O, no store.
 * Role:    the algebra's first comparison: two `asserted` (never quoted)
 *          assertions on one single-valued `(subject, predicate, epoch)`
 *          key with different comparable values cannot both be true.
 *
 * What it deliberately does NOT do:
 *   - fire across strata (history is quotation);
 *   - compare unknowns (honest absence — an unknown neither corroborates
 *     nor contradicts);
 *   - fire on multi-valued predicates (the declared exception);
 *   - infer subject identity (no stamp, no comparison);
 *   - resolve anything — it names pairs; the caller files findings.
 *
 * Values compare by structural equality over their comparable face (a
 * known `Claim` compares by its value), via JSON with sorted keys — the
 * same determinism bar the house holds serialization to elsewhere.
 */

import { assertionKey, comparableValueOf, participates, type Assertion } from './types.js';

/** One exclusion: the two-or-more assertions that cannot all be true. */
export interface Conflict {
  readonly key: string;
  /** Every distinct-valued assertion on the key, in input order. */
  readonly assertions: readonly Assertion[];
}

/** Deterministic structural rendering — sorted keys, no ambient state. */
function renderValue(value: unknown): string {
  const face = comparableValueOf(value);
  return JSON.stringify(face, (_k, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as object).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}

/**
 * Find every single-valued key carrying two or more distinct values.
 *
 * @param assertions the finite set under comparison (one payload, or one
 *                   write-delta joined with the standing set for a subject)
 * @param multiValued predicates exempt from single-valuedness, declared
 */
export function conflictsOf(
  assertions: readonly Assertion[],
  multiValued: ReadonlySet<string> = new Set(),
): readonly Conflict[] {
  const byKey = new Map<string, { byValue: Map<string, Assertion[]>; order: Assertion[] }>();

  for (const a of assertions) {
    if (a.stratum !== 'asserted') continue; // history is quotation
    if (multiValued.has(a.predicate)) continue; // the declared exception
    if (!participates(a.value)) continue; // unknowns never compare
    const key = assertionKey(a);
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = { byValue: new Map(), order: [] };
      byKey.set(key, entry);
    }
    const rendered = renderValue(a.value);
    const bucket = entry.byValue.get(rendered);
    if (bucket === undefined) entry.byValue.set(rendered, [a]);
    else bucket.push(a);
    entry.order.push(a);
  }

  const conflicts: Conflict[] = [];
  for (const [key, entry] of byKey) {
    if (entry.byValue.size < 2) continue;
    conflicts.push({ key, assertions: entry.order });
  }
  return conflicts;
}
