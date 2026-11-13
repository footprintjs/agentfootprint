import type { FlowDecisionEvent, FlowSelectedEvent } from 'footprintjs';
import type { AgentfootprintEvent } from '../../../events/registry.js';
import type { ObservabilityStrategy } from '../../../strategies/types.js';

// ─── Public options ──────────────────────────────────────────────────

export interface OtelObservabilityOptions {
  /** Service name on every emitted span. Surfaces in your OTel
   *  backend's service map. Required. */
  readonly serviceName: string;
  /** OTel Tracer to use. Defaults to `trace.getTracer(scopeName)` — where
   *  `trace` is the lazy-imported `@opentelemetry/api` and `scopeName` is the
   *  option below. */
  readonly tracer?: OtelTracerLike;
  /**
   * The INSTRUMENTATION SCOPE name every span is recorded under — what a
   * backend shows as `scope.name`. Default `'agentfootprint'`.
   *
   * ── Why this is a knob and not a constant ────────────────────────────────
   * Some telemetry consumers ROUTE on this name rather than read it. AWS
   * Bedrock AgentCore Evaluations is the case that forced the option: it will
   * score any agent's traces, from anywhere, but only classifies spans whose
   * scope name begins `opentelemetry.instrumentation.` or
   * `openinference.instrumentation.` — everything else is skipped in silence,
   * which is indistinguishable from "your agent was fine".
   *
   * The default does NOT change, because a rename moves every existing
   * dashboard's spans out from under it. Consumers who need a routable name
   * pass one; `agentCoreEvaluationSpans()` in the AgentCore adapter is that
   * one consumer's spelling, kept in that vendor's own file.
   *
   * Ignored when `tracer` is supplied — a tracer you built already has a name.
   */
  readonly scopeName?: string;
  /**
   * Put the turn's PROMPT and ANSWER TEXT on the agent span (default `false`):
   * `gen_ai.task.input` from the user's prompt and `gen_ai.task.output` from
   * the final answer. Two more values that a person or a model WROTE ride
   * under the same switch when their events occur: the evidence gate's
   * unsupported values (`agentfootprint.agent.evidence_checked`) and an
   * evaluation's `explanation` (`gen_ai.evaluation.result`).
   *
   * It does NOT export tool arguments or results — that is
   * {@link OtelObservabilityOptions.captureToolContent}, a switch of its own:
   * what the two parties SAID and what the run's tools carried are different
   * disclosures (`hosting/sessionWire.ts` · `TranscriptMessage` draws the
   * same line).
   *
   * ── The two attribute names are pre-existing, and not the spec's ─────────
   * `gen_ai.task.input` / `gen_ai.task.output` are the names AgentCore
   * Evaluations reads; the current GenAI registry does not define them. They
   * predate the rule that this adapter uses spec names only where the spec
   * has the thing, are kept for the consumers that read them, and are not
   * extended (follow-up: the spec's `gen_ai.input.messages` /
   * `gen_ai.output.messages` shape, CHANGELOG).
   *
   * ── Off by default, deliberately ─────────────────────────────────────────
   * This adapter's standing rule is that content does not ride spans — the
   * snapshot / audit-log channel carries it under the consumer's own
   * redaction policy. Turning this on EXPORTS raw prompt and answer text to
   * whatever backend the tracer points at, where it is typically retained and
   * searchable, and no redaction of ours stands between the two.
   *
   * ── Why it exists ────────────────────────────────────────────────────────
   * Trace-scoring services read the answer they are grading off the span.
   * AgentCore Evaluations reads exactly these two attributes (after an event
   * body it only emits in its own runtime), so a scorer sees an empty turn
   * without them. Enable it when a consumer's whole purpose is to read the
   * content, and not to make dashboards prettier.
   *
   * ── What it is NOT ───────────────────────────────────────────────────────
   * Per-inference message arrays (`gen_ai.input.messages` /
   * `gen_ai.output.messages`) are NOT emitted: this adapter's `llm_start` /
   * `llm_end` events carry model, usage and stop reason, never the messages,
   * so there is nothing truthful to put there. Turn-level input and output,
   * the gate's unsupported values and an evaluation's explanation are what we
   * have and all this claims.
   */
  readonly captureContent?: boolean;
  /**
   * Put each executed tool call's ARGUMENTS and RESULT on its `execute_tool`
   * span (default `false`) — the GenAI spec's Opt-In
   * `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result`.
   *
   * ── What is exported: the MODEL's view, never more ───────────────────────
   * Only for a call that RAN and RETURNED — a call that failed, or that a
   * rule refused, exports no content (the spec defines the result "if
   * execution was successful").
   * Arguments: the proposal `tool_start` carried, serialized AT `tool_start`
   * (the tool receives that same object and may write into it — a request's
   * auth header must never ride out as its "arguments"). Every key the
   * dispatch path names in `changedArgKeys` — an `onToolCall` link set,
   * rewrote or removed it, or the tool's own redaction hides it
   * (`flowchartAsTool({ redact })` / `runbookAsTool({ redact })`) — reads
   * `'REDACTED'`: the value the tool ran with is withheld, since a link can
   * add a value (a server-side key) the model never saw, and a scrubbed
   * original must not leave either. A `wants` tool shows the refs it named,
   * never the artifact data they resolved to. A CODE RUNNER's arguments are
   * the generated program and are withheld
   * (`agentfootprint.tool.args.withheld`); the library's law is that the
   * program never reaches an exporter (`events/payloads.ts` ·
   * `ToolsCodeRunPayload`). Recognized by the `tools.code_run` event, which
   * only `codeRunnerTool` files (under the name the model called, so a
   * re-exposed runner is covered): any OTHER code-executing tool — an MCP
   * code interpreter, a hand-written `eval` tool — is not recognized, and
   * its arguments export like any tool's.
   * Result: what the model read — after every `onToolResult` rewrite (a
   * scrub the model saw is the scrub the trace gets; a result a link denied
   * exports the refusal the model read), the placement ticket, the
   * `maxToolResultChars` cut. These come off the batch path's events, so a
   * resumed leg — which this adapter does not trace — is not covered.
   *
   * ── The spec's object schema ─────────────────────────────────────────────
   * Both attributes are objects in the spec; a span carries them as JSON
   * strings (OTel JS span attributes hold no objects). A value that is, or is
   * text that parses to, a plain object rides the spec attribute. Anything
   * else — plain text, a number, an array, the string `"123"` — rides this
   * adapter's own `agentfootprint.tool.args.content` /
   * `agentfootprint.tool.result.content`, verbatim for text and JSON for the
   * rest, so a string is never exported as a number.
   *
   * ── Size: omitted, never cut ─────────────────────────────────────────────
   * A value over {@link OtelObservabilityOptions.maxContentChars} is not
   * exported at all; `agentfootprint.tool.args.omitted_chars` /
   * `agentfootprint.tool.result.omitted_chars` states its size. A cut JSON
   * value reads as complete data, and one oversized attribute can fail the
   * export batch it rides in — taking other runs' spans with it.
   *
   * ── What no switch can scrub ─────────────────────────────────────────────
   * A tool whose result echoes a credential (a custom kind with an
   * enumerable secret, or `cred.toHeaders()` returned as data) exports it:
   * the built-in kinds hide their secret from `JSON.stringify`
   * (`identity/kinds.ts` · `hideSecrets`), a hand-built object does not.
   * Turning this on EXPORTS the run's tool traffic — raw records, whatever a
   * tool returns — to the tracer's backend.
   */
  readonly captureToolContent?: boolean;
  /**
   * The largest CONTENT value exported as one attribute, in characters
   * (default `65536`): a tool call's arguments or result, an evaluation's
   * explanation. Over it the value is OMITTED and its size stated — never
   * truncated. Applies to `gen_ai.task.input` / `gen_ai.task.output` too
   * (`agentfootprint.task.<input|output>.omitted_chars`): a hosted caller
   * chooses the prompt's size, and one oversized attribute can fail the
   * export batch it rides in.
   */
  readonly maxContentChars?: number;
  /**
   * How a session-bound run's `gen_ai.conversation.id` is written (default
   * `'digest'`).
   *
   *   - `'digest'` — the lowercase hex SHA-256 of the session id's UTF-8
   *     bytes: 64 characters, whatever the caller sent. It groups a backend's
   *     session view exactly as the raw id would, and an operator finds a
   *     known session's traces by hashing its id. The library's standing rule
   *     for a key it must be able to JOIN on but not disclose ("keyHash, never
   *     the key", `events/payloads/toolSessionPayloads.ts` · `ToolSessionPayloadBase`).
   *   - `'raw'` — the session id as issued. Safe ONLY behind a door that
   *     verifies who may open a conversation (`standingAgent({ identity })`):
   *     at a door with no verifier the session id IS the handle to the
   *     conversation — its history, its pending question, its artifacts — so
   *     exporting it hands that handle to everyone who can read the traces,
   *     for as long as they are retained.
   *
   * A digest is a join key, not a secret: a GUESSABLE session id stays
   * guessable by hashing guesses. The library's own ids are random UUIDs.
   */
  readonly conversationId?: 'digest' | 'raw';
  /**
   * Which checker-accounting rows a turn exports (default `'actionable'`).
   * Every agent run files its per-check accounting (`integrity.disposition`)
   * after the turn closes; a plain healthy run files nine rows that say
   * nothing a reader acts on.
   *
   *   - `'actionable'` — a short `agentfootprint.integrity.disposition` span
   *     under the turn ONLY when a row carries something to act on: a check
   *     that filed findings, or a registered check that filed nothing at all
   *     while the run did work (wiring rot — the rule is
   *     `integrity/disposition/ledger.ts` · `filedNothing`, the one
   *     `assertAlive` throws on). Only those rows ride as events. A healthy
   *     run exports no span, byte-identical to before this mapping existed.
   *   - `'all'` — the span on every traced run, one event per registered
   *     check.
   */
  readonly checkAccounting?: 'actionable' | 'all';
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
   * credential lifecycle — and the library's own structure: declared
   * absence / coverage, the evidence verdict, findings standings (with their
   * per-standing counts on the agent span) and the checker-accounting span
   * (`agentfootprint.integrity.disposition`). Set `false` to emit only the
   * span tree + `gen_ai.*` attributes and events (e.g., aggressive per-byte
   * vendor billing) — `gen_ai.evaluation.result` still rides, like the
   * attributes.
   */
  readonly explainability?: boolean;
  /**
   * Where errors go (8.11.0).
   *
   * This adapter writes to a tracer you own, so most failures surface in your
   * OTel pipeline rather than here — but a throwing tracer, a malformed span
   * or a dispatch-layer error still has to land somewhere. Without this they
   * reach the default sink (a rate-limited `console.error`), because telemetry
   * that fails invisibly is indistinguishable from telemetry that works.
   *
   * Equivalent to assigning the strategy's `_onError` property after
   * construction, but visible at the call site.
   */
  readonly onError?: (error: Error, event?: AgentfootprintEvent) => void;
  /**
   * @internal Pre-resolved `@opentelemetry/api` module, for tests that need
   * the path where this adapter builds its OWN tracer — the only path on
   * which {@link OtelObservabilityOptions.scopeName} is observable. Skips the
   * lazy require, exactly as `_client` does on the SDK-backed adapters.
   */
  readonly _otelApi?: OtelApiModule;
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
  /** Start a new trace, ignoring any span active in the context — OTel's own
   *  `SpanOptions.root`. */
  root?: boolean;
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

export interface OtelApiModule {
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
 * `Agent.create({...}).watch(...)` or
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
