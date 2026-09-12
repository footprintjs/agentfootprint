/**
 * traceToolNames — the two facts about the trace toolpack that are needed
 * BEFORE the pack is loaded.
 *
 * `.selfExplain()` mounts the pack lazily (9.94.0): the toolpack module —
 * eleven tools over a finished trace, the largest single module on the
 * library's default graph — is reached through `import()` the first time
 * the self-explain skill is active on an iteration, never at build time and
 * never for an agent that did not enable it (see `selfExplain.ts` ·
 * `buildSelfExplainToolProvider`). Two things the builder needs cannot wait
 * for that load, and they live here so that reading them costs nothing:
 *
 *   - `TRACE_TOOL_NAMES` — the names the pack can mount, which `build()`
 *     reserves synchronously (a consumer tool sharing a name would silently
 *     shadow the trace tool);
 *   - `NO_COMPLETED_RUN_MESSAGE` — the model-visible answer every trace tool
 *     gives before a turn has finished, which the delegate-mode `explain_run`
 *     tool returns without loading the pack at all.
 *
 * `traceToolpack.ts` re-exports `TRACE_TOOL_NAMES` and `lazyToolpack.ts`
 * re-exports `NO_COMPLETED_RUN_MESSAGE`, so every existing import path still
 * resolves — this module only changes what a static import of them COSTS.
 */

/**
 * The tool names this pack can mount. The Agent builder reserves these at
 * `.selfExplain()` build time — the tools slot dedupes by name with
 * first-occurrence-wins, so a consumer tool sharing a name would silently
 * shadow the trace tool AND the skill body would instruct the model into
 * the wrong one. Exported so the reservation list is DERIVED from the pack
 * rather than typed out beside it (a second list is a list that drifts).
 *
 * The pack itself asserts, at test time, that what it mounts is exactly
 * this list (test/lib/trace-toolpack/selfExplainAgent.test.ts).
 */
export const TRACE_TOOL_NAMES = [
  'run_overview',
  'find_context_errors',
  'find_in_trace',
  'trace_node',
  'trace_slice',
  'backtrack',
  'who_wrote',
  'get_value',
  'inspect_tool_call',
  'inspect_tool_run',
  'read_narrative',
] as const;

/** Model-visible answer when no completed run is available yet. */
export const NO_COMPLETED_RUN_MESSAGE =
  'No completed run is available yet — the trace exists only after a turn finishes. ' +
  'Tell the user there is nothing to explain yet.';
