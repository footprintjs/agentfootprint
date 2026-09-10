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
 * time: a policy-redacted key never
 * enters the commit log. But the live state view is not a commit — it is the
 * run's own heap — and its scrubbed twin, the *redacted mirror*, is served
 * only by `getSnapshot({ redact: true })`. Both tools called `getSnapshot()`
 * bare, so the string the model read and the kept record's `sharedState`
 * carried the plaintext while the log beside them said `REDACTED`. Two
 * mechanisms, each correct, never composed.
 *
 * THE RULE. With a policy set, the served snapshot is footprintjs's redacted
 * view, plus one thing that view leaves raw: a subflow's final state.
 * `subflowResults[*].treeContext.globalContext` is the subflow's own isolated
 * heap (footprintjs `SubflowExecutor` builds the result from the nested
 * runtime's `sharedState`, and only the RUN-level runtime keeps a mirror). Its
 * `history`, though, is that subflow's commit log — scrubbed at write time
 * like the run's — so the served state is the FOLD of that history, through
 * footprintjs's own `stateAt`. That is the same construction the run-level
 * mirror is (apply the scrubbed patches in order), done at serve time for the
 * level footprintjs does not mirror. The subflow's fold base is dropped by the
 * same law footprintjs applies to the run's (`ExecutionRuntime.getSnapshot`:
 * the base never passed a policy, so it is omitted rather than served) — a
 * subflow runtime is created bare (`SubflowExecutor`, through 9.19.1), so that
 * base is `{}` and nothing is lost; the omission is there for the day it is not.
 *
 * Without a policy this is `executor.getSnapshot()`, byte for byte: no
 * mirror, no fold, the fold bases present, exactly the path both tools had.
 *
 * WHAT IT CANNOT DO — and what it no longer has to (9.89.2). A served view is
 * as clean as the log it is built from, and since footprintjs 9.19.0 the log
 * is clean: ONE policy covers everything the run retains or serves — the
 * commit log in both encodings, the redacted mirror, `stageReads` /
 * `stageWrites`, recorder events and the narrative, a subflow's `inputMapper`
 * seed (its `history[0]` and its narrated `Input:` line) and its
 * `outputMapper` merge-back into the parent, `fields` dot-paths in the log and
 * the mirror — and NEVER the live heap the run computes on nor the resume
 * checkpoint. The five places footprintjs 9.18 left plaintext in the record
 * (dot-path fields, merge-back, seed, seed narrative, tracked reads — each a
 * write or a read past the scope facade) are closed at the root by its
 * `RedactionRule`, which `StageContext` asks on every staged write and every
 * tracked read; `test/core/flowchartAsTool.redact.test.ts` §6 asserts each
 * one closed, red on 9.18. ONE limit remains, and it is the one this function
 * exists for: `subflowResults[*].treeContext.globalContext` (and its `#n`
 * twin) is the subflow's raw heap even under `getSnapshot({ redact: true })`
 * — only the run-level runtime keeps a mirror — so the refold above is the
 * answer, pinned in §7 of the same file. The resume checkpoint
 * (`err.checkpoint` on a paused run) is not a served view: resumption must
 * replay against real values, and it is handed to the agent loop, never to a
 * model.
 */

import type { FlowChartExecutor, RedactionPolicy, RuntimeSnapshot } from 'footprintjs';
import { stateAt } from 'footprintjs/trace';

/** The part of a footprintjs `SubflowResult` this projection reads and rewrites. */
interface SubflowStateEntry {
  readonly treeContext: {
    readonly globalContext: Record<string, unknown>;
    readonly history: readonly unknown[];
    readonly initialState?: Record<string, unknown>;
    readonly [extra: string]: unknown;
  };
  readonly [extra: string]: unknown;
}

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
  if (policy === undefined) return executor.getSnapshot();
  const view = executor.getSnapshot({ redact: true });
  if (view.subflowResults === undefined) return view;
  return { ...view, subflowResults: refoldSubflowStates(view.subflowResults) };
}

/**
 * Rewrite every subflow entry's final state as the fold of its own scrubbed
 * log. `subflowResults` is dual-keyed (subflow path AND mount runtimeStageId
 * name the SAME object), so the fold runs once per object and both keys keep
 * pointing at one entry — the shape a consumer already relies on.
 */
function refoldSubflowStates(results: Record<string, unknown>): Record<string, unknown> {
  const refolded = new Map<unknown, unknown>();
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(results)) {
    if (!refolded.has(entry)) refolded.set(entry, refoldOne(entry));
    out[key] = refolded.get(entry);
  }
  return out;
}

function refoldOne(entry: unknown): unknown {
  if (!isSubflowStateEntry(entry)) return entry;
  const { initialState: _droppedBase, ...treeContext } = entry.treeContext;
  void _droppedBase;
  // Log-only on purpose — see the module note on the fold base.
  const { state } = stateAt({ history: treeContext.history }, treeContext.history.length - 1);
  return { ...entry, treeContext: { ...treeContext, globalContext: state } };
}

function isSubflowStateEntry(entry: unknown): entry is SubflowStateEntry {
  if (entry === null || typeof entry !== 'object') return false;
  const treeContext = (entry as { treeContext?: unknown }).treeContext;
  return (
    treeContext !== null &&
    typeof treeContext === 'object' &&
    Array.isArray((treeContext as { history?: unknown }).history)
  );
}
