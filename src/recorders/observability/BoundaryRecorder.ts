/**
 * BoundaryRecorder — unified domain event log for an agentfootprint run.
 *
 * The single source of truth Lens (and any other consumer) reads to
 * render a run. Every observable moment in a run is captured as one
 * `DomainEvent` in a single ordered stream:
 *
 *   - `run.entry` / `run.exit`              — top-level executor.run()
 *   - `subflow.entry` / `subflow.exit`      — every subflow boundary
 *   - `fork.branch`                         — one per parallel child
 *   - `decision.branch`                     — chosen branch of a Conditional
 *   - `loop.iteration`                      — one per back-edge traversal
 *   - `llm.start` / `llm.end`               — LLM provider call lifecycle
 *   - `tool.start` / `tool.end`             — tool execution lifecycle
 *   - `context.injected`                    — anything injected into a slot
 *
 * All events carry `runtimeStageId` (binds with footprintjs Trace view +
 * with each other), `subflowPath`, `depth`, and `ts` (wall-clock ms).
 * Subflow events are domain-tagged (`slotKind` / `primitiveKind` /
 * `isAgentInternal`) so consumers dispatch on tag without re-parsing.
 *
 * Architecture:
 *
 *   ┌──── footprintjs (domain-agnostic) ────┐
 *   │  FlowRecorder events (run/subflow/    │  ──┐
 *   │  fork/decision/loop)                  │    │
 *   └───────────────────────────────────────┘    │
 *                                                │
 *   ┌──── agentfootprint dispatcher ─────────┐   │  consumed by
 *   │  Typed events (llm/tool/context)       │  ──┤
 *   └────────────────────────────────────────┘   │
 *                                                ▼
 *                                  ┌─── BoundaryRecorder ───┐
 *                                  │  one tagged stream of  │
 *                                  │  DomainEvent           │
 *                                  └────────────────────────┘
 *                                                │
 *                                                ▼  consumed by
 *                                  ┌────── Lens (UI) ──────┐
 *                                  │  Slider / RunFlow /   │
 *                                  │  NodeDetail / etc.    │
 *                                  └───────────────────────┘
 *
 * Why ONE recorder: Lens scrub axis, run-flow graph, slot rows inside
 * the LLM card, right-pane detail panel, commentary panel — every UI
 * surface reads from the SAME stream. Adding a new domain event = one
 * tagged emit + one render shape. No state machines spread across
 * renderers, no merging of multiple sources, no name-based filter lists.
 *
 * Naming: `runtimeStageId` is footprintjs's primitive (path-prefixed +
 * `#executionIndex`). `subflowPath` is rooted under the synthetic
 * `'__root__'`. `slotKind` / `primitiveKind` are agent-domain. The
 * design follows the React Fiber + OpenTelemetry pattern:
 * **producers self-describe; consumers dispatch on type**.
 *
 * WIRING — THREE PARTS, ALL AT RECORD TIME
 * ────────────────────────────────────────
 * This recorder hears half a run per connection, and the half it misses
 * cannot be reconstructed afterwards. All three go on BEFORE `run()`:
 *
 *   1. `runner.attach(boundary)` — the footprintjs control-flow channel:
 *      run / subflow entry and exit, forks, decisions, loops. Without it
 *      there are no boundaries at all.
 *   2. `boundary.subscribe(runner)` — the agentfootprint typed stream:
 *      `llm.*`, `tool.*`, `context.injected`. Without it the boundaries
 *      have no content: no model calls, no tool calls, no injections.
 *   3. `{ getCommitCount }` — where each boundary sits on the commit
 *      axis. Without it every event is stamped `commitIdxBefore: 0` and
 *      the step strip cannot be rebuilt from the recording later. This
 *      one fails SILENTLY — the events all look fine.
 *
 * There is no after-the-fact fix for any of the three: a completed run
 * leaves a snapshot and a commit log, and neither says where a boundary
 * opened relative to the commits. `recordRun(runner)` does all three and
 * hands back `{ snapshot, events, structure }` — reach for it first, and
 * wire by hand only when you need a shape it doesn't produce.
 *
 * @example
 * ```typescript
 * import { boundaryRecorder, EventDispatcher } from 'agentfootprint';
 *
 * const boundary = boundaryRecorder({
 *   getCommitCount: () => executor.getCommitCount(),  // the commit axis
 * });
 * const dispatcher = new EventDispatcher();
 * executor.attachCombinedRecorder(boundary);   // wires FlowRecorder side
 * boundary.subscribe(dispatcher);              // wires typed-event side
 *
 * await executor.run({ input });
 *
 * for (const e of boundary.getEvents()) {
 *   switch (e.type) {
 *     case 'run.entry':       renderRoot(e); break;
 *     case 'subflow.entry':   if (e.slotKind) renderSlotRow(e);
 *                              else if (e.primitiveKind) renderPrimitive(e);
 *                              break;
 *     case 'llm.start':       renderLLMCall(e); break;
 *     // ...
 *   }
 * }
 * ```
 */

import {
  ROOT_RUNTIME_STAGE_ID,
  ROOT_SUBFLOW_ID,
  SequenceStore,
  CommitRangeIndex,
  type RangeToken,
} from 'footprintjs/trace';
import type {
  CombinedRecorder,
  FlowDecisionEvent,
  FlowForkEvent,
  FlowLoopEvent,
  FlowSubflowEvent,
  TraversalContext,
} from 'footprintjs';
// `FlowRunEvent` isn't re-exported from footprintjs's main barrel in
// 4.16.0. Local structural copy matches the public shape exactly —
// `{ payload?: unknown; traversalContext?: TraversalContext }`.
// Add this to footprintjs/index re-exports next minor; remove this
// shim then.
interface FlowRunEvent {
  readonly payload?: unknown;
  readonly traversalContext?: TraversalContext;
}
// Structural shim for footprintjs's FlowRunFailedEvent (the terminal
// run-boundary event on a thrown run). Only `.message` is needed here.
interface FlowRunFailedEvent {
  readonly structuredError: { readonly message: string };
  readonly traversalContext?: TraversalContext;
}
import type { AgentfootprintEvent } from '../../events/registry.js';
import type { Unsubscribe } from '../../events/dispatcher.js';
import { SUBFLOW_IDS, STAGE_IDS, slotFromSubflowId } from '../../conventions.js';
import type { ContextSlot } from '../../events/types.js';
import { createRunIdObserver, type RunIdObserver } from './observeRunId.js';
import { summarizeEmbeddings } from './embeddingSummary.js';

// ─── DomainEvent: discriminated union ────────────────────────────────

/** Fields every domain event carries. */
interface DomainEventBase {
  /** Stable per-execution key (footprintjs primitive). For run events it
   *  is `'__root__#0'`; subflow events use the parent stage's runtimeStageId
   *  at mount; typed events use the firing stage's runtimeStageId. */
  readonly runtimeStageId: string;
  /** Decomposition of `subflowId` into segments, rooted under `'__root__'`. */
  readonly subflowPath: readonly string[];
  /** Depth in the run tree — root = 0, top-level subflow = 1, etc. */
  readonly depth: number;
  /** Wall-clock ms at capture time. */
  readonly ts: number;
  /** Commit count when this event fired. 0 if the recorder was
   *  constructed without `getCommitCount` (legacy mode). The boundary
   *  RANGE for an (entry, exit) pair is `[entry.commitIdxBefore,
   *  exit.commitIdxBefore]`. Phase 5 Layer 2 — see
   *  `docs/design/boundary-commit-ranges.md`. */
  readonly commitIdxBefore: number;
  /** RESERVED for future event types that trigger engine writes.
   *  CURRENT BEHAVIOR: always equals `commitIdxBefore` for every event
   *  emitted by today's BoundaryRecorder. Observer events don't write
   *  to scope, so the executor's commit count doesn't change between
   *  the moment the event is sampled and the moment it's recorded.
   *  Consumers should currently treat this as identical to
   *  `commitIdxBefore`; do NOT rely on it being strictly greater.
   *  The field exists for forward compatibility — if a future
   *  observer pattern triggers commits during its handler, this is
   *  where the post-effect count will land. */
  readonly commitIdxAfter: number;
}

