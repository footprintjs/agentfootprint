import type { Injection, InjectionEvaluation } from './types.js';

/** Project the role-visible declarations from the same Gather decision as read_skill.
 * The evaluator keeps enforcing every skip. Public counts describe only the visible rows. */
export function evaluationCatalog(
  injections: readonly Injection[],
  evaluation: InjectionEvaluation,
  hidden: readonly string[] | undefined,
) {
  const { active, skipped } = evaluation;
  const excluded = new Set(hidden);
  const skippedDetails = excluded.size ? skipped.filter((row) => row.reason !== 'hidden') : skipped;
  const skillCatalog = injections
    .filter((entry) => entry.flavor === 'skill' && !excluded.has(entry.id))
    .map((entry) => ({ id: entry.id, description: entry.description ?? '(no description)' }));
  // Recorders hash serialized events. Preserve the established property order on every path.
  return {
    activeCount: active.length,
    skippedCount: skippedDetails.length,
    evaluatedTotal: injections.length - (skipped.length - skippedDetails.length),
    activeIds: active.map((entry) => entry.id),
    skippedDetails,
    triggerKindCounts: countTriggerKinds(active),
    skillCatalog,
  };
}

/** Count active injections by trigger kind (observability metric). */
function countTriggerKinds(active: readonly Injection[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const inj of active) {
    counts[inj.trigger.kind] = (counts[inj.trigger.kind] ?? 0) + 1;
  }
  return counts;
}
