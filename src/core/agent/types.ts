/**
 * Agent type definitions — both PUBLIC types (AgentOptions, AgentInput,
 * AgentOutput) consumed by `Agent.create({...}).run({...})` callers AND
 * the INTERNAL `AgentState` shape used by stage functions.
 *
 * These were originally inline in `core/Agent.ts`; extracted here as
 * part of the v2.11.1 decomposition. `core/Agent.ts` re-exports them
 * for back-compat (the 28+ existing import sites continue to work).
 */

import type {
  AttachRecorderOptions,
  FlowChartExecutorOptions,
  ReadTrackingMode,
  StructureRecorder,
  CommitValuesMode,
} from 'footprintjs';
import type { GroupTranslator } from '../translator.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMToolSchema,
  PermissionChecker,
  PricingTable,
} from '../../adapters/types.js';
import type { CacheMarker, CacheStrategy } from '../../cache/types.js';
import type { ActiveInjection } from '../../lib/injection-engine/types.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import type { MemoryIdentity } from '../../memory/identity/types.js';
import type { CredentialProvider } from '../../identity/types.js';
import type { ArtifactStore } from '../../artifacts/types.js';
import type { ArtifactPlacement } from '../../artifacts/placement.js';
import type { AuthorizationRequiredMode } from '../../identity/consent.js';
import type { ToolArgValidationMode } from './toolArgsValidation.js';
import type { ThinkingBlock } from '../../thinking/types.js';
import type { ReliabilityScope } from '../../reliability/types.js';
import type { FoldedSpan, WindowRecord } from './window/types.js';
import type { ExternalGround } from '../../integrity/unsupported-argument/check.js';
import type { MessagesDelivery } from './delivery/types.js';
import type { MiddlewareDecision } from './middleware/types.js';
import type { OutputAttempt } from './outputEnforcement.js';
import type { UnsupportedValue } from './evidence/types.js';
import type { AgentRunCheckpoint } from '../runCheckpoint.js';

// ─── PUBLIC types (consumer-facing) ────────────────────────────────

/**
 * Dials for the deferred observer queue (RFC-001) — only meaningful with
 * `observerDelivery: 'deferred'` (passing them without it throws at
 * construction). Same vocabulary as footprintjs's `AttachRecorderOptions`
 * minus `delivery` (the Agent option IS the delivery switch):
 * `capture` (default `'clone'` — hooks receive the same event shape as
 * inline), `maxQueue` (default 10 000), `overflow` (default
 * `'drop-oldest'`), `sampleEvery`, `flushBudgetMs` (default 2).
 */
export type ObserverDeliveryOptions = Omit<AttachRecorderOptions, 'delivery'>;

/**
 * Per-write read-provenance policy — `AgentOptions.writeProvenance`. Derived
 * structurally from footprintjs's executor options (the engine owns the
 * vocabulary; it does not export the alias), so the two can never drift.
 */
export type WriteProvenanceMode = NonNullable<FlowChartExecutorOptions['writeProvenance']>;

/**
 * The app's external-ground door for the choice-seam integrity check
 * (9.72.0) — see {@link AgentOptions.externalGrounds}. Yields the entries the
 * app currently vouches for; consulted once per LLM response that contains an
 * armed call. Must be synchronous: the values are things the app already
 * verified and holds (a clicked selection), never something to go fetch.
 */
export type ExternalGroundsProvider = () => readonly ExternalGround[];

/**
 * The object form of `AgentOptions.artifacts` (9.22.0): the store plus its
 * operator dials. `placement` cannot be spelled without `store` — a
 * threshold with nowhere to put what it catches would be configuration that
 * lies, and the shape refuses it before a runtime check has to.
 */
export interface AgentArtifactsOptions {
  /** The claim-check store — same seam as the bare `ArtifactStore` form. */
  readonly store: ArtifactStore;
  /**
   * The placement threshold. A tool result whose finalized text exceeds
   * `maxInlineChars` is checked into the store (under the tool's declared
   * `resultKind`, or `tool-result/<toolName>` when it declares none) and the
   * model reads the claim ticket instead.
   * Judged AFTER the tool's own `resultCeiling` (the author's refusal comes
   * first) and BEFORE the agent-level `maxToolResultChars` truncation net
   * (which then measures the ticket, so it should rarely fire). Omitted →
   * results are never measured and never placed, exactly as before.
   */
  readonly placement?: ArtifactPlacement;
  /**
   * Check each completed run's RECORDING into the store (9.26.0), so a screen
   * can replay the turn later without the deployment inventing a place to keep
   * it.
   *
   * `true` for the default naming, or `{ label }` to name them yourself. Off by
   * default: unset, no recorder is attached, no events are captured, and the
   * run is byte-identical to every earlier release.
   *
   * ── What lands, and where ───────────────────────────────────────────────
   * The `recordRun` contract exactly — `{ snapshot, events, structure }`, the
   * three things a viewer needs and the shape `observeRecording()` consumes —
   * minted as kind `'recording/run'` in the RUN's own artifact scope, with
   * `origin.runId` joining it back to the trace. The existing wire ops serve
   * it: `{ op: 'artifact-get', ref }` returns the recording, and no new
   * operation was needed for any of it. Retention rides the store, so
   * recordings age out under the same ttl and byte budget everything else
   * does.
   *
   * ── The cost, stated rather than discovered ─────────────────────────────
   * Recording a run means an event tail and a boundary recorder for its
   * duration, and the mint is one store write on the way OUT of `run()` — the
   * answer is fully composed before the write begins and the write can never
   * change it, but `run()` does return after it rather than before. That is
   * deliberate: a fire-and-forget write is a recording lost whenever the
   * container exits with the reply, which is exactly the deployment that wants
   * this most.
   *
   * A mint that FAILS degrades to the old behaviour — the answer is returned
   * unchanged, and the failure lands on the record as
   * `agentfootprint.artifacts.refused`. A run never fails because its
   * recording could not be filed.
   *
   * Nothing is minted for a run that paused (there is no completed run yet) or
   * threw. A resumed run mints when it completes, and its recording covers the
   * RESUMED run — which is what the recorder saw.
   */
  readonly recordings?: boolean | AgentRecordingsOptions;
}

/** The object form of {@link AgentArtifactsOptions.recordings}. */
export interface AgentRecordingsOptions {
  /**
   * The label every minted recording carries, verbatim.
   *
   * Absent, each is labelled `run <runId>`. A static label repeats across runs
   * on purpose — what distinguishes two recordings is the ref and
   * `origin.runId`, and a library that decorated your label to make it unique
   * would be overruling the name you chose.
   */
  readonly label?: string;
}