export interface DomainRunEvent extends DomainEventBase {
  readonly type: 'run.entry' | 'run.exit';
  readonly payload?: unknown;
  /** Always `true` for run events — convenience flag for filter callers. */
  readonly isRoot: true;
}

export interface DomainSubflowEvent extends DomainEventBase {
  readonly type: 'subflow.entry' | 'subflow.exit';
  /** Path-prefixed engine id (matches `FlowSubflowEvent.subflowId`). */
  readonly subflowId: string;
  /** Last segment of `subflowId` — convenience for leaf-name grouping. */
  readonly localSubflowId: string;
  readonly subflowName: string;
  /** Build-time description from the subflow root (`'<Kind>: <detail>'`). */
  readonly description?: string;
  /** Parsed `'<Kind>:'` prefix — `'Agent'`, `'LLMCall'`, `'Sequence'`, etc. */
  readonly primitiveKind?: string;
  /** Set ONLY for the 3 input-slot subflows (sf-system-prompt / sf-messages / sf-tools). */
  readonly slotKind?: ContextSlot;
  /** True for Agent state-machine routing/wrapper subflows (route, tool-calls, final, merge). */
  readonly isAgentInternal: boolean;
  /** `inputMapper` result on entry; subflow shared state on exit. */
  readonly payload?: unknown;
}

export interface DomainForkBranchEvent extends DomainEventBase {
  readonly type: 'fork.branch';
  readonly parentSubflowId: string;
  readonly childName: string;
}

export interface DomainDecisionBranchEvent extends DomainEventBase {
  readonly type: 'decision.branch';
  readonly decider: string;
  readonly chosen: string;
  readonly rationale?: string;
  /**
   * `true` when this decision comes from one of the Agent's internal
   * routing stages (e.g., the ReAct `Route` decider that picks
   * `tool-calls` vs `final`). Filtered out of the timeline by
   * `buildStepGraph` — the actor arrows that follow already encode
   * the routing observably (`llm→tool` vs `llm→user`).
   *
   * `false` when the decision comes from a consumer-defined
   * `Conditional` primitive — those ARE meaningful timeline steps.
   */
  readonly isAgentInternal: boolean;
}

export interface DomainLoopIterationEvent extends DomainEventBase {
  readonly type: 'loop.iteration';
  readonly target: string;
  readonly iteration: number;
}

/**
 * Composition boundary event — fired for every composition primitive
 * (Parallel / Sequence / Loop / Conditional). Mirrors `subflow.entry/exit`
 * but for the COMPOSITION wrapper itself (the box that contains the
 * branches / steps / iterations / chosen-branch).
 *
 * This pair OPENS and CLOSES a boundary range in `boundaryIndex`. Child
 * subflows that fire between the pair nest naturally inside the
 * composition's range.
 *
 * The `runtimeStageId` is the composition's own per-execution id —
 * SAME format as any other runtimeStageId, with `#executionIndex`. The
 * `kind` discriminates which composition primitive this is.
 *
 * For the Lens compound time axis, this group is what collapses
 * parallel branches into ONE slider position at the parent's drill
 * level. Drill into the composition to see its children as positions.
 */
export interface DomainCompositionEvent extends DomainEventBase {
  readonly type: 'composition.start' | 'composition.end';
  readonly kind: 'Parallel' | 'Sequence' | 'Loop' | 'Conditional';
  readonly compositionId: string;
  readonly name: string;
  /** On `composition.end`, the exit status reported by the composition. */
  readonly status?: 'ok' | 'err' | 'break' | 'budget_exhausted';
  readonly durationMs?: number;
}

/**
 * The 4 actor arrows of a ReAct cycle. Tagged on `llm.start` / `llm.end`
 * at capture time so consumers (slider, run-flow renderer) dispatch by
 * `event.actorArrow` instead of running their own state machine.
 *
 *   - `'user→llm'` — first LLM call, or any LLM call NOT preceded by a
 *     tool result (assembled-context delivery to the model).
 *   - `'tool→llm'` — LLM call that follows a tool's result (the next
 *     iteration of a ReAct loop).
 *   - `'llm→tool'` — `llm.end` whose `toolCallCount > 0` (the LLM is
 *     requesting tool execution).
 *   - `'llm→user'` — `llm.end` with `toolCallCount === 0` (terminal
 *     response delivered to the user).
 */
export type ActorArrow = 'user→llm' | 'tool→llm' | 'llm→tool' | 'llm→user';

export interface DomainLLMStartEvent extends DomainEventBase {
  readonly type: 'llm.start';
  readonly model: string;
  readonly provider: string;
  readonly systemPromptChars?: number;
  readonly messagesCount?: number;
  readonly toolsCount?: number;
  /** Capture-time classification: `'user→llm'` for the first call or any
   *  call not preceded by a tool result; `'tool→llm'` after a tool result. */
  readonly actorArrow: 'user→llm' | 'tool→llm';
}

export interface DomainLLMEndEvent extends DomainEventBase {
  readonly type: 'llm.end';
  readonly content: string;
  readonly toolCallCount: number;
  readonly usage: { readonly input: number; readonly output: number };
  readonly stopReason?: string;
  /** Capture-time classification: `'llm→tool'` when the LLM requested
   *  tools (`toolCallCount > 0`); `'llm→user'` for terminal delivery. */
  readonly actorArrow: 'llm→tool' | 'llm→user';
}

export interface DomainToolStartEvent extends DomainEventBase {
  readonly type: 'tool.start';
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args?: unknown;
}

export interface DomainToolEndEvent extends DomainEventBase {
  readonly type: 'tool.end';
  readonly toolCallId: string;
  readonly result?: unknown;
  readonly durationMs?: number;
  readonly error?: boolean;
}

export interface DomainContextInjectedEvent extends DomainEventBase {
  readonly type: 'context.injected';
  readonly slot: ContextSlot;
  readonly source: string;
  readonly sourceId?: string;
  readonly asRole?: 'system' | 'user' | 'assistant' | 'tool';
  readonly contentSummary?: string;
  readonly reason?: string;
  readonly sectionTag?: string;
  readonly upstreamRef?: string;
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  /** Tokens consumed by this injection (from `budgetSpent.tokens`). */
  readonly budgetTokens?: number;
  /** Fraction of slot cap consumed (from `budgetSpent.fractionOfCap`). */
  readonly budgetFraction?: number;
}

/** Discriminated union covering every observable moment in a run. */
export type DomainEvent =
  | DomainRunEvent
  | DomainSubflowEvent
  | DomainCompositionEvent
  | DomainForkBranchEvent
  | DomainDecisionBranchEvent
  | DomainLoopIterationEvent
  | DomainLLMStartEvent
  | DomainLLMEndEvent
  | DomainToolStartEvent
  | DomainToolEndEvent
  | DomainContextInjectedEvent;

// ─── Lean projection ─────────────────────────────────────────────────

/**
 * The `DomainEvent` fields that carry captured run CONTENT — what the
 * agent read, produced, and handed across a boundary — as opposed to
 * run STRUCTURE (where a boundary was, when, of what kind). These are
 * the fields `snapshot: 'lean'` drops.
 *
 * They are also exactly the fields `buildStepGraphFromEvents` turns
 * into StepNode content (`entryPayload` / `exitPayload` /
 * `contentSummary` / `assistantText` / `toolArgs` / `toolResult`) —
 * which is why dropping them is opt-in rather than the default.
 *
 * When you add a field to a `Domain*Event`, decide:
 *   - Does it hold data the agent handled (unbounded, redaction-
 *     relevant)?                                        → add it HERE
 *   - Does it say where/when/what-kind the boundary was? → leave it out
 *
 * Forgetting to add one means a lean snapshot still ships that content
 * — silently, since nothing else references the field.
 *
 * Two free-text fields deliberately stay OUT of this set: `rationale`
 * on `decision.branch` and `reason` on `context.injected`. They are
 * short capture-time annotations saying WHY a boundary happened, and a
 * lean bundle loses most of its explanatory value without them — but a
 * decider that interpolates run values into its rationale does put that
 * text in a lean artifact. Lean means "no captured payloads", not "no
 * free text at all"; say so wherever lean is offered as a redaction
 * story.
 */
