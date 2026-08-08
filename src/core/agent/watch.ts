/**
 * watch — PUBLIC. The door named for what an observer does.
 *
 * Pattern: naming, not machinery. `.watch()` attaches what the removed
 *          `.recorder()` attached; the type it takes is exactly footprintjs's
 *          `CombinedRecorder`. Nothing new happens at run time.
 * Role:    core/ layer. The counterpart `moments.ts` has described in prose
 *          since the loop moments were written down:
 *
 *            "`watch` attends all five and more; `act` attends exactly these.
 *             The difference is what a rule may DO there — an observer
 *             reports, a rule changes what happens next."
 *
 *          That sentence named an API that did not exist. This is it.
 * Emits:   N/A (one type alias).
 *
 * ## Why there is no `WATCH_MOMENTS`
 *
 * `.act()`'s keys are a closed, compiler-pinned list because a rule has to be
 * TOLD where it may speak — a rule written for a moment nobody reads is a
 * governance hole, so the list is checked and the build fails when it drifts.
 * An observer is the opposite: it attends the entire event stream, and there
 * is no closed set to enumerate. Publishing a `WATCH_MOMENTS` list would be
 * inventing a vocabulary we would then have to keep true against every event
 * added forever. The honest surface for watching is the door and the type.
 *
 * ## Build time and run time are different doors on purpose
 *
 *   `.watch(observer)`   — on the BUILDER. Attached before the agent exists,
 *                          so the observer sees the very first run. Returns
 *                          the builder, because you are still building.
 *   `agent.attach(o)`    — on the RUNNER. Attached to a live agent, and
 *                          returns an `Unsubscribe` you own and must call.
 *
 * Two return types, no ambiguity about which one you are holding.
 */

import type { CombinedRecorder } from 'footprintjs';

/**
 * Anything that can watch a run.
 *
 * The plain name for footprintjs's `CombinedRecorder` — the substrate's word
 * for the same thing, still exported from the main barrel for anyone typing
 * against the engine directly. Every recorder factory in
 * `agentfootprint/observe` returns something assignable to this, as does any
 * object with the recorder hook methods on it.
 *
 * @example
 * ```ts
 * import { Agent, type Watcher } from 'agentfootprint';
 * import { toolChoiceRecorder, routeRecorder } from 'agentfootprint/observe';
 *
 * const observers: Watcher[] = [toolChoiceRecorder(), routeRecorder()];
 *
 * const agent = Agent.create({ provider, model })
 *   .watch(...observers)
 *   .build();
 * ```
 */
export type Watcher = CombinedRecorder;
