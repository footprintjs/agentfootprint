/**
 * otelObservability — OpenTelemetry distributed-tracing adapter.
 *
 * Ships every agentfootprint event as OpenTelemetry spans + log
 * records via a consumer-supplied OTel API. Same hierarchical
 * mapping as the X-Ray adapter, but the destination is whichever
 * OTel-compat backend the consumer's SDK exports to:
 *
 *   - **Honeycomb** (OTLP/HTTP)
 *   - **Grafana Cloud / Tempo / Mimir** (OTLP)
 *   - **AWS Distro for OTel** → AWS X-Ray (alternative to xrayObservability)
 *   - **Datadog APM** (OTLP endpoint)
 *   - **Splunk Observability Cloud** (OTLP)
 *   - **New Relic** (OTLP endpoint)
 *   - **Lightstep / ServiceNow Cloud Observability** (OTLP)
 *   - any custom OTel collector / processor pipeline
 *
 * Subpath:  `agentfootprint/observability-providers`
 * Peer dep: `@opentelemetry/api` (OPTIONAL — installed only when
 *           this adapter is used. The consumer ALSO installs the
 *           OTel SDK + exporter of their choice — that's the BYO
 *           contract that makes this adapter backend-agnostic.).
 *
 * **Why BYO SDK:** OTel's SDK is heavyweight and exporter-specific
 * (each backend has its own exporter package). Forcing a particular
 * exporter would defeat the "OTel is portable" guarantee. Consumers
 * configure the SDK + exporter once at app startup; we just speak
 * the typed OTel API.
 *
 * Mapping:
 *
 *   agent.turn_start          ↦  start root span (one trace per turn)
 *   agent.turn_end            ↦  end root span
 *   agent.iteration_start     ↦  start child span under root
 *   agent.iteration_end       ↦  end iteration span
 *   stream.llm_start          ↦  start child span (model call)
 *   stream.llm_end            ↦  end llm span
 *   stream.tool_start         ↦  start child span (tool call)
 *   stream.tool_end           ↦  end tool span (with `error: true` if errored)
 *   cost.tick                 ↦  setAttribute on topmost active span
 *
 * @example Basic — Honeycomb via OTLP
 * ```ts
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { trace } from '@opentelemetry/api';
 * import { otelObservability } from 'agentfootprint/observability-providers';
 *
 * // Set up OTel ONCE at app startup.
 * const provider = new NodeTracerProvider();
 * provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({
 *   url: 'https://api.honeycomb.io/v1/traces',
 *   headers: { 'x-honeycomb-team': process.env.HONEYCOMB_KEY },
 * })));
 * provider.register();
 *
 * agent.enable.observability({
 *   strategy: otelObservability({
 *     serviceName: 'my-agent',
 *     // tracer optional — defaults to trace.getTracer('agentfootprint').
 *   }),
 * });
 * ```
 *
 * @example Test injection
 * ```ts
 * otelObservability({
 *   serviceName: 'test',
 *   tracer: mockTracer, // anything matching the OTel Tracer interface
 * });
 * ```
 */

import type { AgentfootprintEvent } from '../../events/registry.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { ObservabilityStrategy } from '../../strategies/types.js';

// ─── Public options ──────────────────────────────────────────────────

export interface OtelObservabilityOptions {
  /** Service name on every emitted span. Surfaces in your OTel
   *  backend's service map. Required. */
  readonly serviceName: string;
  /** OTel Tracer to use. Defaults to
   *  `trace.getTracer('agentfootprint', AGENTFOOTPRINT_VERSION)`
   *  (where `trace` is the lazy-imported `@opentelemetry/api`). */
  readonly tracer?: OtelTracerLike;
  /** 0..1 — sample rate for turn-level spans. Default `1.0`.
   *  Sampling decisions are normally an OTel SDK concern (via
   *  `Sampler`); this option is a per-strategy override for cases
   *  where the consumer wants agentfootprint to drop spans BEFORE
   *  they reach the SDK (e.g., aggressive cost control). */
  readonly sampleRate?: number;
}