const CONTENT_FIELDS = ['payload', 'args', 'result', 'content', 'contentSummary'] as const;

type ContentField = (typeof CONTENT_FIELDS)[number];

const CONTENT_FIELD_SET: ReadonlySet<string> = new Set<string>(CONTENT_FIELDS);

/**
 * A `DomainEvent` with its content fields removed — the shape
 * `toSnapshot()` emits under `snapshot: 'lean'`.
 *
 * Distributive by construction (`T extends unknown ? … : never`) so the
 * union survives the `Omit` and `type` still narrows for consumers.
 */
type StripContent<T> = T extends unknown ? Omit<T, ContentField> : never;
export type LeanDomainEvent = StripContent<DomainEvent>;

// ─── BoundaryAggregate — per-boundary rollup ────────────────────────

/**
 * Per-boundary rollup returned by
 * `BoundaryRecorder.aggregateForBoundary` and
 * `BoundaryRecorder.aggregateAllBoundaries`. Same shape regardless of
 * primitive kind — UIs render the same chip set for every Agent /
 * LLMCall / Sequence / Parallel / Conditional / Loop.
 *
 * Events count toward this rollup when their `subflowPath` is a
 * prefix-match of the boundary's `subflowPath`. Nested boundaries
 * (e.g., LLMCall inside an Agent) contribute to BOTH rollups.
 *
 * In-flight boundaries (no `subflow.exit` yet) get partial values;
 * `endedAtMs` and `durationMs` are undefined until close.
 */
export interface BoundaryAggregate {
  readonly runtimeStageId: string;
  readonly subflowId: string;
  readonly subflowPath: readonly string[];
  /** `'Agent'` / `'LLMCall'` / `'Sequence'` / `'Parallel'` /
   *  `'Conditional'` / `'Loop'`. Always set on rollups returned by
   *  `aggregateAllBoundaries` (which filters to primitive boundaries).
   *  Optional on `aggregateForBoundary` results because the caller may
   *  request rollup for a non-primitive subflow (rare). */
  readonly primitiveKind?: string;
  /** Subflow display name (e.g., 'Triage', 'Billing'). */
  readonly label: string;
  /** Token usage summed across every `llm.end` inside this boundary. */
  readonly tokens: { readonly input: number; readonly output: number };
  /** Count of `llm.start` events inside this boundary. */
  readonly llmCalls: number;
  /** Count of `tool.start` events inside this boundary. */
  readonly toolCalls: number;
  /** Count of `agent.iteration_start` events scoped to this boundary —
   *  ReAct-loop iterations. Always `0` for non-Agent primitives. */
  readonly iterations: number;
  /** Wall-clock ms of `subflow.entry`. */
  readonly startedAtMs: number;
  /** Wall-clock ms of `subflow.exit`. Undefined while in flight. */
  readonly endedAtMs?: number;
  /** `endedAtMs - startedAtMs`. Undefined while in flight. */
  readonly durationMs?: number;
}

/** Closed set of routing/wrapper subflow IDs that are pure plumbing.
 *  Slot subflows (`sf-system-prompt` / `sf-messages` / `sf-tools`) are
 *  NOT in this set — they're real context-engineering moments.
 *
 *  When you add a new subflow to the Agent's internal flowchart, decide:
 *    - Is it a context-engineering moment the user should see?  → leave OUT
 *    - Is it pure routing / dispatch / cache plumbing?           → add HERE
 *
 *  Forgetting to add it leaks every iteration of that subflow into the
 *  StepGraph as a fake "step" the user has to scrub past. */
const AGENT_INTERNAL_LOCAL_IDS: ReadonlySet<string> = new Set<string>([
  // Subflow ids (`sf-*`)
  SUBFLOW_IDS.INJECTION_ENGINE, // collects activeInjections; pure plumbing
  SUBFLOW_IDS.LLM_CALL, // LLMCall's inner invocation wrapper — the meaningful step is the call-llm stage INSIDE; the wrapper itself is a chart-shape container
  SUBFLOW_IDS.ROUTE,
  SUBFLOW_IDS.TOOL_CALLS,
  SUBFLOW_IDS.FINAL,
  SUBFLOW_IDS.MERGE,
  SUBFLOW_IDS.CACHE, // v2.14 — per-turn cache decision wrapper; pure plumbing
  SUBFLOW_IDS.CACHE_DECISION, // v2.6 — emits cacheMarkers; not a user step
  SUBFLOW_IDS.THINKING, // v2.14 — normalize result lands on parent LLM step
  // Decider stage ids (the same set is used to filter `decision.branch`
  // events whose deciding stage is plumbing rather than user-facing).
  STAGE_IDS.CACHE_GATE, // v2.6 — apply-markers / no-markers routing; plumbing
  // LLMCall outer wrapper stage + post-invocation marker — pure chart
  // shape, not user-meaningful steps.
  STAGE_IDS.CLIENT,
  STAGE_IDS.EXTRACT_FINAL,
] as readonly string[]);
// Constructed as a set on a separate line so we can extend with the
// thinking-handler inner-subflow ids below without the literal set
// initializer needing every value at compile time.
const _AGENT_INTERNAL_PREFIXES = ['thinking-'] as const;
/**
 * True when a local stage/subflow id should be hidden from the user-
 * facing StepGraph. Either an exact match against `AGENT_INTERNAL_LOCAL_IDS`
 * OR a prefix match against `_AGENT_INTERNAL_PREFIXES`.
 *
 * The prefix path catches the inner subflow that
 * `buildThinkingSubflow` creates with stageId `thinking-{handlerId}`
 * (e.g. `thinking-anthropic`, `thinking-openai`) — its results are
 * already folded into the wrapping LLMCall step's payload, so the
 * inner subflow is pure plumbing too.
 */
function isAgentInternalId(localId: string): boolean {
  if (AGENT_INTERNAL_LOCAL_IDS.has(localId)) return true;
  for (const p of _AGENT_INTERNAL_PREFIXES) {
    if (localId.startsWith(p)) return true;
  }
  return false;
}

/**
 * Anything that can hand out every typed event as it fires — the one
 * capability `BoundaryRecorder.subscribe()` needs.
 *
 * A `Runner` satisfies this (`runner.on('*', …)`) and so does the
 * internal `EventDispatcher`, which is the point: wiring the recorder's
 * typed half never requires reaching past the public runner for a
 * dispatcher it doesn't hand out.
 */
export interface TypedEventSource {
  on(type: '*', listener: (event: AgentfootprintEvent) => void): Unsubscribe;
}

