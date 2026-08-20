/**
 * dangling-reference — a served capability whose declared argument ground
 * has left the window and was not re-established.
 *
 * Pattern: pure function over three name sets; the closure check.
 * Role:    the decidable fragment of "does everything the model is being
 *          offered still have its evidence in reach?". The measured
 *          failure: a `whats_here` result carrying the valid ids was
 *          evicted by the window strategy while the tool that FIRES at
 *          those ids stayed on the wire; the model assembled a plausible
 *          id from memory and was refused. The drop already speaks
 *          (9.57.0, `WindowRecord.droppedObservations`); this makes the
 *          next composition answerable for it.
 *
 * DECLARED, NEVER INFERRED. The library cannot know that one tool's
 * arguments come from another tool's results — only the author does. The
 * edge is `Tool.argumentsFrom`, stamped at definition; a tool that
 * declares nothing is never this check's subject, which is the whole
 * zero-delta story.
 *
 * THE TWO FENCES, stated because they are the check's honesty:
 * - A ground that was NEVER dropped is silent even with no result in the
 *   window — the model simply has not called it yet, and offering the
 *   dependent tool ahead of that is legitimate sequencing, not a defect.
 * - A re-fetched ground (a fresh result present in the window) is silent
 *   however many drops preceded it — the evidence is back in reach.
 * The defect is exactly the third state: WAS grounded, evidence evicted,
 * nothing re-established, capability still offered.
 */

import type { SubjectRef } from '../assertion/types.js';
import type { ContextError } from '../finding/types.js';

/** One served tool and the grounds its author declared. */
export interface ServedGroundedTool {
  readonly name: string;
  /** `Tool.argumentsFrom` — tool names whose results ground this one's arguments. */
  readonly argumentsFrom: readonly string[];
}

/**
 * Compare the served tools' declared grounds against what the window has
 * dropped and what it currently holds.
 *
 * @param droppedResults tool names whose RESULTS have left the window this
 *   run (union of `WindowRecord.droppedObservations`).
 * @param presentResults tool names with a result currently IN the window.
 */
export function danglingReferencesOf(
  servedTools: readonly ServedGroundedTool[],
  droppedResults: ReadonlySet<string>,
  presentResults: ReadonlySet<string>,
  epoch: number,
): readonly ContextError[] {
  const findings: ContextError[] = [];
  for (const tool of servedTools) {
    const missing = tool.argumentsFrom.filter(
      (ground) => droppedResults.has(ground) && !presentResults.has(ground),
    );
    if (missing.length === 0) continue;
    findings.push({
      kind: 'dangling-reference',
      seam: 'compose',
      subjects: [
        { kind: 'tool', id: tool.name },
        ...missing.map((id): SubjectRef => ({ kind: 'tool', id })),
      ],
      witnesses: missing.map((ground) => ({
        subject: { kind: 'tool', id: tool.name },
        predicate: 'argument-ground',
        value: `results of '${ground}' evicted, not re-established`,
        epoch,
        stratum: 'asserted' as const,
        provenance: `window ledger: '${ground}' in droppedObservations, no result in window`,
      })),
      epoch,
      message:
        `'${tool.name}' is being offered while the results that ground its arguments have left ` +
        `the window (${missing.join(', ')}) and were not re-established. A call the model makes ` +
        `with remembered values cannot be checked against evidence nobody can see — re-fetching ` +
        `(calling ${missing.join(', ')} again) re-grounds it; nothing here withholds the tool.`,
    });
  }
  return findings;
}
