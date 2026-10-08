/**
 * marker — the one positive sign that a snapshot was SERVED under a redaction
 * policy, carried by the snapshot itself.
 *
 * Pattern: a recorder with no data but a snapshot bundle, attached to a run's
 *          executor only when a policy covers the run
 *          (`runRedaction.ts` · `applyTo`).
 * Role:    the Lens half's guard. A reader of a record (the answer account,
 *          `assessAnswer`, the served views) reads footprintjs's placeholder
 *          as a value KEPT OUT only when the record says a policy covered the
 *          run. Without that sign a tool that really returned the string
 *          `'REDACTED'` would read as kept out — and an unredacted run's
 *          account would change. With no policy nothing is attached, and the
 *          snapshot is byte-identical to before.
 *
 * The bundle names no policy and no key: it says a policy was in force, which
 * is a fact about the record, not about the run's values.
 *
 * The row is a recorder's, so the run's LIVE snapshot carries it too — true of
 * its commit log (footprintjs scrubs it as it is written), never of its live
 * state. The library's live readers fold that state as values and do not
 * consult the row (`Agent · assessment` → `assess.ts` · `assessLive`).
 */

import type { CombinedRecorder } from 'footprintjs';

/** The id the marker's bundle carries in `snapshot.recorders`. */
export const REDACTION_MARKER_ID = 'agentfootprint.redaction';

/** The two placeholders footprintjs serves a selected value as (log/mirror, scope tier). */
const PLACEHOLDERS: ReadonlySet<unknown> = new Set(['REDACTED', '[REDACTED]']);

/** Whether `value` is one of footprintjs's redaction placeholders. */
export function isPlaceholder(value: unknown): boolean {
  return PLACEHOLDERS.has(value);
}

/**
 * The marker for a run's executor. It contributes one row to the served
 * snapshot's `recorders`, and tells the run when it has SETTLED — finished,
 * failed or paused (`onSettled`) — so the run's serving can let go of what
 * only the live run needed (`runRedaction.ts` · `retiredRule`).
 */
export function redactionMarker(onSettled: () => void = () => undefined): CombinedRecorder {
  return {
    id: REDACTION_MARKER_ID,
    onRunStart(): void {
      // Nothing to observe at the start: the bundle below is the sign.
    },
    onRunEnd(): void {
      onSettled();
    },
    onRunFailed(): void {
      onSettled();
    },
    onPause(): void {
      onSettled();
    },
    toSnapshot: () => ({
      name: 'Redaction',
      description:
        'Served under a redaction policy: a placeholder (REDACTED / [REDACTED]) stands ' +
        'wherever the policy selected a value.',
      data: { servedUnderPolicy: true },
    }),
  } as CombinedRecorder;
}

/**
 * Whether `snapshot` (a served snapshot, or a recording's) carries the marker —
 * the record was served under a redaction policy, so a placeholder in it is a
 * value the policy kept out.
 */
export function servedUnderPolicy(snapshot: unknown): boolean {
  if (snapshot === null || typeof snapshot !== 'object') return false;
  const recorders = (snapshot as { recorders?: unknown }).recorders;
  return (
    Array.isArray(recorders) &&
    recorders.some(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        (row as { id?: unknown }).id === REDACTION_MARKER_ID,
    )
  );
}