export interface BoundaryRecorderOptions {
  readonly id?: string;
  /**
   * Live commit-count accessor — `() => runner.getCommitCount()` on an
   * agentfootprint runner, or `() => executor.getCommitCount()` on a raw
   * footprintjs executor (5.1+). When provided:
   *   - Every DomainEvent gains `commitIdxBefore` / `commitIdxAfter`.
   *   - `recorder.boundaryIndex` is populated with open/close ranges
   *     keyed on each subflow's entry event.
   *
   * **Omitting it produces a recording whose step strip cannot be
   * rebuilt.** Every event is stamped `commitIdxBefore: 0`, so every
   * boundary claims to have opened at the same instant; `boundaryIndex`
   * is deliberately left EMPTY rather than filled with zero-width
   * `[0, 0]` ranges that would read as real. Offline, a consumer
   * replaying this bundle sees no positions to place, so the strip stays
   * quiet — the honest outcome, and an unrecoverable one: the commit log
   * records what each stage WROTE, never when a boundary was crossed
   * relative to it, so nothing downstream can derive the axis after the
   * fact. There is no error and the events otherwise look complete,
   * which is exactly why this is called out here.
   *
   * Sample it live — a closure over the runner, not a captured number.
   * The count is meaningless before the run starts and must be read at
   * the moment each boundary fires. Phase 5 Layer 2.
   */
  readonly getCommitCount?: () => number;
  /**
   * How much of each event `toSnapshot()` carries into
   * `runtimeSnapshot.recorders`.
   *
   *   - `'full'` (default) — every field, content included. Required by
   *     `buildStepGraphFromEvents()`: an offline `<Replay>` restores its
   *     entry/exit payloads, assistant text, tool args and tool results
   *     from this bundle and nowhere else.
   *   - `'lean'` — boundary STRUCTURE only. Drops the five content
   *     fields (`payload`, `args`, `result`, `content`,
   *     `contentSummary`); keeps every field that says WHERE, WHEN and
   *     OF WHAT KIND each boundary was, so the commit-range index
   *     rebuilds range for range offline. Sized on one demo turn (4
   *     ReAct iterations, 4 LLM calls, 3 tool calls, run end to end on
   *     a mock provider): the bundle this method returned was 69.7 KB
   *     raw / 4.6 KB gzipped, its lean projection 21.7 KB / 1.9 KB —
   *     content was 69% of the raw bytes, and a consumer rebuilding
   *     only the index reads none of it. Same run measured twice; that
   *     turn's content was the entry/exit payloads, since only the
   *     boundary side of this recorder was attached — a run that also
   *     `subscribe()`s the typed-event side carries tool args, tool
   *     results and assistant text in there too. (The replay fixture
   *     the suite measures reports a much larger full bundle — it
   *     stands in for each subflow's missing entry seed with that
   *     subflow's final state, so it serializes the state twice per
   *     boundary. Don't quote it.)
   *
   * Same reasoning as `BoundaryRangeLabel`: a stored artifact shouldn't
   * become a second, redaction-bypassing copy of everything the agent
   * read and wrote. Consumers that DO want content join back on
   * `runtimeStageId` against the run's own snapshot.
   *
   * `'full'` stays the default because this bundle has carried content
   * since it shipped (v2.x, 2026-04-27) and offline consumers depend on
   * that silently — a lean default would quietly empty their replays.
   */
  readonly snapshot?: 'full' | 'lean';
  /**
   * Keep raw embedding vectors in captured payloads (8.20.0). Default
   * `false`: every `embedding` / `embeddings` field in a boundary payload is
   * replaced with its `{ dims, norm }` summary at capture time.
   *
   * The default exists because of a field measurement: the memory-read
   * subflow's boundary output carries each retrieved entry's full vector,
   * and one retrieval turn's recording weighed 2.76 MB — ~1.1 MB of it
   * embedding floats no consumer of a recording reads. The retrieval
   * evidence a debugger needs (score, passage, document, rejected
   * candidates) does not live in those floats and is untouched.
   *
   * Set `true` only when a consumer genuinely replays vectors (say, to
   * re-rank offline) — the recording grows by the full vector bytes again.
   */
  readonly recordEmbeddings?: boolean;
}

/**
 * Stripped projection used as the LABEL for the commit-range index.
 * Intentionally OMITS `payload` (security panel review YELLOW #1):
 * `boundaryIndex.enclosing()` queries should not bypass redaction by
 * exposing raw scope payloads through the range index. Consumers
 * needing payload can join on `runtimeStageId` with the full event
 * stream via `getEvents()` (which IS subject to redaction policy).
 */
export interface BoundaryRangeLabel {
  readonly type: 'subflow.entry' | 'run.entry' | 'composition.start';
  readonly runtimeStageId: string;
  readonly subflowPath: readonly string[];
  readonly depth: number;
  readonly ts: number;
  /** Set on subflow entries; undefined on the synthetic run-root entry. */
  readonly subflowId?: string;
  readonly localSubflowId?: string;
  readonly subflowName?: string;
  readonly description?: string;
  readonly primitiveKind?: string;
  readonly slotKind?: ContextSlot;
  readonly isAgentInternal?: boolean;
  /** Composition primitive (Parallel/Sequence/Loop/Conditional) when the
   *  range was opened by a `composition.start` event. */
  readonly compositionKind?: 'Parallel' | 'Sequence' | 'Loop' | 'Conditional';
  readonly compositionName?: string;
}

function toBoundaryLabel(e: DomainSubflowEvent | DomainRunEvent): BoundaryRangeLabel {
  if (e.type === 'subflow.entry') {
    return {
      type: 'subflow.entry',
      runtimeStageId: e.runtimeStageId,
      subflowPath: e.subflowPath,
      depth: e.depth,
      ts: e.ts,
      subflowId: e.subflowId,
      localSubflowId: e.localSubflowId,
      subflowName: e.subflowName,
      ...(e.description !== undefined ? { description: e.description } : {}),
      ...(e.primitiveKind !== undefined ? { primitiveKind: e.primitiveKind } : {}),
      ...(e.slotKind !== undefined ? { slotKind: e.slotKind } : {}),
      isAgentInternal: e.isAgentInternal,
    };
  }
  return {
    type: 'run.entry',
    runtimeStageId: e.runtimeStageId,
    subflowPath: e.subflowPath,
    depth: e.depth,
    ts: e.ts,
  };
}

/** Build a BoundaryRangeLabel for the open side of a composition pair. */
function toCompositionBoundaryLabel(e: DomainCompositionEvent): BoundaryRangeLabel {
  return {
    type: 'composition.start',
    runtimeStageId: e.runtimeStageId,
    subflowPath: e.subflowPath,
    depth: e.depth,
    ts: e.ts,
    compositionKind: e.kind,
    compositionName: e.name,
  };
}

/** Clamp `getCommitCount()` returns to a safe non-negative integer.
 *  Defensive against malformed injections returning NaN/Infinity/negatives
 *  (security panel review YELLOW #2). */
function sanitizeCommitCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n;
}

let _counter = 0;

/** Factory — matches the `inOutRecorder()` / `topologyRecorder()` style. */
export function boundaryRecorder(options: BoundaryRecorderOptions = {}): BoundaryRecorder {
  return new BoundaryRecorder(options);
}

/**
 * Unified domain event recorder. Implements `CombinedRecorder` so it can
 * attach to the executor's FlowRecorder channel; exposes `subscribe()`
 * to wire to the agentfootprint typed-event dispatcher.
 *
 * v5: composes a `SequenceStore<DomainEvent>` (storage) instead of
 * extending the deprecated `SequenceStore<T>` base. Time-travel
 * utilities (`getEntryRanges`, `accumulate`) are accessed through the
 * store via the public read API on this class.
 */
export class BoundaryRecorder implements CombinedRecorder {
  readonly id: string;

  /** Composition: storage shelf. */
  private readonly store = new SequenceStore<DomainEvent>();

  /**
   * Phase 5 Layer 2 — interval index over commit indices, populated
   * live as boundary entry/exit pairs fire. Consumers (Lens) read
   * `enclosing(commitIdx)` for breadcrumbs and `overlapping(slice)`
   * for time-range queries. Empty when `getCommitCount` is not
   * injected. See `docs/design/boundary-commit-ranges.md`.
   */
  readonly boundaryIndex: CommitRangeIndex<BoundaryRangeLabel> =
    new CommitRangeIndex<BoundaryRangeLabel>();

  /** Open-range tokens keyed by `runtimeStageId` so the matching exit
   *  can close the correct range. Pure side-table; cleared on runId
   *  reset. Not exposed externally. */
  private readonly openTokens = new Map<string, RangeToken>();

  /** Live commit-count accessor injected by the runner. Sanitized
   *  (NaN/Infinity/negative → 0) before use. */
  private readonly getCommitCount: () => number;

  /** True when `getCommitCount` was explicitly injected. In LEGACY
   *  MODE (false), `boundaryIndex` is intentionally NOT populated —
   *  zero-width [0,0] ranges would mislead consumers querying the
   *  index. Multi-panel review flagged this footgun. */
  private readonly hasCommitTracking: boolean;

  /** Snapshot verbosity — see `BoundaryRecorderOptions.snapshot`. Only
   *  `toSnapshot()` reads it; the live event stream from `getEvents()`
   *  is always full, so in-process consumers are never affected. */
  private readonly snapshotMode: 'full' | 'lean';