// ─── OTel-shaped surfaces (subset we use) ────────────────────────────

/** Subset of `@opentelemetry/api`'s `Tracer` we depend on. */
export interface OtelTracerLike {
  startSpan(name: string, options?: OtelSpanOptions, context?: unknown): OtelSpanLike;
}

/** Subset of `@opentelemetry/api`'s `SpanOptions`. */
export interface OtelSpanOptions {
  attributes?: Record<string, string | number | boolean>;
  startTime?: number; // unix epoch ms (or hrtime tuple — we use ms)
  kind?: number; // SpanKind enum value
}

/** Subset of `@opentelemetry/api`'s `Span` we depend on. */
export interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  end(endTime?: number): void;
  spanContext(): { traceId: string; spanId: string; traceFlags: number };
}

interface OtelApiModule {
  readonly trace?: {
    getTracer(name: string, version?: string): OtelTracerLike;
    setSpan(context: unknown, span: OtelSpanLike): unknown;
  };
  readonly context?: {
    active(): unknown;
    with<T>(ctx: unknown, fn: () => T): T;
  };
  readonly SpanStatusCode?: { OK: number; ERROR: number; UNSET: number };
}

// ─── Strategy factory ────────────────────────────────────────────────

export function otelObservability(opts: OtelObservabilityOptions): ObservabilityStrategy {
  if (!opts.serviceName) {
    throw new TypeError(
      `[otelObservability] \`serviceName\` is required. ` +
        `Pass an identifier visible in your OTel backend's service map, e.g. 'my-agent-prod'.`,
    );
  }

  const sampleRate = opts.sampleRate ?? 1;

  // Lazy-resolve tracer if not injected. Defer the API import until
  // first event so consumers who don't actually fire events (no agent
  // run yet) don't even hit the OTel API surface.
  let tracer: OtelTracerLike | undefined = opts.tracer;
  let otelApi: OtelApiModule | undefined;
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
    tracer = otelApi.trace.getTracer('agentfootprint');
    return tracer;
  }

  // Per-turn state — same pattern as xrayObservability. Events for
  // multiple in-flight turns interleave correctly because we key by
  // `runId` from the event payload.
  const activeTurns = new Map<
    string,
    {
      readonly stack: Array<{ name: string; span: OtelSpanLike }>;
      readonly sampled: boolean;
    }
  >();

  let stopped = false;
  let onErrorHook: ((err: Error, event?: AgentfootprintEvent) => void) | undefined;

  function pushSpan(
    turnState: NonNullable<ReturnType<typeof activeTurns.get>>,
    name: string,
    attrs?: Record<string, string | number | boolean>,
  ): OtelSpanLike {
    // OTel parent-context wiring: we capture the parent in a context
    // and start the new span under it. (For BYO SDK setups, the
    // `trace.setSpan` + `context.with` pattern is canonical. For
    // the test-injected tracer path, we just pass the parent as
    // implicit context.)
    const parent = turnState.stack[turnState.stack.length - 1]?.span;
    let ctx: unknown;
    if (parent && otelApi?.trace?.setSpan && otelApi?.context?.active) {
      ctx = otelApi.trace.setSpan(otelApi.context.active(), parent);
    }
    const span = ensureTracer().startSpan(name, attrs ? { attributes: attrs } : undefined, ctx);
    turnState.stack.push({ name, span });
    return span;
  }

  function popSpan(
    turnState: NonNullable<ReturnType<typeof activeTurns.get>>,
    expectedName?: string,
  ): OtelSpanLike | undefined {
    let idx = turnState.stack.length - 1;
    if (expectedName) {
      while (idx >= 0 && turnState.stack[idx]!.name !== expectedName) idx--;
    }
    if (idx < 0) return undefined;
    return turnState.stack.splice(idx, 1)[0]!.span;
  }

  function endSpan(span: OtelSpanLike, opts?: { error?: boolean }): void {
    if (opts?.error) {
      const code = otelApi?.SpanStatusCode?.ERROR ?? 2;
      try {
        span.setStatus({ code });
      } catch {
        /* mock tracers may not implement setStatus — ignore */
      }
    }
    span.end();
  }

  // ─── Event-to-span dispatch ────────────────────────────────────────

  function handleEvent(event: AgentfootprintEvent): void {
    if (stopped) return;
    const runId = (event.payload as { runId?: string } | undefined)?.runId;
    if (!runId) return; // Events without a turn anchor — skip.

    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        const sampled = sampleRate >= 1 || Math.random() < sampleRate;
        const turnState = { stack: [], sampled } as {
          stack: Array<{ name: string; span: OtelSpanLike }>;
          sampled: boolean;
        };
        activeTurns.set(runId, turnState);
        if (sampled) pushSpan(turnState, opts.serviceName, { 'service.name': opts.serviceName });
        break;
      }

      case 'agentfootprint.agent.turn_end': {
        const t = activeTurns.get(runId);
        if (!t) break;
        // Defensive: end everything still on the stack.
        while (t.stack.length > 0) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        activeTurns.delete(runId);
        break;
      }

      case 'agentfootprint.agent.iteration_start': {
        const t = activeTurns.get(runId);
        if (t?.sampled) {
          const iteration = (event.payload as { iteration?: number }).iteration;
          pushSpan(t, `iteration:${iteration ?? '?'}`, {
            ...(typeof iteration === 'number' && { 'iteration.number': iteration }),
          });
        }
        break;
      }

      case 'agentfootprint.agent.iteration_end': {
        const t = activeTurns.get(runId);
        if (t?.sampled) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        break;
      }

      case 'agentfootprint.stream.llm_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const model = (event.payload as { model?: string }).model;
        pushSpan(t, 'llm', model ? { 'gen_ai.request.model': model } : undefined);
        break;
      }

      case 'agentfootprint.stream.llm_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const span = popSpan(t, 'llm');
        if (span) endSpan(span);
        break;
      }

      case 'agentfootprint.stream.tool_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const toolName = (event.payload as { toolName?: string }).toolName ?? 'tool';
        pushSpan(t, `tool:${toolName}`, { 'tool.name': toolName });
        break;
      }

      case 'agentfootprint.stream.tool_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const toolName = (event.payload as { toolName?: string }).toolName;
        const errored = (event.payload as { error?: unknown }).error !== undefined;
        const span = popSpan(t, toolName ? `tool:${toolName}` : undefined);
        if (span) endSpan(span, { error: errored });
        break;
      }

      // Other events — annotate the topmost active span.
      default: {
        const t = activeTurns.get(runId);
        const top = t?.stack[t.stack.length - 1]?.span;
        if (!t?.sampled || !top) break;
        // Cost ticks are particularly valuable as attributes.
        if (event.type === 'agentfootprint.cost.tick') {
          const p = event.payload as { cumulativeCostUsd?: number };
          if (typeof p.cumulativeCostUsd === 'number') {
            try {
              top.setAttribute('cost.cumulative_usd', p.cumulativeCostUsd);
            } catch {
              /* ignore */
            }
          }
        }
        break;
      }
    }
  }

  return {
    name: 'otel',
    capabilities: { events: true, traces: true },
    exportEvent: handleEvent,
    flush(): void {
      // OTel SDKs handle their own flushing (the consumer-configured
      // SpanProcessor's `forceFlush()`). We don't cross that boundary
      // here — calling `provider.forceFlush()` is the consumer's
      // responsibility on shutdown. Documented in the README.
    },
    stop(): void {
      stopped = true;
      // Defensive: end any spans the agent loop didn't close.
      for (const [, t] of activeTurns) {
        while (t.stack.length > 0) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
      }
      activeTurns.clear();
    },
    _onError(err: Error, event?: AgentfootprintEvent): void {
      onErrorHook =
        onErrorHook ??
        ((e) => {
          // eslint-disable-next-line no-console
          console.error(`[otelObservability] error:`, e.message);
        });
      onErrorHook(err, event);
    },
  };
}