export interface AgentOptions {
  readonly provider: LLMProvider;
  /** Human-friendly name shown in events/metrics. Default: 'Agent'. */
  readonly name?: string;
  /** Stable id used for topology + events. Default: 'agent'. */
  readonly id?: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Hard budget on ReAct iterations. Default: 10. Hard cap: 50. */
  readonly maxIterations?: number;
  /**
   * Pricing adapter. When set, Agent emits `agentfootprint.cost.tick`
   * after every LLM response (once per ReAct iteration) with per-call
   * and cumulative USD. Run-scoped — the cumulative resets each `.run()`.
   */
  readonly pricingTable?: PricingTable;
  /**
   * Cumulative USD budget per run. With `pricingTable`, Agent emits a
   * one-shot `agentfootprint.cost.limit_hit` (`action: 'warn'`) when
   * cumulative USD crosses this budget. Execution continues — consumers
   * choose whether to abort by listening to the event.
   */
  /**
   * Cumulative USD cap for one run. Requires a `pricingTable` — the budget is
   * money and only a pricing table turns tokens into money (refused at build
   * otherwise since 8.13.0).
   *
   * A bare number WARNS: `agentfootprint.cost.limit_hit` fires once with
   * `action: 'warn'` and the run carries on. That is what this option has
   * always done, and it stays exactly that.
   *
   * `{ usd, onExceed: 'halt' }` makes it a stop. The loop ends at the next
   * iteration boundary — the same boundary `maxIterations` uses — so a call
   * already in flight completes, is billed and is recorded; nothing is
   * abandoned mid-request. The run returns the answer it has (possibly `''`)
   * and `agent.stoppedEarly()` says why.
   *
   * @example
   * ```ts
   * Agent.create({ provider, model, pricingTable, costBudget: 0.50 })           // warns
   * Agent.create({ provider, model, pricingTable,
   *                costBudget: { usd: 0.50, onExceed: 'halt' } })               // stops
   * ```
   */
  readonly costBudget?: number | { readonly usd: number; readonly onExceed: 'warn' | 'halt' };
  /**
   * Per-slot context budgets, in characters (8.11.0).
   *
   * Each of the three context slots warns — and emits
   * `agentfootprint.context.budget_pressure` — when what it composed for an
   * iteration exceeds its budget. **Nothing is ever truncated:** the full
   * content still reaches the LLM. The budget is a signal that the slot is
   * growing past what you expected, not a limiter.
   *
   * Defaults: `systemPrompt` 4000, `messages` 10000, `tools` 2000. The keys
   * are the three slots the context model already names
   * (`ContextSlot = 'system-prompt' | 'messages' | 'tools'`), so the option
   * and the event it produces speak one vocabulary.
   *
   * Before 8.11.0 these caps existed but no public door reached them, and the
   * over-budget warning told you to "raise budgetCap" — a knob nothing could
   * set. Raising a budget is the right answer when the slot is legitimately
   * that big (a long conversation easily passes the 10000-character messages
   * default); trimming is the right answer when it isn't.
   *
   * @example Give a long-running support agent more room for history
   *   Agent.create({ provider, model, contextBudget: { messages: 40_000 } })
   */
  readonly contextBudget?: {
    readonly systemPrompt?: number;
    readonly messages?: number;
    readonly tools?: number;
  };
  /**
   * Permission adapter. When set, the Agent calls
   * `permissionChecker.check({capability: 'tool_call', ...})` BEFORE every
   * `tool.execute()`. Emits `agentfootprint.permission.check` with the
   * decision. On `deny`, the tool is skipped and its result is a
   * synthetic denial string; on `allow` / `gate_open`, execution proceeds
   * normally.
   */
  readonly permissionChecker?: PermissionChecker;
  /**
   * Tool-args validation mode (#9). Default `'enforce'`: LLM-produced args
   * are validated against the tool's declared `inputSchema` BEFORE dispatch.
   * On mismatch the tool is NOT executed — the model receives a structured
   * retry message as the tool result (paths + expected shapes + received
   * TYPES) and corrects itself on the next iteration. Emits
   * `agentfootprint.validation.args_invalid`.
   * `'warn'` emits the event but executes anyway; `'off'` disables.
   * Validation is an honest JSON-Schema subset (type/required/properties/
   * items/enum/explicit additionalProperties:false, plus the string SHAPE
   * keywords pattern/minLength/maxLength) — unsupported keywords are
   * ignored, never false-rejecting.
   *
   * A string-shape refusal quotes a CAPPED excerpt of the offending value
   * and the parameter's own `description`, because "expected string, got
   * string" cannot be acted on; every other issue still names types only.
   */
  readonly toolArgValidation?: ToolArgValidationMode;
  /**
   * The ceiling on ONE tool result, in characters (9.11.0). **Opt-in — there
   * is no default, and there will not be one.**
   *
   * Over the cap, the result is REPLACED by a marker that names the tool, the
   * size, the cap, and the one action that helps — and carries the first
   * characters of the real answer verbatim:
   *
   * ```json
   * { "truncated": true,
   *   "reason": "orders_export returned 812431 chars, over the 20000-char cap. Narrow the request and call again.",
   *   "head": "id,customer,total\n1001,…" }
   * ```
   *
   * The marker IS the result. It is what the model reads on the `role: 'tool'`
   * message AND what `agentfootprint.stream.tool_end` carries — so a run that
   * capped a 800KB result does not then ship that same 800KB to an event sink,
   * and a trace shows the truncation instead of hiding it. `head` gets whatever
   * the cap has left after the sentence explaining it, so a bigger cap buys a
   * proportionally bigger head.
   *
   * **Why no default.** A default would silently modify tool results: a tool
   * that returns 200KB of rows is doing what somebody wrote it to do, and a
   * framework that quietly replaced that the first time it ran would be lying
   * to the app about its own tool. Omitted, results are never measured and
   * never replaced — byte-identical to every earlier release.
   *
   * It composes with, and never replaces, what a tool already does: a tool with
   * its own paging keeps it, `CodeResult.truncated` still means what it means,
   * and an `onToolResult` middleware that summarizes runs FIRST — the cap
   * measures what the chain produced. It is the last-resort net, not the plan.
   * When big tool DATA is the norm rather than the accident, the answer is the
   * `CodeRunner` port ("summarize prose, compute data"), not a bigger cap.
   *
   * Refused at construction for a non-positive or non-integer value: `0` is not
   * "off" — omitting the option is.
   *
   * @example a support agent whose search tool can return a whole knowledge base
   *   Agent.create({ provider, model, maxToolResultChars: 20_000 })
   */
  readonly maxToolResultChars?: number;
  /**
   * How long ONE tool teardown may take before the runner stops waiting
   * (default 5000ms). See `ctx.onTeardown`.
   *
   * Bounded because teardown sits on the SIGTERM path: an unbounded vendor
   * `Stop()` turns a container stop into a thirty-second wait for SIGKILL, and
   * a shutdown that hangs is indistinguishable from one that crashed. When the
   * budget runs out the cleanup is ABANDONED, not cancelled — there is nothing
   * to cancel a vendor's in-flight call with — and
   * `agentfootprint.tools.session_close_failed` fires with
   * `errorClass: 'ToolTeardownTimeoutError'`, because a session that may still
   * be live is a fact somebody is paying for.
   *
   * Raise it for a backend whose `Stop` is genuinely slow; lower it for a
   * latency-critical shutdown where an abandoned session is the cheaper loss.
   */
  readonly toolTeardownTimeoutMs?: number;
  /**
   * Read-tracking policy for the snapshot's per-stage read view
   * (footprintjs `StageSnapshot.stageReads`) — the observability-cost
   * lever for LONG runs. Forwarded to the Agent's internal
   * `FlowChartExecutor` as `{ readTracking }`.
   *
   * - `'summary'` (Agent default) — each tracked read records a cheap
   *   `ReadSummaryMarker` (type + size proxy + short preview) instead of
   *   a `structuredClone` of the value. Measured at N=200 full-feature
   *   iterations, `'full'` clones ~18MB of read values that nothing in
   *   the agentfootprint/lens/explainable-ui stack consumes.
   * - `'full'` — footprintjs's own default: every tracked read clones the
   *   value into `stageReads`. Set explicitly if you inspect
   *   `agent.getSnapshot()` read VALUES (not just keys/shapes).
   * - `'off'` — reads are not recorded; `stageReads` is absent.
   *
   * Narrative, recorder events (`onRead` payloads), and commit history are
   * IDENTICAL in every mode — the policy scopes ONLY the snapshot's
   * `stageReads` payload. Note the Agent default (`'summary'`) is
   * deliberately cheaper than footprintjs's (`'full'`); see CHANGELOG
   * behavior-change callout.
   */
  readonly readTracking?: ReadTrackingMode;
  /**
   * Commit-log value encoding (#13c-B) — forwarded to the internal
   * executor as `{ commitValues }`. Agent default is **`'delta'`**: a
   * stage whose net change to a tracked array is "the old array plus a
   * tail" (the agent's `history` every iteration) records ONLY the tail
   * (`append` verb); key removals record a `delete` verb. LOSSLESS — any
   * step's full value reconstructs by replay (`commitValueAt` from
   * `footprintjs/trace`), which is why this is safe for audit trails.
   * Retained commit-log memory becomes linear instead of quadratic.
   * Set `'full'` for footprintjs's default encoding (every changed key
   * stores its full final value) if a downstream consumer reads
   * `bundle.overwrite[key]` as the complete value.
   */
  readonly commitValues?: CommitValuesMode;
  /**
   * Per-write read provenance — forwarded to the internal executor as
   * `{ writeProvenance }`. Default **`'off'`** (footprintjs's own default):
   * every recording is byte-identical to earlier releases.
   *
   * With `'reads-prefix'`, each recorded write also stores the keys that were
   * tracked-read BEFORE it, which upgrades what the trace layer can claim about
   * a value: a downstream write is linked to this value because that write's
   * own read-prefix names the key — and a write whose prefix omits it is
   * excluded exactly. That is the difference between "this stage read A and
   * wrote B, in some order the log cannot see" and a recorded dependency.
   *
   * Turn it on when you intend to DEBUG the run: `traceVariable` reports
   * `coverage: 'exact'` only under this dial, and only then will `walkToRoot`
   * take a deterministic `narrowedBy: 'dataflow'` hop instead of an embedding
   * guess. Cost is one small array copy per write.
   */
  readonly writeProvenance?: WriteProvenanceMode;
  /**
   * Record the ASSEMBLED system prompt on every LLM call (9.50.0).
   * **Opt-in. Default OFF — and the default is a privacy decision.**
   *
   * When `true`, each `agentfootprint.stream.llm_start` event carries
   * `systemPromptText`: the joined injection pieces verbatim, exactly as the
   * provider received them. That is the string today's recordings only
   * describe (each piece is on the record; the assembled whole is not), so a
   * debugger no longer has to render "not in this recording" for the one
   * artifact the model actually read.
   *
   * WHY OFF BY DEFAULT: the assembled prompt is as sensitive as everything
   * in it — skill bodies, RAG passages, memory recalls, per-user
   * instructions — and it can be LARGE, once per iteration. With the dial on,
   * it rides into every attached recorder, every vendor sink, every
   * `recordRun` recording and every persisted envelope; treat those artifacts
   * accordingly. Off (the default), `llm_start` keeps its exact prior bytes —
   * `systemPromptChars` still reports the length, and the text is honestly
   * absent rather than summarized.
   *
   * @example capture the prompt while debugging context assembly
   *   Agent.create({ provider, model, recordSystemPrompt: true })
   */
  readonly recordSystemPrompt?: boolean;
  /**
   * Credential provider for downstream OAuth (declare-and-push). When set, a
   * tool that declares `needs: { credential }` has it resolved BEFORE `execute`
   * and injected as `ctx.credential`; tools can also pull via `ctx.credentials`.
   * From `agentfootprint/security` (`agentCoreIdentity({ region })`,
   * `staticTokens({ ... })`, or any `CredentialProvider`).
   */
  readonly credentials?: CredentialProvider;
  /**
   * The artifact store (9.21.0) — the claim-check seam. When set, every tool's
   * `ctx.artifacts` is this store bound to the RUN's scope (the same
   * tenant/principal/conversation tuple memory scopes on, composed by the
   * framework — a tool can never name or widen it), and every mint / resolve /
   * sweep / refusal lands on the typed record as
   * `agentfootprint.artifacts.*`. From the main barrel:
   * `inMemoryArtifacts()`, `fileArtifacts({ directory })`,
   * `sqliteArtifacts({ file })` — or any `ArtifactStore`.
   *
   * Since 9.22.0 the store also switches on the data legs: tools may declare
   * `wants` (ref arguments resolved at dispatch), the `present` tool is
   * auto-attached, and — via the object form — the operator may set the
   * placement threshold: `artifacts: { store, placement: { maxInlineChars } }`
   * checks any tool result over the threshold into the store and hands the
   * model the claim ticket instead ({@link AgentArtifactsOptions}). The bare
   * `ArtifactStore` form stays exactly what it was: the store, no placement.
   *
   * Unset — the default — the agent is byte-identical to earlier releases:
   * no events, no state, no `present` tool, and `ctx.artifacts` is a
   * fail-closed capability whose every method throws a teaching refusal
   * naming this option (`ctx.hasArtifacts` is the fact to branch on).
   */
  readonly artifacts?: ArtifactStore | AgentArtifactsOptions;
  /**
   * Tell the model when it has already made this exact call and already got
   * this exact answer (9.26.0). **On by default.**
   *
   * When one tool is dispatched with deeply-equal arguments and returns a
   * byte-identical result for the second time in a turn, one sentence is
   * appended to that result: *identical call, identical result — calling again
   * will not change it.* The call still RAN, the result is unchanged beside
   * the note, and a third identical call is not blocked. It is evidence, not a
   * gate.
   *
   * The failure it addresses is measured rather than imagined: a traced run in
   * which a model called one tool three times with identical arguments after
   * the backend silently ignored a filter, reading the same rows as a fresh
   * answer each time. Nothing inside the conversation can see that; the
   * framework watched all three land.
   *
   * **A turn that repeats nothing is byte-identical either way** — the same
   * results, the same events, and the same tracked state down to the key set.
   * The counters are held run-keyed beside the dispatch loop, never written to
   * scope: a within-turn tally is not conversation state, and tracked state is
   * the commit log, the snapshot, the narrative and every recording. Only an
   * actual repeat is visible, as one sentence on that result and one
   * `agentfootprint.tools.repeated_call` event.
   *
   * Set `false` to switch it off — nothing is fingerprinted, no counter is
   * kept, and even a repeating turn is byte-identical to earlier releases.
   * Worth doing when a deployment's tools are deliberately polled (an identical
   * call returning an identical status IS the expected shape while a job runs)
   * and the note would be noise rather than news.
   */
  readonly repeatedCallNudge?: boolean;
  /**
   * How many tools' most recent results the window keeps beyond
   * `keepRecentTurns` (9.57.0). **On by default, at 2.** Only meaningful
   * beside `.window(...)` / `.compaction(...)`; an agent with no window
   * strategy never builds the stage and pays nothing either way.
   *
   * The failure it addresses is measured, not imagined. An agent drove a
   * screen through tools; one tool result carried the only list of valid ids.
   * Under a small window that result left after about two iterations — while
   * the 9.55.0 anchor kept the REQUEST, so the model still knew what it had
   * been asked to do and no longer had what it needed to do it. It assembled
   * a plausible id out of an entity name it remembered, was refused, and
   * spent actions on it. In one archived run the final answer to the person
   * named a host that appears in no tool result at all.
   *
   * So for each tool that has spoken since the request, the window keeps that
   * tool's MOST RECENT result — at most this many beyond the recent-turns
   * window — until the agent calls that tool again or the person asks
   * something new. One pin per tool name, superseded on the next call, so it
   * cannot accumulate past your tool roster; a parallel batch is one turn and
   * costs one slot; and a pin that has provably blocked two consecutive
   * boundaries stands down ON THE RECORD rather than let a window grow.
   *
   * What it costs, and how to see it: `WindowRecord.observations` names every
   * turn the pin held and its exact character count, so the window's size
   * without the pin is computable from the record. What it gets wrong is
   * documented rather than buried — the pin is CONTENT-BLIND (a tool's last
   * result may be a one-word acknowledgement while the load-bearing one was
   * the call before), and under `summarizeOldest` a pinned turn stays raw
   * while everything around it is folded.
   *
   * Set `false` (or `0`) to switch it off — no pins, no `observations` key,
   * and the window behaves exactly as it did in 9.56.0.
   */
  readonly keepLastToolResults?: number | false;
  /**
   * How loud the Context Integrity checkers are about their OWN health
   * (9.60.0). Default `'observe'`.
   *
   * Every run keeps a disposition ledger — one row per applicable check,
   * counting checked-pass / checked-fail / not-applicable / unreachable —
   * and files it once at the run boundary as
   * `agentfootprint.integrity.disposition` (listener-gated, like every
   * typed event). `'dev'` adds the two liveness theorems: a canary at run
   * start proves each check's pure function can still catch its own
   * synthetic defect, and a run whose registered checkers demonstrably
   * never ran fails with `CheckerDeadError` instead of returning a green
   * answer — because a green report from a check that never ran is
   * decoration, and two shipped checks in this codebase decayed exactly
   * that way.
   */
  readonly integrityPosture?: 'observe' | 'dev';
  /**
   * App-verified ground for the choice-seam integrity check (9.72.0).
   *
   * The `unsupported-argument` check judges every armed tool call's
   * identifier-like arguments against what the RUN served the model. Some
   * ground the run never serves: a person clicked a row in the app's data
   * panel, the app VERIFIED the clicked cells against the artifact the panel
   * renders, and the model was told to act on that selection. An identifier
   * the model takes from a verified selection is not fabricated — this door
   * is how the app says so.
   *
   * Register a provider that yields the currently-verified entries, each a
   * `{ value, source }` pair — `source` is a short label for where the value
   * came from (e.g. `'viewer-selection'`). The provider is consulted once per
   * LLM response that contains an armed call, so entries may change between
   * turns as the person's selection does. Entries join the grounded corpus:
   * a value they contain files no finding, and each excusal is put on the
   * record as `agentfootprint.integrity.external_ground_used`, carrying the
   * `source` label of the entry that excused it.
   *
   * DECLARED, NEVER AMBIENT — this option is the only door; there is no
   * global registry to mutate. Absent, or a provider that yields nothing,
   * is byte-identical to today. A provider that throws or returns garbage
   * contributes nothing and never aborts the run.
   *
   * HONESTY NOTE, because this is an assertion door: the library records
   * what the app asserts — verifying the assertion (against the artifact,
   * the click, whatever the app's ground truth is) is the APP's duty, done
   * before the entry is yielded. The `source` label travels with every
   * excusal precisely so a reader can audit that chain instead of having to
   * trust it.
   */
  readonly externalGrounds?: ExternalGroundsProvider;
  /**
   * Notice when a lookup for a value THIS RUN PRODUCED comes back empty
   * (9.77.0) — the write seam's `empty-lookup` advisory. **Default off.**
   *
   * The recorded failure: a triage agent's reverse-lookup tool filtered a
   * column before a pivot, so the column did not exist yet and every reverse
   * lookup returned an empty result — for every identifier, always. The tool
   * answered successfully with an empty list, and the agent reported in a
   * table, with confidence, that the device was logged in to no port on any
   * collected switch, advising a check of the physical cabling. The device was
   * logged in the whole time. Nothing noticed, because an empty result from a
   * broken filter is byte-identical to an empty result from a genuine absence.
   *
   * What the library CAN see is the pair: the identifier came out of an
   * earlier tool result in this run — from a tool named in the consumer's
   * `Tool.argumentsFrom` — and the lookup keyed on it came back with nothing.
   * Turn this on and each such pair files one `advisory` finding on
   * `agentfootprint.integrity.context_error`, naming the value, the producing
   * tool, the consuming tool and the call id.
   *
   * THE CEILING, and it is why this never accuses: an empty result can be
   * perfectly true — the thing may exist and simply have nothing to show
   * right now — so this is a place to look, never a verdict that anything is
   * wrong. The SAME advisory is filed for a true absence and for a lookup that
   * could never have matched, because nothing in this library can tell them
   * apart. Every finding carries the ceiling sentence in its own message.
   *
   * WHAT IT JUDGES, and what it refuses to. A result is read only when the
   * library can COUNT it: an array (zero rows is zero rows) or the `absent()`
   * envelope. A prose sentence, a bespoke `{ rows: [] }` wrapper, a `null`, a
   * placement claim ticket — nothing in there is countable, so the encounter
   * files a `not-applicable` row and NO finding. That row is the point: a
   * check that silently skipped what it could not read would be the
   * decoration the disposition ledger exists to make impossible.
   *
   * TWO HALVES ARM IT: this dial AND at least one tool declaring
   * `argumentsFrom`. The declaration alone is deliberately not enough — it
   * already arms `dangling-reference` and `unsupported-argument`, and an
   * advisory that armed itself off a declaration made for something else would
   * not be opt-in. Absent, the run is byte-identical: no finding, no event,
   * nothing on the wire changes. The one visible difference is the registered
   * `empty-lookup` row in the disposition report, filed `not-applicable` —
   * which is the family's law, not an exception to it: registered-but-unarmed
   * is a ROW, never silence.
   *
   * Nothing is ever blocked, retried or rewritten; the model reads exactly the
   * result the tool returned.
   */
  readonly noticeEmptyLookups?: boolean;
  /**
   * Check a tool's rows against the columns it declared (9.78.0) — the write
   * seam's COLUMN-TYPE CONTRACT. **Default `'off'`.**
   *
   * THE RECORDED FAILURES, three of them, all one shape — a number became
   * something else and nothing noticed at the seam. A mapping report wrote
   * `str(m.get("logical_unit_number") or "")`, so LUN 0 — falsy — was stored
   * as an EMPTY STRING on 2,094 mappings, and a host group missing the LUN an
   * initiator probes first was indistinguishable from one that had it. A
   * capacity view rendered an 8 MiB disk as `0.0 GB`, which reads as NO DISK
   * during a live incident. And a whole family of tools returned their
   * numbers as quoted strings (`"1240"`), which silently blanked every chart,
   * because nothing downstream could tell a measure from a label.
   *
   * The library already lets a tool declare what its result IS
   * (`Tool.resultKind`). This dial reads the sibling declaration —
   * `Tool.resultColumns`, what the result CONTAINS — and checks the rows
   * against it at the moment the tool answers.
   *
   * THE THREE WORDS, and they are `toolArgsValidation`'s own:
   *
   *   • `'off'` (default) — nothing measured. Byte-identical to every release
   *     before this existed.
   *   • `'warn'` — findings are filed on
   *     `agentfootprint.integrity.context_error` and the model reads the rows
   *     EXACTLY as the tool returned them. Nothing is blocked, changed or
   *     retried.
   *   • `'enforce'` — the rows are REFUSED and the model reads a teaching
   *     sentence naming the column, what it declared, what arrived and how
   *     many rows — the `resultCeiling` idiom, not a thrown stack trace. The
   *     refusal is the whole payload, on every channel.
   *
   * The words are borrowed rather than invented deliberately: this is the
   * MIRROR of `toolArgsValidation` — that boundary validates the arguments
   * going IN against the tool's declared `inputSchema`, this one validates
   * the rows coming OUT against the tool's declared `resultColumns`. Two
   * validators at one seam that graded themselves in different vocabularies
   * would be a worse defect than either could catch.
   *
   * TWO FINDINGS, because the field bug turned on the difference:
   * `column-type-mismatch` (the column is there and holds the wrong thing)
   * and `missing-column` (the declared column is in none of the rows). They
   * send a person to two different files.
   *
   * THE CEILING: this judges TYPE, never MEANING. It sees that a column
   * declared `number` holds a string; it can never see that the string should
   * have been `0`, or that `0.0` should have been `0.0078` — so the `0.0 GB`
   * failure above passes it cleanly. The bound ships as `COLUMN_TYPE_CEILING`
   * and is quoted verbatim into every finding.
   *
   * WHAT IT REFUSES TO JUDGE: a result is read only when it is an ARRAY OF
   * PLAIN OBJECTS with at least one row. Prose, a `null`, a bespoke
   * `{ rows: [...] }` wrapper, a claim ticket — and the ZERO-ROW result,
   * which has no columns to be wrong about and belongs to `empty-lookup`
   * next door — all file an explicit `not-applicable` row and NO finding.
   *
   * TWO HALVES ARM IT: this dial AND at least one tool declaring
   * `resultColumns`. Absent, the run is byte-identical; the one visible
   * difference is the registered `column-type-mismatch` / `missing-column`
   * rows in the disposition report, filed `not-applicable` — the family's
   * law, not an exception to it.
   */
  readonly checkColumnTypes?: 'off' | 'warn' | 'enforce';
  /**
   * What a turn does when its ACTION BUDGET runs out mid-task (9.56.0).
   * Default **on**.
   *
   * `maxIterations` is a cap on actions, and the model does not know it is
   * about to be hit. Before this, a turn that reached the cap while the model
   * was still asking for tools handed back whatever text happened to ride that
   * last call — which, mid-task, is a fragment: *"The third finding focus is
   * not settling… Let me check what's on screen now:"*. That sentence went to
   * the person as if it were the answer, and nothing on the record said the
   * budget had run out.
   *
   * With this on, the run spends ONE more LLM call with **the tools withheld**
   * and this instruction appended, then hands back what comes back:
   *
   * > *Your action budget for this turn is exhausted. Do not request tools.
   * > Give your best final answer from what you have: what you completed, what
   * > remains undone, and anything the person should know.*
   *
   * That call is exempt from `maxIterations` by design — it cannot loop,
   * because with no tools on the wire there is nothing for the model to ask
   * for. It costs one call and it is on the record like any other turn (its
   * own `iteration_start` / `llm_start` / `cost.tick`).
   *
   * It rides the ITERATION budget only. A halting `costBudget` keeps today's
   * behaviour, because there the person capped the MONEY and one more call
   * would spend past the cap; an action cap says nothing about a call that
   * takes no action.
   *
   * The fact is on the record either way — `agent.stoppedEarly()` and
   * `agentfootprint.agent.budget_exhausted` both say whether the turn was
   * wrapped up (`action: 'wrapped-up'`) or cut short (`'cut-short'`), so a
   * dashboard can tell "answered" from "answered after the budget ran out".
   *
   * **A turn that never runs out of budget is byte-identical either way** —
   * same calls, same events, same tracked state down to the key set.
   *
   * Set `false` to keep the pre-9.56.0 behaviour: the turn ends on whatever
   * the last call produced. Worth doing when a caller renders `stoppedEarly`
   * itself and would rather not pay for the extra call.
   *
   * @example
   * ```ts
   * Agent.create({ provider, model, maxIterations: 8 });                     // wraps up
   * Agent.create({ provider, model, wrapUpAtMaxIterations: false });         // cuts short
   * ```
   */
  readonly wrapUpAtMaxIterations?: boolean;
  /**
   * What the run does when a tool's DECLARED credential (`needs: { credential }`)
   * comes back `authorization-required` — a person has to click a consent link
   * before the tool can run. Default **`'pause'`** (8.6.0).
   *
   * - `'pause'` — the run stops at the block. `agent.run()` returns a pause
   *   outcome whose `pauseData.authorization` carries `{ service, sessionId,
   *   authorizationUrl }`; a `standingAgent` answers **202** with
   *   `{ awaiting }`; `agent.resume(checkpoint)` re-resolves the credential and
   *   runs the tool that was waiting. The model is never told, so it cannot
   *   adapt around work that has not happened.
   * - `'tell-model'` — the model reads a refusal naming the service (never the
   *   URL) and may route around the block. The turn still cannot report a clean
   *   completion: `agent.run()` raises `CredentialConsentRequiredError`, which
   *   carries the URL to the caller.
   *
   * In BOTH modes the authorization URL stays out of the conversation, the
   * snapshot, the narrative, the typed event stream and any recording. It is a
   * bearer capability carrying a session-correlating `state` parameter; before
   * 8.6.0 it was interpolated into the tool result and copied into all of them.
   */
  readonly onAuthorizationRequired?: AuthorizationRequiredMode;
  /**
   * Global cache kill switch (v2.6+). `'off'` disables the cache
   * layer entirely — the CacheGate decider routes to `'no-markers'`
   * every iteration regardless of other rules. Default: caching
   * enabled (auto-resolved per provider via the strategy registry).
   *
   * Use `'off'` for low-frequency agents (cron jobs running once per
   * hour) where the cache TTL guarantees zero cache hits and the
   * cache-write penalty isn't worth paying.
   */
  readonly caching?: 'off';
  /**
   * Optional explicit CacheStrategy override (v2.6+). Defaults to
   * `getDefaultCacheStrategy(provider.name)` — so Anthropic/OpenAI/
   * Bedrock/Mock providers auto-resolve to their respective strategies
   * once those land in Phase 7+.
   */
  readonly cacheStrategy?: CacheStrategy;
  /**
   * Optional build-time recorders threaded into footprintjs's
   * `flowChart()` factory. Each recorder fires `onStageAdded` once per
   * node in the Agent's internal chart (Seed, CallLLM, Route, tool
   * handler, slot mounts, PrepareFinal, BreakFinal), and
   * `onSubflowMounted` once per mounted subflow. Recorders own their
   * own accumulators — agentfootprint just threads them through.
   *
   * Cascade: each slot subflow (system-prompt, messages, tools)
   * was built earlier with its OWN recorders (or none).
   * footprintjs does NOT propagate StructureRecorders into mounted
   * subflows — attach the same recorders to every nested composition
   * for full coverage.
   *
   * When omitted, no build-time observation is wired up.
   */
  readonly structureRecorders?: readonly StructureRecorder[];
  /**
   * Optional per-COMPOSITION translator (UI-agnostic). See
   * `core/translator.ts`. When attached, `agent.getUIGroup()` invokes
   * it with the Agent's `GroupMetadata` (kind `'Agent'`, id, name,
   * empty `members[]`, plus `extra.slots` and `extra.toolNames`).
   * Tools are not `Runner` instances (they're function executors)
   * so they're conveyed by name in `extra`, not as group members.
   * Returns `undefined` when omitted.
   */
  readonly groupTranslator?: GroupTranslator;
  /**
   * How the ReAct loop behaves — a single setting with three honest choices.
   * Default `'dynamic'`. (Merged in 6.0.0 from the old `reactMode` +
   * `reactStructure` pair, which had a silently-ignored combination.)
   *
   * `'dynamic'` (default) — every iteration re-runs the InjectionEngine and
   * all three slots (system-prompt ‖ messages ‖ tools), because which
   * injections are active can change per turn (a skill activates, a rule
   * fires, a tool-return triggers something). The right shape when the agent
   * uses skills, rule/on-tool-return triggers, or any per-turn context
   * steering. Flat chart shape.
   *
   * `'classic'` — textbook ReAct: context is engineered ONCE. The
   * InjectionEngine, system-prompt and tools run a single time up front; the
   * loop targets only the Messages slot, so each iteration just appends the
   * new tool result and re-calls the LLM. Use when the system prompt and tool
   * set are FIXED for the whole run (the common case). Flat chart shape — the
   * chart reads honestly: `ToolCalls → Messages` loops, static slots outside.
   * CAVEAT: because static slots are cached after turn 1, do NOT use `'classic'`
   * with skills or dynamic-trigger injections — a mid-run activation would not
   * surface into the cached system-prompt/tools. Use `'dynamic'` for those.
   *
   * `'dynamic-grouped'` — same semantics as `'dynamic'`, but the whole LLM turn
   * (injection engine + 3 slots + cache + call + thinking) is wrapped in a
   * single `sf-llm-call` SUBFLOW — the same boundary the `LLMCall` primitive
   * produces. Lens (and any explainable-ui consumer) renders it as an LLM group
   * with its slots inside, with zero bespoke collapsing. Behaviour is identical
   * to `'dynamic'`; only the chart's nesting differs. (Grouping is dynamic-only:
   * it re-seeds context every turn by design, so there is no classic-grouped.)
   */
  readonly reactMode?: 'classic' | 'dynamic' | 'dynamic-grouped';
  /**
   * Observer delivery tier (RFC-001 Block 10). Default `'inline'` —
   * byte-identical to every prior release: the Agent's bridge recorders
   * (and your `.watch()` attachments) run synchronously inside the
   * producing statement, so a slow `agent.on()` listener taxes every
   * stage of every iteration.
   *
   * `'deferred'` moves observation off the hot path: every observer event
   * is captured into footprintjs's bounded queue (≈ microseconds) and
   * delivered at the next microtask checkpoint — "one beat behind", with
   * listener work overlapping the LLM/tool await windows instead of
   * serializing with the loop. Same events, same payloads, same order;
   * only the timing meta (`wallClockMs` / `runOffsetMs`) reflects the
   * later delivery. Terminal boundaries (run resolve, reject, pause)
   * drain the queue synchronously BEFORE control returns, so crash
   * reports / checkpoints always carry the complete record.
   *
   * Exception kept inline for correctness: the causal-evidence harvest
   * recorder (mounted with CAUSAL memories) — the memory write stage
   * reads its accumulators MID-run, so it cannot run one beat behind.
   *
   * Per-recorder override: a consumer recorder that declares its own
   * `delivery` field keeps it — the agent-level option is the default
   * tier for recorders that don't declare one.
   *
   * For serverless / graceful shutdown, settle async listener work with
   * `await agent.drainObservers({ timeoutMs })` before the process exits.
   * Queue stats surface on `agent.getLastSnapshot()?.observerStats`.
   */
  readonly observerDelivery?: 'inline' | 'deferred';
  /**
   * Queue dials for `observerDelivery: 'deferred'` — see
   * `ObserverDeliveryOptions`. Throws at construction when set without
   * `observerDelivery: 'deferred'` (no silently-ignored combinations).
   */
  readonly observerDeliveryOptions?: ObserverDeliveryOptions;
}