  /** See `BoundaryRecorderOptions.recordEmbeddings`. Applied at CAPTURE
   *  time, so the summary is what every projection (live stream, snapshot,
   *  lean) sees — one truth, not per-reader rewrites. */
  private readonly keepEmbeddings: boolean;

  /**
   * Tracks whether the most recent `llm.end` had toolCalls. Used to
   * classify the NEXT `llm.start` as `'tool→llm'` (vs `'user→llm'` if
   * there's no pending tool result). Reset on `clear()` and on every
   * `llm.start` event after the classification is applied.
   */
  private prevLLMEndHadTools = false;

  /**
   * Run-boundary observer — fires resetForNewRun() when
   * traversalContext.runId changes between events AND no boundary is
   * currently open. The "no open boundary" gate distinguishes:
   *
   *   - **Legitimate new run** — consumer reuses one recorder across
   *     sequential `executor.run()` calls. All prior boundaries closed
   *     before the second run began; openTokens is empty when the new
   *     runId arrives → safe to wipe state so the second run doesn't
   *     alias with the first.
   *   - **Composition sub-run** — primitives like `LLMCall`, `Sequence`,
   *     and `Parallel` internally spawn their own `FlowChartExecutor`
   *     instances. Each sub-executor mints a NEW runId. When that
   *     sub-executor fires events on the SHARED recorder, the recorder
   *     is still inside the parent run — `openTokens` is non-empty.
   *     Resetting here would wipe the parent's boundary index mid-run
   *     (the bug Layer 4 surfaced in agentfootprint-lens fanout).
   *
   * The `openTokens.size === 0` check is the cleanest semantic signal:
   * if nothing is in-flight, a runId change means "the consumer started
   * fresh"; if something is open, the new runId is from a sub-executor
   * nested inside the still-ongoing parent.
   */
  private readonly runIdGuard: RunIdObserver = createRunIdObserver(() => {
    if (this.openTokens.size > 0) {
      // Inside an active run — new runId is from a composition sub-
      // executor (LLMCall / Sequence / Parallel). Do NOT reset.
      return;
    }
    this.store.clear();
    this.boundaryIndex.clear();
    this.openTokens.clear();
    this.prevLLMEndHadTools = false;
  });

  constructor(options: BoundaryRecorderOptions = {}) {
    this.id = options.id ?? `boundary-${++_counter}`;
    this.snapshotMode = options.snapshot ?? 'full';
    this.keepEmbeddings = options.recordEmbeddings ?? false;
    this.hasCommitTracking = options.getCommitCount !== undefined;
    const raw = options.getCommitCount;
    this.getCommitCount = raw === undefined ? () => 0 : () => sanitizeCommitCount(raw());
  }

  /** Boundary payloads keep a vector's shape, not its bytes — see
   *  `recordEmbeddings`. Copy-on-write: payloads without embeddings pass
   *  through by reference. */
  private capturePayload(payload: unknown): unknown {
    return this.keepEmbeddings ? payload : summarizeEmbeddings(payload);
  }

  /**
   * Reset all transient state.
   *
   * **Composition-safe gate (Phase 5 Layer 4):** if `openTokens.size > 0`
   * the call is a no-op. Rationale: `FlowChartExecutor.run()` calls
   * `r.clear?.()` on every attached recorder during its pre-run loop.
   * When agentfootprint composition primitives (LLMCall, Sequence,
   * Parallel, etc.) propagate the parent's recorders to nested
   * sub-executors, EACH sub-executor's pre-run clear loop calls
   * `clear()` on the SHARED parent recorder mid-run — wiping live
   * parent state. The `openTokens.size > 0` check distinguishes:
   *
   *   - **Legitimate reset** — consumer or executor calls `clear()`
   *     when no boundary is in-flight (`openTokens` empty). Safe to
   *     wipe; the recorder is idle.
   *   - **Composition wipe** — sub-executor's pre-run clear fires
   *     while the parent has open boundaries (`openTokens` non-empty).
   *     Skip the wipe; the parent's state must be preserved.
   *
   * If a consumer needs to forcibly wipe state even with open tokens
   * (e.g., manual recovery after a crashed run), pair `clear()` with
   * an explicit `forceClear()` (TODO — add when the use case shows up;
   * today the recorder lifecycle pattern is "one recorder per logical
   * run" so leaked tokens shouldn't occur).
   */
  clear(): void {
    if (this.openTokens.size > 0) {
      // Mid-run wipe attempt — almost certainly a sub-executor's
      // pre-run clear via composition propagation. Skip.
      return;
    }
    this.store.clear();
    this.boundaryIndex.clear();
    this.openTokens.clear();
    this.prevLLMEndHadTools = false;
    this.runIdGuard.reset();
  }

  private observeRunId(runId: string | undefined): void {
    this.runIdGuard.observe(runId);
  }

  // ── FlowRecorder hooks (footprintjs side) ───────────────────────────

  onRunStart(event: FlowRunEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const commitIdxBefore = this.getCommitCount();
    const e = buildRunEvent('run.entry', this.capturePayload(event.payload), commitIdxBefore);
    // Open range BEFORE the store push so a failed push doesn't leak
    // an unclosed range (DS+logic panel review). The label is the
    // stripped projection (no payload) — security-panel YELLOW #1.
    if (this.hasCommitTracking) {
      const token = this.boundaryIndex.open(toBoundaryLabel(e), commitIdxBefore);
      this.openTokens.set(e.runtimeStageId, token);
    }
    this.store.push(e);
  }

  onRunEnd(event: FlowRunEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const commitIdxBefore = this.getCommitCount();
    const e = buildRunEvent('run.exit', this.capturePayload(event.payload), commitIdxBefore);
    // Close the range BEFORE store.push so a failed push doesn't
    // leak a permanently-open range. The range is the canonical
    // truth; the store entry is downstream telemetry.
    if (this.hasCommitTracking) {
      const token = this.openTokens.get(e.runtimeStageId);
      if (token) {
        this.boundaryIndex.close(token, commitIdxBefore);
        this.openTokens.delete(e.runtimeStageId);
      }
    }
    this.store.push(e);
  }

  onRunFailed(event: FlowRunFailedEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const commitIdxBefore = this.getCommitCount();
    // A failed run still TERMINATES — close the root range (mirror
    // onRunEnd) so consumers get a terminal "Run · failed" boundary
    // position instead of a slider that stops mid-call. The error rides
    // as the exit payload so the WHY is reachable at that boundary.
    const e = buildRunEvent('run.exit', { error: event.structuredError.message }, commitIdxBefore);
    if (this.hasCommitTracking) {
      const token = this.openTokens.get(e.runtimeStageId);
      if (token) {
        this.boundaryIndex.close(token, commitIdxBefore);
        this.openTokens.delete(e.runtimeStageId);
      }
    }
    this.store.push(e);
  }

  onSubflowEntry(event: FlowSubflowEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const commitIdxBefore = this.getCommitCount();
    const e = buildSubflowEvent(event, 'subflow.entry', commitIdxBefore, (p) =>
      this.capturePayload(p),
    );
    if (!e) return;
    if (this.hasCommitTracking) {
      const token = this.boundaryIndex.open(toBoundaryLabel(e), commitIdxBefore);
      this.openTokens.set(e.runtimeStageId, token);
    }
    this.store.push(e);
  }

  onSubflowExit(event: FlowSubflowEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const commitIdxBefore = this.getCommitCount();
    const e = buildSubflowEvent(event, 'subflow.exit', commitIdxBefore, (p) =>
      this.capturePayload(p),
    );
    if (!e) return;
    if (this.hasCommitTracking) {
      const token = this.openTokens.get(e.runtimeStageId);
      if (token) {
        this.boundaryIndex.close(token, commitIdxBefore);
        this.openTokens.delete(e.runtimeStageId);
      }
    }
    this.store.push(e);
  }

