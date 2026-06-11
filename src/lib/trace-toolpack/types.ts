/**
 * Trace toolpack types — RFC-003 Part C (the introspection toolpack).
 *
 * Pattern: artifact bag — everything a debugging LLM needs to navigate a
 *          COMPLETED run, captured once and handed to `traceToolpack()`.
 * Role:    Input contract. The toolpack never re-runs anything; it serves
 *          bounded, id-addressed views over these frozen artifacts.
 */

import type { RuntimeSnapshot } from 'footprintjs';
import type { ControlDepLookup } from 'footprintjs/trace';

/**
 * The frozen evidence of one completed run.
 *
 * - `snapshot` — `executor.getSnapshot()`. Carries the commit log (what every
 *   step wrote, with verbs + redaction + `untrackedSources` honesty markers),
 *   the execution tree (per-step name/description/reads/errors), the final
 *   shared state, and the `commitValues` mode discriminant.
 * - `controlDeps` — OPTIONAL `controlDepRecorder().asLookup()` from the run.
 *   With it, causal slices include `[control: <rule label>]` edges to the
 *   decider that routed execution. Without it, slices say so explicitly.
 * - `narrative` — OPTIONAL narrative lines (e.g. rendered from
 *   `executor.getNarrativeEntries()`). When present, a `read_narrative` tool
 *   is added for bounded, paginated access to the human-readable story.
 */
export interface TraceToolpackArtifacts {
  readonly snapshot: RuntimeSnapshot;
  readonly controlDeps?: ControlDepLookup;
  readonly narrative?: readonly string[];
}

/**
 * Bounding dials. Every output is bounded BY DEFAULT — these set the
 * defaults; per-call params (`maxDepth`, `maxNodes`, `maxChars`, `maxLines`)
 * let the LLM ask for more up to hard caps the consumer cannot exceed.
 */
export interface TraceToolpackOptions {
  /** Value-preview length in chars (trace_node / who_wrote). Default 160. */
  readonly previewChars?: number;
  /** Default causal-slice depth for trace_slice. Default 6 (hard cap 20). */
  readonly sliceMaxDepth?: number;
  /** Default causal-slice node budget for trace_slice. Default 25 (hard cap 100). */
  readonly sliceMaxNodes?: number;
  /** Default char budget for get_value. Default 2000 (hard cap 8000). */
  readonly valueMaxChars?: number;
}

/** Resolved options with defaults applied (internal). */
export interface ResolvedToolpackOptions {
  readonly previewChars: number;
  readonly sliceMaxDepth: number;
  readonly sliceMaxNodes: number;
  readonly valueMaxChars: number;
}

/** Hard caps — per-call params clamp to these regardless of what the LLM asks for. */
export const TOOLPACK_HARD_CAPS = {
  sliceMaxDepth: 20,
  sliceMaxNodes: 100,
  valueMaxChars: 8000,
  narrativeMaxLines: 200,
} as const;

export function resolveToolpackOptions(options?: TraceToolpackOptions): ResolvedToolpackOptions {
  return {
    previewChars: options?.previewChars ?? 160,
    sliceMaxDepth: options?.sliceMaxDepth ?? 6,
    sliceMaxNodes: options?.sliceMaxNodes ?? 25,
    valueMaxChars: options?.valueMaxChars ?? 2000,
  };
}
