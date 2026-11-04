import type { InjectionContext } from '../types.js';
import type { CursorMove } from './graphCursor.js';
import { devWarn } from '../devWarn.js';

/**
 * Memoize `nextSkill` per EVALUATION PASS.
 *
 * `evaluateInjections` hands ONE `ctx` object to every trigger in a pass, and
 * (since 8.3.0) every graph-compiled trigger — entry and route target alike —
 * asks `nextSkill(ctx)`. Without this, a graph with E entries and R routes pays
 * O(E × (E + R)) predicate calls per iteration instead of O(E + R): a 15-entry
 * regex router would re-run all 15 regexes 15 times per turn.
 *
 * Keyed on ctx IDENTITY in a WeakMap, so entries vanish with the context object
 * and a fresh iteration always recomputes. Safe because the resolver is pure over
 * `ctx` (route/entry predicates are documented as "pure + total"); the memo can
 * only make a pass MORE self-consistent, never less. `graph.nextSkill` and
 * `graph.explainNextSkill` are left un-memoized — they are public API called once
 * per iteration, and a consumer that mutates a ctx object between calls must still
 * get a fresh answer.
 *
 * Memoizes the whole `CursorMove` and projects `.to` for the triggers (8.5.0), so
 * one pass computes the destination and the cause together, exactly once.
 */
export function memoizePerPass(
  resolveCursor: (ctx: InjectionContext) => CursorMove,
): (ctx: InjectionContext) => string | undefined {
  const cache = new WeakMap<InjectionContext, { value: string | undefined }>();
  return (ctx) => {
    const hit = cache.get(ctx);
    if (hit) return hit.value;
    const value = resolveCursor(ctx).to;
    cache.set(ctx, { value });
    return value;
  };
}

export function warnMatcherThrew(edge: string, err: unknown): void {
  devWarn(
    `agentfootprint skillGraph: ${edge} predicate threw — treated as no-match. ` +
      `Predicates must be pure + total. ${err instanceof Error ? err.message : String(err)}`,
  );
}
