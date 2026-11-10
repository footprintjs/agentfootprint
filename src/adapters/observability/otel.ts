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


import type { OtelObservabilityOptions, OtelObservabilityStrategy } from './otel/types.js';
import { createOtelStrategy } from './otel/strategy.js';

export type {
  OtelObservabilityOptions,
  OtelAttributeValue,
  OtelTracerLike,
  OtelSpanOptions,
  OtelSpanLike,
  OtelDecisionEvidenceRecorder,
  OtelObservabilityStrategy,
} from './otel/types.js';

export function otelObservability(opts: OtelObservabilityOptions): OtelObservabilityStrategy {
  return createOtelStrategy(opts);
}
