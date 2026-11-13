import { lazyRequire } from '../../../../lib/lazyRequire.js';
import type {
  OtelObservabilityOptions,
  OtelApiModule,
  OtelSpanLike,
  OtelSpanOptions,
  OtelAttributeValue,
  OtelTracerLike,
} from '../types.js';
import type { TurnState } from '../turns/state.js';
import { capAttrs } from '../attributes/bounds.js';
import type { Attrs } from '../attributes/projections.js';

export function createSpanWriter(opts: OtelObservabilityOptions, scopeName: string) {
  // Lazy-resolve tracer if not injected. Defer the API import until
  // first event so consumers who don't actually fire events (no agent
  // run yet) don't even hit the OTel API surface.
  let tracer: OtelTracerLike | undefined = opts.tracer;
  let otelApi: OtelApiModule | undefined = opts._otelApi;
  function ensureTracer(): OtelTracerLike {
    if (tracer) return tracer;
    if (!otelApi) {
      try {
        otelApi = lazyRequire<OtelApiModule>('@opentelemetry/api');
      } catch {
        throw new Error(
          'otelObservability requires the `@opentelemetry/api` peer dependency.\n' +
            '  Install:  npm install @opentelemetry/api\n' +
            '  Plus an OTel SDK + exporter for your backend (e.g.,\n' +
            '  `@opentelemetry/sdk-trace-node` + `@opentelemetry/exporter-trace-otlp-http`).\n' +
            '  Or pass `tracer` for test injection.',
        );
      }
    }
    if (!otelApi.trace?.getTracer) {
      throw new Error(
        'otelObservability: `@opentelemetry/api` is installed but `trace.getTracer` not found. Update the package.',
      );
    }
    tracer = otelApi.trace.getTracer(scopeName);
    return tracer;
  }
  /**
   * Start a span under `parent` (a root when `parent` is undefined) — the ONE
   * place spans are started. OTel parent-context wiring: we capture the
   * parent in a context and start the new span under it. (For BYO SDK
   * setups, the `trace.setSpan` + `context.with` pattern is canonical. For
   * the test-injected tracer path, we just pass the parent as implicit
   * context.) The parent may already have ENDED: OTel links a child by span
   * context, so a span started after its parent closed is still its child.
   */
  function startSpanUnder(
    parent: OtelSpanLike | undefined,
    name: string,
    attrs?: Record<string, OtelAttributeValue>,
    root = false,
  ): OtelSpanLike {
    let ctx: unknown;
    if (parent && otelApi?.trace?.setSpan && otelApi?.context?.active) {
      ctx = otelApi.trace.setSpan(otelApi.context.active(), parent);
    }
    const options: OtelSpanOptions | undefined =
      attrs || root
        ? { ...(attrs && { attributes: capAttrs(attrs) }), ...(root && { root: true }) }
        : undefined;
    return ensureTracer().startSpan(name, options, ctx);
  }

  function pushSpan(
    turnState: TurnState,
    name: string,
    attrs?: Record<string, OtelAttributeValue>,
  ): OtelSpanLike {
    const span = startSpanUnder(turnState.stack[turnState.stack.length - 1]?.span, name, attrs);
    turnState.stack.push({ name, span });
    return span;
  }

  /** A short span under `parent` carrying `events`, ended at once — how an
   *  event lands under a turn it can no longer be written onto. */
  function recordOnChildSpan(
    parent: OtelSpanLike,
    name: string,
    attrs: Attrs | undefined,
    events: ReadonlyArray<{ readonly name: string; readonly attrs: Attrs }>,
  ): void {
    const span = startSpanUnder(parent, name, attrs);
    for (const e of events) recordSpanEvent(span, e.name, e.attrs);
    endSpan(span);
  }
  function popSpan(
    turnState: TurnState,
    match?: string | ((name: string) => boolean),
  ): OtelSpanLike | undefined {
    let idx = turnState.stack.length - 1;
    if (match !== undefined) {
      const matches = typeof match === 'string' ? (name: string): boolean => name === match : match;
      // idx >= 0 guard guarantees stack[idx] exists.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      while (idx >= 0 && !matches(turnState.stack[idx]!.name)) idx--;
    }
    if (idx < 0) return undefined;
    // splice(idx, 1) returns a 1-element array; idx < 0 guarded above.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return turnState.stack.splice(idx, 1)[0]!.span;
  }

  function endSpan(span: OtelSpanLike, endOpts?: { error?: boolean }): void {
    if (endOpts?.error) {
      const code = otelApi?.SpanStatusCode?.ERROR ?? 2;
      try {
        span.setStatus({ code });
      } catch {
        /* mock tracers may not implement setStatus — ignore */
      }
    }
    span.end();
  }

  function setAttrs(span: OtelSpanLike, attrs: Record<string, OtelAttributeValue>): void {
    writeAttrs(span, capAttrs(attrs));
  }

  /** The raw write, for attributes already through {@link capAttrs}. */
  function writeAttrs(span: OtelSpanLike, attrs: Record<string, OtelAttributeValue>): void {
    for (const [key, value] of Object.entries(attrs)) {
      try {
        span.setAttribute(key, value);
      } catch {
        /* ignore — never break the agent loop on a sink error */
      }
    }
  }

  /** Emit a span event (preferred) or flattened-attribute fallback —
   *  see "Decisions = SPAN EVENTS" in the module docs. */
  function recordSpanEvent(
    span: OtelSpanLike,
    name: string,
    attrs: Record<string, OtelAttributeValue>,
  ): void {
    // Capped BEFORE flattening: the fallback prefixes every key, and a content
    // key must still be recognized as one.
    const capped = capAttrs(attrs);
    if (typeof span.addEvent === 'function') {
      try {
        span.addEvent(name, capped);
        return;
      } catch {
        /* fall through to attribute fallback */
      }
    }
    const flattened: Record<string, OtelAttributeValue> = {};
    for (const [key, value] of Object.entries(capped)) flattened[`${name}.${key}`] = value;
    writeAttrs(span, flattened);
  }

  function topSpan(t: TurnState | undefined): OtelSpanLike | undefined {
    return t?.stack[t.stack.length - 1]?.span;
  }

  return {
    startSpanUnder,
    pushSpan,
    recordOnChildSpan,
    popSpan,
    endSpan,
    setAttrs,
    recordSpanEvent,
    topSpan,
  };
}

export type SpanWriter = ReturnType<typeof createSpanWriter>;
