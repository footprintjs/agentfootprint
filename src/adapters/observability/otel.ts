/**
 * otelObservability — OpenTelemetry distributed-tracing adapter.
 *
 * Ships every agentfootprint event as OpenTelemetry spans + span events
 * via a consumer-supplied OTel API, following the OpenTelemetry **GenAI
 * semantic conventions** (`gen_ai.*` attribute namespace) plus
 * agentfootprint-specific explainability attributes (`agentfootprint.*`).
 * Same hierarchical mapping as the X-Ray adapter, but the destination is
 * whichever OTel-compat backend the consumer's SDK exports to:
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
 * ## Event → span/attribute mapping
 *
 *   agent.turn_start          ↦  start root span (one trace per turn) —
 *                                `gen_ai.operation.name: 'invoke_agent'`
 *   agent.turn_end            ↦  end root span (+ turn-total `gen_ai.usage.*`)
 *   agent.iteration_start     ↦  start child span under root
 *   agent.iteration_end       ↦  end iteration span
 *   stream.llm_start          ↦  start child span (inference) — `gen_ai.*`
 *                                request attrs (`chat` operation)
 *   stream.llm_end            ↦  end llm span (+ `gen_ai.usage.*`,
 *                                `gen_ai.response.*`)
 *   stream.tool_start         ↦  start child span — `execute_tool` operation,
 *                                `gen_ai.tool.name` / `gen_ai.tool.call.id`
 *   stream.tool_end           ↦  end tool span (ERROR status + `error.type`
 *                                if errored). Correlated by toolCallId so
 *                                PARALLEL tool calls close the right span.
 *   cost.tick                 ↦  setAttribute on topmost active span
 *   error.fatal               ↦  ERROR status on root + defensive unwind
 *   context.evaluated         ↦  N span events `agentfootprint.skill.routing`
 *                                — SYNTHESIZED name (one per routing entry),
 *                                not a registry-verbatim forward; all other
 *                                span events use the registry name verbatim
 *
 * ## Decisions = SPAN EVENTS, not attributes (design decision)
 *
 * Explainability signals (route decisions, skill routing, validation
 * rejections, permission checks, credential lifecycle) are emitted as
 * **span events** on the currently-active span rather than attributes:
 *
 *   1. MULTIPLICITY — an iteration span can carry several decisions
 *      (route + N skill routings + M permission checks). Attributes are
 *      last-write-wins and would clobber; span events accumulate.
 *   2. ORDERING — span events carry their own timestamps, preserving the
 *      decision sequence inside one span. Compliance review (EU AI Act
 *      Art. 12 record-keeping) needs the order decisions were made.
 *   3. ROUND-TRIP — OTLP backends (and agentThinkingUI's `fromOTLP`
 *      ingestion) surface span events as first-class timeline entries.
 *
 * When the consumer-injected tracer's spans don't implement `addEvent`
 * (minimal test doubles), the adapter falls back to flattened
 * `${eventName}.${key}` attributes — degraded (last-write-wins) but
 * never silently dropped.
 *
 * ## PII discipline
 *
 * Mirrors the #9 validation contract: attribute values NEVER echo
 * runtime VALUES that can carry PII —
 *   - tool args  → top-level key NAMES only (`agentfootprint.tool.args.keys`)
 *   - tool results → `typeof` only (`agentfootprint.tool.result.type`)
 *   - validation issues → path / expected / got TYPES (bounded upstream)
 *   - decide() evidence → rule labels, operators, thresholds (developer
 *     constants) and the engine's redaction-aware value SUMMARIES
 *   - userPrompt / llm content / thinking → never emitted
 *   - error.fatal → stage + scope only (error MESSAGES can echo values)
 *   - credential events carry no secrets by construction (registry contract)
 *
 * @example Basic — Honeycomb via OTLP
 * ```ts
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
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
 * const otel = otelObservability({
 *   serviceName: 'my-agent',
 *   // genAiSpanNames: true,  // opt-in spec span names ('chat gpt-4', …)
 * });
 * agent.enable.observability({ strategy: otel });
 * // Optional — operator-level decide()/select() evidence as span events:
 * // Agent.create({...}).recorder(otel.decisionEvidenceRecorder())
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

import type { FlowDecisionEvent, FlowSelectedEvent } from 'footprintjs';
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
  /**
   * Opt-in OTel GenAI semconv SPAN NAMES (default `false`):
   *
   *   root  → `invoke_agent {serviceName}`  (was `{serviceName}`)
   *   llm   → `chat {model}`                (was `llm`)
   *   tool  → `execute_tool {toolName}`     (was `tool:{toolName}`)
   *
   * Off by default because existing consumers' dashboards / alerts key
   * on the legacy span names — renames would break them. All `gen_ai.*`
   * ATTRIBUTES are emitted regardless of this flag (purely additive),
   * so semconv-aware backends can already group by
   * `gen_ai.operation.name` with the flag off.
   */
  readonly genAiSpanNames?: boolean;
  /**
   * Explainability span events (default `true`): route decisions, skill
   * routing provenance, validation rejections, permission decisions,
   * credential lifecycle. Set `false` to emit only the span tree +
   * `gen_ai.*` attributes (e.g., aggressive per-byte vendor billing).
   */
  readonly explainability?: boolean;
}

