/**
 * lazyTraceToolpack — the toolpack with LATE-BOUND artifacts.
 *
 * `traceToolpack(artifacts)` is a factory over FROZEN artifacts: it
 * precomputes an index and even bakes step-id enums into tool schemas.
 * That is right for the dedicated debugger (the run is already complete
 * when you build it) — and wrong for `.selfExplain()`, where the tools
 * are defined at Agent BUILD time but must read the agent's own *previous
 * completed run*, which changes every turn.
 *
 * This wrapper splits the two lifetimes:
 *
 *   - SCHEMAS are built once from an empty template (artifact-independent —
 *     no id enums, generic descriptions; the same shape `traceToolpack`
 *     itself produces past the enum cap), so the tools can be mounted on
 *     a skill before any run exists.
 *   - EXECUTION resolves `resolve()` per call, builds the REAL toolpack
 *     over the resolved artifacts (memoized by snapshot identity — one
 *     index per completed run, not per call), and delegates through
 *     `callTraceTool` so arg validation matches the eager path.
 *
 * When `resolve()` returns undefined (no completed run yet), every tool
 * answers with an honest, model-visible message instead of throwing —
 * the same #9 philosophy as the toolpack's unknown-id corrections.
 */

import type { RuntimeSnapshot } from 'footprintjs';

import type { Tool } from '../../core/tools.js';
import { callTraceTool, traceToolpack } from './traceToolpack.js';
import type { TraceToolpackArtifacts, TraceToolpackOptions } from './types.js';

/** Model-visible answer when no completed run is available yet. */
export const NO_COMPLETED_RUN_MESSAGE =
  'No completed run is available yet — the trace exists only after a turn finishes. ' +
  'Tell the user there is nothing to explain yet.';

/**
 * Model-visible answer when a tool MOUNTED on the catalog has no evidence
 * to serve for this particular run.
 *
 * The lazy pack's shape is fixed at Agent BUILD time — the tool catalog and
 * the builder's name reservation both need to know the list before any run
 * exists — while an artifact bag's OPTIONAL parts (the narrative, the event
 * tail) are decided per run. So a tool can be on the catalog with nothing
 * behind it, and the honest move is to say which switch turns it back on
 * rather than to answer emptily.
 */
export function missingArtifactMessage(toolName: string): string {
  const part = toolName === 'read_narrative' ? 'narrative' : 'events';
  return (
    `${toolName} has nothing to read for this run — the captured evidence carries no ` +
    `${part}. This agent was built with selfExplain({ include: { ${part}: false } }), or the ` +
    `artifacts were assembled without it. The other trace tools are unaffected.`
  );
}

/**
 * Minimal empty snapshot for building artifact-independent template
 * schemas. The cast is safe because the toolpack's CONSTRUCTION reads
 * only `commitLog` (`?? []`) and `executionTree` (visit() guards
 * undefined) — `sharedState`/`commitValues` are read only inside
 * execute paths, and the wrapper below shadows every template execute.
 */
const EMPTY_SNAPSHOT = {
  commitLog: [],
  executionTree: undefined,
  sharedState: {},
  commitValues: 'full',
} as unknown as RuntimeSnapshot;

/**
 * Build the toolpack with late-bound artifacts.
 *
 * The template is built over an artifact bag that declares EVERY optional
 * part (an empty narrative, an empty event tail), so the lazy pack mounts
 * the same tool list every time. That fixed list is what the Agent
 * builder's name reservation and the tool catalog are both keyed on — a
 * pack whose shape depended on a run that has not happened yet could not
 * be reserved at build time. When a resolved run turns out not to carry
 * one of those parts, the tool answers with
 * {@link missingArtifactMessage} instead of quietly disappearing.
 */
export function lazyTraceToolpack(
  resolve: () => TraceToolpackArtifacts | undefined,
  options?: TraceToolpackOptions,
): Tool[] {
  const template = traceToolpack({ snapshot: EMPTY_SNAPSHOT, narrative: [], events: [] }, options);

  // One real toolpack per completed run: memoized by snapshot identity.
  // Retention note: the memo pins at most ONE prior snapshot (whatever a
  // trace tool last executed against) until the next call rebinds it.
  let memoSnapshot: RuntimeSnapshot | undefined;
  let memoTools: Tool[] | undefined;
  const realTools = (artifacts: TraceToolpackArtifacts): Tool[] => {
    if (memoTools === undefined || memoSnapshot !== artifacts.snapshot) {
      memoSnapshot = artifacts.snapshot;
      memoTools = traceToolpack(artifacts, options);
    }
    return memoTools;
  };

  return template.map((tool) => ({
    ...tool,
    execute: async (args: Record<string, unknown>) => {
      const artifacts = resolve();
      if (!artifacts) return NO_COMPLETED_RUN_MESSAGE;
      const real = realTools(artifacts);
      if (!real.some((candidate) => candidate.schema.name === tool.schema.name)) {
        return missingArtifactMessage(tool.schema.name);
      }
      return callTraceTool(real, tool.schema.name, args);
    },
  }));
}
