/**
 * A capturing OTel tracer for the `otelObservability` suites — the in-memory
 * exporter these tests use in place of the OTel SDK (which is not a dependency
 * of this repo: the adapter is BYO-SDK by design).
 *
 * It records what an exporter would receive — every span in start order, its
 * PARENT (through a fake `_otelApi` context, the one seam the adapter parents
 * spans through), its attributes in insertion order, its span events and its
 * status — so a projection of the capture is a byte-comparable picture of the
 * wire.
 */
import type {
  OtelAttributeValue,
  OtelSpanLike,
  OtelSpanOptions,
  OtelTracerLike,
} from '../../src/adapters/observability/otel.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

export interface CapturedSpanEvent {
  readonly name: string;
  readonly attributes: Record<string, OtelAttributeValue>;
}

export interface CapturedSpan {
  readonly name: string;
  /** Index (in `spans`) of the span this one was started under; `null` = a root. */
  readonly parent: number | null;
  /** Started with `SpanOptions.root` — a new trace whatever is active. */
  readonly root?: true;
  readonly attributes: Record<string, OtelAttributeValue>;
  readonly events: CapturedSpanEvent[];
  status?: { code: number; message?: string };
  ended: boolean;
}

/** The subset of `@opentelemetry/api` the adapter reads when it parents spans. */
export interface FakeOtelApi {
  readonly trace: {
    getTracer(): OtelTracerLike;
    setSpan(context: unknown, span: OtelSpanLike): unknown;
  };
  readonly context: { active(): unknown; with<T>(ctx: unknown, fn: () => T): T };
  readonly SpanStatusCode: { OK: number; ERROR: number; UNSET: number };
}

export interface Capture {
  readonly tracer: OtelTracerLike;
  /** Pass as `_otelApi` so the adapter's parent wiring is observable. */
  readonly otelApi: FakeOtelApi;
  readonly spans: CapturedSpan[];
}

const PARENT = Symbol('parent-span-index');

export function makeCapture(opts: { withAddEvent?: boolean } = {}): Capture {
  const withAddEvent = opts.withAddEvent !== false;
  const spans: CapturedSpan[] = [];
  const indexOf = new WeakMap<OtelSpanLike, number>();

  const tracer: OtelTracerLike = {
    startSpan(name: string, options?: OtelSpanOptions, context?: unknown): OtelSpanLike {
      const parentIndex =
        typeof context === 'object' && context !== null && PARENT in context
          ? (context as { [PARENT]: number })[PARENT]
          : null;
      const captured: CapturedSpan = {
        name,
        parent: parentIndex,
        ...(options?.root === true && { root: true as const }),
        attributes: { ...(options?.attributes ?? {}) },
        events: [],
        ended: false,
      };
      spans.push(captured);
      const span: OtelSpanLike = {
        setAttribute(key, value): unknown {
          captured.attributes[key] = value;
          return undefined;
        },
        setStatus(status): unknown {
          captured.status = status;
          return undefined;
        },
        end(): void {
          captured.ended = true;
        },
        spanContext() {
          return {
            traceId: 'capture-trace',
            spanId: `span-${spans.indexOf(captured)}`,
            traceFlags: 1,
          };
        },
        ...(withAddEvent && {
          addEvent(eventName: string, attributes?: Record<string, OtelAttributeValue>): unknown {
            // A real SDK drops an event on an ENDED span; recording it anyway
            // would let a test pass on data no exporter would ever receive.
            if (captured.ended) return undefined;
            captured.events.push({ name: eventName, attributes: { ...(attributes ?? {}) } });
            return undefined;
          },
        }),
      };
      indexOf.set(span, spans.length - 1);
      return span;
    },
  };

  const otelApi: FakeOtelApi = {
    trace: {
      getTracer: () => tracer,
      setSpan: (_ctx, span) => ({ [PARENT]: indexOf.get(span) ?? null }),
    },
    context: { active: () => ({}), with: (_ctx, fn) => fn() },
    SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  };

  return { tracer, otelApi, spans };
}

/** A REAL dispatcher-envelope event — the run anchor rides `meta.runId`. */
export function envelope(
  type: string,
  payload: Record<string, unknown>,
  runId = 'run-1',
  meta: Record<string, unknown> = {},
): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: 0,
      runOffsetMs: 0,
      runtimeStageId: 'stage#0',
      subflowPath: [],
      compositionPath: [],
      runId,
      ...meta,
    },
  } as unknown as AgentfootprintEvent;
}

/** Every span name, attribute and span event as ONE string — for "value X
 *  appears NOWHERE on the wire" assertions. */
export function allEmittedText(spans: readonly CapturedSpan[]): string {
  return JSON.stringify(spans.map((s) => ({ n: s.name, a: s.attributes, e: s.events })));
}

/** Every span event with this name, across the tree. */
export function eventsNamed(spans: readonly CapturedSpan[], name: string): CapturedSpanEvent[] {
  return spans.flatMap((s) => s.events.filter((e) => e.name === name));
}
