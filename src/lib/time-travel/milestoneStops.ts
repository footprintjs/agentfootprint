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
 * WHY THIS FILE EXISTS. footprintjs ships the reader's cursor (`timeTravel`)
 * and one stop grammar — `commitStops`, one stop per executed stage — because
 * that is the only grammar the substrate itself knows. It does NOT know what an
 * LLM turn is. agentfootprint does: `milestoneFor` has classified a local stage
 * id into an iteration / slot / llm-turn / tool-call / decision since 9.x, and
 * until 9.87 every consumer that wanted a milestone slider mapped that
 * classifier onto commits by hand. This is that mapping, once, on the strategy
 * seam the port opened — so the agent SUPPLIES the stops for its own runs and
 * every reader gets the same axis.
 *
 * WHAT IT IS (9.89.0). A FILTER over the port's own axis. footprintjs 9.18
 * shipped `filterStops(stops, keep)` — the bookend guard, the re-partition and
 * a `meta` slot on the stop — because two consumers had each re-derived all
 * three by hand against 9.17, this file among them. The hand-rolled copies are
 * gone: the one owner of the `[start, …stages, end]` contract is the library
 * that returns it, and this strategy is one expression over it. The axis is
 * byte-for-byte the 9.88.0 axis (`test/lib/time-travel/milestone-stops-equivalence.test.ts` pins
 * that against a verbatim copy of the 9.88.0 implementation); what is new is that the milestone now RIDES on the
 * stop as `meta`, and that a start which absorbed pre-milestone stages says so
 * with `prologue: true`.
 *
 * WHAT IT IS NOT. Not a second cursor. A strategy only says where the one
 * cursor may rest; `timeTravel` still owns the position, the folds and the
 * marks. And not a re-walk: a milestone that was never committed gets no stop,
 * because a cursor that stops where no evidence exists is telling a story
 * rather than reading one.
 */

import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import { commitStops, filterStops } from 'footprintjs/trace';
import type { Stop, TimeTravelStrategy } from 'footprintjs/trace';
import {
  MILESTONE_KINDS,
  milestoneFor,
  milestoneFromTags,
  type Milestone,
} from '../../conventions.js';

/** Is this `meta` a {@link Milestone} — ours, not another strategy's? */
function isMilestone(meta: unknown): meta is Milestone {
  if (meta === null || typeof meta !== 'object') return false;
  const { kind, label } = meta as { kind?: unknown; label?: unknown };
  return typeof label === 'string' && (MILESTONE_KINDS as readonly unknown[]).includes(kind);
}

/**
 * The milestone a stop stands for, or `null` when it stands for none (the
 * `'start'` / `'end'` bookends).
 *
 * A stop that {@link milestoneStops} made carries its milestone as
 * `stop.meta`, and that is what is read — the classification the strategy
 * made when it put the stop on the axis, not a second run of the classifier.
 * A stop from ANOTHER strategy — the port's own `commitStops`, or a consumer's
 * filter that kept the stop without a milestone meta — has none, so the answer
 * falls back to where it always came from: `milestoneFor` over the stop's
 * `runtimeStageId`. Same classifier, same answer; a `meta` of some other
 * vocabulary is not mistaken for ours.
 *
 * @example
 * ```ts
 * const stop = cursor.at()!;
 * milestoneOf(stop)?.kind;   // 'llm-turn'
 * ```
 */
