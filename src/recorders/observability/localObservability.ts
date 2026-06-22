/**
 * localObservability — Tier-3 (Debug) observability: RETAIN a live run model,
 * render it live, and snapshot it for offline replay.
 *
 * One handle, two outputs:
 *   - LIVE   — `onUpdate(graph)` fires per event; pass the handle to
 *              `<Lens recorder={handle} />` and it re-renders as the agent runs.
 *   - OFFLINE— `getTrace()` (any time) and `onComplete(trace)` (auto, at run
 *              exit) freeze the model into a JSON-lossless `Trace` for `<Replay>`.
 *
 * Contrast with `enable.observability({ strategy })` (Tier-4 / Monitor), which
 * ships each event to a vendor and FORGETS. localObservability KEEPS the model
 * so you can look at it — locally, with full content. See
 * `docs/design/local-observability-and-pii.md`.
 *
 * It's a thin wrapper over `enable.flowchart` (the existing live StepGraph) +
 * `serializeTrace` (the snapshot). UI-free: returns data, never React.
 */

import type { CombinedRecorder } from 'footprintjs';

import type { EventDispatcher } from '../../events/dispatcher.js';
import type { DomainEvent } from './BoundaryRecorder.js';
import { attachFlowchart, type FlowchartHandle, type StepGraph } from './FlowchartRecorder.js';
import { serializeTrace, type SerializeTraceOptions, type Trace } from './trace.js';

export interface LocalObservabilityOptions {
  /** LIVE recording — called with a fresh StepGraph on every event (drives `<Lens>`). */
  readonly onLive?: (graph: StepGraph) => void;
  /** At run exit — called once with the finalized recording (a Trace, auto-serialized) to replay offline. */
  readonly onRecorded?: (trace: Trace) => void;
  /**
   * Default serialize-time redaction, applied to BOTH `onRecorded` and
   * `getTrace()` (overridable per `getTrace` call). Runs once per event so PII
   * never enters the Trace — see the trust-boundary note in the design doc.
   * Pass `redactContent` for a ready-made redactor.
   */
  readonly redact?: (event: DomainEvent) => DomainEvent;
}

/** A `FlowchartHandle` (live) plus `getTrace()` (offline snapshot). */
export interface LocalObservabilityHandle extends FlowchartHandle {
  /** Freeze the current model into a JSON-lossless Trace. Safe during or after a run. */
  getTrace(options?: SerializeTraceOptions): Trace;
}

/**
 * Attach a local-observability handle. `now` is injectable for tests (the
 * library otherwise stamps `Date.now()` at serialize time).
 *
 * @internal Called from `RunnerBase.enable.localObservability`.
 */
export function attachLocalObservability(
  runnerAttach: (recorder: CombinedRecorder) => () => void,
  dispatcher: EventDispatcher,
  options: LocalObservabilityOptions = {},
  now: () => number = Date.now,
  getStructure?: () => unknown,
): LocalObservabilityHandle {
  let completed = false;
  // `let` (not const): `handle` is referenced by `buildTrace` and the onUpdate
  // closure below, both defined before its assignment. The closures only run
  // after `attachFlowchart` returns, so `handle` is always set by call time.
  // eslint-disable-next-line prefer-const
  let handle: FlowchartHandle;

  const buildTrace = (override?: SerializeTraceOptions): Trace =>
    serializeTrace(handle.boundary.getEvents(), {
      capturedAtMs: now(),
      ...(getStructure && { structure: getStructure() }),
      ...(options.redact && { redact: options.redact }),
      ...override,
    });

  handle = attachFlowchart(runnerAttach, dispatcher, {
    onUpdate: (graph) => {
      options.onLive?.(graph);
      // Fire onRecorded once, when the root run boundary closes.
      if (
        options.onRecorded &&
        !completed &&
        handle.boundary.getEvents().some((e) => e.type === 'run.exit')
      ) {
        completed = true;
        options.onRecorded(buildTrace());
      }
    },
  });

  return { ...handle, getTrace: buildTrace };
}
