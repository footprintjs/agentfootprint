/**
 * The pseudo-stage a tool-teardown event is stamped with.
 *
 * `session_closed` and `session_close_failed` fire after the run's last stage
 * has committed — there is no runtimeStageId to inherit, and inventing one that
 * looked like a real stage would put a fictitious node in every consumer's step
 * strip. This says plainly where it came from, the way `'<stageId>#paused'`
 * does at the pause boundary. Their two siblings, `session_started` and
 * `session_reused`, happen inside a real stage and carry its real id.
 */
export const TOOL_TEARDOWN_STAGE_ID = 'tool-teardown#0';

/**
 * The pseudo-stage a LATE artifact fact is stamped with — one that lands after
 * the run its binding was made in had ended (a tool's floating upload). Its
 * stage is long gone; like the teardown events it says plainly where it came
 * from, and carries the run it belongs to rather than the one that is live.
 */
export const LATE_ARTIFACT_FACT_STAGE_ID = 'artifact-late#0';

/**
 * The pseudo-stage the run-configuration manifest is stamped with (9.41.0).
 *
 * Same reasoning as the teardown id above, at the other end of the run: the
 * manifest is dispatched before the chart starts, so there is no stage to
 * inherit and inventing a plausible one would put a node in every step strip
 * that no traversal ever visited. This says plainly where it came from.
 */
export const RUN_MANIFEST_STAGE_ID = 'run-configured#0';

/**
 * Pseudo-stage for `agentfootprint.integrity.disposition` (9.60.0) — the
 * ledger is filed at the run boundary, after the last stage committed, so it
 * states where it came from exactly as the teardown id above does.
 */
export const INTEGRITY_DISPOSITION_STAGE_ID = 'integrity-disposition#0';

/**
 * Pseudo-stage for `agentfootprint.skill.graph_declared` (9.50.0) — same
 * reasoning as the manifest id directly above: dispatched before the chart
 * starts, so it states where it came from instead of inheriting a stage no
 * traversal visited.
 */
export const GRAPH_DECLARED_STAGE_ID = 'graph-declared#0';