/**
 * What `.configure(fn)` may change for one run. Both fields are
 * optional; returning `{}` (or nothing) means "use the built defaults",
 * which is exactly what an agent without `.configure()` does.
 *
 * Deliberately NOT the tools axis — `.toolProvider()` already owns that,
 * and it is consulted every iteration rather than once per run.
 */
export interface RunConfig {
  /** Model id for every LLM call in this run. */
  readonly model?: string;
  /** Replaces the base system prompt set by `.system(...)` for this run. */
  readonly instructions?: string;
}

/** What a `.configure(fn)` resolver is given. */
export interface RunConfigContext {
  /** The message this run was started with. */
  readonly message: string;
  /** The memory identity passed to `run({ identity })`, when there was one. */
  readonly identity?: MemoryIdentity;
  /** This run's id — the same one that stamps every typed event's `meta.runId`. */
  readonly runId: string;
  /** What the agent was BUILT with, so a resolver can decide relative to it. */
  readonly defaults: {
    readonly model: string;
    readonly instructions: string;
  };
}

/**
 * Per-run configuration resolver — see `AgentBuilder.configure`. Called
 * exactly once per run, synchronously, at the start of the run.
 */
export type RunConfigFn = (ctx: RunConfigContext) => RunConfig | undefined;

export interface AgentInput {
  readonly message: string;

