import type { EntryDecl } from './graphRoutes.js';
import type { InjectionContext } from '../types.js';
import type { CursorMove } from './graphCursor.js';

/**
 * The suppression reporter (8.15.0) — the honesty half of the one law.
 *
 * A conditional entry is active exactly while the cursor is on it, so an entry whose
 * own `when` matched while the graph is somewhere else is SUPPRESSED. Before 8.15.0
 * it would have loaded beside the cursor's skill, which is precisely the double
 * activation the law removes — so the run has to be able to SAY it happened, or an
 * author debugging "why isn't my entry loading?" has nothing to read.
 *
 * Pure: one resolver pass plus, at most, one predicate call per OTHER conditional
 * entry — O(E), inside the ceiling `memoizePerPass` sets for the whole evaluation.
 * The RAW resolver (not the memoized projection) is used deliberately, matching the
 * freshness policy of the other public resolvers: called once per iteration, always
 * recomputed.
 *
 * A throwing predicate is swallowed HERE and reported by the evaluator instead
 * (`skipped: 'predicate-threw'`) — one throw must not be told as two different
 * stories on the same event.
 */
export function makeSupersededEntries(
  entries: readonly EntryDecl[],
  resolveCursor: (ctx: InjectionContext) => CursorMove,
): (ctx: InjectionContext) => readonly string[] {
  const conditional = entries.filter((e) => e.when !== undefined);
  if (conditional.length === 0) return () => [];
  return (ctx) => {
    const to = resolveCursor(ctx).to;
    // No cursor at all → the trigger falls back to the rule alone, so nothing is
    // being superseded.
    if (to === undefined) return [];
    const out: string[] = [];
    for (const e of conditional) {
      if (e.id === to) continue; // this is the one that won
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (e.when!(ctx)) out.push(e.id);
      } catch {
        // Reported by the evaluator as `predicate-threw`, not as a suppression.
      }
    }
    return out;
  };
}