  onFork(event: FlowForkEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const ts = Date.now();
    const ctx = event.traversalContext;
    const runtimeStageId = ctx?.runtimeStageId ?? '';
    const segments = ctx?.subflowPath ? ctx.subflowPath.split('/').filter(Boolean) : [];
    const subflowPath: readonly string[] = [ROOT_SUBFLOW_ID, ...segments];
    const commitIdxBefore = this.getCommitCount();
    for (const childName of event.children) {
      this.store.push({
        type: 'fork.branch',
        runtimeStageId,
        subflowPath,
        depth: subflowPath.length - 1,
        ts,
        commitIdxBefore,
        commitIdxAfter: commitIdxBefore,
        parentSubflowId: event.parent,
        childName,
      });
    }
  }

  onDecision(event: FlowDecisionEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const ctx = event.traversalContext;
    // Agent-internal decisions (Route picking tool-calls / final) are
    // identified by the deciding stage's stableId matching one of the
    // known Agent-internal subflow ids. The actor arrows that follow
    // (`llm→tool` / `llm→user`) already encode the routing observably,
    // so the timeline filters these out — but we still capture them in
    // the event log so the right-pane / commentary can read the
    // rationale when present.
    const stageId = ctx?.stageId ?? '';
    const localStageId = stageId.includes('/')
      ? stageId.slice(stageId.lastIndexOf('/') + 1)
      : stageId;
    const isAgentInternal = isAgentInternalId(localStageId);
    const commitIdxBefore = this.getCommitCount();
    this.store.push({
      type: 'decision.branch',
      runtimeStageId: ctx?.runtimeStageId ?? '',
      subflowPath: pathFromCtx(ctx?.subflowPath),
      depth: ctxDepth(ctx?.subflowPath),
      ts: Date.now(),
      commitIdxBefore,
      commitIdxAfter: commitIdxBefore,
      decider: event.decider,
      chosen: event.chosen,
      ...(event.rationale ? { rationale: event.rationale } : {}),
      isAgentInternal,
    });
  }

  onLoop(event: FlowLoopEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const ctx = event.traversalContext;
    const commitIdxBefore = this.getCommitCount();
    this.store.push({
      type: 'loop.iteration',
      runtimeStageId: ctx?.runtimeStageId ?? '',
      subflowPath: pathFromCtx(ctx?.subflowPath),
      depth: ctxDepth(ctx?.subflowPath),
      ts: Date.now(),
      commitIdxBefore,
      commitIdxAfter: commitIdxBefore,
      target: event.target,
      iteration: event.iteration,
    });
  }

  // ── Typed-event subscription (agentfootprint dispatcher side) ───────

  /**
   * Subscribe to the run's typed events and emit a domain event for each
   * `llm.*` / `tool.*` / `context.injected` one. This is the recorder's
   * SECOND half — `runner.attach(...)` supplies the boundaries, this
   * supplies what happened inside them. Wire both, before the run.
   *
   * Takes anything that offers a wildcard subscription, which a public
   * `Runner` does as readily as the internal `EventDispatcher` — so a
   * consumer never has to reach past `runner.on` for a dispatcher it
   * isn't given.
   *
   * Returns an unsubscribe function; safe to call multiple times (each
   * call adds a new subscription). Most consumers call this once at
   * recorder construction and dispose with the returned function.
   */
  subscribe(source: TypedEventSource): Unsubscribe {
    return source.on('*', (event: AgentfootprintEvent) => this.ingestTypedEvent(event));
  }

  private ingestTypedEvent(event: AgentfootprintEvent): void {
    // NOTE: deliberately does NOT call observeRunId(event.meta.runId).
    // The agentfootprint dispatcher's runId is generated by a DIFFERENT
    // generator than footprintjs's traversalContext.runId. Mixing them
    // would toggle lastRunId on every event and trigger a false reset.
    // Run-boundary detection happens reliably via the FlowRecorder hooks
    // (onRunStart fires FIRST in any new run, before any typed event).
    const meta = event.meta;
    const runtimeStageId = meta.runtimeStageId ?? '';
    const subflowPath = [ROOT_SUBFLOW_ID, ...(meta.subflowPath ?? [])];
    const depth = subflowPath.length - 1;
    const ts = meta.wallClockMs;
    // Phase 5 Layer 2: stamp commit index on every typed event for
    // consumers that want to join domain events with the commit log
    // (e.g., "which LLM call happened during this commit slice?").
    // Typed events don't write to scope themselves, so before === after.
    const commitIdxBefore = this.getCommitCount();

    switch (event.type) {
      case 'agentfootprint.stream.llm_start': {
        const p = event.payload;
        // Classify the actor arrow at capture time. State is local to
        // THIS recorder and consumed-then-reset on each llm.start. No
        // state machine spread across renderers; consumers just read
        // `event.actorArrow`.
        const actorArrow: 'user→llm' | 'tool→llm' = this.prevLLMEndHadTools
          ? 'tool→llm'
          : 'user→llm';
        this.prevLLMEndHadTools = false;
        this.store.push({
          type: 'llm.start',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          commitIdxBefore,
          commitIdxAfter: commitIdxBefore,
          model: p.model,
          provider: p.provider,
          ...(p.systemPromptChars !== undefined ? { systemPromptChars: p.systemPromptChars } : {}),
          ...(p.messagesCount !== undefined ? { messagesCount: p.messagesCount } : {}),
          ...(p.toolsCount !== undefined ? { toolsCount: p.toolsCount } : {}),
          actorArrow,
        });
        break;
      }
      case 'agentfootprint.stream.llm_end': {
        const p = event.payload;
        const actorArrow: 'llm→tool' | 'llm→user' = p.toolCallCount > 0 ? 'llm→tool' : 'llm→user';
        // Set the pending flag for the NEXT llm.start (if any). A
        // terminal call (toolCallCount === 0) leaves the flag false so
        // a hypothetical follow-up call would correctly be 'user→llm'.
        this.prevLLMEndHadTools = p.toolCallCount > 0;
        this.store.push({
          type: 'llm.end',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          commitIdxBefore,
          commitIdxAfter: commitIdxBefore,
          content: p.content,
          toolCallCount: p.toolCallCount,
          usage: { input: p.usage.input, output: p.usage.output },
          ...(p.stopReason ? { stopReason: p.stopReason } : {}),
          actorArrow,
        });
        break;
      }
      case 'agentfootprint.stream.tool_start': {
        const p = event.payload;
        this.store.push({
          type: 'tool.start',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          commitIdxBefore,
          commitIdxAfter: commitIdxBefore,
          toolName: p.toolName,
          toolCallId: p.toolCallId,
          ...(p.args !== undefined ? { args: p.args } : {}),
        });
        break;
      }
      case 'agentfootprint.stream.tool_end': {
        const p = event.payload;
        this.store.push({
          type: 'tool.end',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          commitIdxBefore,
          commitIdxAfter: commitIdxBefore,
          toolCallId: p.toolCallId,
          ...(p.result !== undefined ? { result: p.result } : {}),
          ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
          ...(p.error !== undefined ? { error: p.error } : {}),
        });
        break;
      }
      case 'agentfootprint.context.injected': {
        const p = event.payload;
        this.store.push({
          type: 'context.injected',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          commitIdxBefore,
          commitIdxAfter: commitIdxBefore,
          slot: p.slot,
          source: p.source ?? 'unknown',
          ...(p.sourceId ? { sourceId: p.sourceId } : {}),
          ...(p.asRole ? { asRole: p.asRole } : {}),
          ...(p.contentSummary ? { contentSummary: p.contentSummary } : {}),
          ...(p.reason ? { reason: p.reason } : {}),
          ...(p.sectionTag ? { sectionTag: p.sectionTag } : {}),
          ...(p.upstreamRef ? { upstreamRef: p.upstreamRef } : {}),
          ...(p.retrievalScore !== undefined ? { retrievalScore: p.retrievalScore } : {}),
          ...(p.rankPosition !== undefined ? { rankPosition: p.rankPosition } : {}),
          ...(p.budgetSpent?.tokens !== undefined ? { budgetTokens: p.budgetSpent.tokens } : {}),
          ...(p.budgetSpent?.fractionOfCap !== undefined
            ? { budgetFraction: p.budgetSpent.fractionOfCap }
            : {}),
        });
        break;
      }
      case 'agentfootprint.composition.enter': {
        // Open a boundary range for the composition. The MATCHING KEY
        // for open/close is `payload.id` (the composition's stable id),
        // NOT `meta.runtimeStageId`. Reason: the composition's enter
        // event fires from a different stage (entry hook) than its
        // exit event (merge / exit hook) — different `meta.runtimeStageId`s.
        // The composition's `id` is the only field that's the same on
        // both. The boundary range's runtimeStageId (used as the Lens
        // group identity) is the ENTER event's `meta.runtimeStageId`
        // (the entry stage's id) — that's the "fork moment."
        const p = event.payload;
        const e: DomainCompositionEvent = {
          type: 'composition.start',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          commitIdxBefore,
          commitIdxAfter: commitIdxBefore,
          kind: p.kind as 'Parallel' | 'Sequence' | 'Loop' | 'Conditional',
          compositionId: p.id,
          name: p.name,
        };
        if (this.hasCommitTracking) {
          const token = this.boundaryIndex.open(toCompositionBoundaryLabel(e), commitIdxBefore);
          this.openTokens.set(`composition:${p.id}`, token);
        }
        this.store.push(e);
        break;
      }
      case 'agentfootprint.composition.exit': {
        // Close the matching composition range. Keyed by `payload.id`
        // — see the enter handler for why this differs from
        // meta.runtimeStageId.
        const p = event.payload;
        const e: DomainCompositionEvent = {
          type: 'composition.end',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          commitIdxBefore,
          commitIdxAfter: commitIdxBefore,
          kind: p.kind as 'Parallel' | 'Sequence' | 'Loop' | 'Conditional',
          compositionId: p.id,
          name: p.name ?? '',
          status: p.status,
          durationMs: p.durationMs,
        };
        if (this.hasCommitTracking) {
          const key = `composition:${p.id}`;
          const token = this.openTokens.get(key);
          if (token) {
            this.boundaryIndex.close(token, commitIdxBefore);
            this.openTokens.delete(key);
          }
        }
        this.store.push(e);
        break;
      }
      default:
        // Other typed events (agent.*, eval.*, etc.) are not mapped to
        // DomainEvent for now — they're higher-level summaries that
        // downstream selectors derive on demand.
        break;
    }
  }

