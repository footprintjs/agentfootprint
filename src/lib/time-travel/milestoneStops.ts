/**
 * milestoneStops — the agent's own scrub stops, derived from its commit log.
 *
 * Role:  Fold. It reads a finished run's commit log and answers one question —
 *        "which positions in this run is a reader allowed to stop at?" It
 *        executes nothing, records nothing, and stores nothing beside the log.
 * Reads: a recorded commit log (plus the execution tree when the caller has
 *        it), and `conventions.ts` · `milestoneFor` for the domain vocabulary.
 * Emits: N/A.
 *
 * WHY THIS FILE EXISTS. footprintjs 9.17 ships the reader's cursor
 * (`timeTravel`) and one stop grammar — `commitStops`, one stop per executed
 * stage — because that is the only grammar the substrate itself knows. It does
 * NOT know what an LLM turn is. agentfootprint does: `milestoneFor` has
 * classified a local stage id into an iteration / slot / llm-turn / tool-call /
 * decision since 9.x, and until now every consumer that wanted a milestone
 * slider mapped that classifier onto commits by hand. The Why Lens did it one
 * way; anyone else with a recording had to write it again. This is that
 * mapping, once, on the strategy seam the port opened — so the agent SUPPLIES
 * the stops for its own runs and every reader gets the same axis.
 *
 * WHAT IT IS NOT. Not a second cursor. A strategy only says where the one
 * cursor may rest; `timeTravel` still owns the position, the folds and the
 * marks. And not a re-walk: a milestone that was never committed gets no stop,
 * because a cursor that stops where no evidence exists is telling a story
 * rather than reading one.
 */

import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import { commitStops } from 'footprintjs/trace';
import type { Stop, TimeTravelStrategy } from 'footprintjs/trace';
import { milestoneFor, type Milestone } from '../../conventions.js';

/**
 * The milestone a stop stands for, or `null` when it stands for none (the
 * `'start'` / `'end'` bookends).
 *
 * WHY A FUNCTION AND NOT A FIELD. footprintjs's `Stop` is a closed shape —
 * `step`, `runtimeStageId`, `commitIdx`, `lastCommitIdx`, `stageId`,
 * `subflowPath`, `label`, `kind` — with no extension slot a strategy may write
 * its own vocabulary into, and `kind` is the port's own `StopKind`
 * (`'commit' | 'mount' | 'start' | 'end'`), not ours to overload. So the
 * milestone kind travels the only way it honestly can: re-derived from the
 * stop's `runtimeStageId`, by the same classifier that put the stop on the
 * axis. Same input, same function, same answer — there is no second source of
 * truth here, only a second reading of the one there is.
 *
 * @example
 * ```ts
 * const stop = cursor.at()!;
 * milestoneOf(stop)?.kind;   // 'llm-turn'
 * ```
 */
export function milestoneOf(stop: Stop): Milestone | null {
  return stop.runtimeStageId ? milestoneFor(stop.runtimeStageId) : null;
}

