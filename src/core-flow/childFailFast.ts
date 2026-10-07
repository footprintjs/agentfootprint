/**
 * A composed child that failed fast is a FAILED child.
 *
 * An agent's reliability loop ends its run by writing the fail-fast record and
 * breaking; only the agent's own run boundary (`Agent · finalizeResult`) turns
 * that record into `ReliabilityFailFastError`. A composition mounts the agent's
 * CHART, so that boundary never runs — the record stayed behind the child's
 * mount and the composition carried on as if the child had answered `''`.
 *
 * A mount hands its outputMapper the child's result, or — when the child's
 * chart returned none, as a failed-fast agent's does — the child's whole state.
 * `childFailFast` reads the record off that state. Each composition then fails
 * the way it fails for any child: one that hands a child's error on as it is
 * (Sequence, Workflow, Conditional, Loop) carries the record onto its own state
 * and raises the agent's own error (`raiseChildFailFast`) before anything else
 * runs; one that reports failed children itself (Parallel, Graph) reports this
 * one there.
 */
import {
  RELIABILITY_FAIL_KEYS,
  failFastErrorOf,
  failFastRecordOf,
  type ReliabilityFailRecord,
} from '../reliability/failFastRecord.js';

/** The fail-fast record a child ended with, or nothing when it did not fail fast. */
export function childFailFast(sfOutput: unknown): ReliabilityFailRecord | undefined {
  if (typeof sfOutput !== 'object' || sfOutput === null) return undefined;
  return failFastRecordOf(sfOutput as Readonly<Record<string, unknown>>);
}

/**
 * For a composition that reports failed children itself (Parallel, Graph): a
 * failed-fast child's outputMapper throws the agent's own error, so the child
 * is reported as failed with the fail-fast's message.
 */
export function throwIfChildFailedFast(sfOutput: unknown): void {
  const record = childFailFast(sfOutput);
  if (record !== undefined) throw failFastErrorOf(record);
}

/**
 * Raise the agent's own error when a child's fail-fast record stands on this
 * composition's state. `read` is the composition's own read of a state key.
 */
export function raiseChildFailFast(read: (key: string) => unknown): void {
  // One read on the path every successful run takes; the rest only on failure.
  if (read('reliabilityFailKind') === undefined) return;
  const state: Record<string, unknown> = {};
  for (const key of RELIABILITY_FAIL_KEYS) state[key] = read(key);
  const record = failFastRecordOf(state);
  if (record !== undefined) throw failFastErrorOf(record);
}
