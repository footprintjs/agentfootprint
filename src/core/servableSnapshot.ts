/**
 * servableSnapshot — the ONE owner of what a run may SHOW of its snapshot:
 * every runner's `getLastSnapshot()` (an agent's, a composition's) and every
 * chart-backed tool's inner run.
 *
 * Pattern: a single projection function over `FlowChartExecutor.getSnapshot`.
 * Role:    `RunnerBase · getLastSnapshot` serves a runner's last run through
 *          it, with the policy that run was covered by (`Agent.create({
 *          redact })`, a composed member's, a caller's). And every
 *          state-bearing thing `flowchartAsTool` / `runbookAsTool` hands
 *          outward — the values a `resultMapper` reads, the envelope's state,
 *          the recording beside the walk, the record `keepRecord` retains —
 *          is taken from HERE, so "what may leave the executor" is spelled
 *          once. Nothing here decides what is secret; the policy does that,
 *          footprintjs enforces it, and this function serves the view
 *          footprintjs already built for serving. What a runner computes on
 *          is never read through here — `RunnerBase · liveSnapshot` is.
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

import { createTypedScopeFactory, RedactionRule } from 'footprintjs/advanced';
import type {
  FlowChart,
  FlowChartExecutor,
  RedactionPolicy,
  RuntimeSnapshot,
  ScopeFactory,
} from 'footprintjs';

/**
 * The snapshot a chart-backed tool may hand outward.
 *
 * @param executor the run's executor — in flight, or after `run()` returned,
 *                 threw, or paused
 * @param policy   the policy the run was covered by (the policy the executor
 *                 was handed) — `undefined` means the raw snapshot, exactly as
 *                 `executor.getSnapshot()` returns it
 */
export function servableSnapshot(
  executor: FlowChartExecutor,
  policy: RedactionPolicy | undefined,
): RuntimeSnapshot {
  return policy === undefined ? executor.getSnapshot() : executor.getSnapshot({ redact: true });
}

/**
 * THE MODEL'S VIEW of a chart-backed tool's run, when the calling run's policy
 * (`ToolExecutionContext.redact`) joined the tool's own.
 *
 * The run is covered by the UNION — its commit log, mirror, narrative, kept
 * record and recording are records, and a record keeps out everything either
 * policy names. But the state the tool hands the MODEL (what a `resultMapper`
 * reads, a runbook envelope's rows and report) is the model's input, and the
 * calling run's policy never reaches the model's input. So that state is the
 * run's LIVE state served under the TOOL's own policy only — what the tool
 * author declared to keep away from the model — plus the CHART's own marks (a
 * per-call `$setValue(key, value, true)`, a subflow mapper's taint): names,
 * run-wide. A mark on a key the caller's policy selects is the caller's (the
 * rule marks a selected key when it is written), so it is left out — whole-key
 * and field marks alike. Marks are names, so two cases cannot be told apart: a
 * chart that marks a key the caller ALSO names (the value reaches the model),
 * and a mapper's field mark that came from the caller's `fields` onto a key
 * the caller does not name (the field stays hidden from the model).
 *
 * With no caller policy (`callerPolicy` undefined) this is exactly the served
 * view's state, as before.
 *
 * @param executor     the finished run's executor
 * @param toolPolicy   the tool's own `redact`, as declared
 * @param callerPolicy the calling run's policy, when it joined the tool's
 * @param runRule      the run's own rule, for its marks (`watchRunRule`)
 */
export function modelFacingState(
  executor: FlowChartExecutor,
  toolPolicy: RedactionPolicy | undefined,
  callerPolicy: RedactionPolicy | undefined,
  runRule: RedactionRule | undefined,
): Readonly<Record<string, unknown>> {
  if (callerPolicy === undefined) return stateOf(servableSnapshot(executor, toolPolicy));
  const rule = new RedactionRule(toolPolicy);
  const marks = runRule?.marksForCheckpoint();
  if (marks !== undefined) {
    // A mark on a key the caller's policy selects is the caller's: dropped,
    // for whole keys and for a mapper's field marks alike.
    const callers = new RedactionRule(callerPolicy);
    const fields =
      marks.fields === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(marks.fields).filter(([key]) => !callers.isKeyRedacted(key)),
          );
    rule.restoreMarks({
      keys: marks.keys.filter((key) => !callers.isKeyRedacted(key)),
      ...(fields !== undefined && Object.keys(fields).length > 0 && { fields }),
    });
  }
  // The mirror's placeholder: what the served view held where the tool's own
  // policy selected a value.
  return rule.retainRecord(stateOf(executor.getSnapshot()), 'REDACTED');
}

/**
 * A scope factory for a chart-backed tool's executor that remembers the run's
 * own redaction rule (`StageContext · getRedactionRule`) — the rule whose
 * marks `modelFacingState` carries. The chart's own factory, or the
 * builder's default, does the scoping.
 */
export function watchRunRule(spec: FlowChart): {
  readonly scopeFactory: ScopeFactory;
  rule(): RedactionRule | undefined;
} {
  let seen: RedactionRule | undefined;
  const base: ScopeFactory = spec.scopeFactory ?? createTypedScopeFactory();
  return {
    scopeFactory: (context, stageName, readOnlyContext, executionEnv) => {
      seen = context?.getRedactionRule?.() ?? seen;
      return base(context, stageName, readOnlyContext, executionEnv);
    },
    rule: () => seen,
  };
}

/** A snapshot's shared state (older betas called it `values`). */
function stateOf(snapshot: unknown): Readonly<Record<string, unknown>> {
  return (
    (snapshot as { sharedState?: Readonly<Record<string, unknown>> }).sharedState ??
    (snapshot as { values?: Readonly<Record<string, unknown>> }).values ??
    {}
  );
}
