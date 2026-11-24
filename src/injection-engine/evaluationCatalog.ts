import type { Injection, InjectionEvaluation } from './types.js';

/** Project the role-visible declarations from the same Gather decision as read_skill.
 * The evaluator keeps enforcing every skip. Public counts describe only the visible rows. */
export function evaluationCatalog(
  injections: readonly Injection[],
  skipped: InjectionEvaluation['skipped'],
  hidden: readonly string[] | undefined,
) {
  const excluded = new Set(hidden);
  const skippedDetails = excluded.size ? skipped.filter((row) => row.reason !== 'hidden') : skipped;
  const skillCatalog = injections
    .filter((entry) => entry.flavor === 'skill' && !excluded.has(entry.id))
    .map((entry) => ({ id: entry.id, description: entry.description ?? '(no description)' }));
  return {
    evaluatedTotal: injections.length - (skipped.length - skippedDetails.length),
    skippedDetails,
    skippedCount: skippedDetails.length,
    skillCatalog,
  };
}
