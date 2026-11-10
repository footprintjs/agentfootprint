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
 * Subpath:  `agentfootprint/observe`
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
 *   a bracket carrying        ↦  NO span: the call never executed (9.113.0).
 *   `notDispatched`              Its tool_start adds ONE span event
 *                                `agentfootprint.tool.not_dispatched` to the
 *                                active span — SYNTHESIZED name — with
 *                                `gen_ai.tool.name`, `gen_ai.tool.call.id` and
 *                                the paused call's id and name; its tool_end
 *                                closes nothing. KNOWN LIMIT: only on a leg
 *                                this adapter traces, and a trace opens on
 *                                `agent.turn_start` only. A resumed leg emits
 *                                none and carries a new `meta.runId`, so none
 *                                of it is traced today — and a settled bracket
 *                                only ever rides a resumed leg, so no run
 *                                records this span event yet
 *   cost.tick                 ↦  setAttribute on topmost active span
 *   error.fatal               ↦  ERROR status on root + defensive unwind
 *   context.evaluated         ↦  N span events `agentfootprint.skill.routing`
 *                                — SYNTHESIZED name (one per routing entry),
 *                                not a registry-verbatim forward; apart from
 *                                it, `agentfootprint.tool.not_dispatched`
 *                                above and `agentfootprint.integrity.check`
 *                                below, span events use the registry name
 *                                verbatim
 *
 * ## What an evaluation tool reads
 *
 *   meta.sessionId            ↦  `gen_ai.conversation.id` on the agent, chat
 *                                and execute_tool spans of a session-bound run
 *                                — the SHA-256 DIGEST of the session id by
 *                                default (`conversationId: 'raw'` for the id
 *                                itself, safe only behind a verifying door);
 *                                never the runId in its place
 *   eval.score                ↦  `gen_ai.evaluation.result` — the spec's
 *                                evaluation event, carried as a SPAN event
 *                                (the spec's reference emitter logs it; this
 *                                adapter speaks the Tracer API only). On the
 *                                span it evaluates while the turn is open; on
 *                                a short `agentfootprint.evaluation` span
 *                                under the turn once it closed — and PARENTED
 *                                only when the score's own meta places it in
 *                                that run's session. Otherwise (every
 *                                `agent.emit` after the run) it rides an
 *                                `agentfootprint.evaluation` span of its own,
 *                                unparented, naming the ref. `explanation`
 *                                only under `captureContent`; `evidence` never
 *   tools.absent /            ↦  span event on the call's own span: a COUNT
 *   tools.coverage_declared      per list (checked / not_checked /
 *                                cannot_cover), the suggested tool's name only
 *                                when this strategy has seen that tool run —
 *                                never a sentence the tool author wrote
 *   agent.evidence_checked    ↦  span event: verdict + unsupported COUNT; the
 *                                values only under `captureContent`
 *   findings.standing         ↦  span event per row (ids, enums, counts; an
 *                                unknown id as a flag only), at most
 *                                {@link MAX_STANDING_EVENTS_PER_TURN} per turn
 *                                then one `agentfootprint.findings.standing_overflow`
 *                                (SYNTHESIZED); a count per standing on the
 *                                agent span when the turn closes
 *   integrity.disposition     ↦  filed AFTER turn_end. By default exported
 *                                only when a row is actionable (findings, or
 *                                wiring rot): a short
 *                                `agentfootprint.integrity.disposition` span
 *                                under the turn, one
 *                                `agentfootprint.integrity.check` span event
 *                                (SYNTHESIZED) per actionable row.
 *                                `checkAccounting: 'all'` for every row
 *   (captureToolContent only) ↦  `gen_ai.tool.call.arguments` /
 *                                `gen_ai.tool.call.result` on the tool span of
 *                                a call that ran and returned — the proposal
 *                                snapshot with every rule-changed key
 *                                withheld, and what the model READ; objects
 *                                only; omitted over `maxContentChars`; never a
 *                                code runner's program
 *
 * The structure events above ride the `explainability` switch; the
 * evaluation event does not (it is a `gen_ai.*` signal, like the attributes).
 * A span started after its parent ended (the disposition, a late score) is
 * valid OTel; most trace views draw it outside the parent's bar.
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
 * Mirrors the #9 validation contract: by default attribute values NEVER echo
 * runtime VALUES that can carry PII —
 *   - tool args  → top-level key NAMES only (`agentfootprint.tool.args.keys`)
 *     (by default; see `captureToolContent`)
 *   - tool results → `typeof` only (`agentfootprint.tool.result.type`)
 *     (by default; see `captureToolContent`)
 *   - validation issues → path / expected / got TYPES (bounded upstream)
 *   - decide() evidence → rule labels, operators, thresholds (developer
 *     constants) and the engine's redaction-aware value SUMMARIES
 *   - userPrompt / llm content / thinking → never emitted (by default; see
 *     `captureContent`)
 *   - error.fatal → stage + scope only (error MESSAGES can echo values)
 *   - credential events carry no secrets by construction (registry contract)
 *   - the session id → its SHA-256 digest (`conversationId`)
 *   - absence / coverage events → list COUNTS, and the suggested tool's NAME
 *     only when this strategy has seen that tool run; never
 *     `looked_for`, a `what` / `why`, `tryInstead` or an unregistered
 *     `tryInsteadTool.tool` — any field a tool author writes can interpolate
 *     an argument (coverage README, "What that does not close"). The EVENT
 *     never carries them, content on or off; under `captureToolContent` an
 *     `absent()` call's result (the envelope itself) does, as its
 *     `gen_ai.tool.call.result`, beside the arguments any interpolation came
 *     from
 *   - evidence verdict → the unsupported COUNT; findings → ids, enums,
 *     counts, never the model's lines (an id the model wrote that names no
 *     result is a flag, not the id); disposition → check names + counts
 *   - eval.score → metric name, score, label (a vocabulary word by contract),
 *     target words from the payload's closed vocabularies; `evidence` never
 *   - EVERY string attribute outside the content switches is capped at 256
 *     characters and every list at 20 items plus an overflow marker, in one
 *     funnel (`capAttrs`) —
 *     whoever chose the value, a caller-sized session id or a model-written
 *     id cannot choose the size of an attribute. A capped value is cut with
 *     `…` (never mid surrogate pair): a cut id is no longer the id. Span
 *     NAMES carry a tool or model name at most 64 characters
 *     (`spanNamePart`), since a tool name is the model's text when it names
 *     no registered tool
 *   - the session digest hashes the id's UTF-8 bytes, where every lone
 *     surrogate becomes U+FFFD: two ids differing only in a lone surrogate
 *     share a digest. Library-minted ids are UUIDs; documented, not handled
 *
 * Two content switches, each off by default: `captureContent` (the turn's
 * prompt and answer, the evidence gate's unsupported values, an evaluation's
 * explanation) and `captureToolContent` (tool arguments and results). The
 * adapter redacts nothing of its own: it exports what the events carry. A
 * call's arguments are the proposal `tool_start` carried, SERIALIZED THEN
 * (the engine hands the same object to the tool, which may write into it),
 * with every key `tool_end` names in `changedArgKeys` — a rule rewrote it,
 * or the tool's own `redact` policy hides it — withheld as `'REDACTED'`; the
 * result is what the model read (`modelResult`, after the `onToolResult`
 * scrub and the removal of the record-only coverage fields `short` / `kind`).
 * Never a raw value a rule replaced, never a value a rule added.
 *
 * @example Basic — Honeycomb via OTLP
 * ```ts
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { otelObservability } from 'agentfootprint/observe';
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
 * // Agent.create({...}).watch(otel.decisionEvidenceRecorder())
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
import type { Standing } from '../../core/agent/findings/types.js';
import type {
  AgentEvidenceCheckedPayload,
  EvalScorePayload,
  FindingsStandingPayload,
  IntegrityDispositionPayload,
  ToolAbsentPayload,
  ToolEndPayload,
  ToolStartPayload,
} from '../../events/payloads.js';
import type { AgentfootprintEvent } from '../../events/registry.js';
import { filedNothing } from '../../integrity/disposition/ledger.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { sha256Hex } from '../../lib/sha256.js';
import { toWireJson } from '../../lib/wireJson.js';

import { rateLimitedConsoleSink } from './deliveryErrors.js';

import type { OtelAttributeValue, OtelTracerLike, OtelSpanLike, OtelSpanOptions, OtelApiModule, OtelObservabilityOptions, OtelObservabilityStrategy, OtelDecisionEvidenceRecorder } from './otel/types.js';
export type { OtelAttributeValue, OtelTracerLike, OtelSpanLike, OtelSpanOptions, OtelObservabilityOptions, OtelObservabilityStrategy, OtelDecisionEvidenceRecorder } from './otel/types.js';
import { bound, boundList, spanNamePart, capAttrs } from './otel/attributes/bounds.js';
import { renderEvidenceAttrs, looksLikeDecideEvidence, type DecisionEvidenceLike } from './otel/attributes/evidence.js';
import { STANDINGS, MAX_STANDING_EVENTS_PER_TURN, DEFAULT_MAX_CONTENT_CHARS, isPlainObject, toolContentAttrs, coverageAttrs, evidenceVerdictAttrs, standingAttrs, standingCountAttrs, dispositionSpanAttrs, dispositionRowAttrs, evaluationAttrs, type Attrs } from './otel/attributes/projections.js';

/** The batch settlement's marker (9.113.0), as the canonical field defines it. */
type SettledMarker = NonNullable<ToolStartPayload['notDispatched']>;

/**
 * The same marker as an event reaching this adapter carries it — DERIVED from
 * the canonical field (one definition), every level optional because the
 * adapter also takes hand-fed streams.
 */
type SettledMarkerLike = { readonly [K in keyof SettledMarker]?: Partial<SettledMarker[K]> };

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
  const scopeName = opts.scopeName ?? 'agentfootprint';
  const captureContent = opts.captureContent === true;
  const captureToolContent = opts.captureToolContent === true;
  const maxContentChars = opts.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const rawConversationId = opts.conversationId === 'raw';
  const allCheckRows = opts.checkAccounting === 'all';

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
    /** toolCallId → tool name, from `tool_start` (`tool_end` carries no name). */
    readonly toolNames: Map<string, string>;
    /** `gen_ai.conversation.id` as this adapter writes it (the digest, or the
     *  raw id under `conversationId: 'raw'`) — absent for a run that is not
     *  session-bound. Stamped on every GenAI span of the turn. */
    readonly conversationId?: string;
    /** SHA-256 of the session id, whatever form is exported — what a score's
     *  own session is compared against before it may be parented here. */
    readonly sessionDigest?: string;
    /** Findings standing rows seen this turn, per standing. Created on the
     *  first row, so a turn with none puts no count keys on the root. */
    standingCounts?: Map<Standing, number>;
    /** Standing span EVENTS written this turn, and the rows past the cap. */
    standingEvents: number;
    standingOmitted: number;
    /** toolCallId → the call's tool name and its proposal, SERIALIZED at
     *  `tool_start` (never the live object: the engine hands that same object
     *  to the tool, which may write into it) — kept only under
     *  `captureToolContent`, for the `tool_end` that exports the arguments. */
    readonly proposedArgs: Map<
      string,
      { readonly toolName: string; readonly text?: string; readonly chars: number }
    >;
  }
  const activeTurns = new Map<string, TurnState>();

  /**
   * Tool names this strategy has seen RUN — a `tool_end` without `error` or
   * `notExecuted` — so a held tool, by construction. What a `tryInsteadTool`
   * suggestion is recognized against. Bounded; names only.
   */
  const ranTools = new Set<string>();
  /**
   * Tool names that filed a `tools.code_run` — a code runner. Its arguments
   * ARE the generated program, which "must not reach an exporter"
   * (`events/payloads.ts` · `ToolsCodeRunPayload`): under
   * `captureToolContent` its calls export no arguments. `code_run` fires after
   * the tool ran and BEFORE its `tool_end`, so the first call is covered too;
   * a call that failed exports no content at all.
   */
  const codeRunners = new Set<string>();
  const MAX_TOOL_NAMES = 1024;
  function remember(set: Set<string>, name: string): void {
    if (set.size >= MAX_TOOL_NAMES && !set.has(name)) return;
    set.add(name);
  }

  /**
   * Turns that have CLOSED (turn_end / error.fatal), by run id — so a late
   * event can still find its run. Two events arrive late by construction: the
   * checker accounting (`integrity.disposition`, filed in the run door's
   * `finally`, after turn_end) and an evaluation scored after the run. A real
   * SDK drops span events on an ENDED span, so a late event gets its own
   * short child span. An unsampled turn is remembered too (no span), so its
   * late events are dropped with it rather than exported loose.
   *
   * Bounded — the last {@link MAX_CLOSED_TURNS} — and cleared by `stop()`.
   * The window is per strategy, and one strategy usually serves the whole
   * process: in a busy server a late event for a run 32 turns back finds it
   * forgotten. A forgotten run's id is still remembered (a string, in
   * {@link forgottenRuns}), so "forgotten" is told apart from "never traced"
   * and reported, never dropped in silence. Each held root keeps its span
   * object (and, under `captureContent`, the task text on it) on the heap
   * until it leaves the window.
   */
  const MAX_CLOSED_TURNS = 32;
  const MAX_FORGOTTEN_RUNS = 1024;
  interface ClosedTurn {
    /** The ended root; absent for a turn sampling dropped. */
    readonly root?: OtelSpanLike;
    readonly sessionDigest?: string;
  }
  const closedTurns = new Map<string, ClosedTurn>();
  /** run id → whether it was sampled, for runs that left the window. */
  const forgottenRuns = new Map<string, boolean>();
  function rememberClosed(runId: string, t: TurnState): void {
    closedTurns.delete(runId);
    closedTurns.set(runId, {
      ...(t.root !== undefined && { root: t.root }),
      ...(t.sessionDigest !== undefined && { sessionDigest: t.sessionDigest }),
    });
    while (closedTurns.size > MAX_CLOSED_TURNS) {
      const [oldest] = closedTurns.entries();
      if (oldest === undefined) break;
      closedTurns.delete(oldest[0]);
      forgottenRuns.set(oldest[0], oldest[1].root !== undefined);
    }
    while (forgottenRuns.size > MAX_FORGOTTEN_RUNS) {
      const [oldest] = forgottenRuns.keys();
      if (oldest === undefined) break;
      forgottenRuns.delete(oldest);
    }
  }

  /** `gen_ai.conversation.id` for a span of this turn — or nothing. */
  function conversationAttr(t: TurnState): Attrs {
    return t.conversationId !== undefined ? { 'gen_ai.conversation.id': t.conversationId } : {};
  }

  /** `gen_ai.task.<input|output>`, or its size when over `maxContentChars`. */
  function taskContent(kind: 'input' | 'output', text: string): Attrs {
    return text.length > maxContentChars
      ? { [`agentfootprint.task.${kind}.omitted_chars`]: text.length }
      : { [`gen_ai.task.${kind}`]: text };
  }

  /** A non-empty `meta.sessionId`, or undefined. */
  function sessionOf(event: AgentfootprintEvent): string | undefined {
    const sessionId = (event as { meta?: { sessionId?: unknown } }).meta?.sessionId;
    return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined;
  }

  let stopped = false;
  // The fallback when the consumer wires nothing. Rate-limited; a
  // consumer-supplied sink is not. Armed at CONSTRUCTION — before 8.11.0 it
  // was installed lazily inside `_onError` itself, which meant any caller
  // reading the hook rather than calling the method found `undefined`.
  const consoleSink = rateLimitedConsoleSink('otel');

  /** A failure this adapter must not swallow — through the strategy's own
   *  `_onError`, so a hook assigned after construction is the one called. */
  function report(error: Error, event?: AgentfootprintEvent): void {
    try {
      strategy._onError?.(error, event);
    } catch {
      /* a failing sink must never break the agent loop */
    }
  }

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

  /** The root of a traced turn, open or recently closed — `undefined` for an
   *  unsampled turn or a run this adapter never traced (or has forgotten). */
  function rootOf(runId: string): OtelSpanLike | undefined {
    const live = activeTurns.get(runId);
    if (live !== undefined) return live.root;
    return closedTurns.get(runId)?.root;
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

      // #9 tool-arg validation rejections. The span event renders paths /
      // expectations / received TYPES only. A string-shape issue also carries
      // `value` (a capped excerpt) and `hint` for the MODEL's correction —
      // deliberately NOT projected here: third-party telemetry stays
      // value-free (PII contract).
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

      // A tool's declared absence / coverage — on the call's OWN span while it
      // is open (parallel calls interleave, so the stack top may be another
      // call's), else the active span. Counts per list, never a sentence.
      case 'agentfootprint.tools.absent':
      case 'agentfootprint.tools.coverage_declared': {
        const callId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
        const span = (callId !== undefined ? t.toolSpans.get(callId) : undefined) ?? top;
        recordSpanEvent(
          span,
          event.type,
          coverageAttrs(p as Partial<ToolAbsentPayload>, (name) => ranTools.has(name)),
        );
        break;
      }

      // The evidence gate's verdict on one would-be-final answer.
      case 'agentfootprint.agent.evidence_checked': {
        recordSpanEvent(
          top,
          event.type,
          evidenceVerdictAttrs(p as Partial<AgentEvidenceCheckedPayload>, captureContent),
        );
        break;
      }

      // One model standing on one earlier result; counted for turn_end. The
      // MODEL decides how many rows it files, and a real SDK keeps 128
      // events per span by evicting the OLDEST — so past a per-turn cap the
      // rows are counted, not written, and one summary event says how many
      // at the turn's close. The per-standing counts stay complete.
      case 'agentfootprint.findings.standing': {
        const row = p as Partial<FindingsStandingPayload>;
        if (t.standingEvents < MAX_STANDING_EVENTS_PER_TURN) {
          t.standingEvents += 1;
          recordSpanEvent(top, event.type, standingAttrs(row));
        } else t.standingOmitted += 1;
        if (row.standing !== undefined && STANDINGS.includes(row.standing)) {
          t.standingCounts ??= new Map();
          t.standingCounts.set(row.standing, (t.standingCounts.get(row.standing) ?? 0) + 1);
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * The turn's findings summary on the agent span, at whichever close the
   * turn gets (turn_end, error.fatal, or `stop()` for a paused one): a count
   * per standing when any row was filed, and the one overflow event when the
   * per-turn cap held rows back.
   */
  function flushStandings(t: TurnState): void {
    if (t.root === undefined || !explainability) return;
    if (t.standingCounts !== undefined) setAttrs(t.root, standingCountAttrs(t.standingCounts));
    if (t.standingOmitted > 0) {
      recordSpanEvent(t.root, 'agentfootprint.findings.standing_overflow', {
        'agentfootprint.findings.standing_events_omitted': t.standingOmitted,
        'agentfootprint.findings.standing_events_written': t.standingEvents,
      });
    }
  }

  /** `stream.tool_end` as this adapter reads it — every field optional,
   *  because it also takes hand-fed streams. */
  type ToolEndLike = Partial<
    Pick<ToolEndPayload, 'toolCallId' | 'result' | 'modelResult' | 'changedArgKeys' | 'notExecuted'>
  > & { readonly toolName?: string; readonly error?: unknown; readonly notDispatched?: unknown };

  /** The proposal as `tool_start` carried it, serialized THEN — a snapshot, so
   *  nothing written into the object later can reach the export. */
  function snapshotArgs(
    toolName: string,
    args: unknown,
  ): {
    readonly toolName: string;
    readonly text?: string;
    readonly chars: number;
  } {
    let text: string | undefined;
    try {
      text = toWireJson(args);
    } catch {
      text = undefined;
    }
    if (text === undefined) return { toolName, chars: 0 };
    return text.length > maxContentChars
      ? { toolName, chars: text.length }
      : { toolName, text, chars: text.length };
  }

  /**
   * `captureToolContent`, for a call that RAN and RETURNED (no `error`, no
   * `notExecuted`): its arguments — the proposal snapshot, with every key a
   * rule changed or the tool's redaction hides (`changedArgKeys`) shown as
   * `'REDACTED'`: withheld, never replaced by a value the event does not
   * carry — and what the model READ (`modelResult` when a rule changed it,
   * else `result`). A code runner's arguments are its generated program and
   * are withheld. A call that failed or never ran exports no content. Shape
   * and size by {@link toolContentAttrs}.
   */
  function toolContent(t: TurnState, p: ToolEndLike, errored: boolean): Attrs {
    const proposal = p.toolCallId !== undefined ? t.proposedArgs.get(p.toolCallId) : undefined;
    if (p.toolCallId !== undefined) t.proposedArgs.delete(p.toolCallId);
    if (errored || p.notExecuted === true) return {};
    const read = Object.prototype.hasOwnProperty.call(p, 'modelResult') ? p.modelResult : p.result;
    return {
      ...argsContent(proposal, p.changedArgKeys ?? []),
      ...toolContentAttrs('result', read, maxContentChars),
    };
  }

  function argsContent(
    proposal:
      | { readonly toolName: string; readonly text?: string; readonly chars: number }
      | undefined,
    changed: readonly string[],
  ): Attrs {
    if (proposal === undefined) return {};
    if (codeRunners.has(proposal.toolName))
      return { 'agentfootprint.tool.args.withheld': 'code-runner' };
    if (proposal.text === undefined)
      return proposal.chars > 0 ? { 'agentfootprint.tool.args.omitted_chars': proposal.chars } : {};
    if (changed.length === 0) return toolContentAttrs('args', proposal.text, maxContentChars);
    let parsed: unknown;
    try {
      parsed = JSON.parse(proposal.text);
    } catch {
      return {};
    }
    if (!isPlainObject(parsed)) return {};
    const shown: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    for (const key of changed) shown[key] = 'REDACTED';
    return toolContentAttrs('args', shown, maxContentChars);
  }

  // ─── Late-capable events (they may arrive after the turn closed) ───

  /**
   * The checker accounting, filed ONCE per run from the run door's `finally`
   * — after turn_end on a finished run, after error.fatal on a failed one,
   * with the turn still open on a paused one. When it is exported it gets
   * its own short span under the turn's root, so a reader finds it in one
   * place whichever exit the run took.
   *
   * By default only when a row is ACTIONABLE — a check filed findings, or a
   * registered check filed nothing while the run did work (the wiring rot
   * `integrity/disposition/ledger.ts` · `filedNothing` names) — and only those
   * rows ride as events. A healthy run exports nothing. `checkAccounting:
   * 'all'` exports every row on every run.
   */
  function handleDisposition(event: AgentfootprintEvent, runId: string): void {
    const root = rootOf(runId);
    if (root === undefined) return;
    const p = event.payload as Partial<IntegrityDispositionPayload>;
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
    const actionable = (row: (typeof rows)[number]): boolean =>
      n(row.findings) > 0 ||
      (p.workExisted === true &&
        filedNothing({
          checked: n(row.checked),
          notApplicable: n(row.notApplicable),
          unreachable: n(row.unreachable),
        }));
    const shown = allCheckRows ? rows : rows.filter(actionable);
    if (!allCheckRows && shown.length === 0) return;
    recordOnChildSpan(
      root,
      'agentfootprint.integrity.disposition',
      dispositionSpanAttrs(p),
      shown.map((row) => ({
        name: 'agentfootprint.integrity.check',
        attrs: dispositionRowAttrs(row),
      })),
    );
  }

  /** A score about a whole run can name it: `target` 'run' / 'turn' with the
   *  run id as `targetRef` — the only join a score filed after the run has
   *  (`agent.emit` stamps `runId: 'consumer-scope'`). A tool-call or
   *  iteration ref names something else and never joins a run. */
  function runNamedBy(p: Partial<EvalScorePayload>): string | undefined {
    return (p.target === 'run' || p.target === 'turn') && typeof p.targetRef === 'string'
      ? p.targetRef
      : undefined;
  }

  /** A run this adapter holds — open, or closed within the window. */
  interface HeldRun {
    readonly runId: string;
    readonly live?: TurnState;
    /** Absent when sampling dropped the run. */
    readonly root?: OtelSpanLike;
    readonly sessionDigest?: string;
  }

  function heldRun(runId: string): HeldRun | undefined {
    const live = activeTurns.get(runId);
    if (live !== undefined)
      return {
        runId,
        live,
        ...(live.root !== undefined && { root: live.root }),
        ...(live.sessionDigest !== undefined && { sessionDigest: live.sessionDigest }),
      };
    const closed = closedTurns.get(runId);
    return closed === undefined ? undefined : { runId, ...closed };
  }

  /**
   * Where a verified score lands on a run whose turn is still OPEN: on the
   * span it names while that span is open — the tool call (`targetRef` = its
   * call id), the iteration (`targetRef` = its index) — else on a short span
   * of its own under the turn's root, never on a sibling operation it does
   * not name. A score about the run or the turn lands on the agent span.
   */
  function placeOnOpenTurn(
    t: TurnState,
    root: OtelSpanLike,
    p: Partial<EvalScorePayload>,
    attrs: Attrs,
  ): void {
    const ref = typeof p.targetRef === 'string' ? p.targetRef : undefined;
    let span: OtelSpanLike | undefined;
    if (p.target === 'toolCall') span = ref !== undefined ? t.toolSpans.get(ref) : undefined;
    else if (p.target === 'iteration')
      span = t.stack.find((entry) => entry.name === `iteration:${ref ?? ''}`)?.span;
    else span = root;
    if (span !== undefined) recordSpanEvent(span, 'gen_ai.evaluation.result', attrs);
    else
      recordOnChildSpan(root, 'agentfootprint.evaluation', undefined, [
        { name: 'gen_ai.evaluation.result', attrs },
      ]);
  }

  /** A score this adapter may not (or cannot) place under a run: its own
   *  root span, the ref it named as an attribute, and why it stands alone. */
  function recordUnparented(
    attrs: Attrs,
    reason: 'owner-unverified' | 'run-forgotten' | 'run-not-held',
  ): void {
    // `root`: a NEW trace, never a child of whatever span is active in the
    // caller's context (an unrelated request being served) — unparented means
    // unparented.
    const span = startSpanUnder(
      undefined,
      'agentfootprint.evaluation',
      { 'service.name': opts.serviceName, 'agentfootprint.eval.unparented': reason },
      true,
    );
    recordSpanEvent(span, 'gen_ai.evaluation.result', attrs);
    endSpan(span);
  }

  /**
   * `eval.score` → `gen_ai.evaluation.result` (the spec's evaluation event,
   * carried here as a SPAN event: this adapter speaks only the Tracer API).
   *
   * WHICH run: the one the score NAMES (`target` 'run' / 'turn', `targetRef`
   * = a run id) when this adapter holds it; else the run the score was
   * emitted from. A ref that names no run held here ('this-run', a label)
   * falls back to the emitting run.
   *
   * WHETHER it may be parented there: only when the library can place the
   * score in that run's session — it was emitted from inside that very run,
   * or its own `meta.sessionId` is that run's session. Run ids are minted in
   * sequence and anyone can write one, so a score that cannot show it
   * belongs (every `agent.emit` after the run: no session on its meta) is
   * exported on a span of its OWN, unparented, naming the ref — never under
   * someone else's trace. Placement while the turn is open follows
   * {@link placeOnOpenTurn}; after it closed, a short `agentfootprint.evaluation`
   * span under the root (a finished span takes no events).
   *
   * Never silently lost: a run sampling dropped takes its scores with it; a
   * run that left the closed-turn window is exported unparented AND reported
   * through `onError`; a score with no `metricId` (the spec's one Required
   * attribute) is reported. This path is best effort — the durable home for
   * scores filed after the run is a score record, not a trace span.
   */
  function handleEvalScore(event: AgentfootprintEvent, runId: string): void {
    const p = event.payload as Partial<EvalScorePayload>;
    if (typeof p.metricId !== 'string' || p.metricId === '') {
      report(
        new Error(
          'otelObservability: an agentfootprint.eval.score without a metricId was not exported — ' +
            'gen_ai.evaluation.name is the one attribute the spec requires.',
        ),
        event,
      );
      return;
    }
    const attrs = evaluationAttrs(p, captureContent, maxContentChars);
    const named = runNamedBy(p);
    const namedRun = named !== undefined ? heldRun(named) : undefined;
    // A ref naming a run this strategy FORGOT is still that run's score: it
    // never falls back to the run it was emitted from.
    const forgottenRef =
      namedRun === undefined && named !== undefined && forgottenRuns.has(named) ? named : undefined;
    const target = forgottenRef !== undefined ? undefined : namedRun ?? heldRun(runId);
    if (target === undefined) {
      const ref = forgottenRef ?? named ?? runId;
      const sampled = forgottenRuns.get(ref);
      if (sampled === false) return; // sampling dropped it; its scores go with it
      if (sampled === true) {
        recordUnparented(attrs, 'run-forgotten');
        report(
          new Error(
            `otelObservability: an evaluation score names run '${bound(ref)}', which closed more ` +
              `than ${String(MAX_CLOSED_TURNS)} turns ago on this strategy — exported on its own ` +
              `span, unparented.`,
          ),
          event,
        );
        return;
      }
      recordUnparented(attrs, 'run-not-held');
      return;
    }
    if (target.root === undefined) return; // sampling dropped it
    const scoreSession = sessionOf(event);
    const verified =
      target.runId === runId ||
      (scoreSession !== undefined &&
        target.sessionDigest !== undefined &&
        sha256Hex(scoreSession) === target.sessionDigest);
    if (!verified) {
      recordUnparented(attrs, 'owner-unverified');
      return;
    }
    if (target.live !== undefined) placeOnOpenTurn(target.live, target.root, p, attrs);
    else
      recordOnChildSpan(target.root, 'agentfootprint.evaluation', undefined, [
        { name: 'gen_ai.evaluation.result', attrs },
      ]);
  }

  // ─── Event-to-span dispatch ────────────────────────────────────────

  function handleEvent(event: AgentfootprintEvent): void {
    if (stopped) return;
    const runId = anchorRunId(event);
    if (!runId) return; // Events without a turn anchor — skip.

    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        const sampled = sampleRate >= 1 || Math.random() < sampleRate;
        // The CONVERSATION this run belongs to: `meta.sessionId` (9.4.0),
        // stamped by `run(input, { sessionId })` and by `standingAgent` from
        // the request's own session — the one a `SessionLifecycle` store
        // (9.26.0) persists. It is the spec's `gen_ai.conversation.id` exactly:
        // "the unique identifier for a conversation (session, thread)", and
        // the spec rules out a stand-in ("a new UUID, a trace identifier …
        // SHOULD NOT be used"), so a run that is not session-bound gets none —
        // never the runId, which names ONE turn and would merge nothing and
        // split everything in a backend's session view.
        //
        // WRITTEN AS A DIGEST by default (`conversationId`): at a door with no
        // verifier the session id is the handle to the conversation, and a
        // trace backend is read by many more people than the browser that
        // minted it. The digest groups exactly as the id would; the raw id is
        // an opt-in for doors that verify who may open a conversation.
        const sessionId = sessionOf(event);
        const sessionDigest = sessionId !== undefined ? sha256Hex(sessionId) : undefined;
        const turnState: TurnState = {
          stack: [],
          sampled,
          toolSpans: new Map(),
          toolNames: new Map(),
          standingEvents: 0,
          standingOmitted: 0,
          proposedArgs: new Map(),
          ...(sessionId !== undefined && {
            conversationId: rawConversationId ? sessionId : sessionDigest,
            sessionDigest,
          }),
        };
        activeTurns.set(runId, turnState);
        closedTurns.delete(runId);
        forgottenRuns.delete(runId);
        if (sampled) {
          const turnIndex = (event.payload as { turnIndex?: number }).turnIndex;
          // `invoke_agent` span per the GenAI agent-span conventions.
          // `gen_ai.provider.name` / `gen_ai.request.model` (conditionally
          // required) are back-filled on the first llm_start — unknown here.
          // `userPrompt` rides the span ONLY when the consumer asked for it
          // (`captureContent`) — see that option for what enabling it exports.
          // `agentfootprint.run.id` names the run (one turn) beside the
          // conversation id above — one session, many runs.
          // WHO the run is for (9.11.0). This adapter maps selected signals
          // onto spans rather than serializing the envelope — unlike the
          // file / CloudWatch / AgentCore sinks, which write
          // `JSON.stringify(event)` and inherit every meta field for free — so
          // the actor has to be placed deliberately or it would not appear at
          // all. Own namespace, not `enduser.id`: the semconv name for this has
          // moved once already, and quietly claiming a convention we do not
          // track is worse than a name that says whose field it is.
          const actor = (event as { meta?: { principal?: string; tenant?: string } }).meta;
          turnState.root = pushSpan(
            turnState,
            genAiNames ? `invoke_agent ${opts.serviceName}` : opts.serviceName,
            {
              'service.name': opts.serviceName,
              'gen_ai.operation.name': 'invoke_agent',
              'gen_ai.agent.name': opts.serviceName,
              ...conversationAttr(turnState),
              'agentfootprint.run.id': runId,
              ...(typeof turnIndex === 'number' && { 'agentfootprint.turn.index': turnIndex }),
              // Absent when nobody named one — an anonymous run gets no
              // attribute rather than an empty string.
              ...(actor?.principal !== undefined && {
                'agentfootprint.principal.id': actor.principal,
              }),
              ...(actor?.tenant !== undefined && { 'agentfootprint.tenant.id': actor.tenant }),
              ...(captureContent &&
                typeof (event.payload as { userPrompt?: unknown }).userPrompt === 'string' && {
                  ...taskContent('input', (event.payload as { userPrompt: string }).userPrompt),
                }),
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
            finalContent?: string;
          };
          setAttrs(t.root, {
            ...(captureContent &&
              typeof p.finalContent === 'string' &&
              taskContent('output', p.finalContent)),
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
        // A count per findings standing (only when the turn filed any) and the
        // overflow summary (only when the per-turn cap held rows back).
        flushStandings(t);
        // Defensive: end everything still on the stack.
        while (t.stack.length > 0) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        activeTurns.delete(runId);
        rememberClosed(runId, t);
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
        pushSpan(t, genAiNames && p.model ? `chat ${spanNamePart(p.model)}` : 'llm', {
          'gen_ai.operation.name': 'chat',
          ...(p.model !== undefined && { 'gen_ai.request.model': p.model }),
          ...(p.provider !== undefined && { 'gen_ai.provider.name': p.provider }),
          ...(typeof p.temperature === 'number' && {
            'gen_ai.request.temperature': p.temperature,
          }),
          // Conditionally Required on inference spans "if available" (spec).
          ...conversationAttr(t),
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
          notDispatched?: SettledMarkerLike;
        };
        const toolName = p.toolName ?? 'tool';
        // A call the batch settlement answered (9.113.0) never executed, so it
        // gets no `execute_tool` span — one would claim an execution that
        // never happened. The fact is a library decision, recorded like every
        // other one here: a span event on the active span (SYNTHESIZED name).
        // Only on a leg this adapter traces — see the header's KNOWN LIMIT.
        if (p.notDispatched !== undefined) {
          const top = topSpan(t);
          if (top) {
            const paused = p.notDispatched.pausedCall;
            recordSpanEvent(top, 'agentfootprint.tool.not_dispatched', {
              'gen_ai.tool.name': toolName,
              ...(p.toolCallId !== undefined && { 'gen_ai.tool.call.id': p.toolCallId }),
              ...(paused?.toolCallId !== undefined && {
                'agentfootprint.tool.paused_call.id': paused.toolCallId,
              }),
              ...(paused?.toolName !== undefined && {
                'agentfootprint.tool.paused_call.name': paused.toolName,
              }),
            });
          }
          break;
        }
        // Tool-execution span per GenAI semconv (`execute_tool`).
        // Args: top-level key NAMES by default. The values ride
        // `gen_ai.tool.call.arguments` — Opt-In in the spec, because they are
        // raw (PII / prompt-injection echo) — ONLY under `captureToolContent`,
        // SNAPSHOTTED here (serialized now — the tool receives this same
        // object and may write into it) and exported at `tool_end`, once the
        // rules have named the keys they changed (`changedArgKeys`).
        const argKeys =
          p.args !== undefined && typeof p.args === 'object' ? Object.keys(p.args) : [];
        const nameInSpan = spanNamePart(toolName);
        const span = pushSpan(t, genAiNames ? `execute_tool ${nameInSpan}` : `tool:${nameInSpan}`, {
          'tool.name': toolName,
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': toolName,
          ...(p.toolCallId !== undefined && { 'gen_ai.tool.call.id': p.toolCallId }),
          ...(p.protocol !== undefined && { 'agentfootprint.tool.protocol': p.protocol }),
          ...(argKeys.length > 0 && { 'agentfootprint.tool.args.keys': boundList(argKeys) }),
          // Conditionally Required on execute_tool spans "if available" (spec).
          ...conversationAttr(t),
        });
        if (p.toolCallId !== undefined) {
          t.toolSpans.set(p.toolCallId, span);
          t.toolNames.set(p.toolCallId, toolName);
          if (captureToolContent) t.proposedArgs.set(p.toolCallId, snapshotArgs(toolName, p.args));
        }
        break;
      }

      case 'agentfootprint.stream.tool_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as ToolEndLike;
        // A settled call's tool_start opened no span (see tool_start), so its
        // tool_end closes nothing — and must never reach the name-less
        // fallback below, which would pop whatever tool span is on top.
        if (p.notDispatched !== undefined) break;
        const errored = p.error !== undefined && p.error !== false;
        const ranName = p.toolCallId !== undefined ? t.toolNames.get(p.toolCallId) : undefined;
        if (p.toolCallId !== undefined) t.toolNames.delete(p.toolCallId);
        // A call that returned without error and was not refused ran a tool
        // this agent holds — what a `tryInsteadTool` name is recognized by.
        if (ranName !== undefined && !errored && p.notExecuted !== true)
          remember(ranTools, ranName);
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
                  name === `tool:${spanNamePart(p.toolName ?? '')}` ||
                  name === `execute_tool ${spanNamePart(p.toolName ?? '')}`
              : (name): boolean => name.startsWith('tool:') || name.startsWith('execute_tool '),
          );
        }
        if (!span) break;
        // Result: TYPE by default — never the value (PII discipline; mirrors
        // the #9 contract). Content only under `captureToolContent`
        // (`toolContent`): the proposal with rule-changed keys withheld, and
        // what the model read.
        setAttrs(span, {
          'agentfootprint.tool.result.type': p.result === null ? 'null' : typeof p.result,
          ...(errored && { 'error.type': '_OTHER' }), // boolean error flag — no class info
          ...(captureToolContent && toolContent(t, p, errored)),
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
        flushStandings(t);
        while (t.stack.length > 1) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        const root = popSpan(t);
        if (root) endSpan(root, { error: true });
        activeTurns.delete(runId);
        // The run door's `finally` still files its checker accounting.
        rememberClosed(runId, t);
        break;
      }

      // A code runner ran: its NAME marks its calls' arguments (the program)
      // as never exported. Names only; the event carries no code.
      case 'agentfootprint.tools.code_run': {
        const tool = (event.payload as { tool?: unknown }).tool;
        if (typeof tool === 'string') remember(codeRunners, tool);
        break;
      }

      // Late-capable events: they may name a turn that has already closed.
      case 'agentfootprint.eval.score': {
        handleEvalScore(event, runId);
        break;
      }
      case 'agentfootprint.integrity.disposition': {
        if (explainability) handleDisposition(event, runId);
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

  const strategy: OtelObservabilityStrategy = {
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
        flushStandings(t);
        while (t.stack.length > 0) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        t.toolSpans.clear();
      }
      activeTurns.clear();
      closedTurns.clear();
      forgottenRuns.clear();
    },
    /**
     * Where errors go. Overriding it works — assign `_onError`, or pass
     * `onError` in the factory options.
     */
    _onError(err: Error, event?: AgentfootprintEvent): void {
      (opts.onError ?? consoleSink)(err, event);
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
  return strategy;
}