// ─── OTel-shaped surfaces (subset we use) ────────────────────────────

/** Attribute value union we emit. Matches OTel's `AttributeValue`
 *  subset: primitives + homogeneous string arrays
 *  (`gen_ai.response.finish_reasons`, issue lists, …). */
export type OtelAttributeValue = string | number | boolean | readonly string[];

/** Subset of `@opentelemetry/api`'s `Tracer` we depend on. */
export interface OtelTracerLike {
  startSpan(name: string, options?: OtelSpanOptions, context?: unknown): OtelSpanLike;
}

/** Subset of `@opentelemetry/api`'s `SpanOptions`. */
export interface OtelSpanOptions {
  attributes?: Record<string, OtelAttributeValue>;
  startTime?: number; // unix epoch ms (or hrtime tuple — we use ms)
  kind?: number; // SpanKind enum value
}

/** Subset of `@opentelemetry/api`'s `Span` we depend on. */
export interface OtelSpanLike {
  setAttribute(key: string, value: OtelAttributeValue): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  end(endTime?: number): void;
  spanContext(): { traceId: string; spanId: string; traceFlags: number };
  /** OTel `Span.addEvent` — optional in the duck-typed surface so
   *  minimal test doubles still satisfy the interface. Explainability
   *  signals degrade to flattened attributes when absent. */
  addEvent?(name: string, attributes?: Record<string, OtelAttributeValue>): unknown;
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

// ─── Extended strategy surface ───────────────────────────────────────

/**
 * footprintjs CombinedRecorder (FlowRecorder channel) that forwards
 * decide()/select() operator-level evidence into the paired
 * otelObservability strategy as span events. Attach via
 * `Agent.create({...}).recorder(...)` or
 * `executor.attachCombinedRecorder(...)`.
 */
export interface OtelDecisionEvidenceRecorder {
  readonly id: string;
  onDecision(event: FlowDecisionEvent): void;
  onSelected(event: FlowSelectedEvent): void;
}

/** Return type of {@link otelObservability} — the base
 *  ObservabilityStrategy plus the decide()/select() evidence bridge. */
export interface OtelObservabilityStrategy extends ObservabilityStrategy {
  /**
   * Build the decide()/select() evidence bridge for this strategy.
   *
   * Operator-level decision evidence (which rule fired, the
   * `key op threshold → actual` conditions) travels on footprintjs's
   * FlowRecorder channel (`onDecision` / `onSelected`) — it never
   * reaches the typed event dispatcher, so the strategy alone can't
   * see it. This recorder is the bridge (same pattern as the #5
   * causal-evidence bridge in `memory/causal/evidenceRecorder.ts`).
   *
   * Decisions WITHOUT structured evidence are skipped — they already
   * arrive via the `agent.route_decided` / `composition.route_decided`
   * typed events, so forwarding them here would double-report.
   *
   * @remarks PII: attaching this recorder EXPORTS bounded actual scope
   * values to your OTel collector — each condition renders as
   * `key op threshold → actualSummary (bool)`, where `actualSummary` is
   * the engine's redaction-aware ≤80-char value summary (e.g.
   * `creditScore gt 700 → 750 (true)`). Keys covered by a footprintjs
   * `RedactionPolicy` render `[REDACTED]`; everything else leaves the
   * process. For compliance record-keeping that disclosure is usually
   * the point — but treat the collector as PII-bearing, or redact the
   * relevant keys upstream, before attaching.
   *
   * @remarks Attach ONCE per executor. Every instance carries the
   * well-known id `'otel-decision-evidence'`, so re-attaching is
   * idempotent-by-ID (the replacement prevents double-reported span
   * events); instances from the same strategy share its turn state by
   * design.
   */
  decisionEvidenceRecorder(): OtelDecisionEvidenceRecorder;
}

// ─── Bounding helpers (PII / cardinality discipline) ─────────────────

/** Hard caps for attribute payloads. Evidence is bounded upstream
 *  (#5 `maxFieldChars`); these are defense-in-depth for the OTLP wire. */
const MAX_ATTR_CHARS = 256;
const MAX_LIST_ITEMS = 20;

function bound(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return s.length > MAX_ATTR_CHARS ? `${s.slice(0, MAX_ATTR_CHARS - 1)}…` : s;
}

function boundList(items: readonly string[]): readonly string[] {
  const capped = items.slice(0, MAX_LIST_ITEMS).map(bound);
  return items.length > MAX_LIST_ITEMS
    ? [...capped, `…+${items.length - MAX_LIST_ITEMS} more`]
    : capped;
}

// ─── decide()/select() evidence rendering ────────────────────────────
//
// Structural mirror of footprintjs's DecisionEvidence / SelectionEvidence
// (lib/decide/types). We read it duck-typed so the adapter also accepts
// the same shape arriving on `composition.route_decided.evidence`.

interface RuleEvidenceLike {
  readonly type?: string;
  readonly ruleIndex?: number;
  readonly branch?: string;
  readonly matched?: boolean;
  readonly label?: string;
  /** filter rules — operator-level conditions. `threshold` is a
   *  developer-written rule constant (not runtime data);
   *  `actualSummary` is the engine's bounded, redaction-aware summary. */
  readonly conditions?: ReadonlyArray<{
    readonly key?: string;
    readonly op?: string;
    readonly threshold?: unknown;
    readonly actualSummary?: string;
    readonly result?: boolean;
  }>;
  /** function rules — the scope reads the predicate made. */
  readonly inputs?: ReadonlyArray<{ readonly key?: string; readonly valueSummary?: string }>;
}

interface DecisionEvidenceLike {
  readonly rules?: readonly RuleEvidenceLike[];
  readonly chosen?: string;
  readonly default?: string;
  readonly selected?: readonly string[];
}

/** Render one rule's operator-level conditions as compact strings:
 *  `creditScore gt 700 → 750 (true)`. Value summaries come from the
 *  engine already bounded + redaction-aware — we only re-cap length. */
function renderConditions(rule: RuleEvidenceLike): readonly string[] {
  if (rule.conditions !== undefined && rule.conditions.length > 0) {
    return boundList(
      rule.conditions.map(
        (c) => `${c.key} ${c.op} ${bound(c.threshold)} → ${c.actualSummary} (${c.result})`,
      ),
    );
  }
  if (rule.inputs !== undefined && rule.inputs.length > 0) {
    return boundList(rule.inputs.map((i) => `${i.key} = ${i.valueSummary}`));
  }
  return [];
}

/** Flatten decide()/select() evidence into span-event attributes. */
function renderEvidenceAttrs(evidence: DecisionEvidenceLike): Record<string, OtelAttributeValue> {
  const attrs: Record<string, OtelAttributeValue> = {};
  if (evidence.chosen !== undefined)
    attrs['agentfootprint.decision.chosen'] = bound(evidence.chosen);
  if (evidence.default !== undefined)
    attrs['agentfootprint.decision.default'] = bound(evidence.default);
  if (evidence.selected !== undefined)
    attrs['agentfootprint.decision.selected'] = boundList(evidence.selected.map(String));
  const rules = evidence.rules ?? [];
  if (rules.length > 0) attrs['agentfootprint.decision.rules_evaluated'] = rules.length;
  const matched = rules.find((r) => r.matched === true);
  if (matched !== undefined) {
    if (matched.label !== undefined)
      attrs['agentfootprint.decision.rule.label'] = bound(matched.label);
    if (matched.ruleIndex !== undefined)
      attrs['agentfootprint.decision.rule.index'] = matched.ruleIndex;
    if (matched.branch !== undefined)
      attrs['agentfootprint.decision.rule.branch'] = bound(matched.branch);
    const conditions = renderConditions(matched);
    if (conditions.length > 0) attrs['agentfootprint.decision.conditions'] = conditions;
  }
  return attrs;
}

/** Is this object shaped like decide()/select() evidence? */
function looksLikeDecideEvidence(value: unknown): value is DecisionEvidenceLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as DecisionEvidenceLike).rules)
  );
}

