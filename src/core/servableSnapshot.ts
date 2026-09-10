/**
 * servableSnapshot — the ONE owner of what a chart-backed tool may SHOW of its
 * inner run.
 *
 * Pattern: a single projection function over `FlowChartExecutor.getSnapshot`.
 * Role:    every state-bearing thing `flowchartAsTool` / `runbookAsTool` hands
 *          outward — the values a `resultMapper` reads, the envelope's state,
 *          the recording beside the walk, the record `keepRecord` retains —
 *          is taken from HERE, so "what may leave the executor" is spelled
 *          once. Nothing here decides what is secret; the policy does that,
 *          footprintjs enforces it, and this function serves the view
 *          footprintjs already built for serving.
 *
 * THE DEFECT THIS CLOSES (9.89.1; entry 6 of
 * docs/design/2026-09-recorded-not-built.md). footprintjs scrubs at COMMIT
 * time: a policy-redacted key never enters the commit log. But the live state
 * view is not a commit — it is the run's own heap — and its scrubbed twin, the
 * *redacted mirror*, is served only by `getSnapshot({ redact: true })`. Both
 * tools called `getSnapshot()` bare, so the string the model read and the kept
 * record's `sharedState` carried the plaintext while the log beside them said
 * `REDACTED`. Two mechanisms, each correct, never composed.
 *
 * THE RULE. With a policy set, the served snapshot is footprintjs's redacted
 * view, exactly the object `getSnapshot({ redact: true })` returns — not a
 * copy, not a second scrub. Without a policy it is `executor.getSnapshot()`,
 * byte for byte: no mirror, the fold bases present, exactly the path both
 * tools had.
 *
 * WHAT IT NO LONGER HAS TO DO (9.89.3). Through footprintjs 9.19.x the
 * redacted view left ONE surface raw: a subflow's final state
 * (`subflowResults[*].treeContext.globalContext`, and its per-iteration `#n`
 * twin) was the subflow's own isolated heap, because only the run-level
 * runtime kept a mirror. So this function refolded each subflow's scrubbed
 * `history` through footprintjs's `stateAt` before serving — the mirror's own
 * construction, done at serve time, one level down. footprintjs 9.20.0 closed
 * that limit at the root: a subflow keeps its own mirror whenever the run
 * does, and the served state IS that mirror (equal to the fold over its
 * scrubbed history; `engine/handlers/servedSubflowResults.ts` substitutes it
 * once per mount, so the path key and the `#n` twin still name ONE object).
 * A refold kept here would be a SECOND owner of the same rule — two owners
 * drift — so it is gone. `test/core/flowchartAsTool.redact.test.ts` §7 pins
 * both halves: the substrate's own redacted view holds the placeholder (red
 * on 9.19.x), and this function serves that very object.
 *
 * WHAT IT CANNOT DO. The resume checkpoint (`err.checkpoint` on a paused run)
 * is not a served view: resumption must replay against real values, and it is
 * handed to the agent loop, never to a model. And the redacted view OMITS the
 * run's `initialState` (footprintjs `ExecutionRuntime.getSnapshot`: the raw
 * pre-run seed never passed a policy, so it is dropped rather than served), so
 * a fold of a kept record reports `basis: 'log-only'`; a subflow's
 * `treeContext.initialState` travels as footprintjs serves it (9.20.0 keeps
 * it — the nested runtime's base BEFORE its seed, which is a commit of its
 * own, `history[0]`).
 */

import type { FlowChartExecutor, RedactionPolicy, RuntimeSnapshot } from 'footprintjs';

/**
 * The snapshot a chart-backed tool may hand outward.
 *
 * @param executor the inner run's executor, after `run()` returned, threw, or paused
 * @param policy   the tool's `redact` option — `undefined` means the raw
 *                 snapshot, exactly as `executor.getSnapshot()` returns it
 */
export function servableSnapshot(
  executor: FlowChartExecutor,
  policy: RedactionPolicy | undefined,
): RuntimeSnapshot {
  return policy === undefined ? executor.getSnapshot() : executor.getSnapshot({ redact: true });
}
