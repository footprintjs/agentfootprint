import type { DomainEvent, DomainSubflowEvent } from './domainEvents.js';

// ─── BoundaryAggregate — per-boundary rollup ────────────────────────

/**
 * Per-boundary rollup returned by
 * `BoundaryRecorder.aggregateForBoundary` and
 * `BoundaryRecorder.aggregateAllBoundaries`. Same shape regardless of
 * primitive kind — UIs render the same chip set for every Agent /
 * LLMCall / Sequence / Parallel / Conditional / Loop.
 *
 * Events count toward this rollup when their `subflowPath` is a
 * prefix-match of the boundary's `subflowPath`. Nested boundaries
 * (e.g., LLMCall inside an Agent) contribute to BOTH rollups.
 *
 * In-flight boundaries (no `subflow.exit` yet) get partial values;
 * `endedAtMs` and `durationMs` are undefined until close.
 */
export interface BoundaryAggregate {
  readonly runtimeStageId: string;
  readonly subflowId: string;
  readonly subflowPath: readonly string[];
  /** `'Agent'` / `'LLMCall'` / `'Sequence'` / `'Parallel'` /
   *  `'Conditional'` / `'Loop'`. Always set on rollups returned by
   *  `aggregateAllBoundaries` (which filters to primitive boundaries).
   *  Optional on `aggregateForBoundary` results because the caller may
   *  request rollup for a non-primitive subflow (rare). */
  readonly primitiveKind?: string;
  /** Subflow display name (e.g., 'Triage', 'Billing'). */
  readonly label: string;
  /** Token usage summed across every `llm.end` inside this boundary. */
  readonly tokens: { readonly input: number; readonly output: number };
  /** Count of `llm.start` events inside this boundary. */
  readonly llmCalls: number;
  /** Count of `tool.start` events inside this boundary — a settled call's
   *  (`notDispatched`, 9.113.0) excluded: it never ran. */
  readonly toolCalls: number;
  /** Count of `agent.iteration_start` events scoped to this boundary —
   *  ReAct-loop iterations. Always `0` for non-Agent primitives. */
  readonly iterations: number;
  /** Wall-clock ms of `subflow.entry`. */
  readonly startedAtMs: number;
  /** Wall-clock ms of `subflow.exit`. Undefined while in flight. */
  readonly endedAtMs?: number;
  /** `endedAtMs - startedAtMs`. Undefined while in flight. */
  readonly durationMs?: number;
}

// ─── Rollup helpers (used by aggregateForBoundary) ──────────────────

/** Returns true when `path` starts with every segment of `prefix`. */
function isSubflowPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  if (path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Single-pass fold producing a `BoundaryAggregate` from the flat
 * event stream. Pure projection — no recorder state mutation.
 */
function foldRollup(
  events: readonly DomainEvent[],
  entry: DomainSubflowEvent,
  exit: DomainSubflowEvent | undefined,
): BoundaryAggregate {
  const path = entry.subflowPath;
  let llmCalls = 0;
  let toolCalls = 0;
  let iterations = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of events) {
    if (!isSubflowPathPrefix(path, e.subflowPath)) continue;
    switch (e.type) {
      case 'llm.start':
        llmCalls++;
        break;
      case 'tool.start':
        // A settled call (9.113.0) was never dispatched: not a tool call of
        // this boundary — the count it had before the settlement bracketed it.
        if (e.notDispatched === undefined) toolCalls++;
        break;
      case 'llm.end':
        inputTokens += e.usage.input;
        outputTokens += e.usage.output;
        break;
      // Iteration counting: every loop.iteration scoped to this
      // boundary OR equivalent. The composition.iteration / agent.
      // iteration_start typed events fire on the dispatcher channel
      // but BoundaryRecorder doesn't capture them as DomainEvents
      // today — instead we count `loop.iteration` events that fire
      // on the FlowRecorder side (already mapped). For Agent runs
      // the agent's outer loop contributes one per ReAct cycle.
      case 'loop.iteration':
        iterations++;
        break;
    }
  }
  const startedAtMs = entry.ts;
  const endedAtMs = exit?.ts;
  return {
    runtimeStageId: entry.runtimeStageId,
    subflowId: entry.subflowId,
    subflowPath: entry.subflowPath,
    ...(entry.primitiveKind ? { primitiveKind: entry.primitiveKind } : {}),
    label: entry.subflowName,
    tokens: { input: inputTokens, output: outputTokens },
    llmCalls,
    toolCalls,
    iterations,
    startedAtMs,
    ...(endedAtMs !== undefined ? { endedAtMs, durationMs: endedAtMs - startedAtMs } : {}),
  };
}

export { foldRollup };