  // ── Read API ────────────────────────────────────────────────────────

  /** All events in capture order (the canonical projection). */
  getEvents(): DomainEvent[] {
    return this.store.getAll();
  }

  /** Type-narrowed lookup: all events of one kind. */
  getEventsByType<T extends DomainEvent['type']>(type: T): Extract<DomainEvent, { type: T }>[] {
    const out: Extract<DomainEvent, { type: T }>[] = [];
    for (const e of this.store.getAll()) {
      if (e.type === type) out.push(e as Extract<DomainEvent, { type: T }>);
    }
    return out;
  }

  // ── Back-compat / convenience query helpers ─────────────────────────

  /** All boundary events (run + subflow, entry + exit interleaved). */
  getBoundaries(): (DomainRunEvent | DomainSubflowEvent)[] {
    const out: (DomainRunEvent | DomainSubflowEvent)[] = [];
    for (const e of this.store.getAll()) {
      if (
        e.type === 'run.entry' ||
        e.type === 'run.exit' ||
        e.type === 'subflow.entry' ||
        e.type === 'subflow.exit'
      ) {
        out.push(e);
      }
    }
    return out;
  }

  /** Just the entry-phase boundary events — the "step list" timeline. */
  getSteps(): (DomainRunEvent | DomainSubflowEvent)[] {
    return this.getBoundaries().filter((b) => b.type === 'run.entry' || b.type === 'subflow.entry');
  }

  /** Subset of `getSteps()` excluding agent-internal routing subflows. */
  getVisibleSteps(): (DomainRunEvent | DomainSubflowEvent)[] {
    return this.getSteps().filter((s) => s.type !== 'subflow.entry' || !s.isAgentInternal);
  }

  /** Entry/exit pair for one chart execution by `runtimeStageId`. */
  getBoundary(runtimeStageId: string): {
    entry?: DomainRunEvent | DomainSubflowEvent;
    exit?: DomainRunEvent | DomainSubflowEvent;
  } {
    const matches = this.store.getByKey(runtimeStageId);
    let entry: DomainRunEvent | DomainSubflowEvent | undefined;
    let exit: DomainRunEvent | DomainSubflowEvent | undefined;
    for (const e of matches) {
      if (e.type === 'run.entry' || e.type === 'subflow.entry') entry = e;
      else if (e.type === 'run.exit' || e.type === 'subflow.exit') exit = e;
    }
    return {
      ...(entry ? { entry } : {}),
      ...(exit ? { exit } : {}),
    };
  }

  /** Convenience for the outermost `__root__` pair. */
  getRootBoundary(): {
    entry?: DomainRunEvent;
    exit?: DomainRunEvent;
  } {
    const pair = this.getBoundary(ROOT_RUNTIME_STAGE_ID);
    return {
      ...(pair.entry?.type === 'run.entry' ? { entry: pair.entry } : {}),
      ...(pair.exit?.type === 'run.exit' ? { exit: pair.exit } : {}),
    };
  }

  /** Subflow events grouped by the 3 input slots — for slot-row rendering. */
  getSlotBoundaries(): {
    systemPrompt: DomainSubflowEvent[];
    messages: DomainSubflowEvent[];
    tools: DomainSubflowEvent[];
  } {
    const systemPrompt: DomainSubflowEvent[] = [];
    const messages: DomainSubflowEvent[] = [];
    const tools: DomainSubflowEvent[] = [];
    for (const e of this.store.getAll()) {
      if (e.type !== 'subflow.entry' && e.type !== 'subflow.exit') continue;
      if (e.slotKind === 'system-prompt') systemPrompt.push(e);
      else if (e.slotKind === 'messages') messages.push(e);
      else if (e.slotKind === 'tools') tools.push(e);
    }
    return { systemPrompt, messages, tools };
  }

  /**
   * Roll up the event stream for ONE primitive boundary (Agent /
   * LLMCall / Sequence / Parallel / Conditional / Loop) into per-
   * boundary totals — tokens, llm calls, tool calls, iterations,
   * cache hits, duration.
   *
   * Pure projection over `getEvents()`. Events are attributed to a
   * boundary when their `subflowPath` is a **prefix-match** of the
   * boundary's path — so a nested `LLMCall` inside an `Agent` rolls
   * up into BOTH (LLMCall total + Agent total).
   *
   * Works mid-run (the boundary's `subflow.exit` may not have fired
   * yet — `endedAtMs` / `durationMs` are undefined in that case).
   * Works post-run.
   *
   * Multi-consumer story: this is the single source of rollup truth
   * for Lens, CLI live monitors, Sentry breadcrumbs, OTel exporters,
   * dashboards. Domain math (what counts as an "iteration"? does
   * cache hit count separately from llmCalls?) lives HERE — every
   * consumer hooks up; nobody re-implements.
   *
   * @param runtimeStageId The boundary's runtimeStageId (the same id
   *   carried by `StepNode.runtimeStageId` for primitive subflows).
   * @returns The rollup, or `undefined` if no `subflow.entry` event
   *   matches `runtimeStageId`.
   */
  aggregateForBoundary(runtimeStageId: string): BoundaryAggregate | undefined {
    const events = this.store.getAll();
    let entry: DomainSubflowEvent | undefined;
    let exit: DomainSubflowEvent | undefined;
    for (const e of events) {
      if (e.type === 'subflow.entry' && e.runtimeStageId === runtimeStageId) entry = e;
      if (e.type === 'subflow.exit' && e.runtimeStageId === runtimeStageId) exit = e;
    }
    if (!entry) return undefined;
    return foldRollup(events, entry, exit);
  }

