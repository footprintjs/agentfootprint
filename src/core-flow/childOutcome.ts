/**
 * What a composed child handed back: its ANSWER, or the terminal verdict its
 * chart ended on — and a child that ended on a verdict is a FAILED child.
 *
 * An agent ends some runs on a record in its state instead of a throw — a
 * reliability fail-fast, a policy halt, a denied message, a refused answer —
 * and only its own run boundary (`Agent · finalizeResult`) turns the record
 * into the typed error. A composition mounts the agent's CHART, so that
 * boundary never runs: the record stayed behind the mount and the composition
 * carried on as if the child had answered.
 *
 * A mount hands its outputMapper the chart's RESULT, or — when the chart
 * returned none — the child's whole state. Only the child knows which is
 * which: an agent's validated answer leaves as an object, and read as state it
 * looked like a refusal. So the child's own runner reads the outcome
 * (`core/terminalVerdict.ts` · `outcomeOf`): an answer from a result, a
 * verdict ONLY from state. A runner that does not read its own outcome hands
 * back its result as the answer, as it always did. Each composition then
 * fails the way it fails for any child:
 *
 * - Sequence, workflow(), Conditional and Loop hand a child's error on as it
 *   is: they carry the verdict onto their own state (`carryVerdict`) and raise
 *   the child's own error (`raiseChildVerdict`) before anything after the
 *   child runs.
 * - Parallel and graph() report failed children themselves: the child's
 *   outputMapper throws the child's error (`childError`), so the merge or the
 *   level join reports that branch or node as failed with its message.
 */
import {
  readsItsOwnOutcome,
  terminalErrorOf,
  type ChildOutcome,
  type TerminalVerdict,
} from '../core/terminalVerdict.js';

/** The key a composition carries a child's verdict under, on its own state. */
export const CHILD_VERDICT_KEY = 'childVerdict';

/** What a child's mount handed back, read by the child's own runner when it can. */
export function childOutcome(runner: unknown, sfOutput: unknown): ChildOutcome {
  return readsItsOwnOutcome(runner) ? runner.outcomeOf(sfOutput) : { answer: sfOutput };
}

/**
 * A verdict, to land on the composition's state WHOLE: carried in a
 * one-element array — a plain object would be merged field by field.
 */
export function carryVerdict(verdict: TerminalVerdict): {
  readonly [CHILD_VERDICT_KEY]: readonly [TerminalVerdict];
} {
  return { [CHILD_VERDICT_KEY]: [verdict] };
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

/** The error a child's verdict raises — the one its own run raises. */
export function childError(verdict: TerminalVerdict): Error {
  return terminalErrorOf(verdict);
}
