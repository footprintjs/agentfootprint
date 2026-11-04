import type { EntryDecl } from './graphRoutes.js';
import type { Injection, InjectionContext } from '../types.js';
import type { EntryScorer, EntryScoring } from '../entryScorer.js';
import { warnMatcherThrew } from './passMemo.js';

/**
 * Bind the chosen `EntryScorer` strategy into `graph.scoreEntries`. The engine owns
 * the `when`-filtering (it needs `ctx` + the entry predicates); the scorer owns the
 * ranking. Filters the entries to the `when`-passing candidates, hands the scorer
 * `{ userMessage, candidates: { id, description } }`, and returns its `EntryScoring`.
 * Async wrapper so a sync scorer (`keywordScorer`) and an async one (`embeddingScorer`)
 * present identically; runs once per turn in the OFF-LOOP PickEntry stage, never in
 * the sync route triggers, so `nextSkill` stays synchronous. An empty candidate set
 * (or a throwing scorer, caught by PickEntry) falls back to the normal cold-start entry.
 */
export function makeScoreEntries(
  entries: readonly EntryDecl[],
  skillsById: ReadonlyMap<string, Injection>,
  scorer: EntryScorer,
): (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring> {
  return async (ctx, signal) => {
    const candidates = entries
      .filter((e) => {
        if (!e.when) return true;
        try {
          return e.when(ctx);
        } catch (err) {
          warnMatcherThrew(`entry "${e.id}"`, err);
          return false;
        }
      })
      .map((e) => ({ id: e.id, description: skillsById.get(e.id)?.description ?? e.id }));
    return scorer.score({ userMessage: ctx.userMessage, candidates }, signal);
  };
}
