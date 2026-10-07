/**
 * A composed child that ENDED on a terminal verdict is a FAILED child.
 *
 * An agent ends some runs on a record in its state instead of a throw — a
 * reliability fail-fast, a policy halt, a denied message, a refused answer —
 * and only its own run boundary (`Agent · finalizeResult`) turns the record
 * into the typed error. A composition mounts the agent's CHART, so that
 * boundary never runs: the record stayed behind the child's mount and the
 * composition carried on as if the child had answered (`''`, or the branch
 * name a refusing decider ended on).
 *
 * A child that ended on a verdict returns no answer, so its mount hands the
 * outputMapper the child's whole state; the child's own runner names the
 * verdict from it (`core/terminalVerdict.ts` · `terminalVerdictOf`, the one
 * translation its boundary uses too). Each composition then fails the way it
 * fails for any child:
 *
 * - Sequence, workflow(), Conditional and Loop hand a child's error on as it
 *   is: they carry the verdict onto their own state (`carryChildVerdict`) and
 *   raise the child's own error (`raiseChildVerdict`) before anything after
 *   the child runs.
 * - Parallel and graph() report failed children themselves: the child's
 *   outputMapper throws the child's error (`throwIfChildEnded`), so the merge
 *   or level join reports that branch or node as failed with its message.
 */
import { endsOnVerdict, terminalErrorOf, type TerminalVerdict } from '../core/terminalVerdict.js';

/** The key a composition carries a child's verdict under, on its own state. */
export const CHILD_VERDICT_KEY = 'childVerdict';

/** The terminal verdict a child's chart ended on, or nothing when it ended on an answer. */
export function childVerdict(runner: unknown, sfOutput: unknown): TerminalVerdict | undefined {
  if (typeof sfOutput !== 'object' || sfOutput === null || !endsOnVerdict(runner)) return undefined;
  return runner.terminalVerdictOf(sfOutput as Readonly<Record<string, unknown>>);
}

/**
 * For an outputMapper: the child's verdict, to spread onto the composition's
 * state. Carried in a one-element array so it lands WHOLE — a plain object
 * would be merged field by field, and the merge folds repeated array items.
 */
export function carryChildVerdict(
  runner: unknown,
  sfOutput: unknown,
): { readonly [CHILD_VERDICT_KEY]: readonly [TerminalVerdict] } | undefined {
  const verdict = childVerdict(runner, sfOutput);
  return verdict === undefined ? undefined : { [CHILD_VERDICT_KEY]: [verdict] };
}

/**
 * Raise the child's own error when a carried verdict stands on this
 * composition's state. `read` is the composition's own read of a state key.
 */
export function raiseChildVerdict(read: (key: string) => unknown): void {
  const carried = read(CHILD_VERDICT_KEY) as readonly TerminalVerdict[] | undefined;
  const verdict = carried?.[0];
  if (verdict !== undefined) throw terminalErrorOf(verdict);
}

/** For a composition that reports failed children itself: throw the child's own error. */
export function throwIfChildEnded(runner: unknown, sfOutput: unknown): void {
  const verdict = childVerdict(runner, sfOutput);
  if (verdict !== undefined) throw terminalErrorOf(verdict);
}
