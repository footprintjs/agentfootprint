/**
 * invariant-violation — two things that cannot both be true were both
 * asserted, caught at the WRITE that created the contradiction.
 *
 * Pattern: pure function over one write-delta plus the standing set.
 * Role:    the first Context Integrity check, and the cheapest. When a
 *          map's engagement is written PARKED while tools it owns are
 *          still on the wire, the two channels disagree: one says the
 *          subsystem is inactive, the other shows it available. That is
 *          the recorded failure, and this catches it at the transaction
 *          that made it true rather than re-detecting it on every call.
 *
 * WHY THE WRITE, NOT THE SERVING. A contradiction is BORN at two moments:
 * when a fact is written, and when an artifact is composed. Checking at
 * serving finds the same defect once per call, with no way to name which
 * write caused it; checking the delta names the guilty write, costs one
 * comparison against a single subject, and files ONE finding.
 *
 * WHAT THIS CANNOT DO, stated so nobody assumes otherwise: the check
 * DETECTS, it never blocks the write. The engine's recorders cannot veto
 * (hook throws are swallowed and the error path commits anyway), and
 * blocking a park because tools were still registered would invert
 * causality — the park is the correct fact; the stale serving is the
 * defect. Dev posture throws AFTER the append, in the writer's own caller.
 */

import type { Assertion, SubjectRef } from '../assertion/types.js';
import { conflictsOf } from '../assertion/conflicts.js';
import type { ContextError } from '../finding/types.js';

/** One map's engagement standing as the kernel just wrote it. */
export interface EngagementWrite {
  readonly mapId: string;
  readonly standing: 'engaged' | 'parked';
  /** Iteration the write landed on — the epoch the comparison runs at. */
  readonly iteration: number;
  /** Tool names this map owns, as the mount declared them. */
  readonly ownedToolNames: readonly string[];
}

/**
 * Tool names actually on the wire for this call, and where that was read.
 * Absent (rather than empty) when the caller could not see the wire — an
 * unknown serving set never contradicts anything.
 */
export interface ServedTools {
  readonly names: readonly string[];
  readonly provenance: string;
}

const SUSPENDED = 'suspended';
const AVAILABLE = 'available';

/**
 * Compare one engagement write against what is being served.
 *
 * Returns findings (usually none). A parked map whose owned tools have
 * left the wire is the healthy case and returns nothing — which is a
 * `checked-pass`, not silence: the caller files that disposition.
 */
export function invariantViolationsOf(
  write: EngagementWrite,
  served: ServedTools | undefined,
): readonly ContextError[] {
  if (served === undefined) return []; // unknown serving set: incomparable, never a guess
  if (write.standing !== 'parked') return [];

  const stillServed = write.ownedToolNames.filter((name) => served.names.includes(name));
  if (stillServed.length === 0) return [];

  const subject: SubjectRef = { kind: 'map', id: write.mapId };
  const witnesses: Assertion[] = [
    {
      subject,
      predicate: 'availability',
      value: SUSPENDED,
      epoch: write.iteration,
      stratum: 'asserted',
      provenance: `engagement write: ${write.mapId} parked`,
    },
    ...stillServed.map(
      (name): Assertion => ({
        subject,
        predicate: 'availability',
        value: AVAILABLE,
        epoch: write.iteration,
        stratum: 'asserted',
        provenance: `${served.provenance}: tool '${name}' offered, owned by '${write.mapId}'`,
      }),
    ),
  ];

  // Run the algebra rather than asserting the conflict directly — the
  // fences (quotation, unknowns, epochs) then apply to this check for
  // free, and one comparison owns the definition of "contradict".
  if (conflictsOf(witnesses).length === 0) return [];

  return [
    {
      kind: 'invariant-violation',
      seam: 'write',
      subjects: [subject, ...stillServed.map((id): SubjectRef => ({ kind: 'tool', id }))],
      witnesses,
      epoch: write.iteration,
      message:
        `'${write.mapId}' was written PARKED while ${String(stillServed.length)} tool(s) it owns ` +
        `are still being offered (${stillServed.join(', ')}). One channel says the subsystem is ` +
        `inactive and another shows it available, in the same call. The park is the fact; the ` +
        `serving is the defect — nothing here resolves which, and the write always lands.`,
    },
  ];
}
