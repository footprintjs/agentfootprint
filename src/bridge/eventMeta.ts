/**
 * eventMeta — build EventMeta from a footprintjs TraversalContext.
 *
 * Pattern: Adapter (GoF) — translates footprintjs's per-stage context into
 *          agentfootprint's per-event metadata shape.
 * Role:    Used by every core recorder to attach meta to emitted events.
 * Emits:   N/A (helper only).
 */

import type { TraversalContext } from 'footprintjs';
import { parseRuntimeStageId } from 'footprintjs/trace';
import type { EventMeta } from '../events/types.js';

// NOTE: runtimeStageId parsing lives in footprintjs/trace
// (parseRuntimeStageId, buildRuntimeStageId). We reuse their helper instead
// of re-implementing the split.

/**
 * Minimal "stage origin" shape — the common subset of footprintjs's
 * TraversalContext (from FlowRecorder events), RecorderContext (from
 * Recorder data-flow events), and EmitEvent (from EmitRecorder).
 *
 * Note: `subflowPath` type varies across footprintjs event shapes:
 *   - TraversalContext.subflowPath → `string | undefined` (/-separated)
 *   - EmitEvent.subflowPath        → `readonly string[]`
 *   - RecorderContext              → N/A (derived from runtimeStageId)
 *
 * We accept both shapes and normalize inside `buildEventMeta`.
 */
export interface StageOrigin {
  readonly runtimeStageId?: string;
  readonly subflowPath?: string | readonly string[];
}

export interface RunContext {
  /** Millisecond wall-clock timestamp when the run started. */
  readonly runStartMs: number;
  /** Unique run id (demultiplex concurrent runs sharing one dispatcher). */
  readonly runId: string;
  /** Optional OTEL trace id forwarded from executor.run({ env: { traceId } }). */
  readonly traceId?: string;
  /** Optional correlation id for cross-event tying (retrieval→injection→LLM). */
  readonly correlationId?: string;
  /** Composition ancestry path (e.g. ['Sequence:bot', 'Agent:classify']). */
  readonly compositionPath: readonly string[];
  /** Optional turn/iter indices from agent runtime. */
  readonly turnIndex?: number;
  readonly iterIndex?: number;
  /** The hosting conversation this run belongs to, when it belongs to one
   *  (9.4.0). Absent for an unhosted or anonymous run — never fabricated. */
  readonly sessionId?: string;
  /** WHO the caller NAMED for this run (9.11.0) — from an explicit
   *  `run({ identity })` only, never from the synthesized `runIdentity` and
   *  never derived from a session. Absent for an anonymous run. */
  readonly principal?: string;
  /** The tenant the caller NAMED for this run (9.11.0). Same rule as
   *  {@link RunContext.principal}. */
  readonly tenant?: string;
}

/**
 * Build an EventMeta from a stage origin + run-level context.
 *
 * Accepts footprintjs's TraversalContext (FlowRecorder events), RecorderContext
 * (WriteEvent / CommitEvent / etc.), or a bare StageOrigin. When the origin
 * has no runtimeStageId (rare — manual emit during tests), the meta degrades
 * gracefully to 'unknown#0'.
 */
export function buildEventMeta(
  origin: StageOrigin | TraversalContext | undefined,
  run: RunContext,
): EventMeta {
  const now = Date.now();
  const runtimeStageId = origin?.runtimeStageId ?? 'unknown#0';
  // Normalize subflowPath across the 3 shapes footprintjs uses:
  //   - undefined (RecorderContext: derive from runtimeStageId)
  //   - /-separated string (TraversalContext: parse)
  //   - readonly string[] (EmitEvent: pass through)
  const raw = (origin as StageOrigin | undefined)?.subflowPath;
  const subflowPath: readonly string[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
    ? parseSubflowPath(raw)
    : parseSubflowPath(parseRuntimeStageId(runtimeStageId).subflowPath);
  return {
    wallClockMs: now,
    runOffsetMs: now - run.runStartMs,
    runtimeStageId,
    subflowPath,
    compositionPath: run.compositionPath,
    runId: run.runId,
    ...(run.traceId !== undefined && { traceId: run.traceId }),
    ...(run.correlationId !== undefined && { correlationId: run.correlationId }),
    ...(run.turnIndex !== undefined && { turnIndex: run.turnIndex }),
    ...(run.iterIndex !== undefined && { iterIndex: run.iterIndex }),
    // Present only when the run really is session-bound. An absent key and an
    // empty string are different facts, and only one of them is honest.
    ...(run.sessionId !== undefined && { sessionId: run.sessionId }),
    // The actor half of the audit wire (9.11.0). Same rule, one layer up: the
    // runner only ever puts an EXPLICIT identity on the run context, so there
    // is nothing to filter here — an absent key means nobody named one.
    ...(run.principal !== undefined && { principal: run.principal }),
    ...(run.tenant !== undefined && { tenant: run.tenant }),
  };
}

/**
 * Parse footprintjs's `/`-separated subflow path into a readonly array.
 *
 * The source of truth for runtimeStageId parsing lives in footprintjs at
 * `footprintjs/trace::parseRuntimeStageId`. We only need the path-split
 * convenience here; the `/` separator is stable across footprintjs
 * versions (covered by their `parseRuntimeStageId` tests).
 */
export function parseSubflowPath(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw.split('/').filter((s) => s.length > 0);
}
