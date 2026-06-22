/**
 * Trace — a UI-free, JSON-lossless snapshot of a run for OFFLINE REPLAY.
 *
 * `localObservability()` (Tier-3 / Debug) retains a live model during a run.
 * `serializeTrace()` freezes that model into a `Trace` — plain JSON you can
 * persist (file, Redis, a bug report) and later rehydrate WITHOUT re-running
 * the agent. `agentfootprint-lens`'s `<Replay trace={…} />` consumes it and
 * rebuilds the flowchart via the existing translators.
 *
 * A `Trace` stores ONLY the domain-event log (the single source of truth the
 * Lens already reads). The step graph is ALWAYS a derived projection of those
 * events (footprint.js's "graph is derived, never post-processed" principle) —
 * it is rebuilt at render time, never stored. Storing a derived graph would be
 * redundant AND a redaction hazard: a second content surface a per-event
 * `redact` could never reach.
 *
 * PII / trust boundary: the event log carries real content — `llm.end.content`,
 * `tool.start.args`, `tool.end.result`, `context.injected.contentSummary`,
 * `run`/`subflow` `payload`, `decision.branch.rationale`. A live, in-process
 * model is fine, but **serializing is a trust-boundary crossing** (the trace
 * can travel). So redaction is applied HERE, at serialize time, via a
 * consumer `redact` function — PII never enters the `Trace`. `redactContent`
 * is a ready-made redactor covering every content field. The result is
 * self-describing: `trace.redaction`. See
 * `docs/design/local-observability-and-pii.md`.
 *
 * Because `getEvents()` is FLAT (parent + every subflow), one `redact` pass
 * covers the whole tree — no per-subflow inheritance needed here. (The engine's
 * `RedactionPolicy` separately propagates to subflows for the OBSERVER mirror.)
 */

import type { DomainEvent } from './BoundaryRecorder.js';
import { buildStepGraphFromEvents, type StepGraph } from './FlowchartRecorder.js';

/**
 * How a `Trace` was redacted before serialization.
 * - `'none'`   — raw content (no `redact`). A `<Replay>` UI may warn.
 * - `'pii'`    — a consumer `redact` ran (the default label when one is given).
 * - `'policy'` — produced from a declarative `RedactionPolicy` (future).
 */
export type TraceRedaction = 'none' | 'pii' | 'policy';

/** Cheap headline rollup, so a consumer can show totals without folding `events`. */
export interface TraceSummary {
  readonly tokens: { readonly input: number; readonly output: number };
  readonly llmCalls: number;
  readonly toolCalls: number;
  readonly durationMs?: number;
}

/**
 * A JSON-lossless, UI-free snapshot of one run. Persist it, ship it, replay it.
 * `events` ARE the run (the graph is a derived projection, rebuilt at render).
 */
export interface Trace {
  /** Schema version. Bump on a breaking shape change. */
  readonly version: 1;
  /** The domain-event log — the whole timeline. Already redacted if `redact` ran. */
  readonly events: readonly DomainEvent[];
  /**
   * The serialized STATIC chart structure (footprint.js `buildTimeStructure`).
   * Design-time data (stage ids/names/types/edges) — UI-free. `<Replay>` rebuilds
   * the flowchart from this and overlays `events`, so an offline replay matches
   * the live `<Lens>` exactly. NOT runtime-redacted (it carries no user data; the
   * `redact` function targets runtime events).
   */
  readonly structure?: unknown;
  /** Optional headline totals. */
  readonly summary?: TraceSummary;
  /** Self-describing redaction state — travels with the trace. */
  readonly redaction: TraceRedaction;
  /** Wall-clock capture time, stamped by the caller (the engine has no clock here). */
  readonly capturedAtMs?: number;
}

export interface SerializeTraceOptions {
  /**
   * Consumer redaction — runs once per domain event at the serialize boundary,
   * so PII never enters the `Trace`. Return a scrubbed COPY (do not mutate the
   * input — the live model still references it). Use `redactContent` for a
   * ready-made redactor. When omitted, content is raw.
   */
  readonly redact?: (event: DomainEvent) => DomainEvent;
  /** Override the `redaction` label. Defaults to `'pii'` when `redact` is given, else `'none'`. */
  readonly redactionLabel?: TraceRedaction;
  /** The serialized static chart (`getSpec().buildTimeStructure`) — for `<Replay>` to rebuild the flowchart. */
  readonly structure?: unknown;
  /** Optional precomputed headline rollup. */
  readonly summary?: TraceSummary;
  /** Wall-clock capture time. Pass `Date.now()` from the call site. */
  readonly capturedAtMs?: number;
}

/**
 * Ready-made redactor: replaces every content-bearing field with a marker,
 * keeping structure/counts for a useful replay. Covers ALL `DomainEvent`
 * content surfaces — pass it to `getTrace({ redact: redactContent })`.
 *
 * Returns a copy only when it changes something, so unaffected events stay
 * referentially identical (cheap) and the caller's live model is never mutated.
 */
export function redactContent(event: DomainEvent): DomainEvent {
  switch (event.type) {
    case 'llm.end':
      return { ...event, content: `[${event.content.length} chars]` };
    case 'tool.start':
      return event.args !== undefined ? { ...event, args: '[redacted]' } : event;
    case 'tool.end':
      return event.result !== undefined ? { ...event, result: '[redacted]' } : event;
    case 'context.injected':
      return event.contentSummary !== undefined
        ? { ...event, contentSummary: '[redacted]' }
        : event;
    case 'run.entry':
    case 'run.exit':
      return event.payload !== undefined ? { ...event, payload: '[redacted]' } : event;
    case 'subflow.entry':
    case 'subflow.exit':
      return event.payload !== undefined ? { ...event, payload: '[redacted]' } : event;
    case 'decision.branch':
      return event.rationale !== undefined ? { ...event, rationale: '[redacted]' } : event;
    default:
      return event;
  }
}

/**
 * Freeze a live run model into a `Trace`. Pure: pass the `BoundaryRecorder`'s
 * `getEvents()` output.
 *
 *   const trace = serializeTrace(handle.boundary.getEvents(), {
 *     redact: redactContent,         // PII stripped before it enters the trace
 *     capturedAtMs: Date.now(),
 *   });
 *   fs.writeFileSync('run.trace.json', JSON.stringify(trace));
 */
export function serializeTrace(
  events: readonly DomainEvent[],
  options: SerializeTraceOptions = {},
): Trace {
  const { redact, redactionLabel, structure, summary, capturedAtMs } = options;
  // A fresh array either way, so a held Trace is detached from the live store.
  const safeEvents = redact ? events.map((e) => redact(e)) : events.slice();
  const redaction: TraceRedaction = redactionLabel ?? (redact ? 'pii' : 'none');
  return {
    version: 1,
    events: safeEvents,
    ...(structure !== undefined && { structure }),
    ...(summary !== undefined && { summary }),
    redaction,
    ...(capturedAtMs !== undefined && { capturedAtMs }),
  };
}

/**
 * Rebuild the step graph from a `Trace` — the offline half of replay. The graph
 * is ALWAYS a derived projection of `trace.events`; because those events were
 * already redacted at serialize time, the rebuilt graph is clean too (no extra
 * redaction needed — that's exactly why the graph is never stored). UI-free:
 * `agentfootprint-lens`'s `<Replay>` translates this `StepGraph` into its
 * xyflow render model.
 */
export function traceToStepGraph(trace: Trace): StepGraph {
  return buildStepGraphFromEvents(trace.events);
}