  /**
   * WHO this run is for — the scoping tuple, not a session handle.
   *
   * Committed to `scope.runIdentity` at seed and read by five consumers:
   * memory + RAG namespacing (`.memory()` / `.rag()` isolate reads and
   * writes per tenant + principal + conversation), `PermissionChecker.check`,
   * the `.toolMiddleware()` / `.messageMiddleware()` chains,
   * `ToolProvider.list(ctx)`, and the credential provider.
   *
   * Since 9.7.0 it also reaches `tool.execute` as `ctx.identity` — but only
   * when you PASSED one. The default `{ conversationId: '<runId>' }` below is
   * synthesized, and a tool told about a conversation nobody named would key a
   * session on a fiction, so `ctx.identity` is absent in that case. A DERIVED
   * identity (the session rule below) is synthesized too, and is absent there
   * for the same reason.
   *
   * **When omitted, one of two defaults applies (9.10.0):**
   *
   *  - the run carries a `sessionId` (`agent.run(input, { sessionId })`, which
   *    is what `standingAgent` passes from every served request) →
   *    `{ conversationId: sessionId }`. A hosting session IS a conversation, so
   *    a served session gets durable per-user memory with no configuration at
   *    all. Before 9.10.0 it got the per-run default below and a fresh runId
   *    every turn, which meant a registered `.memory()` recalled nothing across
   *    the turns of one session.
   *  - no session either → `{ conversationId: '<runId>' }`, unchanged, so
   *    agents without memory and scripts that name nobody work exactly as they
   *    did.
   *
   * An identity you pass ALWAYS wins over the derivation — including the one a
   * continued conversation carries, so a turn cannot silently re-namespace the
   * conversation it is continuing.
   *
   * **`conversationId` is a namespace key, not a conversation.** Passing the
   * same `conversationId` to two `run()` calls does NOT continue the first
   * one: `run()` is one turn and seeds `history` from this call's message
   * alone. What continues a conversation is {@link AgentInput.continueFrom}
   * (or `agent.followUp(message)`); what makes prior turns *recallable* under
   * this key is a registered memory, and that recall arrives in the
   * system-prompt slot as a `<memory>` block rather than as message turns.
   */
  readonly identity?: MemoryIdentity;