// ─── Strategy factory ────────────────────────────────────────────────

export function otelObservability(opts: OtelObservabilityOptions): OtelObservabilityStrategy {
  if (!opts.serviceName) {
    throw new TypeError(
      `[otelObservability] \`serviceName\` is required. ` +
        `Pass an identifier visible in your OTel backend's service map, e.g. 'my-agent-prod'.`,
    );
  }

  const sampleRate = opts.sampleRate ?? 1;
  const genAiNames = opts.genAiSpanNames === true;
  const explainability = opts.explainability !== false;

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
  // the run anchor (`meta.runId`).
  interface TurnState {
    readonly stack: Array<{ name: string; span: OtelSpanLike }>;
    readonly sampled: boolean;
    /** The root (turn) span — kept aside so llm_start can back-fill
     *  `gen_ai.provider.name` / `gen_ai.request.model` onto the
     *  `invoke_agent` span (conditionally-required semconv attrs we
     *  don't know yet at turn_start). */
    root?: OtelSpanLike;
    rootEnriched?: boolean;
    /** toolCallId → live tool span. tool_end carries ONLY toolCallId
     *  at runtime (`ToolEndPayload`), and parallel tool calls
     *  interleave — LIFO stack popping would close the wrong span. */
    readonly toolSpans: Map<string, OtelSpanLike>;
  }
  const activeTurns = new Map<string, TurnState>();

  let stopped = false;
  let onErrorHook: ((err: Error, event?: AgentfootprintEvent) => void) | undefined;

  /**
   * Resolve the run anchor for an event.
   *
   * Real runtime events are dispatcher envelopes — the run id lives on
   * `event.meta.runId` (built by `bridge/eventMeta.ts`). The legacy
   * `payload.runId` read is kept as a fallback for consumers feeding
   * hand-built events (the pre-6.17 shape this adapter's own tests
   * used). Without the meta read, NO span ever opened on a real agent
   * run — the bug the fabricated test shapes masked.
   */
  function anchorRunId(event: AgentfootprintEvent): string | undefined {
    const meta = (event as { meta?: { runId?: string } }).meta;
    return meta?.runId ?? (event.payload as { runId?: string } | undefined)?.runId;
  }

  function pushSpan(
    turnState: TurnState,
    name: string,
    attrs?: Record<string, OtelAttributeValue>,
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
    if (typeof span.addEvent === 'function') {
      try {
        span.addEvent(name, attrs);
        return;
      } catch {
        /* fall through to attribute fallback */
      }
    }
    const flattened: Record<string, OtelAttributeValue> = {};
    for (const [key, value] of Object.entries(attrs)) flattened[`${name}.${key}`] = value;
    setAttrs(span, flattened);
  }

  function topSpan(t: TurnState | undefined): OtelSpanLike | undefined {
    return t?.stack[t.stack.length - 1]?.span;
  }

  /** Single-active-turn resolution for FlowRecorder evidence (which has
   *  no dispatcher runId to join on). One agent = one turn in flight is
   *  the norm; with >1 concurrent turn we can't attribute the decision
   *  safely, so we skip rather than risk cross-run contamination. */
  function soleActiveTurn(): TurnState | undefined {
    if (activeTurns.size !== 1) return undefined;
    const [t] = activeTurns.values();
    return t;
  }

  // ─── Explainability span events (typed-event side) ─────────────────

  function handleExplainability(event: AgentfootprintEvent, t: TurnState): void {
    const top = topSpan(t);
    if (!top) return;
    const p = event.payload as unknown as Record<string, unknown>;

    switch (event.type) {
      // The ReAct loop's own decision: tool-calls vs final.
      case 'agentfootprint.agent.route_decided': {
        recordSpanEvent(top, 'agentfootprint.agent.route_decided', {
          'agentfootprint.decision.stage': 'react-route',
          'agentfootprint.decision.chosen': bound(p.chosen),
          ...(typeof p.rationale === 'string' && {
            'agentfootprint.decision.rationale': bound(p.rationale),
          }),
          ...(typeof p.iterIndex === 'number' && {
            'agentfootprint.iteration.index': p.iterIndex,
          }),
        });
        break;
      }

      // Conditional core-flow routing. `evidence` (when an emitter
      // populates it with decide() output) renders at operator level.
      case 'agentfootprint.composition.route_decided': {
        const attrs: Record<string, OtelAttributeValue> = {
          'agentfootprint.decision.stage': bound(p.conditionalId),
          'agentfootprint.decision.chosen': bound(p.chosen),
          ...(typeof p.rationale === 'string' && {
            'agentfootprint.decision.rationale': bound(p.rationale),
          }),
        };
        if (looksLikeDecideEvidence(p.evidence))
          Object.assign(attrs, renderEvidenceAttrs(p.evidence));
        recordSpanEvent(top, 'agentfootprint.composition.route_decided', attrs);
        break;
      }

      // Skill-graph routing provenance — one span event per routed
      // injection: the decision path (predicate labels + branch taken),
      // the route edge, and the tools the route unlocked.
      case 'agentfootprint.context.evaluated': {
        const routing = p.routing as
          | ReadonlyArray<{
              injectionId?: string;
              via?: string;
              label?: string;
              from?: string;
              path?: ReadonlyArray<{ label?: string; branch?: string }>;
              tools?: readonly string[];
            }>
          | undefined;
        if (!Array.isArray(routing)) break; // no skill routing this iteration — no event
        for (const r of routing) {
          recordSpanEvent(top, 'agentfootprint.skill.routing', {
            'agentfootprint.skill.injection_id': bound(r.injectionId),
            ...(r.via !== undefined && { 'agentfootprint.skill.via': bound(r.via) }),
            ...(r.label !== undefined && { 'agentfootprint.skill.label': bound(r.label) }),
            ...(r.from !== undefined && { 'agentfootprint.skill.from': bound(r.from) }),
            ...(Array.isArray(r.path) && {
              'agentfootprint.skill.path': boundList(
                r.path.map(
                  (step: { label?: string; branch?: string }) => `${step.label} → ${step.branch}`,
                ),
              ),
            }),
            ...(Array.isArray(r.tools) && {
              'agentfootprint.skill.tools': boundList(r.tools.map(String)),
            }),
          });
        }
        break;
      }

      case 'agentfootprint.skill.activated': {
        recordSpanEvent(top, 'agentfootprint.skill.activated', {
          'agentfootprint.skill.id': bound(p.skillId),
          'agentfootprint.skill.reason': bound(p.reason),
          ...(Array.isArray(p.injectedTools) && {
            'agentfootprint.skill.tools': boundList((p.injectedTools as unknown[]).map(String)),
          }),
        });
        break;
      }

      // #9 tool-arg validation rejections. Issues carry paths /
      // expectations / received TYPES — never values (PII contract).
      case 'agentfootprint.validation.args_invalid': {
        const issues = (p.issues ?? []) as ReadonlyArray<{
          path?: string;
          expected?: string;
          got?: string;
        }>;
        recordSpanEvent(top, 'agentfootprint.validation.args_invalid', {
          'agentfootprint.validation.tool_name': bound(p.toolName),
          'agentfootprint.validation.tool_call_id': bound(p.toolCallId),
          'agentfootprint.validation.enforced': p.enforced === true,
          'agentfootprint.validation.issue_count': issues.length,
          'agentfootprint.validation.issues': boundList(
            issues.map((i) => `${i.path}: expected ${i.expected}, got ${i.got}`),
          ),
        });
        break;
      }

      case 'agentfootprint.permission.check': {
        recordSpanEvent(top, 'agentfootprint.permission.check', {
          'agentfootprint.permission.capability': bound(p.capability),
          'agentfootprint.permission.actor': bound(p.actor),
          ...(p.target !== undefined && { 'agentfootprint.permission.target': bound(p.target) }),
          'agentfootprint.permission.result': bound(p.result),
          ...(p.policyRuleId !== undefined && {
            'agentfootprint.permission.policy_rule_id': bound(p.policyRuleId),
          }),
          ...(typeof p.rationale === 'string' && {
            'agentfootprint.permission.rationale': bound(p.rationale),
          }),
          ...(typeof p.reason === 'string' && {
            'agentfootprint.permission.reason': bound(p.reason),
          }),
        });
        break;
      }

      case 'agentfootprint.permission.halt': {
        recordSpanEvent(top, 'agentfootprint.permission.halt', {
          'agentfootprint.permission.target': bound(p.target),
          'agentfootprint.permission.reason': bound(p.reason),
          ...(typeof p.iteration === 'number' && {
            'agentfootprint.iteration.index': p.iteration,
          }),
        });
        break;
      }

      // Credential lifecycle — payloads carry kind / service / session
      // identifiers ONLY (the registry contract: never the secret).
      case 'agentfootprint.credential.requested':
      case 'agentfootprint.credential.acquired':
      case 'agentfootprint.credential.authorization_required':
      case 'agentfootprint.credential.failed': {
        recordSpanEvent(top, event.type, {
          'agentfootprint.credential.service': bound(p.service),
          ...(p.kind !== undefined && { 'agentfootprint.credential.kind': bound(p.kind) }),
          ...(p.mode !== undefined && { 'agentfootprint.credential.mode': bound(p.mode) }),
          ...(p.sessionId !== undefined && {
            'agentfootprint.credential.session_id': bound(p.sessionId),
          }),
          ...(p.reason !== undefined && { 'agentfootprint.credential.reason': bound(p.reason) }),
        });
        break;
      }

      default:
        break;
    }
  }

  // ─── Event-to-span dispatch ────────────────────────────────────────

  function handleEvent(event: AgentfootprintEvent): void {
    if (stopped) return;
    const runId = anchorRunId(event);
    if (!runId) return; // Events without a turn anchor — skip.

    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        const sampled = sampleRate >= 1 || Math.random() < sampleRate;
        const turnState: TurnState = { stack: [], sampled, toolSpans: new Map() };
        activeTurns.set(runId, turnState);
        if (sampled) {
          const turnIndex = (event.payload as { turnIndex?: number }).turnIndex;
          // `invoke_agent` span per the GenAI agent-span conventions.
          // `gen_ai.provider.name` / `gen_ai.request.model` (conditionally
          // required) are back-filled on the first llm_start — unknown here.
          // `userPrompt` is deliberately NOT emitted (PII).
          // We emit `agentfootprint.run.id` (not `gen_ai.conversation.id`):
          // a run is one turn, not a conversation/session — agentfootprint
          // has no session primitive yet, and mislabeling would corrupt
          // backends' session grouping.
          turnState.root = pushSpan(
            turnState,
            genAiNames ? `invoke_agent ${opts.serviceName}` : opts.serviceName,
            {
              'service.name': opts.serviceName,
              'gen_ai.operation.name': 'invoke_agent',
              'gen_ai.agent.name': opts.serviceName,
              'agentfootprint.run.id': runId,
              ...(typeof turnIndex === 'number' && { 'agentfootprint.turn.index': turnIndex }),
            },
          );
        }
        break;
      }

      case 'agentfootprint.agent.turn_end': {
        const t = activeTurns.get(runId);
        if (!t) break;
        if (t.root) {
          // Turn-total usage on the invoke_agent span (semconv allows
          // usage attrs on agent spans) + the iteration count.
          const p = event.payload as {
            totalInputTokens?: number;
            totalOutputTokens?: number;
            iterationCount?: number;
          };
          setAttrs(t.root, {
            ...(typeof p.totalInputTokens === 'number' && {
              'gen_ai.usage.input_tokens': p.totalInputTokens,
            }),
            ...(typeof p.totalOutputTokens === 'number' && {
              'gen_ai.usage.output_tokens': p.totalOutputTokens,
            }),
            ...(typeof p.iterationCount === 'number' && {
              'agentfootprint.iteration.count': p.iterationCount,
            }),
          });
        }
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
          const iteration =
            (event.payload as { iterIndex?: number; iteration?: number }).iterIndex ??
            (event.payload as { iteration?: number }).iteration;
          pushSpan(t, `iteration:${iteration ?? '?'}`, {
            ...(typeof iteration === 'number' && { 'iteration.number': iteration }),
          });
        }
        break;
      }

      case 'agentfootprint.agent.iteration_end': {
        const t = activeTurns.get(runId);
        if (t?.sampled) {
          const span = popSpan(t, (name) => name.startsWith('iteration:'));
          if (span) {
            const toolCallCount = (event.payload as { toolCallCount?: number }).toolCallCount;
            if (typeof toolCallCount === 'number')
              setAttrs(span, { 'agentfootprint.tool_call.count': toolCallCount });
            endSpan(span);
          }
        }
        break;
      }

      case 'agentfootprint.stream.llm_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as { model?: string; provider?: string; temperature?: number };
        // Inference span per GenAI semconv: operation `chat`.
        // `gen_ai.provider.name` passes the adapter's provider id through
        // unchanged — 'anthropic' / 'openai' / 'cohere' are already
        // well-known semconv values; others ride as custom values (the
        // spec permits them).
        pushSpan(t, genAiNames && p.model ? `chat ${p.model}` : 'llm', {
          'gen_ai.operation.name': 'chat',
          ...(p.model !== undefined && { 'gen_ai.request.model': p.model }),
          ...(p.provider !== undefined && { 'gen_ai.provider.name': p.provider }),
          ...(typeof p.temperature === 'number' && {
            'gen_ai.request.temperature': p.temperature,
          }),
        });
        // Back-fill the conditionally-required agent-span attrs now that
        // the first inference call reveals provider + model.
        if (t.root && t.rootEnriched !== true) {
          t.rootEnriched = true;
          setAttrs(t.root, {
            ...(p.provider !== undefined && { 'gen_ai.provider.name': p.provider }),
            ...(p.model !== undefined && { 'gen_ai.request.model': p.model }),
          });
        }
        break;
      }

      case 'agentfootprint.stream.llm_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const span = popSpan(t, (name) => name === 'llm' || name.startsWith('chat'));
        if (!span) break;
        const p = event.payload as {
          usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
          stopReason?: string;
          providerResponseRef?: string;
        };
        // Response-side semconv attrs. `content` is deliberately NOT
        // emitted (PII) — the snapshot/audit-log channel carries it
        // under the consumer's redaction policy.
        setAttrs(span, {
          ...(typeof p.usage?.input === 'number' && {
            'gen_ai.usage.input_tokens': p.usage.input,
          }),
          ...(typeof p.usage?.output === 'number' && {
            'gen_ai.usage.output_tokens': p.usage.output,
          }),
          ...(typeof p.usage?.cacheRead === 'number' && {
            'gen_ai.usage.cache_read.input_tokens': p.usage.cacheRead,
          }),
          ...(typeof p.usage?.cacheWrite === 'number' && {
            'gen_ai.usage.cache_creation.input_tokens': p.usage.cacheWrite,
          }),
          ...(typeof p.stopReason === 'string' && {
            'gen_ai.response.finish_reasons': [p.stopReason] as readonly string[],
          }),
          ...(typeof p.providerResponseRef === 'string' && {
            'gen_ai.response.id': p.providerResponseRef,
          }),
        });
        endSpan(span);
        break;
      }

      case 'agentfootprint.stream.tool_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as {
          toolName?: string;
          toolCallId?: string;
          args?: Record<string, unknown>;
          protocol?: string;
        };
        const toolName = p.toolName ?? 'tool';
        // Tool-execution span per GenAI semconv (`execute_tool`).
        // Args: top-level key NAMES only — `gen_ai.tool.call.arguments`
        // exists in the spec but is opt-in and carries raw values; we
        // deliberately never emit it (PII / prompt-injection echo).
        const argKeys =
          p.args !== undefined && typeof p.args === 'object' ? Object.keys(p.args) : [];
        const span = pushSpan(t, genAiNames ? `execute_tool ${toolName}` : `tool:${toolName}`, {
          'tool.name': toolName,
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': toolName,
          ...(p.toolCallId !== undefined && { 'gen_ai.tool.call.id': p.toolCallId }),
          ...(p.protocol !== undefined && { 'agentfootprint.tool.protocol': p.protocol }),
          ...(argKeys.length > 0 && { 'agentfootprint.tool.args.keys': boundList(argKeys) }),
        });
        if (p.toolCallId !== undefined) t.toolSpans.set(p.toolCallId, span);
        break;
      }

      case 'agentfootprint.stream.tool_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as {
          toolCallId?: string;
          toolName?: string;
          result?: unknown;
          error?: unknown;
        };
        const errored = p.error !== undefined && p.error !== false;
        // Correlate by toolCallId (the only identity ToolEndPayload
        // carries) — parallel tool calls end out of LIFO order, so name
        // matching alone would close the wrong span. Fallback chain
        // keeps legacy hand-fed events (toolName) working.
        let span: OtelSpanLike | undefined;
        if (p.toolCallId !== undefined && t.toolSpans.has(p.toolCallId)) {
          span = t.toolSpans.get(p.toolCallId);
          t.toolSpans.delete(p.toolCallId);
          // Remove from the stack by identity so the LIFO unwind stays clean.
          const idx = t.stack.findIndex((entry) => entry.span === span);
          if (idx >= 0) t.stack.splice(idx, 1);
        } else {
          span = popSpan(
            t,
            p.toolName !== undefined
              ? (name): boolean =>
                  name === `tool:${p.toolName}` || name === `execute_tool ${p.toolName}`
              : (name): boolean => name.startsWith('tool:') || name.startsWith('execute_tool '),
          );
        }
        if (!span) break;
        // Result: TYPE only — never the value (PII discipline; mirrors
        // the #9 contract and `gen_ai.tool.call.result` stays unemitted).
        setAttrs(span, {
          'agentfootprint.tool.result.type': p.result === null ? 'null' : typeof p.result,
          ...(errored && { 'error.type': '_OTHER' }), // boolean error flag — no class info
        });
        endSpan(span, { error: errored });
        break;
      }

      // A fatal run error: the turn will never see turn_end, so close
      // the span tree here (ERROR on root) instead of leaking it until
      // stop(). Stage + scope only — error MESSAGES can echo PII.
      case 'agentfootprint.error.fatal': {
        const t = activeTurns.get(runId);
        if (!t) break;
        const p = event.payload as { stage?: string; scope?: string };
        if (t.root) {
          recordSpanEvent(t.root, 'agentfootprint.error.fatal', {
            ...(p.stage !== undefined && { 'agentfootprint.error.stage': bound(p.stage) }),
            ...(p.scope !== undefined && { 'agentfootprint.error.scope': bound(p.scope) }),
          });
        }
        while (t.stack.length > 1) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        const root = popSpan(t);
        if (root) endSpan(root, { error: true });
        activeTurns.delete(runId);
        break;
      }

      // Other events — annotate / record on the topmost active span.
      default: {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        // Cost ticks are particularly valuable as attributes.
        if (event.type === 'agentfootprint.cost.tick') {
          const top = topSpan(t);
          if (!top) break;
          // Runtime shape: `cumulative.estimatedUsd` (CostTickPayload).
          // Legacy fallback `cumulativeCostUsd` keeps hand-fed events
          // working (the pre-6.17 fabricated test shape).
          const p = event.payload as {
            cumulative?: { estimatedUsd?: number };
            cumulativeCostUsd?: number;
          };
          const usd = p.cumulative?.estimatedUsd ?? p.cumulativeCostUsd;
          if (typeof usd === 'number') setAttrs(top, { 'cost.cumulative_usd': usd });
          break;
        }
        if (explainability) handleExplainability(event, t);
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
        t.toolSpans.clear();
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

    decisionEvidenceRecorder(): OtelDecisionEvidenceRecorder {
      // One purpose (Convention 1): forward decide()/select() evidence
      // from footprintjs's FlowRecorder channel into this strategy's
      // span machinery. Plumbing filters mirror the #5 causal-evidence
      // bridge (sf-cache gate deciders, the agent's Context slot-fork).
      const forward = (
        stageId: string,
        chosen: string,
        evidence: DecisionEvidenceLike | undefined,
      ): void => {
        if (stopped || !explainability) return;
        // No structured evidence → already reported via the typed
        // route_decided events; skip to avoid double-reporting.
        if (evidence === undefined) return;
        const t = soleActiveTurn();
        if (!t?.sampled) return;
        const top = topSpan(t);
        if (!top) return;
        recordSpanEvent(top, 'agentfootprint.decision.evidence', {
          'agentfootprint.decision.stage': bound(stageId),
          'agentfootprint.decision.chosen': bound(chosen),
          ...renderEvidenceAttrs(evidence),
        });
      };

      return {
        id: 'otel-decision-evidence',
        onDecision(event: FlowDecisionEvent): void {
          const stageId = event.traversalContext?.stageId ?? event.decider;
          // Internal agent plumbing (the cache-gate decider) is not
          // domain decision evidence. `includes` (not startsWith): in
          // reactMode 'dynamic-grouped' names are double-prefixed.
          if (
            String(event.chosen ?? '').includes('sf-cache/') ||
            String(stageId).includes('sf-cache')
          )
            return;
          forward(
            String(stageId),
            String(event.chosen ?? 'unknown'),
            event.evidence as DecisionEvidenceLike | undefined,
          );
        },
        onSelected(event: FlowSelectedEvent): void {
          const stageId = event.traversalContext?.stageId ?? event.parent;
          if (String(stageId).includes('sf-cache')) return;
          // The agent's own Context slot-fork is a selector — plumbing.
          if (
            String(stageId).includes('context') &&
            event.selected.every((s) => s.startsWith('sf-'))
          )
            return;
          forward(
            String(stageId),
            event.selected.join(', '),
            event.evidence as DecisionEvidenceLike | undefined,
          );
        },
      };
    },
  };
}