  /**
   * Roll up every primitive boundary in the run into one rollup each,
   * in the order their `subflow.entry` events fired. Top-level multi-
   * agent UIs call this once per render to populate per-agent chips.
   *
   * Filters to `primitiveKind`-tagged subflows ONLY (Agent / LLMCall /
   * Sequence / Parallel / Conditional / Loop). Slot subflows
   * (`sf-system-prompt` / `sf-messages` / `sf-tools`) are NOT
   * boundaries in this sense — they're context-engineering machinery,
   * not user-facing rollup units.
   */
  aggregateAllBoundaries(): readonly BoundaryAggregate[] {
    const events = this.store.getAll();
    const out: BoundaryAggregate[] = [];
    // Index exits by runtimeStageId for O(1) pair-up.
    const exitByRid = new Map<string, DomainSubflowEvent>();
    for (const e of events) {
      if (e.type === 'subflow.exit' && e.primitiveKind) {
        exitByRid.set(e.runtimeStageId, e);
      }
    }
    for (const e of events) {
      if (e.type !== 'subflow.entry' || !e.primitiveKind) continue;
      const exit = exitByRid.get(e.runtimeStageId);
      out.push(foldRollup(events, e, exit));
    }
    return out;
  }

  /** Snapshot bundle — included in `executor.getSnapshot()` if the
   *  executor implements the snapshot extension protocol.
   *
   *  Under `snapshot: 'lean'` the bundle carries structure only, and
   *  `meta.mode` says so. That field is the whole point: an offline
   *  consumer holding a lean bundle can then SAY "this recording carries
   *  structure only" instead of drawing empty detail panels, because
   *  `buildStepGraphFromEvents()` restores step content from this bundle
   *  and nowhere else. `description` still carries the same fact in
   *  prose for a human reading the JSON — but prose is not something
   *  code branches on, and the readers that had to string-match it
   *  didn't.
   *
   *  `meta` reaches `getSnapshot().recorders[i].meta` on footprintjs
   *  9.12+, which copies it through; older engines rebuild the row
   *  without it and the field is dropped in transit. It is always on the
   *  value THIS method returns, so a producer holding the recorder
   *  (`recordRun`) can read it either way.
   *
   *  `data` is annotated rather than inferred: a lean event is a
   *  structural SUPERtype of a full one, so inference collapses the
   *  union to `LeanDomainEvent[]` and full-mode callers silently lose
   *  `payload` / `content` / … from the type. Narrow on the mode you
   *  configured. */
  toSnapshot(): {
    name: string;
    description: string;
    preferredOperation: 'translate';
    data: DomainEvent[] | LeanDomainEvent[];
    meta: { readonly mode: 'full' | 'lean' };
  } {
    const lean = this.snapshotMode === 'lean';
    return {
      name: 'BoundaryEvents',
      description: lean
        ? 'Unified domain event log, lean — run/subflow boundaries + LLM/tool/context events, without captured content'
        : 'Unified domain event log — run/subflow boundaries + LLM/tool/context events',
      preferredOperation: 'translate' as const,
      data: lean ? this.getEvents().map(stripContent) : this.getEvents(),
      meta: { mode: this.snapshotMode },
    };
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Copy an event without its `CONTENT_FIELDS`. Allow-list by omission
 * rather than a per-type rewrite so a newly added STRUCTURAL field
 * reaches lean consumers without a second edit here — the asymmetry is
 * deliberate, and the one direction it gets wrong (a new content field
 * silently surviving) is pinned by a test on `CONTENT_FIELDS`.
 *
 * Builds a new object; the stored event is never mutated, so a lean
 * `toSnapshot()` leaves the live stream from `getEvents()` untouched.
 */
function stripContent(event: DomainEvent): LeanDomainEvent {
  const lean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!CONTENT_FIELD_SET.has(key)) lean[key] = value;
  }
  return lean as LeanDomainEvent;
}

function buildRunEvent(
  type: 'run.entry' | 'run.exit',
  payload: unknown,
  commitIdxBefore: number,
): DomainRunEvent {
  return {
    type,
    runtimeStageId: ROOT_RUNTIME_STAGE_ID,
    subflowPath: [ROOT_SUBFLOW_ID],
    depth: 0,
    ts: Date.now(),
    commitIdxBefore,
    commitIdxAfter: commitIdxBefore,
    payload,
    isRoot: true,
  };
}

function buildSubflowEvent(
  event: FlowSubflowEvent,
  type: 'subflow.entry' | 'subflow.exit',
  commitIdxBefore: number,
  transformPayload: (payload: unknown) => unknown,
): DomainSubflowEvent | undefined {
  const subflowId = event.subflowId;
  if (!subflowId) return undefined;

  const ctx = event.traversalContext;
  const runtimeStageId = ctx?.runtimeStageId ?? '';
  const segments = subflowId.split('/').filter(Boolean);
  const subflowPath: readonly string[] = [ROOT_SUBFLOW_ID, ...segments];
  const depth = subflowPath.length - 1;
  const localSubflowId = segments[segments.length - 1] ?? subflowId;
  const description = event.description;
  const primitiveKind = description ? parsePrimitiveKindFromDescription(description) : undefined;
  const slotKind = slotFromSubflowId(subflowId);
  const isAgentInternal = isAgentInternalId(localSubflowId);
  const rawPayload = type === 'subflow.entry' ? event.mappedInput : event.outputState;
  const payload = rawPayload === undefined ? undefined : transformPayload(rawPayload);

  return {
    type,
    runtimeStageId,
    subflowPath,
    depth,
    ts: Date.now(),
    commitIdxBefore,
    commitIdxAfter: commitIdxBefore,
    subflowId,
    localSubflowId,
    subflowName: event.name,
    ...(description ? { description } : {}),
    ...(primitiveKind ? { primitiveKind } : {}),
    ...(slotKind ? { slotKind } : {}),
    isAgentInternal,
    ...(payload !== undefined ? { payload } : {}),
  };
}

function pathFromCtx(subflowPath: string | undefined): readonly string[] {
  if (!subflowPath) return [ROOT_SUBFLOW_ID];
  return [ROOT_SUBFLOW_ID, ...subflowPath.split('/').filter(Boolean)];
}

function ctxDepth(subflowPath: string | undefined): number {
  return pathFromCtx(subflowPath).length - 1;
}

function parsePrimitiveKindFromDescription(description: string): string | undefined {
  const colonIdx = description.indexOf(':');
  if (colonIdx <= 0) return undefined;
  const kind = description.slice(0, colonIdx).trim();
  return kind || undefined;
}

// ─── Rollup helpers (used by aggregateForBoundary) ──────────────────

/** Returns true when `path` starts with every segment of `prefix`. */
function isSubflowPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  if (path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Single-pass fold producing a `BoundaryAggregate` from the flat
 * event stream. Pure projection — no recorder state mutation.
 */
function foldRollup(
  events: readonly DomainEvent[],
  entry: DomainSubflowEvent,
  exit: DomainSubflowEvent | undefined,
): BoundaryAggregate {
  const path = entry.subflowPath;
  let llmCalls = 0;
  let toolCalls = 0;
  let iterations = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of events) {
    if (!isSubflowPathPrefix(path, e.subflowPath)) continue;
    switch (e.type) {
      case 'llm.start':
        llmCalls++;
        break;
      case 'tool.start':
        toolCalls++;
        break;
      case 'llm.end':
        inputTokens += e.usage.input;
        outputTokens += e.usage.output;
        break;
      // Iteration counting: every loop.iteration scoped to this
      // boundary OR equivalent. The composition.iteration / agent.
      // iteration_start typed events fire on the dispatcher channel
      // but BoundaryRecorder doesn't capture them as DomainEvents
      // today — instead we count `loop.iteration` events that fire
      // on the FlowRecorder side (already mapped). For Agent runs
      // the agent's outer loop contributes one per ReAct cycle.
      case 'loop.iteration':
        iterations++;
        break;
    }
  }
  const startedAtMs = entry.ts;
  const endedAtMs = exit?.ts;
  return {
    runtimeStageId: entry.runtimeStageId,
    subflowId: entry.subflowId,
    subflowPath: entry.subflowPath,
    ...(entry.primitiveKind ? { primitiveKind: entry.primitiveKind } : {}),
    label: entry.subflowName,
    tokens: { input: inputTokens, output: outputTokens },
    llmCalls,
    toolCalls,
    iterations,
    startedAtMs,
    ...(endedAtMs !== undefined ? { endedAtMs, durationMs: endedAtMs - startedAtMs } : {}),
  };
}