  /**
   * The conversation this turn continues — an `AgentRunCheckpoint` from
   * `agent.checkpoint()`, persisted anywhere and handed back here.
   *
   * This is THE conversation door, and the reason it has to be asked for:
   * `run()` is **one turn**. Without `continueFrom` the run seeds its history
   * from this call's `message` alone, so a second `run()` on the same agent
   * starts a new conversation and the model will honestly say it has not
   * spoken to you before.
   *
   * The stored history is restored, this call's `message` is appended to it as
   * the next user turn, and the run proceeds. `identity` and the conversation's
   * folded spans ride along from the checkpoint unless this call overrides
   * them — a continued turn that silently re-namespaced its own memory would
   * write turn two somewhere turn one cannot be read from.
   *
   * `agent.followUp(message)` is the same thing for the common case, reading
   * the conversation off this agent's own last completed run.
   *
   * @example
   * ```ts
   * await agent.run({ message: 'Book me a table for two.' });
   * const conversation = agent.checkpoint();     // persist anywhere
   * // …a restart later, on a fresh Agent:
   * await agent.run({ message: 'Make it three.', continueFrom: conversation });
   * ```
   */
  readonly continueFrom?: AgentRunCheckpoint;
}

export type AgentOutput = string;

// ─── INTERNAL state (stage functions) ──────────────────────────────

/**
 * Internal scope state for the Agent's flowchart. Recorders never read
 * this directly — they read the InjectionRecord convention keys + emit
 * events. Each stage function under `./stages/` receives a TypedScope
 * over this shape and reads/writes via typed properties.
 *
 * Mutability conventions (followed by every Agent stage):
 *   • Per-iteration scalars (iteration, finalContent, llmLatestContent,
 *     etc.) are OVERWRITTEN each pass; commitLog preserves history.
 *   • Cumulative scalars (cumTokensInput, totalInputTokens, turnNumber)
 *     accumulate monotonically across the run.
 *   • Arrays from slot subflows (systemPromptInjections,
 *     messagesInjections, toolsInjections, dynamicToolSchemas,
 *     cacheMarkers) use `arrayMerge: ArrayMergeMode.Replace` semantics —
 *     each iteration's value REPLACES the prior iteration's, not
 *     appends.
 */