export function milestoneOf(stop: Stop<unknown>): Milestone | null {
  if (isMilestone(stop.meta)) return stop.meta;
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
 * a subflow's `inputMapper` seed. And since 9.89.0 the COMPOSITION itself is
 * the port's too: `filterStops` checks the `[start, …stages, end]` shape,
 * keeps what `keep` keeps, and re-partitions the log. A second implementation
 * of any of that would be a second chance to disagree with the library about
 * what a stage is.
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
 * **What that costs `'start'`, and the flag that says so.** On footprintjs's
 * own axis `'start'` is the fold base: the state before ANY stage ran. Here it
 * absorbs every stage that ran before the first milestone, so `stateAt(start)`
 * is the state the first milestone READ, not the run's raw base — a real agent
 * seeds a couple of dozen keys in `seed` before anything a reader would scrub
 * to. That is the right answer for this axis (the stops must still partition
 * the log), and since 9.18 the port marks it: the returned start carries
 * `prologue: true` whenever it absorbed a stage, so a renderer that means
 * "before anything ran" checks `kind === 'start' && !prologue` instead of
 * assuming it from the kind.
 *
 * **The milestone rides on the stop.** Every kept stop carries its
 * classification as `meta` — `Stop<Milestone>` — so a reader asks
 * `stop.meta?.kind` (or {@link milestoneOf}, which reads the same slot) rather
 * than re-running the classifier over the id. The bookends carry none.
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
 * import { milestoneStopsStrategy } from 'agentfootprint';
 *
 * const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
 * cursor.stops.map((s) => [s.label, s.meta?.kind]);
 * // measured on a two-turn `dynamic` run — 42 commits, 15 stops:
 * // [['Run start', undefined], ['Iteration', 'iteration'],
 * //  ['System prompt', 'slot'], ['Messages', 'slot'], ['Tools', 'slot'],
 * //  ['LLM turn', 'llm-turn'], ['Route', 'decision'], ['Tool call', 'tool-call'],
 * //  … the second turn …, ['Run end', undefined]]
 * cursor.stops[0].prologue; // true — `seed` and the plumbing ran before the first Iteration
 * ```
 */
export function milestoneStops(
  commitLog: readonly CommitBundle[],
  executionTree?: StageSnapshot,
): Stop<Milestone>[] {
  return filterStops<Milestone>(commitStops(commitLog, executionTree), (stop) => {
    const milestone = milestoneAt(commitLog, stop);
    return milestone ? { label: milestone.label, meta: milestone } : null;
  });
}

/**
 * The milestone a stop stands for — **the tag is the fact, the id is the
 * fallback** (9.90.0; law 3 of footprintjs's declared-tags design).
 *
 * The stop's FIRST bundle (`stop.commitIdx` — where footprintjs stamps a
 * stage's declared tags) is read first: when it carries tags, the answer is
 * whatever `milestone:<kind>` / `milestone-label:<label>` they declare, and a
 * bundle that is tagged but NOT as a milestone is not a stop, however
 * recognisable its id — the chart said what this stage is. Only a bundle with
 * no tags at all is classified from its id: a recording made before the charts
 * declared their milestones. On a 9.90.0 recording that path runs ZERO times —
 * every milestone stage is declared, slot branch mounts included (footprintjs
 * 9.21.1 `SubflowMountOptions.tags`), and
 * `test/lib/time-travel/milestone-stops-equivalence.test.ts` counts the
 * fallback on every fixture. Both readings come from the one table in
 * `conventions.ts`, so they agree wherever both exist.
 */
function milestoneAt(log: readonly CommitBundle[], stop: Stop<unknown>): Milestone | null {
  const raw = log[stop.commitIdx]?.tags;
  // A stored row is `unknown[]`-shaped until narrowed: only STRINGS count as
  // declared tags (the same narrowing footprintjs's `tagStops` does), so a
  // damaged row falls back to the id like an untagged one instead of vanishing.
  const tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
  if (tags.length > 0) return milestoneFromTags(tags, stop.label);
  return milestoneFor(stop.runtimeStageId);
}

/**
 * `milestoneStops` as a footprintjs `TimeTravelStrategy` — what you hand
 * `timeTravel(snapshot, { strategy })`. Typed over {@link Milestone}, so the
 * cursor's stops are `Stop<Milestone>` and `cursor.at()?.meta?.kind` is typed;
 * it is still assignable wherever a bare `TimeTravelStrategy` is expected.
 */
export const milestoneStopsStrategy: TimeTravelStrategy<Milestone> = { stopsFor: milestoneStops };
