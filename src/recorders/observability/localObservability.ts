/**
 * localObservability — Tier-3 (Debug) observability: RETAIN a live run model,
 * render it live, and snapshot it for offline replay.
 *
 * One handle, two outputs:
 *   - LIVE   — `onLive(graph)` fires per event with a fresh `StepGraph`; hand
 *              it to your own renderer, or read `handle.getSnapshot()` /
 *              `handle.boundary` whenever you like.
 *   - OFFLINE— `getTrace()` (any time) and `onRecorded(trace)` (auto, at run
 *              exit) freeze the model into a JSON-lossless `Trace`.
 *
 * This handle is NOT a Lens recorder. `<Lens recorder={…} />` wants a
 * `LensRecorder` — a different object with a different surface — and passing
 * this one gives a component with none of the members it calls. To put a run
 * in front of Lens, record it and hand the recording over:
 *
 *   const stop = recordRun(agent);          // agentfootprint/observe
 *   await agent.run({ message });
 *   const recording = stop.toRecording();   // { snapshot, events, structure }
 *
 *   // …in the viewer:
 *   const { recorder, runner } = observeRecording(recording);   // lens
 *   <Lens recorder={recorder} runner={runner} />
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
  /** LIVE recording — called with a fresh StepGraph on every event. */
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
  /**
   * Carry the run's footprintjs snapshot (state + commit log + recorder
   * data) in the Trace. Default `false`.
   *
   * A Trace WITHOUT it draws a chart and a timeline and nothing else: the
   * commit axis, ExplainableShell's memory and provenance panels, and
   * WhereFrom all read the commit log, which lives in the snapshot and
   * appears nowhere in the event log. Turn this on and the Trace can feed
   * them.
   *
   * Off by default because of `redact`, not because of size. `redact` is a
   * per-DOMAIN-EVENT function — it cannot reach inside a snapshot, whose
   * `sharedState` is the run's raw working memory. Filling this field
   * automatically would have widened what a carefully redacted Trace
   * exports without a line of code changing at any call site, which is the
   * kind of quiet trust-boundary move a library has no business making.
   * When you turn it on, redaction for the snapshot half is footprintjs's
   * `setRedactionPolicy()` at run time — the run's own policy, applied when
   * the values were written.
   *
   * For a viewer, prefer `recordRun()`: `{ snapshot, events, structure }`
   * is the shape the UIs consume, and it is explicit about carrying state.
   */
  readonly includeSnapshot?: boolean;
}

/**
 * The three things a live runner knows that a recorder cannot see for
 * itself. Each one lights a different surface of the stored Trace, and a
 * missing one degrades exactly that surface:
 *
 *   - `getStructure`   → the chart. Nothing else can draw it.
 *   - `getSnapshot`    → state, commit log, every attached recorder's data.
 *   - `getCommitCount` → where each boundary sits on the commit axis.
 *
 * All three are read lazily, at the moment they are needed, because all
 * three answer differently before, during and after a run.
 *
 * @internal Supplied by `RunnerBase.enable.localObservability`.
 */
export interface RunAccess {
  /** `() => runner.getSpec().buildTimeStructure` — the static chart. */
  readonly getStructure?: () => unknown;
  /** `() => runner.getLastSnapshot()` — the footprintjs run snapshot. */
  readonly getSnapshot?: () => unknown;
  /** `() => runner.getCommitCount()` — sampled live on every boundary. */
  readonly getCommitCount?: () => number;
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
  access: RunAccess = {},
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
      ...(access.getStructure && { structure: access.getStructure() }),
      // Opt-in — `redact` is a per-event function and cannot reach inside a
      // snapshot, so filling this by default would widen what a redacted
      // Trace exports. Read at freeze time, not at attach time: before the
      // run there is no snapshot, and during one it grows. `onRecorded`
      // fires from the run's own exit boundary, where it is final.
      ...(options.includeSnapshot && access.getSnapshot && { snapshot: access.getSnapshot() }),
      ...(options.redact && { redact: options.redact }),
      ...override,
    });

  handle = attachFlowchart(
    runnerAttach,
    dispatcher,
    {
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
    },
    access.getCommitCount,
  );

  return { ...handle, getTrace: buildTrace };
}