export interface AgentState {
  userMessage: string;
  history: readonly LLMMessage[];
  iteration: number;
  maxIterations: number;
  finalContent: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnStartMs: number;
  // Multi-tenant memory scope. Defaulted in seed when AgentInput.identity
  // is omitted, so non-memory agents work unchanged. Field is named
  // `runIdentity` (not `identity`) so it doesn't collide with the
  // readonly `identity` input arg in scope's typed-args view.
  runIdentity: MemoryIdentity;
  /**
   * Where `runIdentity` came from, when it came from somewhere other than the
   * caller (9.10.0).
   *
   * Present ONLY as `'session'`, and only when the run carried a
   * `sessionId` and no identity at all — the one derivation this library
   * makes. Absent means the identity is either the caller's own or the
   * per-run default, which is what every release before 9.10.0 committed, so
   * a run that is not session-bound writes exactly the keys it always did.
   *
   * It is a fact about the RECORD, not a dial: nothing reads it to decide
   * anything. It exists so a trace can be asked "did anyone actually name this
   * namespace?" and answer honestly.
   */
  runIdentitySource?: 'session';
  // Set during the final branch — the (user, assistant) pair the
  // memory write subflows persist for cross-run recall.
  newMessages: readonly LLMMessage[];
  // WHICH TURN of this conversation this run is (9.6.0) — an ordinal, not a
  // count, so gaps are legal and repeats are not. Memory writes KEY their
  // entries on it (`msg-{turn}-{index}`), which is why seed resolves it from
  // the conversation it was handed AND from the memory stores themselves
  // rather than seeding a constant 1 as every release through 9.5.1 did.
  turnNumber: number;
  // Token-budget signal used by memory pickByBudget deciders. Defaults
  // to a permissive cap; consumers tune via PricingTable hooks later.
  contextTokensRemaining: number;
  // Populated by slot subflow outputMappers:
  systemPromptInjections: readonly InjectionRecord[];
  messagesInjections: readonly InjectionRecord[];
  toolsInjections: readonly InjectionRecord[];
  // Latest LLM response state:
  llmLatestContent: string;
  llmLatestToolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    // Carried, never read here (9.29.0). The adapter that produced the call is
    // the only thing that understands this bag; the loop's job is to keep it
    // attached to its call all the way into the assistant turn, because for
    // Gemini it holds the thought signature the NEXT request must echo.
    readonly providerMeta?: Readonly<Record<string, unknown>>;
  }[];
  // Pause checkpoint — set when a tool calls `pauseHere()`, consumed on resume.
  pausedToolCallId: string;
  pausedToolName: string;
  pausedToolStartMs: number;
  /**
   * The args the paused tool was ACTUALLY RUNNING WITH — every before-tool
   * transform applied — carried across a `pauseHere()` / `askHuman()` pause
   * (8.13.0).
   *
   * Written for the same reason the three sibling pauses write
   * `pausedAskArgs` / `pausedCheckInArgs` / `pausedCredentialArgs`: on resume the
   * after-tool moment runs, and `ToolResultContext.args` promises the args the
   * tool ran with, not the ones the model proposed. Scope is the only carrier
   * across a checkpoint.
   *
   * Optional because a checkpoint written before 8.13.0 does not have it; the
   * resume path recovers those args from the assistant turn in `history` (see
   * `argsForPausedCall` in `stages/toolCalls.ts`).
   */
  pausedToolArgs?: Readonly<Record<string, unknown>>;
  // Check-in checkpoint — set when a tool's `checkIn` demand trips and the
  // run pauses BEFORE execute. `pausedCheckIn` discriminates a check-in pause
  // from a plain `askHuman` pause on resume; `pausedCheckInArgs` carries the
  // proposed args so an APPROVED tool can execute on resume. Both survive
  // structuredClone (checkpoint discipline). Absent for non-check-in pauses.
  pausedCheckIn?: boolean;
  pausedCheckInArgs?: Readonly<Record<string, unknown>>;
  // Which REGISTERED screen component the outstanding ask nominated to collect
  // its decision (9.24.0) — the `componentId` of the check-in's / middleware
  // ask's `AskComponent`, written at pause time ONLY when one exists and read
  // back on resume so the decision record can say which surface answered.
  // Never written for component-less asks (their checkpoints stay
  // byte-identical) and cleared on the resume that consumed it.
  pausedComponentId?: string;
  // Middleware-ask checkpoint — set when a `toolMiddleware` answers `ask` and
  // the run pauses BEFORE the tool executes. Same wire as the check-in pause,
  // discriminated the same way: `pausedAsk` tells resume which kind of question
  // is outstanding. `pausedAskArgs` carries the args AS TRANSFORMED SO FAR (the
  // human approved those, not the model's originals) and `pausedAskIndex` says
  // which link asked, so resume continues the chain from the NEXT one instead
  // of re-running decisions the checkpoint already recorded. All survive
  // structuredClone. Absent for every other pause.
  pausedAsk?: boolean;
  pausedAskArgs?: Readonly<Record<string, unknown>>;
  pausedAskIndex?: number;
  pausedAskMiddleware?: string;
  // Credential-consent checkpoint (8.6.0) — set when a tool's DECLARED
  // credential comes back `authorization-required` under the default
  // `onAuthorizationRequired: 'pause'`. Same wire as the check-in and ask
  // pauses, discriminated the same way. `pausedCredentialArgs` carries the
  // proposed args so the tool can run on resume; there is no
  // `pausedCredentialUrl`, deliberately — the URL rides `pauseData` to the
  // caller and is re-fetched from the provider on resume, so it never has to
  // live in tracked state (which is the commit log, and therefore the trace).
  pausedCredential?: boolean;
  pausedCredentialArgs?: Readonly<Record<string, unknown>>;
  pausedCredentialService?: string;
  // NOTE (8.6.0) — there is deliberately NO scope key for the `'tell-model'`
  // consent record. A tracked write is a commit-log entry, which is the
  // snapshot, the narrative and every recording; putting the consent URL there
  // would rebuild the exact leak this release removes. It travels instead on a
  // side channel (`ToolCallsHandlerDeps.reportConsentOutstanding`) to a private
  // field on the Agent, lives for the length of the run, and reaches the caller
  // only as `CredentialConsentRequiredError`.

  // ── The middleware ledger (`.toolMiddleware()` / `.messageMiddleware()`) ──
  /** One row per middleware decision, in the order they were decided —
   *  including the pass-throughs, because "the rule looked and was fine with
   *  it" and "the rule never ran" are different facts about a run. A transform
   *  files both the value it received and the value it produced, so a slice
   *  taken later can find the moment the text changed and who changed it.
   *  Written only by an agent that configured a chain; absent otherwise. */
  middlewareDecisions?: readonly MiddlewareDecision[];

  // ── The output-schema ledger (`.outputSchema(s, { retries })`) ──────────
  /** One row per final-answer attempt, in order: what was answered, whether
   *  it satisfied the schema, and — when it did not — the validator's own
   *  words and the correction that went back. Read it from
   *  `snapshot.sharedState` to see why a run took three turns to answer.
   *  Written only by an agent that opted into `retries`; absent otherwise. */
  outputAttempts?: readonly OutputAttempt[];
  /** In-flight hand-off from the Route decider (which judges the answer and
   *  picks the branch) to the retry stage (which writes the correction). Not
   *  a record — the record is `outputAttempts`. Always freshly written by the
   *  decider immediately before the retry branch runs, so it is never read
   *  stale. */
  outputSchemaFailure?: {
    readonly attempt: number;
    readonly stage: 'json-parse' | 'schema-validate';
    readonly error: string;
    readonly path?: string;
  };
  /**
   * The answer this run hands back does NOT satisfy the output contract (8.18.0).
   *
   * Written by the Route decider on the one occasion the schema was judged and
   * the answer failed with no re-ask left — including the `retries: 0` case,
   * where there was never a re-ask to spend. Absent on every run whose answer
   * passed, and on every agent with no `.outputSchema()`.
   *
   * Committed rather than returned for the reason `stoppedEarly` is: `run()`
   * returns a bare string and has nowhere to carry the fact, and the fact is
   * not an error the library gets to raise on its own — `runTyped()` raising is
   * the caller ASKING to be raised at. So it goes in the commit log, where it
   * is provable after the run. Read it with `agent.outputContractUnmet()`.
   */
  outputContractUnmet?: {
    /** Which half of validation failed. */
    readonly stage: 'json-parse' | 'schema-validate';
    /** The validator's own message, verbatim. DATA, not narrative. */
    readonly error: string;
    /** Failing field path when the parser exposes one (Zod-style issues). */
    readonly path?: string;
    /** Answers actually judged, first one included. `1` under `retries: 0`. */
    readonly attempts: number;
    /** Corrective re-asks the run paid for. `0` under `retries: 0`. */
    readonly retriesSpent: number;
    /** True when `.outputFallback()` is configured — in which case a tier
     *  exists that `run()` never reaches and `runTyped()` does. */
    readonly fallbackConfigured: boolean;
    /** Set when an `act({ output })` middleware's own rewrite broke an answer
     *  that HAD satisfied the schema — the name of that middleware. */
    readonly brokenBy?: string;
  };

  // ── The evidence gate (`.namesAndNumbersFromEvidence()`, 9.35.0) ────────
  /** In-flight hand-off from the Route decider (which finds the values and
   *  picks the branch) to the recheck stage (which writes the correction).
   *  Not a record — the per-check record rides the emit channel as
   *  `agentfootprint.agent.evidence_checked`, because a per-attempt fact
   *  belongs on that channel and not in a CommitBundle. Always freshly
   *  written by the decider immediately before the branch runs, so it is
   *  never read stale. Absent on an agent without the gate. */
  evidenceUnsupported?: {
    readonly values: readonly UnsupportedValue[];
    /** How many distinct values the answer had to ground, flagged included. */
    readonly candidates: number;
  };
  /** The one bounded revision has been spent this turn (9.35.0). Written by
   *  the EvidenceRecheck branch; reset at seed. Absent on an agent without
   *  the gate, and on one whose posture is `'assist'` (which never revises). */
  evidenceRevisionSpent?: boolean;

  // ── The out-of-budget wrap-up (`wrapUpAtMaxIterations`, 9.56.0) ─────────
  /**
   * The turn's action budget ran out and the ONE wrap-up call has been asked
   * for. Written by the WrapUp branch, read by two places and no others:
   *
   *   • `callLLM`, at request assembly — this is what withholds the tools, so
   *     the last call cannot ask for an action the budget already refused;
   *   • the Route decider, on the pass after — the latch that stops a second
   *     wrap-up and the signal to settle `stoppedEarly` against the answer
   *     that actually came back.
   *
   * **Deliberately NOT seeded.** The key is written only on the turn that runs
   * out, so an agent that finishes inside its budget commits exactly the keys
   * it always did — the whole feature is invisible in its commit log, its
   * snapshot and its recordings (`stepNudgeSpent`'s gate, taken one step
   * further because this behaviour is on by default rather than opted into).
   */
  wrapUpAsked?: boolean;
  /**
   * The answer this run hands back states values that appear in no tool
   * result (9.35.0).
   *
   * Written by the Route decider on the one occasion the check ran and the
   * answer still carried unsupported values with no revision left. Absent on
   * every clean answer and on every agent without the gate.
   *
   * Committed rather than returned for the reason `outputContractUnmet` is:
   * `run()` returns a bare string with nowhere to carry the fact, and under
   * `'assist'` / `'guard'` the library does not get to raise on its own. Under
   * `'rails'` it does, and this is what the boundary reads to do it. Read it
   * after the run with `agent.unsupportedValues()`.
   */
  unsupportedValues?: {
    /** The flagged values, normalized and truncated. */
    readonly values: readonly UnsupportedValue[];
    /** How many distinct values the answer had to ground in total. */
    readonly candidates: number;
    /** True when a revision was asked for and the values survived it. */
    readonly revised: boolean;
    /** True when the answer was WITHHELD (`posture: 'rails'`) rather than
     *  returned with a flag. */
    readonly refused: boolean;
    /** The posture in force, so a reader knows why the answer shipped. */
    readonly posture: 'assist' | 'guard' | 'rails';
  };
  /** Set by the seed / prepare-final stage when a `messageMiddleware` returned
   *  `deny`. Read at the API boundary, where it becomes a `MessageDeniedError`.
   *  Never carries the refused content — see MessageDeniedError. */
  messageDeniedReason?: string;
  messageDeniedPhase?: 'input' | 'output';
  messageDeniedBy?: string;
  // Cost accounting (only used when pricingTable is set).
  cumTokensInput: number;
  cumTokensOutput: number;
  cumEstimatedUsd: number;
  costBudgetHit: boolean;
  /** Resolved from `costBudget`. `'halt'` makes the Route decider stop the
   *  loop at the next boundary once `costBudgetHit` is set. */
  costBudgetOnExceed?: 'warn' | 'halt';
  /**
   * Why the loop stopped before the model said it was done (8.14.0).
   *
   * Written by the Route decider in the ONE case a limit cut the turn short:
   * the model asked for tools and the run refused to run them, because it had
   * reached `maxIterations` or crossed a halting `costBudget`. Absent on every
   * normal finish.
   *
   * It is committed state rather than a return value because
   * {@link AgentOutput} is a bare string with nowhere to carry it — the same
   * constraint that made 8.6.0 raise for an outstanding consent. Here a throw
   * would be wrong (a limit YOU set firing is the limit working, and the
   * answer is sometimes a real one), so the fact goes into the commit log,
   * where it is provable after the run instead of only observable during it.
   * Read it with `agent.stoppedEarly()`.
   */
  stoppedEarly?: {
    readonly reason: 'max-iterations' | 'cost-budget';
    /** The iteration the loop stopped on. */
    readonly iteration: number;
    /** How many tool calls the model asked for that will never run. */
    readonly pendingToolCalls: number;
    /** True when the answer handed back is `''` — the loudest form of this. */
    readonly answerWasEmpty: boolean;
    /**
     * Present only when the turn was WRAPPED UP (9.56.0): the run spent one
     * more call with the tools withheld, asking for a final summary, and that
     * summary is the answer the caller received.
     *
     * This is what separates *answered* from *answered after the budget ran
     * out*. Without it a consumer holding a `stoppedEarly` record cannot tell
     * whether the string beside it is a fragment the loop stopped in the
     * middle of or a deliberate wrap-up. Absent when the turn was cut short
     * (`wrapUpAtMaxIterations: false`, a halting `costBudget`, or an agent
     * with no tools to withhold).
     *
     * When it is set, `answerWasEmpty` describes the WRAP-UP's answer — the
     * one the caller actually received — not the fragment it replaced.
     */
    readonly wrappedUp?: true;
  };
  // Injection Engine state ─────────────────────────────────────
  /** Active set output by InjectionEngine subflow each iteration —
   *  POJO projections (no functions) suitable for scope round-trip. */
  activeInjections: readonly ActiveInjection[];
  /** IDs of LLM-activated Skills the LLM has activated this turn
   *  (via the `read_skill` tool). InjectionEngine matches by id. */
  activatedInjectionIds: readonly string[];
  /** Most recent tool result — the LAST entry of `toolResults`. Kept for
   *  every existing reader (context-bisect's proximate-tool key among them);
   *  batch-aware routing reads `toolResults`. */
  lastToolResult?: {
    toolName: string;
    result: string;
    /** The tool's own declared outcome (9.19.0) — envelope tools only. */
    status?: import('./toolEffects.js').ToolResultStatus;
  };
  // NOTE (9.26.0): the repeated-call nudge deliberately keeps NO key here. Its
  // counters are a within-turn tally, not conversation state, and tracked state
  // is the commit log, the snapshot, the narrative and every recording — a key
  // written on each tool landing would change all of them for every agent that
  // merely upgraded. They live run-keyed beside the dispatch loop instead
  // (`../repeatedCall.ts`), and the repeat itself lands on the record as
  // `agentfootprint.tools.repeated_call`.
  /** EVERY tool result of the current iteration's batch, in call order
   *  (9.16.0) — reset when tool dispatch starts, appended as each result
   *  lands (a pause mid-batch commits the partial batch; resume appends the
   *  answered call). Drives `on-tool-return` triggers and skill-graph routes
   *  so a parallel batch routes on all its calls, not only the last. */
  toolResults?: ReadonlyArray<{
    toolName: string;
    result: string;
    toolCallId: string;
    /** The tool's OWN declared outcome (9.19.0) — present only when the tool
     *  returned a result envelope carrying `status`. `onToolStatus` route
     *  edges key on it. */
    status?: import('./toolEffects.js').ToolResultStatus;
  }>;
  /** The `Deliver` stage's record for THIS iteration: which messages-slot
   *  injections entered the window, and which were held back with the
   *  sentence saying why. Overwritten per iteration (the commit log keeps
   *  the sequence). This is the committed answer to "why is my declaration
   *  not on the wire?" — read it from `snapshot.sharedState`. Absent for an
   *  agent that has no messages-slot delivery mounted. */
  messagesDelivery?: MessagesDelivery;
  /** The run's delivery ledger — every `deliveryKey` already let in, so an
   *  always-on injection is delivered ONCE rather than re-appended every
   *  iteration. Unioned with the markers found in the window itself, which
   *  is what keeps a replayed run (`resumeOnError` restores history into a
   *  fresh scope) from delivering the same message twice. */
  deliveredMessageKeys: readonly string[];
  /** Tool schemas resolved by the tools slot subflow each iteration
   *  (registry + injection-supplied). Used by callLLM. */
  dynamicToolSchemas: readonly LLMToolSchema[];
  // ── Cache layer state (v2.6) ────────────────────────────────
  /** Provider-agnostic cache markers emitted by CacheDecision subflow.
   *  Cleared each iteration by the SkipCaching branch when the
   *  CacheGate decides to skip (kill switch / hit-rate / churn). */
  cacheMarkers: readonly CacheMarker[];
  /** Global cache kill switch from `Agent.create({ caching: 'off' })`. */
  cachingDisabled: boolean;
  /** Running cache hit rate from recent iterations (0..1). Computed
   *  by cacheRecorder (Phase 9); `undefined` until first metrics. */
  recentHitRate: number | undefined;
  /** Rolling window of active-skill IDs across recent iterations.
   *  Maintained by the UpdateSkillHistory function stage; consumed
   *  by CacheGate's skill-churn rule. */
  skillHistory: readonly (string | undefined)[];
  /** The skill-graph CURSOR — which skill node a `skillGraph()` agent is
   *  currently *in*, persisted across ReAct iterations. Advanced each iteration
   *  by the Injection Engine (`currentSkillId = graph.nextSkill(ctx)`) and
   *  carried by the mount mappers; reset to `undefined` per turn at seed (each
   *  turn re-enters via the entry router). `from`-gates the route triggers.
   *  Undefined for agents without a skill graph. */
  currentSkillId?: string;
  /** The `read_skill` pick the skill-graph gate ACCEPTED on this iteration — the
   *  model's own move through the graph. Written by the tool-calls stage EVERY
   *  iteration it runs (cleared when no pick was accepted), so it is one-shot by
   *  construction and can never re-apply a stale pick. Read by the Injection
   *  Engine, where it moves the cursor unless a declared edge fired first.
   *  Undefined for agents without a skill graph (the gate is what validates it). */
  pendingSkillPick?: string;
  /** The ADVANCED skill-graph cursor, inside `sf-llm-call` (the grouped
   *  chart): the Injection Engine's outputMapper writes it here because the
   *  boundary's `currentSkillId` is a readonly input still holding the
   *  previous iteration's value. The tools slot and callLLM's `brainFor`
   *  consult read `nextSkillCursor ?? currentSkillId`. In the flat chart the
   *  engine's outputMapper maps it straight onto `currentSkillId`, so this
   *  key never exists there — the same expression is correct in both shapes. */
  nextSkillCursor?: string;
  /** The relevance ranking of entry candidates from an entry scorer (`.entryBy()` /
   *  `.entryByRelevance()`) — written by the PickEntry stage once per turn (the
   *  "Why this skill?" relevance %). `score` is the raw strategy score; `relevance`
   *  the softmax share. Absent unless the graph used an entry scorer. */
  entryScores?: ReadonlyArray<{
    readonly id: string;
    readonly score: number;
    readonly relevance: number;
  }>;
  /** Name of the entry scorer that produced `entryScores` (`'keyword'` /
   *  `'embedding'` / a custom scorer's name). */
  entryScorer?: string;
  /** The turn-start routing verdict (SG-C) — written once per turn by the
   *  RouteTurn stage on cascade graphs (`classify` / `continuity:
   *  'conversation'`), read by the cursor resolver (iteration 1), the
   *  `read_skill` menu envelope and the `'guard'` gate. Absent on every
   *  other agent — nothing writes it, so nothing changes. */
  turnRoute?: import('../../lib/injection-engine/routingPolicy.js').TurnRoute;
  /** WHERE the active skill's declared procedure stands (9.18.0) — strictly
   *  subordinate to the ONE cursor: it lives and dies inside one skill's
   *  tenure, is re-keyed on every cursor move (by the Evaluate stage, the
   *  same stage the cursor truth lives at) and never crosses runs. Advanced
   *  and skip-recorded by the tool-calls stage at the result boundary.
   *
   *  Carried as a 0-or-1-element ARRAY (`StepPointerCarrier`), never a bare
   *  object: footprintjs outputMappers shallow-merge bare objects field by
   *  field (nested arrays APPEND), while a top-level array under
   *  `arrayMerge: Replace` is set wholesale — the same reason
   *  `activeInjections` crosses boundaries as an array. `[]` = steps are
   *  declared somewhere but no procedure is active; ABSENT = no registered
   *  skill declares steps (nothing ever writes it — zero-cost-when-unused).
   *  Read it with `pointerOf()` from `agentfootprint/injection-engine`. */
  stepPointer?: import('../../lib/injection-engine/skillSteps.js').StepPointerCarrier;
  /** The one teaching nudge for a premature stop has been spent this turn
   *  (9.18.0). Written by the StepNudge branch; reset at seed. Absent on
   *  agents with no stepped skill. */
  stepNudgeSpent?: boolean;
  /** Gate refusals (`skill.rejected` — reachability OR posture) this turn
   *  (9.19.0). Counted by the tool-calls stage, reset at seed, present ONLY
   *  when an escalation brain is declared — the refusal budget that trips
   *  the flip. */
  skillRefusalsThisTurn?: number;
  /** The turn crossed its declared refusal threshold and the rest of it
   *  runs on the escalation brain (9.19.0). Written once per turn at the
   *  flip (a recorded fact — `skill.escalated` fires beside it); reset at
   *  seed (de-escalation). Absent without an escalation brain. */
  skillEscalated?: boolean;
  /** The `propose-transition` tool effect the gate ACCEPTED this iteration
   *  (9.19.0) — reachability-validated, first-accepted-wins across the
   *  batch, stamped with the granting iteration (one-shot by data: the
   *  Evaluate stage honors it exactly once, on the following iteration).
   *  Absent unless a tool proposed one on a skill-graph agent. */
  pendingToolTransition?: import('./toolEffects.js').PendingToolTransition;
  /** The granted `require-instruction` leases (9.19.0), in grant order.
   *  Appended by the tool-calls stage (which prunes spent ones as it
   *  writes); validity is computed per Evaluate pass, never mutated.
   *  Absent unless a tool granted one. */
  instructionLeases?: ReadonlyArray<import('./toolEffects.js').InstructionLease>;

  /**
   * The mount kernel's engagement state (9.58.0) — one record per mounted
   * map: engaged or parked, the evidence strength the standing rests on,
   * and the idle count. Written each pass by the injection engine's
   * Evaluate stage via the `nextMapEngagement` alias round trip; present
   * ONLY on agents built with `.maps()`, so every other agent commits the
   * exact key set it always did. A plain POJO — survives structuredClone,
   * so recordings carry the kernel's standing beside the cursor it never
   * touches.
   */
  /** The `read_skill` picks the gate accepted THIS pass (9.59.0) — cleared at
   *  the top of every dispatching iteration, exactly like `pendingSkillPick`.
   *  The mount kernel's renewal feed reads it; written only on agents built
   *  with `.maps()`. */
  acceptedSkillPicks?: readonly string[];
  mapEngagement?: import('../../maps/engagement/types.js').MapEngagement;

  /**
   * Every coverage statement the run's tools declared, in the order they
   * landed — `absent(…)`'s "here is where I looked" and `coverage(…)`'s
   * "here is what my verdict does not rule out".
   *
   * TRACKED state, unlike the repeated-call counters, and for the opposite
   * reason: a limit is a fact ABOUT THE ANSWER, not a fact about an attempt,
   * so it has to be in the record the answer is read beside — the commit log,
   * the snapshot, every recording. The zero-cost guarantee holds anyway
   * because the key is written only when a tool actually declares one: an
   * agent whose tools never return either shape commits exactly what it
   * always did.
   */
  coverageDeclared?: ReadonlyArray<import('./coverage/index.js').DeclaredCoverage>;
  /**
   * The typed readings this run's tools settled (9.61.0) — one row per
   * (entity, field, value) flattened out of each recognized semantic
   * envelope, in declaration order, never rewritten. The claim seam reads
   * it at answer time: the LAST row for a fact is the settled value, every
   * earlier one is quotable history.
   *
   * The `coverageDeclared` key one line up is the shape and the reason:
   * the envelope is replaced by its compact model projection on the wire,
   * so without a tracked key the typed object exists nowhere a check could
   * reach. Written only when a tool actually declares readings — an agent
   * whose tools return none commits exactly what it always did.
   */
  claimFacts?: ReadonlyArray<import('../../integrity/unsupported-claim/check.js').ClaimLedgerRow>;

  // ── Per-run configuration (`.configure()`) ─────────────────────
  /** The model `.configure()` resolved for THIS run, written by seed and read
   *  by CallLLM. Present only when a resolver returned one — a run that did
   *  not change its model records nothing here, so an agent without
   *  `.configure()` commits exactly what it always did. The point of writing
   *  it at all is that the trace must say which model actually answered:
   *  a run that switched models without recording it would be a trace that
   *  lies about its own most expensive fact. */
  resolvedModel?: string;
  /** The base system prompt `.configure()` resolved for THIS run, replacing
   *  `.system(...)`. Same rule: absent unless a resolver returned one. */
  resolvedInstructions?: string;

  // ── The window ledger (`.window()` / `.compaction()`) ──────────
  /** One record per visit to the window stage that ENGAGED — including the
   *  visits that removed nothing, which are the interesting ones. Written
   *  only by an agent built with `.window()` or `.compaction()`; absent
   *  otherwise, so an agent without one commits exactly the keys it always
   *  did.
   *
   *  This array is the strategy's half of the law: the window shrank, and the
   *  ledger says which stages' messages left it, how many, and what the last
   *  call actually measured. The messages themselves are untouched in the
   *  commit bundles that wrote them.
   *
   *  The key is `compactions` because that is what it shipped as in 7.16,
   *  when compaction was the family's only member. It is committed state —
   *  public surface for anyone reading a run — so it keeps its name rather
   *  than break every reader for a better word. Narrow a record by its
   *  `strategy` field, not by the key it lives under. */
  compactions?: readonly WindowRecord[];
  /** The DURABLE half of the same law: one span per fold, carrying what the
   *  summary stands for and — under `retain: 'conversation'`, the default —
   *  the folded messages themselves.
   *
   *  `compactions` is a record of what a RUN did and dies with the run's
   *  commit log. This is what a CONVERSATION carries: `agent.checkpoint()`
   *  copies it onto `AgentRunCheckpoint.folded`, `resumeOnError` restores it,
   *  and so a standing agent's spans accumulate across every turn, every
   *  restart and every deploy.
   *
   *  Written only when a strategy actually replaced messages with something
   *  that stands for them (today: `summarizeOldest`). Absent otherwise, so an
   *  agent that never folds commits exactly the keys it always did. */
  foldedSpans?: readonly FoldedSpan[];

  // ── Policy halt state (v2.12) ───────────────────────────────
  /** Set when a `PermissionChecker` returns `{ result: 'halt', ... }`.
   *  `Agent.run()` reads these at the API boundary and throws a typed
   *  `PolicyHaltError` carrying the same context — the chart $break's
   *  graceful termination becomes a runtime signal callers can catch
   *  with `instanceof PolicyHaltError`. Telemetry tag from the rule. */
  policyHaltReason?: string;
  /** Content delivered to the LLM as the synthetic tool_result before
   *  termination — also surfaces on `PolicyHaltError.tellLLM` for
   *  audit / replay. */
  policyHaltTellLLM?: string;
  /** The proposed tool call that triggered the halt (NOT executed). */
  policyHaltTarget?: string;
  policyHaltArgs?: Readonly<Record<string, unknown>>;
  /** ReAct iteration the halt fired on. */
  policyHaltIteration?: number;
  /** Identifier of the PermissionChecker that returned `'halt'`. */
  policyHaltCheckerId?: string;

  // ── Thinking state (v2.14) ─────────────────────────────────
  /** Provider-specific raw thinking data, set by callLLM after the
   *  LLM response lands. The NormalizeThinking sub-subflow reads this
   *  and feeds it to the configured `ThinkingHandler.normalize()`.
   *  Undefined when the provider has no thinking content for this call. */
  rawThinking?: unknown;
  /** Normalized thinking blocks from the most recent LLM response.
   *  Written by the NormalizeThinking sub-subflow; read by toolCalls.ts
   *  + prepareFinal.ts when constructing the assistant message for
   *  `scope.history` (ensures Anthropic signature round-trip). Empty
   *  array when no thinking present. */
  thinkingBlocks: readonly ThinkingBlock[];

  // ── Reliability fail-fast state (v2.11.5) ──────────────────
  /** Set when the rules-based reliability loop takes the fail-fast path.
   *  `Agent.run()` reads these from the post-run snapshot and throws a
   *  typed `ReliabilityFailFastError`. Mirrors `policyHalt*` — because the
   *  loop stops the chart with `$break` (not a throw), durable scope is the
   *  only courier of the structured fail context across the break to the
   *  API boundary. (Telemetry ALSO fires via the `reliability.fail_fast`
   *  emit event; these scope fields are the business-logic control signal.) */
  reliabilityFailKind?: string;
  reliabilityFailPayload?: ReliabilityScope['failPayload'];
  reliabilityFailReason?: string;
  /** Originating error message/name — stringified because Error objects
   *  don't survive footprintjs's `structuredClone` of scope. */
  reliabilityFailCauseMessage?: string;
  reliabilityFailCauseName?: string;
}