/**
 * Derive one stop per committed MILESTONE from a recorded commit log.
 *
 * The rule, in one sentence: take footprintjs's own per-stage axis, keep the
 * stages `milestoneFor` classifies, and give the survivors the log back.
 *
 * **Composed, never re-derived.** The hard parts of the per-stage axis are
 * already solved upstream and are not repeated here: one stop per
 * `runtimeStageId` at its FIRST commit (a subflow mount commits twice, a
 * parallel fork child commits twice and siblings interleave — every repeat is
 * an empty bundle), the authoritative mount set read off the execution tree,
 * the `'start'` / `'end'` bookends, and the id-less leading commit that carries
 * a subflow's `inputMapper` seed. This function calls `commitStops` and filters
 * its result. A second implementation of that collapsing would be a second
 * chance to disagree with the library about what a stage is.
 *
 * **The survivors re-partition the log.** A stage that classifies `null` is not
 * a stop, but its commits still happened, so they are folded into the stop that
 * PRECEDES them: every kept stop's `lastCommitIdx` is extended to just before
 * the next kept stop begins. Nothing is orphaned, and `stateAt(stop)` remains
 * exactly "the state that existed when the next milestone's stage started".
 * Commits before the FIRST milestone belong to `'start'` for the same reason —
 * so on a drilled cursor `'start'` reads as "what this subflow began with,
 * after its plumbing ran".
 *
 * **What that costs `'start'`.** On footprintjs's own axis `'start'` is the fold
 * base: the state before ANY stage ran. Here it absorbs every stage that ran
 * before the first milestone, so `stateAt(start)` is the state the first
 * milestone READ, not the run's raw base — a real agent seeds a couple of dozen
 * keys in `seed` before anything a reader would scrub to. That is the right
 * answer for this axis (the stops must still partition the log) and the wrong
 * one to assume from `kind: 'start'` alone, so it is said out loud here, in the
 * folder README, on the docs page and in a test.
 *
 * **A log with no milestones in it at all.** A non-empty log the classifier
 * recognises nothing in — a non-agent chart handed this strategy — yields the
 * two bookends and nothing between them: `'start'` folds the whole log,
 * `'end'` folds the whole log, and `jumpTo` any stage id refuses with
 * `reason: 'miss'`. An axis with nowhere meaningful to stand, which is the
 * truthful shape for a run that has no milestones — not an error, and not the
 * empty `[]` that says the log itself was empty.
 *
 * **It does not know which log it was given.** The classifier reads the LOCAL
 * segment of a stage id, so `sf-llm-call#3` on a run's outer log and
 * `sf-llm-call/call-llm#7` on that mount's drilled inner history are both
 * classified without the strategy being told which one it is holding. That is
 * what lets one strategy serve `reactMode: 'dynamic'` (the `call-llm` bundle is
 * in the outer log → an llm-turn stop on the outer cursor) and
 * `'dynamic-grouped'` (the outer log holds `sf-llm-call` mounts → iteration
 * stops; `drill()` gives the inner cursor, where the same strategy finds the
 * llm-turn, tool-call and decision stops).
 *
 * @param commitLog     the run's `commitLog`, or a subflow's own `history`.
 * @param executionTree the run's `executionTree`, when the caller has it — it
 *   is what makes a mount stop say `kind: 'mount'` rather than being guessed
 *   from bundle shape.
 *
 * @example
 * ```ts
 * import { timeTravel } from 'footprintjs/trace';
 * import { milestoneStopsStrategy, milestoneOf } from 'agentfootprint';
 *
 * const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
 * cursor.stops.map((s) => [s.label, milestoneOf(s)?.kind]);
 * // measured on a two-turn `dynamic` run — 42 commits, 15 stops:
 * // [['Run start', undefined], ['Iteration', 'iteration'],
 * //  ['System prompt', 'slot'], ['Messages', 'slot'], ['Tools', 'slot'],
 * //  ['LLM turn', 'llm-turn'], ['Route', 'decision'], ['Tool call', 'tool-call'],
 * //  … the second turn …, ['Run end', undefined]]
 * ```
 */
export function milestoneStops(
  commitLog: readonly CommitBundle[],
  executionTree?: StageSnapshot,
): Stop[] {
  const perStage = commitStops(commitLog, executionTree);
  if (perStage.length === 0) return [];

  // `commitStops` guarantees the shape [start, …stages, end] for a non-empty
  // log. The bookends are kept verbatim in KIND and re-partitioned below; only
  // the stages in between are filtered.
  //
  // CHECK THE PROPERTY, NOT MERE PRESENCE. `Stop[]` does not pin that shape in
  // the type, and everything below rests on it: `'start'` is the only stop that
  // may open at `-1` (the fold base no commit index reaches) and `'end'` is the
  // only one that folds the whole log. If a future `commitStops` returned some
  // other shape, a presence check would take the first and last STAGE stops for
  // bookends — the first would silently inherit start's `-1` arithmetic and keep
  // its raw stage label, and the last milestone would lose its milestone label.
  // Refusing loudly is the honest answer: an empty axis would be
  // indistinguishable from "this run committed nothing", which is a different
  // fact about a different run.
  const [start, ...rest] = perStage;
  const end = rest.pop();
  if (!start || start.kind !== 'start' || !end || end.kind !== 'end') {
    throw new Error(
      'milestoneStops: commitStops returned an unexpected shape — expected ' +
        `[start, …stages, end], got kinds [${perStage.map((s) => s.kind).join(', ')}]. ` +
        'This is a footprintjs contract change, not something a run can cause.',
    );
  }

  const kept = rest
    .map((stop) => ({ stop, milestone: milestoneFor(stop.runtimeStageId) }))
    .filter((row): row is { stop: Stop; milestone: Milestone } => row.milestone !== null);

  const first = kept[0];
  const stops: Stop[] = [
    {
      ...start,
      step: 0,
      // Everything before the first milestone folds into `'start'`.
      lastCommitIdx: (first ? first.stop.commitIdx : commitLog.length) - 1,
    },
  ];

  for (const [i, { stop, milestone }] of kept.entries()) {
    const next = kept[i + 1];
    stops.push({
      ...stop,
      step: stops.length,
      // Absorb the non-milestone stages that ran after this one.
      lastCommitIdx: next ? next.stop.commitIdx - 1 : commitLog.length - 1,
      label: milestone.label,
    });
  }

  stops.push({ ...end, step: stops.length });
  return stops;
}

/**
 * `milestoneStops` as a footprintjs `TimeTravelStrategy` — what you hand
 * `timeTravel(snapshot, { strategy })`.
 */
export const milestoneStopsStrategy: TimeTravelStrategy = { stopsFor: milestoneStops };
