import { AgentfootprintEvent, AgentfootprintEventType, Unsubscribe, Runner, GroupKind, GroupTranslator, GroupMetadata, GroupMember } from 'agentfootprint';
import { StepGraph, StepNode, LiveStateRecorder, BoundaryRecorder, ContextInjection, BoundaryRangeLabel, ToolChoiceCall, BoundaryAggregate } from 'agentfootprint/observe';
import { TraceRuntimeOverlayHandle, TraceGraph } from 'footprint-explainable-ui/flowchart';
import { CombinedRecorder, TraversalContext, FlowSubflowEvent, FlowForkEvent, FlowDecisionEvent, FlowLoopEvent } from 'footprintjs';
import { Node, Edge } from '@xyflow/react';

/**
 * Lens core types — the data contract views render against. Tree of
 * nodes + typed event log, built incrementally from the agentfootprint
 * EventDispatcher stream. Same shape across every framework adapter.
 */

type RunNodeKind = 'run' | 'composition' | 'iteration' | 'llm-call' | 'tool-call' | 'fork-branch' | 'decision-branch' | 'pause';
type RunNodeStatus = 'running' | 'ok' | 'err' | 'paused' | 'budget_exhausted';
/**
 * One node of the RunTree. Immutable after the recorder finalizes it;
 * live-streaming support (v2.1+) would introduce a version stamp.
 */
interface RunTreeNode {
    /** Stable id — concatenation of the footprintjs `runtimeStageId` + kind. */
    readonly id: string;
    /** The kind drives rendering affordances (icon, color, drill-down shape). */
    readonly kind: RunNodeKind;
    /** Human label shown in the tree view (e.g., "Sequence:pipe", "LLM: claude-opus"). */
    readonly label: string;
    /** Completion status. 'running' while live; terminal on finalize. */
    readonly status: RunNodeStatus;
    /** ms since the run started when this node began. */
    readonly startOffsetMs: number;
    /** ms elapsed inside this node. Undefined while running. */
    readonly durationMs?: number;
    /** Ordered children. LLM-call / tool-call / pause nodes have none. */
    readonly children: readonly RunTreeNode[];
    /**
     * Raw events accumulated inside this node. Scoped to this node —
     * events nested inside a child node live on the child, not here.
     * Views can render these as a stream or extract domain-specific data
     * (cost totals, permission denials, eval scores).
     */
    readonly events: readonly EventLogEntry[];
    /** Kind-specific details — typed separately so views don't downcast. */
    readonly details?: RunNodeDetails;
}
/**
 * Per-kind node details. Discriminated on `kind` — views narrow.
 */
type RunNodeDetails = {
    readonly kind: 'llm-call';
    readonly llm: LLMCallDetails;
} | {
    readonly kind: 'tool-call';
    readonly tool: ToolCallDetails;
} | {
    readonly kind: 'composition';
    readonly composition: CompositionDetails;
} | {
    readonly kind: 'iteration';
    readonly iteration: IterationDetails;
} | {
    readonly kind: 'pause';
    readonly pause: PauseDetails;
};
interface LLMCallDetails {
    readonly provider: string;
    readonly model: string;
    readonly systemPromptChars: number;
    readonly messagesCount: number;
    readonly toolsCount: number;
    readonly content: string;
    readonly toolCallCount: number;
    readonly usage: {
        readonly input: number;
        readonly output: number;
    };
    readonly stopReason: string;
}
interface ToolCallDetails {
    readonly toolName: string;
    readonly toolCallId: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly result: unknown;
    readonly error?: boolean;
}
interface CompositionDetails {
    readonly compositionKind: 'Sequence' | 'Parallel' | 'Conditional' | 'Loop';
    readonly childCount: number;
}
interface IterationDetails {
    readonly iteration: number;
    readonly exitReason?: 'body_complete' | 'budget' | 'guard_false' | 'break';
}
interface PauseDetails {
    readonly reason: string;
    readonly questionPayload: Readonly<Record<string, unknown>>;
}
interface EventLogEntry {
    /** Monotonic sequence number — assigned by the recorder. */
    readonly seq: number;
    /** Timestamp at the moment the recorder received the event. */
    readonly wallClockMs: number;
    /** ms since the run started. */
    readonly runOffsetMs: number;
    /** The full typed v2 event. */
    readonly event: AgentfootprintEvent;
    /** Lifted from `event.meta.runtimeStageId` so this entry plugs into
     *  footprintjs's `SequenceRecorder` keyed-index pattern (per-step
     *  lookups, range index, time-travel slicing). Undefined for events
     *  whose dispatcher meta has no stageId attached (rare). */
    readonly runtimeStageId?: string;
}
interface RunSummary {
    readonly startedAt: number;
    readonly endedAt?: number;
    readonly durationMs?: number;
    readonly status: RunNodeStatus;
    readonly llmCallCount: number;
    readonly toolCallCount: number;
    readonly iterationCount: number;
    readonly totalTokens: {
        readonly input: number;
        readonly output: number;
    };
    readonly totalUsd?: number;
    readonly permissionDenials: number;
    readonly paused: boolean;
    /** Error message when the run terminated with a fatal error
     *  (status `'err'`). Sourced from `agentfootprint.error.fatal`. */
    readonly error?: string;
}

/**
 * LensSnapshotRecorder — Lens's incremental, in-traversal projection of
 * the run's structure + payload into a UI-shaped StepGraph.
 *
 * See docs/design/lens-snapshot-recorder.md for the full contract. In
 * one paragraph: this is a CombinedRecorder. footprintjs FlowRecorder
 * events feed STRUCTURE (subflows, forks, decisions, loops);
 * agentfootprint typed events feed PAYLOAD (LLM/tool/context). Both
 * join on `runtimeStageId`. Every event handler is O(1); rendering
 * `getStepGraph()` is O(1) (returns a pre-built reference). NO
 * post-walking, ever — that's the design promise.
 *
 * Pattern: Observer (CombinedRecorder) + per-runtimeStageId index map.
 * Role:    The single source of truth for Lens's UI-shaped graph.
 *          Replaces the post-walker `buildStepGraphFromSnapshot`.
 * Channel: footprintjs FlowRecorder + agentfootprint dispatcher.
 */

interface FlowRunEvent {
    readonly payload?: unknown;
    readonly traversalContext?: TraversalContext;
}
interface LensSnapshotRunnerLike {
    on<K extends AgentfootprintEventType>(type: K, listener: (event: Extract<AgentfootprintEvent, {
        type: K;
    }>) => void): Unsubscribe;
}
interface LensSnapshotRecorderOptions {
    readonly id?: string;
}
/**
 * Build a fresh recorder. Most consumers use it through `LensRecorder`
 * which attaches it internally on `observe(runner)`. Standalone
 * construction is supported for tests and advanced consumers.
 */
declare function lensSnapshotRecorder(options?: LensSnapshotRecorderOptions): LensSnapshotRecorder;
declare class LensSnapshotRecorder implements CombinedRecorder {
    readonly id: string;
    /** Nodes in registration order — matches slider position. Stored as
     *  the mutable shadow so we can decorate in place; exposed as the
     *  readonly StepNode via `getStepGraph()`. */
    private nodes;
    /** O(1) lookup index for payload joins, keyed by runtimeStageId. */
    private nodesById;
    /** Edges in registration order. */
    private edges;
    /** Stack of currently-open subflow runtimeStageIds for boundary tracking. */
    private boundaryStack;
    /** When the run started (for relative timestamps). */
    private runStartMs;
    /** Last seen runId — wipe state when a fresh run reuses identical
     *  runtimeStageIds. Same pattern Phase 2 uses for BoundaryRecorder. */
    private lastRunId;
    /** Cached graph reference — invalidated on any mutation. Returned by
     *  `getStepGraph()` to give consumers stable identity until the next
     *  event fires. Pairs with ChangeNotifier for React's
     *  useSyncExternalStore-style identity-based change detection. */
    private graphCache;
    constructor(options?: LensSnapshotRecorderOptions);
    /**
     * Wipe all state. Called by:
     *   - The runId guard when a new run is detected.
     *   - The owning LensRecorder when consumer calls `lens.clear()`.
     */
    clear(): void;
    /**
     * Subscribe this recorder to agentfootprint's typed-event dispatcher
     * for payload decoration. The structure side (FlowRecorder) is wired
     * separately via `executor.attachCombinedRecorder(this)` — the owning
     * LensRecorder handles both wirings.
     */
    subscribePayload(runner: LensSnapshotRunnerLike): Unsubscribe;
    onRunStart(event: FlowRunEvent): void;
    onRunEnd(_event: FlowRunEvent): void;
    onSubflowEntry(event: FlowSubflowEvent): void;
    onSubflowExit(event: FlowSubflowEvent): void;
    /**
     * The KEY hook for the bug fix. Engine fires `onFork` ATOMICALLY with
     * the full child list when a Parallel composition spawns. Lens emits
     * one fork-branch node per child + one fork-branch edge from the
     * parent. No inference, no missed branches — the engine carries the
     * truth.
     */
    onFork(event: FlowForkEvent): void;
    onDecision(event: FlowDecisionEvent): void;
    onLoop(event: FlowLoopEvent): void;
    /** Returns the pre-built StepGraph. O(1). Stable reference until the
     *  next mutating event. UI consumers pair with ChangeNotifier for
     *  identity-based change detection (useSyncExternalStore et al). */
    getStepGraph(): StepGraph;
    /** O(1) lookup of one node's full payload — useful for detail panes. */
    getNode(runtimeStageId: string): StepNode | undefined;
    /** Push a node into both the ordered list and the lookup index, and
     *  invalidate the cached graph. O(1). */
    private pushNode;
    /** Apply a mutation to one node by runtimeStageId. No-op if the node
     *  hasn't been registered yet (out-of-order events). Invalidates the
     *  graph cache so consumers see the decoration on next read. */
    private decorate;
    private invalidateCache;
    /**
     * Detect a fresh run via `runId` on the TraversalContext (or typed-
     * event meta). On change, wipe ALL state — the same recorder reused
     * across runs starts each one cleanly. First-time observation just
     * records the runId without resetting.
     */
    private observeRunId;
}

/**
 * LensRecorder — subscribes to a v2 Runner's EventDispatcher and
 * builds a RunTree + EventLog from the typed event stream.
 *
 * Pattern: combines TWO library primitives in one consumer class —
 *
 *   - **STORAGE shelf**:  composes a `SequenceStore<EventLogEntry>` from
 *                         footprintjs v5. Append-only ordered +
 *                         keyed-by-runtimeStageId storage with
 *                         `.aggregate()`, `.accumulate()`,
 *                         `.getByKey()`, `.getEntryRanges()`.
 *                         BOUNDED by default (U3): a `maxEvents` FIFO
 *                         cap (default 50K) evicts oldest entries in
 *                         batches; evictions are counted in
 *                         `getDiagnostics().droppedEvents` — never
 *                         silent. See `LensRecorderOptions.maxEvents`.
 *
 *   - **OBSERVER source**: subscribes to the v2 Runner's EventDispatcher
 *                          (typed events).
 *
 * Plus a `LiveStateRecorder` (agentfootprint v3.0+) attached lazily on
 * `observe()` so consumers reading "is the LLM in flight right now?"
 * get an O(1) answer without folding the event log.
 *
 * Mental model:
 *
 *   ```
 *   runner.on('*')  →  store.push()  ─┐
 *                                      ├─→  Selectors  →  Views
 *   event handlers  →  RunTree         │
 *   live trackers   →  LiveStateRecorder ┘  (live commentary)
 *   ```
 *
 * The tree is built incrementally via a stack:
 *   composition.enter / turn_start / iteration_start  → push node
 *   composition.exit / turn_end / iteration_end       → pop node, finalize
 *   llm_start / tool_start                            → push leaf node
 *   llm_end / tool_end                                → pop leaf, attach details
 *   context.* / cost.* / eval.* / ...                 → attach to current top
 *
 * Hand-rolled aggregations are intentionally avoided — `selectSummary`
 * uses `store.aggregate()`, live commentary uses `LiveStateRecorder`.
 * Lens stays a *direct mapping* over library primitives.
 *
 * v5 migration note: this used to `extends SequenceRecorder<EventLogEntry>`
 * but composition is now the canonical pattern (footprintjs Convention 1:
 * one purpose per recorder). Backward-compat: the inherited methods are
 * re-exposed as public delegators (getEntries, getEntriesForStep,
 * getEntryRanges, entryCount) so consumers who used them keep working.
 */

/** Construction options for `LensRecorder` / `lensRecorder()`. */
interface LensRecorderOptions {
    /**
     * Dev-mode diagnostics switch (backlog item U4).
     *
     * - `true`  — `console.warn` once per unknown event type and on every
     *             bracket mismatch, regardless of the global dev-mode flag.
     * - `false` — never warn, even when footprintjs dev mode is on.
     * - unset   — follow footprintjs's global `isDevMode()` flag (the
     *             lens convention — consumers flip it centrally via
     *             `enableDevMode()` / `disableDevMode()`).
     *
     * Counters (`getDiagnostics()`) are ALWAYS maintained — `debug` only
     * controls console output.
     */
    readonly debug?: boolean;
    /**
     * FIFO cap on the event log (backlog item U3). When the number of
     * stored entries exceeds this cap, the OLDEST entries are evicted in
     * batches (~10% of the cap per eviction, amortized O(1) per event)
     * from BOTH the flat event log AND the per-node `events` lists on the
     * run tree — so memory is genuinely released, not just hidden.
     *
     * Eviction is honest, never silent:
     *   - `getDiagnostics().droppedEvents` counts every evicted entry.
     *   - In debug mode (see `debug`) a `console.warn` fires ONCE when
     *     eviction first kicks in.
     *   - Retained entries keep their original `seq`, so consumers see
     *     the gap at the front of the log.
     *
     * What eviction does NOT touch: run-tree STRUCTURE (iteration /
     * llm-call / tool-call nodes — bounded by run shape, not event
     * volume), `selectSummary()`'s `startedAt` / `durationMs` (anchored
     * to the true first event), and the most recent entries. Aggregations
     * over the log (`selectSummary` counts/tokens, `aggregate`,
     * `getEntries`) reflect only RETAINED events once `droppedEvents > 0`.
     *
     * Default: `50_000` (generous — typical debug runs never evict).
     * Pass `Number.POSITIVE_INFINITY` to opt out of the cap entirely.
     * Must be a positive integer (or `Infinity`); anything else throws a
     * `RangeError` at construction.
     */
    readonly maxEvents?: number;
}
/** Default `maxEvents` cap — generous enough that typical debug runs
 *  never evict (REVIEW.md measured ~72 MB at 360K events; 50K ≈ 10 MB). */
declare const DEFAULT_MAX_EVENTS = 50000;
/** Health counters maintained by `LensRecorder` — see `getDiagnostics()`. */
interface LensDiagnostics {
    /** Per-type count of events whose `type` is not a registered
     *  agentfootprint event type. Empty object on a well-formed run. */
    readonly unknownEventTypes: Record<string, number>;
    /** Number of close events (`*_end` / `*.exit`) that did not match the
     *  kind on top of the build stack. 0 on a well-formed run. */
    readonly bracketMismatches: number;
    /** Number of entries evicted by the `maxEvents` FIFO cap (U3).
     *  0 until the cap is exceeded; when non-zero, the event log and every
     *  log-derived view (summary counts, EventStream, commentary) cover
     *  only the retained tail of the run. Reset by `clear()`. */
    readonly droppedEvents: number;
}
declare class LensRecorder {
    /** Stable id for idempotent attach. */
    readonly id = "lens";
    /** Composition: ordered + keyed event-log storage. */
    private readonly store;
    /** Last seen runId from the dispatcher; on change wipe state. */
    private lastRunId;
    private readonly stack;
    /** Synthetic root — always present so selectors have a stable tree even pre-run. */
    private readonly root;
    private seqCounter;
    private runStartMs?;
    private unsubscribes;
    private finalStatus;
    /** Error message when the run terminated fatally (status `'err'`).
     *  Set from `agentfootprint.error.fatal`; surfaced on `selectSummary`. */
    private runError;
    /** Live transient state of the in-flight run. Subscribed in `observe()`,
     *  cleared/disposed on `detach()`. Lens reads `liveState.isLLMInFlight()`
     *  / `getPartialLLM()` / etc. for O(1) live commentary, instead of
     *  folding the event log every render. */
    readonly liveState: LiveStateRecorder;
    /** Incremental StepGraph projection — Phase 4 single source of
     *  structural truth for the UI. Built event-by-event during traversal
     *  (footprintjs FlowRecorder channel + agentfootprint typed events),
     *  read O(1) via `snapshot.getStepGraph()`. See
     *  `docs/design/lens-snapshot-recorder.md` for the contract. */
    readonly snapshot: LensSnapshotRecorder;
    /**
     * agentfootprint's ReAct StepGraph handle, attached in `observe()` via
     * `runner.enable.flowchart()`. This is the SOURCE OF TRUTH for the
     * step graph the UI renders — it captures the full agent reasoning:
     * actor-arrow steps (user→llm / llm→tool / tool→llm / llm→user), each
     * with `iterationIndex` and `slotUpdated`, PLUS the subflow boundaries.
     *
     * Why not LensSnapshotRecorder? That recorder only emits subflow-
     * boundary nodes (composition topology) — it is blind to the Agent's
     * per-iteration stages, so an Agent rendered as an empty graph. Rather
     * than re-derive the ReAct projection in lens (duplication),
     * `getStepGraph()` consumes agentfootprint's already-correct one and
     * falls back to LensSnapshotRecorder only when no runner is observed.
     */
    private flowchartHandle;
    /**
     * Phase 5 Layer 3 — domain-event log with commit-range tracking.
     * Subscribed in `observe()` via both `runner.attach()` (FlowRecorder
     * channel) AND `boundary.subscribe(runner)` (typed-event channel).
     * Lens reads `boundary.boundaryIndex.enclosing(commitIdx)` to drive
     * the commentary slider — see
     * `docs/design/commentary-slider.md`.
     *
     * SECURITY NOTE (panel review): `boundary.getEvents()` returns full
     * DomainEvent objects INCLUDING `payload` (raw scope reads/writes,
     * tool args, LLM content). Payloads are subject to agentfootprint's
     * `RedactionPolicy` at write time, but a third-party component
     * holding the LensRecorder can read raw payloads without going
     * through any UI redaction layer. The READ-ONLY commit-range index
     * (`boundary.boundaryIndex`) returns the STRIPPED projection
     * (no payload) — safe for arbitrary chip rendering. Use the index
     * for commentary; use `getEvents()` only when you've verified the
     * consumer's trust boundary.
     *
     * `getCommitCount` is injected lazily via `runnerCommitCount` so we
     * can reach the live executor's commit count through `runner` at
     * any moment during the run.
     */
    readonly boundary: BoundaryRecorder;
    /**
     * Explain-ui runtime overlay handle — the authoritative source of
     * "which stages have executed at the current scrub position." Pairs
     * with the trace structure recorder used by `lensCollapser` (both
     * produced by explain-ui). LensFlow consumes `overlay.getOverlay()`
     * + `sliceOverlay(overlay, scrubIndex)` to drive node highlighting
     * the same way TracedFlow does internally, while still rendering
     * with lens's custom node types (LLM card, User node, etc.).
     *
     * Without this, lens hand-rolls a runtimeStageId-parsing matcher
     * (`matchCursorToNodeId`) that guesses node ids from cursor strings.
     * With it, the matcher consults explain-ui's authoritative
     * `activeStageId` for the current scrub position.
     */
    readonly runtime: TraceRuntimeOverlayHandle;
    /** Stored from the most recent `observe(runner)` call so the
     *  `getCommitCount` closure on `boundary` can reach the live
     *  executor across multiple events. Cleared on `detach()`. */
    private currentRunner;
    /**
     * Change-notification primitive composed in. Push-based refresh for
     * React (useSyncExternalStore), Vue (refs), Angular (signals),
     * Recoil (atoms), CLI/DOM consumers — all subscribe to the SAME
     * notifier. See `ChangeNotifier` JSDoc for adapter examples.
     */
    private readonly notifier;
    /** Explicit debug override from options; `undefined` = follow the
     *  global footprintjs `isDevMode()` flag. See `LensRecorderOptions`. */
    private readonly debug;
    /** Per-type count of events outside the agentfootprint registry.
     *  Always maintained (debug only gates console output). */
    private readonly unknownEventTypes;
    /** Count of `popIfKind` bracket mismatches. Always maintained. */
    private bracketMismatchCount;
    /** Unknown types already warned about — warn ONCE per type, not per
     *  event, so a chatty unknown emitter can't flood the console. */
    private readonly warnedUnknownTypes;
    /** FIFO cap on the event log — see `LensRecorderOptions.maxEvents`. */
    private readonly maxEvents;
    /** Entries evicted by the cap so far. Surfaced via `getDiagnostics()`. */
    private droppedEventCount;
    /** Eviction already warned about — warn ONCE per run, not per batch. */
    private warnedEviction;
    constructor(rootLabel?: string, options?: LensRecorderOptions);
    /** Reset all transient state. Called on detach + on detected runId
     *  change so a recorder reused across runs doesn't accumulate. */
    clear(): void;
    /**
     * Health counters for the observed event stream (backlog item U4).
     * Always maintained — no debug flag needed — so UIs and tests can
     * assert stream health without scraping the console:
     *
     *   - `unknownEventTypes` — per-type counts of events whose `type` is
     *     not in agentfootprint's event registry (e.g. a newer
     *     agentfootprint emitting types this lens doesn't know, or a
     *     custom dispatcher leaking foreign events). These events are
     *     still attached to the current top node — counted, not dropped.
     *   - `bracketMismatches` — close events (`llm_end`, `tool_end`,
     *     `composition.exit`, ...) whose kind didn't match the top of the
     *     build stack (malformed ordering). The close is skipped; the
     *     tree stays partially structured rather than crashing.
     *   - `droppedEvents` — entries evicted by the `maxEvents` FIFO cap
     *     (U3). When non-zero, log-derived views cover only the retained
     *     tail of the run.
     *
     * All are `{}` / `0` on a well-formed run that stayed under the cap.
     * Reset by `clear()`. Returns a fresh snapshot object on every call.
     */
    getDiagnostics(): LensDiagnostics;
    /** Whether diagnostic warnings go to the console: explicit option
     *  wins; otherwise follow footprintjs's global dev-mode flag
     *  (evaluated per event so `enableDevMode()` mid-run takes effect). */
    private debugEnabled;
    /**
     * The StepGraph the UI renders — agentfootprint's ReAct projection
     * (actor-arrow steps with `iterationIndex` + `slotUpdated`, plus
     * subflow boundaries). Prefers the live `flowchartHandle` from
     * `observe()`; falls back to `snapshot.getStepGraph()` (subflow-only)
     * when no runner is observed (e.g. a standalone snapshot consumer).
     *
     * This is why an Agent now renders its per-iteration reasoning instead
     * of an empty graph — the handle is a SUPERSET of the snapshot
     * recorder's output, so every existing consumer keeps working.
     */
    getStepGraph(): StepGraph;
    /**
     * Live commit count for the currently-observed run. PUBLIC accessor
     * used by `useCommentarySlider` to size the slider extent (Law 1 of
     * the design doc: slider total = commitLog.length, not max of
     * boundary ranges). Returns 0 before any `observe()` or when the
     * runner exposes no executor.
     */
    getCommitCount(): number;
    /**
     * Live commit log for the currently-observed run. Reaches through the
     * runner to the executor's snapshot. Returns `[]` before any
     * `observe()` or when the runner exposes no executor. Each commit
     * entry carries `runtimeStageId` and `stageId` (and other fields per
     * footprintjs's `CommitBundle` shape).
     *
     * This is THE source for Lens's one-cursor architecture — the slider
     * indexes into this list, and `runtimeGroupId` is derived per commit
     * via the boundary index. See
     * `memory/lens_v0_1_one_cursor_architecture.md`.
     */
    getCommitLog(): ReadonlyArray<{
        readonly runtimeStageId?: string;
        readonly stageId?: string;
        /** Keys this commit actually CHANGED (footprintjs commits are change-only).
         *  Used to light only the slots whose contribution changed. Agent commits
         *  are not run-namespaced, so the top-level overwrite/updates keys ARE the
         *  scope keys (e.g. `systemPromptInjections`). */
        readonly overwriteKeys?: readonly string[];
    }>;
    /**
     * Live commit-count accessor injected into the BoundaryRecorder.
     * Reaches through the currently-observed runner to its last
     * executor's `getCommitCount()`. Returns 0 if no runner is being
     * observed or the runner exposes no executor — degrades gracefully
     * (BoundaryRecorder treats this as legacy mode AT CALL TIME, but
     * with the difference that hasCommitTracking is set ONCE at
     * construction. So we always return a number; just 0 when nothing
     * is wired up). Phase 5 Layer 3.
     */
    private runnerCommitCount;
    /**
     * Push-based change subscription. Delegates to the composed
     * `ChangeNotifier` so React / Vue / Angular / Recoil / vanilla DOM
     * adapters all share the same primitive.
     *
     * @returns Disposer; safe to call multiple times.
     */
    subscribe(listener: () => void): () => void;
    /** Monotonic version — snapshot key for `useSyncExternalStore` /
     *  Vue ref / Angular signal. Bumped on every observed event. */
    getVersion(): number;
    /**
     * Subscribe to a v2 Runner's typed dispatcher. Call once per run.
     * Returns an unsubscribe for the consumer — calling it detaches the
     * recorder (useful for cleanup after post-run rendering is done).
     */
    observe(runner: Runner): Unsubscribe;
    /** Detach from all observed runners. Idempotent. */
    detach(): void;
    private handleEvent;
    /**
     * U3 — enforce the `maxEvents` FIFO cap. When the store exceeds the
     * cap, evict the oldest entries down to ~90% of the cap in ONE batch
     * (amortized O(1) per event: one O(retained) rebuild per ~10%-of-cap
     * pushes), then prune the SAME evicted entries from every run-tree
     * node's `events` list — entry objects are shared references, so
     * skipping the tree would hide the memory, not release it.
     *
     * `SequenceStore` is append-only by design (no removal API), so the
     * batch rebuild (clear + re-push retained) is the supported eviction
     * path; the per-step key + range indices rebuild correctly during
     * re-push.
     */
    private enforceCap;
    /** Drop entries with `seq < minSeq` from a node's `events` list (and
     *  its descendants'). Per-node lists are seq-ordered, so this is a
     *  prefix splice — in place, preserving the node object identity the
     *  build stack may still hold. */
    private pruneNodeEvents;
    /** Notify all subscribers + bump version. Delegated to ChangeNotifier. */
    private bumpVersion;
    /**
     * U4 diagnostics — count (and, in debug, warn ONCE per type about)
     * event types outside agentfootprint's registry. One Set lookup per
     * event on the happy path.
     */
    private noteUnknownType;
    /**
     * Kind-specific handling. Keeps the switch exhaustive over every v2
     * event type we structurally care about; the default branch is the
     * "attach to current top, no structural change" path which has
     * already fired above.
     */
    private dispatch;
    private top;
    private push;
    /**
     * Pop the top node IF its kind matches, applying finalization fields.
     * Mismatched kinds (indicating malformed event ordering) are SKIPPED,
     * never thrown — Lens prefers partial correctness to crashes. Every
     * mismatch increments `getDiagnostics().bracketMismatches` (U4), and
     * when debug is on (`LensRecorderOptions.debug` or footprintjs
     * `isDevMode()`) each mismatch logs a `console.warn` with the
     * expected vs found kind plus the closing event's `runtimeStageId`.
     * Well-formed runs stay console-silent either way.
     */
    private popIfKind;
    /** Number of entries stored. O(1). Mirrors `SequenceStore.size`. */
    get entryCount(): number;
    /** All entries in append order. Returns a shallow copy. */
    getEntries(): EventLogEntry[];
    /** All entries that share `runtimeStageId`. Returns a shallow copy. */
    getEntriesForStep(runtimeStageId: string): EventLogEntry[];
    /** O(1) per-step range index for time-travel scrubbing. */
    getEntryRanges(): ReadonlyMap<string, {
        firstIdx: number;
        endIdx: number;
    }>;
    /** Single-pass fold over every entry. */
    aggregate<TAcc>(reducer: (acc: TAcc, entry: EventLogEntry) => TAcc, init: TAcc): TAcc;
    /** Single-pass fold over entries whose `runtimeStageId` is in `keys`.
     *  Used for time-travel scrubbing — pass the slider's revealed
     *  runtimeStageIds and get the cumulative value up to that position. */
    accumulate<TAcc>(reducer: (acc: TAcc, entry: EventLogEntry) => TAcc, init: TAcc, keys: ReadonlySet<string>): TAcc;
    /** The complete ordered event log. Composition over the underlying store. */
    selectEventLog(): readonly EventLogEntry[];
    /** The RunTree — frozen, recursive, immutable snapshot. */
    selectRunTree(): RunTreeNode;
    /** Summary stats — computed lazily via `store.aggregate()`.
     *  Single-pass fold; types derived from the AgentfootprintEvent
     *  discriminated union.
     *
     *  U3 caveat: once the `maxEvents` cap has evicted entries
     *  (`getDiagnostics().droppedEvents > 0`), the folded counts/tokens
     *  reflect only RETAINED events. `startedAt` / `durationMs` stay
     *  anchored to the true first event of the run (tracked outside the
     *  store), so the time axis never shifts. */
    selectSummary(): RunSummary;
}
/** Convenience factory for consumers who prefer not to `new` the class. */
declare function lensRecorder(rootLabel?: string, options?: LensRecorderOptions): LensRecorder;

/**
 * ChangeNotifier — framework-agnostic Observable primitive.
 *
 * Lens emits one notification per ingested event so any consumer
 * (React, Vue, Angular, Recoil, vanilla DOM, CLI) can refresh its view
 * without polling.
 *
 * Pattern: classic publish/subscribe + monotonic version number.
 *   - `subscribe(listener)` registers a listener; returns disposer.
 *   - `getVersion()` returns a number that changes on every notify().
 *     Frameworks like React's `useSyncExternalStore` use this as a
 *     snapshot identity check.
 *   - `notify()` fires every listener synchronously and bumps version.
 *
 * Why this exists as its OWN class (not inlined on LensRecorder):
 *   - Adapters for non-React frameworks (Vue refs, Angular signals,
 *     Recoil atoms) can wrap the SAME primitive without depending on
 *     React's `useSyncExternalStore`.
 *   - Future Lens components that need their own change-broadcast
 *     (e.g., a derived `LensSelectorCache`) reuse this primitive
 *     instead of re-implementing it.
 *   - Tests can assert change-notification semantics in isolation.
 *
 * Failure semantics: a listener that throws does NOT abort other
 * listeners. The error is swallowed (Lens prefers partial liveness
 * over crash-on-bad-listener). Consumers should log inside their own
 * listeners if visibility is needed.
 *
 * @example Vanilla adapter (DOM):
 *
 * ```typescript
 * const off = recorder.subscribe(() => {
 *   document.getElementById('event-count')!.textContent =
 *     String(recorder.entryCount);
 * });
 * // ... later
 * off();
 * ```
 *
 * @example Vue 3 adapter (composable). Returns COMPUTED refs so
 * template expressions actually re-render — returning the raw recorder
 * object would NOT trigger re-renders because Vue can't see the
 * external mutation.
 *
 * ```typescript
 * import { shallowRef, computed, onUnmounted } from 'vue';
 * export function useLens(recorder: LensRecorder) {
 *   const version = shallowRef(recorder.getVersion());
 *   const off = recorder.subscribe(() => { version.value = recorder.getVersion(); });
 *   onUnmounted(off);
 *   // computed() depends on `version` so each notify() re-runs them.
 *   return {
 *     runTree: computed(() => (version.value, recorder.selectRunTree())),
 *     summary: computed(() => (version.value, recorder.selectSummary())),
 *     log: computed(() => (version.value, recorder.selectEventLog())),
 *   };
 * }
 * ```
 *
 * @example Angular signal adapter:
 *
 * ```typescript
 * import { signal, effect } from '@angular/core';
 * const version = signal(recorder.getVersion());
 * recorder.subscribe(() => version.set(recorder.getVersion()));
 * effect(() => { version(); render(recorder.selectRunTree()); });
 * ```
 */
declare class ChangeNotifier {
    private version;
    private readonly listeners;
    /** Register a change listener. Returns a disposer. Idempotent — the
     *  same listener function added twice is stored once. */
    subscribe(listener: () => void): () => void;
    /** Monotonic version. Bumped before each `notify()` call. Use as the
     *  snapshot key for `useSyncExternalStore` / Vue ref / Angular signal. */
    getVersion(): number;
    /** Bump version + fire every listener synchronously. A throwing
     *  listener doesn't abort the others. */
    notify(): void;
    /** Listener count — exposed for diagnostics + tests. */
    get listenerCount(): number;
}

/**
 * @deprecated FOR LIVE USE — use `LensSnapshotRecorder` instead, which
 * builds the StepGraph incrementally as the engine traverses (O(1) per
 * event, NO post-walk). This function walks the snapshot tree once
 * per call, which becomes O(N²) when invoked from a render loop.
 *
 * STILL VALID for offline / replay scenarios where you have a
 * snapshot from a completed run but no live event stream — e.g.,
 * loading a saved RuntimeSnapshot from disk to render.
 *
 * See `docs/design/lens-snapshot-recorder.md` for the full rationale
 * (the "Law 1" section explicitly forbids post-walking on the live path).
 *
 * `buildStepGraphFromSnapshot` — derives a Lens StepGraph from
 * footprintjs's canonical RuntimeSnapshot. Pure function, no state.
 *
 * Inputs:
 *   - footprintjs RuntimeSnapshot (`runner.getLastSnapshot()`)
 *
 * Outputs:
 *   - Lens StepGraph (nodes + edges) — same shape FlowchartRecorder
 *     produces today, but with structural info sourced from the
 *     canonical snapshot, not from typed events.
 *
 * What this function does NOT do:
 *   - Decorate nodes with payload (LLM tokens, tool args, context
 *     injections). That's a separate join step against typed events.
 *
 * Algorithm (recursive walk over `executionTree.next`):
 *   1. Each StageSnapshot represents one stage. Inspect its
 *      `description` for composition kind:
 *        - "LLMCall: …"          → subflow node, primitiveKind=LLMCall
 *        - "Agent: …"            → subflow node, primitiveKind=Agent
 *        - "Sequence: …"         → subflow node, primitiveKind=Sequence
 *        - "Parallel: N-way fanout" → fork node + N fork-branch nodes
 *        - "Conditional: …"      → decision node + chosen branch
 *        - "Loop: …"             → subflow node + iteration edges
 *   2. Walk `flowMessages` for control-flow transitions (next, fork
 *      with `targetStage[]`, decision with chosen branch, loop).
 *   3. Recurse into `next` chain.
 */

/** Footprintjs StageSnapshot — the runtime tree node shape. We only
 *  read fields the snapshot reliably populates; `unknown` for the rest.
 *  All fields optional so this matches footprintjs's RuntimeSnapshot
 *  even when fields are partially populated mid-traversal. */
interface StageSnapshot {
    id?: string;
    runtimeStageId?: string;
    name?: string;
    description?: string;
    subflowId?: string;
    flowMessages?: ReadonlyArray<FlowMessage>;
    next?: StageSnapshot;
}
interface FlowMessage {
    type: 'next' | 'children' | 'subflow' | 'decision' | 'loop' | string;
    description?: string;
    timestamp?: number;
    targetStage?: string | readonly string[];
    count?: number;
}
interface RuntimeSnapshotLike {
    executionTree?: StageSnapshot;
}
/**
 * Build a StepGraph from a footprintjs snapshot. Returns an empty
 * graph (no nodes, no edges) if the snapshot is undefined or has no
 * executionTree (run hasn't started).
 */
declare function buildStepGraphFromSnapshot(snapshot: RuntimeSnapshotLike | undefined): StepGraph;

/**
 * buildSpecTreeFromBoundary — Phase 5 Layer 4 adapter from
 * BoundaryRecorder's commit-range index to explainable-ui's
 * `SpecNode` tree shape.
 *
 * Why this exists: footprint-explainable-ui's `specToLayout` walks a
 * tree (children-as-array → horizontal fanout; next chain → vertical
 * stack). BoundaryRecorder owns a FLAT range index. This helper
 * bridges the two — building the tree from boundary parent/child
 * relationships derived from `subflowPath`.
 *
 * Pure function. No framework imports. No React. Called from the
 * `<RunTreeFlow>` component (or any non-React adapter) on every
 * change-notify; memoized at the call site.
 *
 * See `docs/design/lens-layout-unification.md` for the full contract.
 */

/**
 * SpecNode — Lens-local subflow tree shape.
 *
 * Historically imported from `footprint-explainable-ui/flowchart`, but
 * v0.20+ no longer exports the type (the legacy spec-walk path was
 * removed — explainable-ui now consumes `TraceGraph` via recorders
 * instead). Lens still uses this shape internally to walk the
 * BoundaryRecorder-derived composition tree (children/next/subflow
 * structure), so we define it locally as the single source of truth.
 *
 * The `icon` field is a Lens addition — `buildSpecTreeFromBoundary`
 * stamps it from the primitive kind ('agent' / 'llm' / 'fork' / etc.)
 * so downstream renderers (`useAgentLegend`, `useCompareBranches`) can
 * dispatch on it without re-parsing the description.
 */
interface SpecNode {
    name: string;
    id?: string;
    description?: string;
    icon?: string;
    children?: SpecNode[];
    next?: SpecNode;
    isSubflowRoot?: boolean;
    subflowId?: string;
    subflowName?: string;
    subflowStructure?: SpecNode;
}
/**
 * Build a `SpecNode` tree from the BoundaryRecorder's commit-range
 * index. The tree is rooted at a synthetic `__root__` node so
 * `specToLayout` has a single entry point.
 *
 * Algorithm:
 *   1. Get all ranges from the index (open + closed).
 *   2. Sort by depth ascending — parents always processed before children.
 *   3. Build a `byPath` index keyed by the FULL subflowPath (joined) so
 *      parent lookup is O(1) and immune to sibling-name collisions
 *      (two `legal` branches under different parents stay distinct).
 *   4. Attach each label to its parent's `children[]` (parent is a
 *      fanout kind — Parallel / Conditional) OR to its `next` chain
 *      (Sequence-like). Fanout-vs-sequence is read from the parent's
 *      OWN `primitiveKind`, not re-parsed from `description`.
 *   5. Return the root.
 *
 * Returns a tree with `children` only if any ranges exist. Empty index
 * → tree with no children (renders as a single `__root__` node).
 */
declare function buildSpecTreeFromBoundary(boundary: BoundaryRecorder): SpecNode;

/**
 * Humanizer — transforms a v2 event into a natural-language commentary line.
 *
 * Pattern: Strategy (GoF). The default implementation ships with Lens;
 *          consumers can override per-domain or whole.
 * Role:    Feeds the analyst-view commentary panel + any other
 *          natural-language surface (logs, chat bubbles, exports).
 * Emits:   N/A — pure fn.
 *
 * Contract: a humanizer returns a string (rendered) or `null` (skip
 * this event — too low-signal for commentary). Never throws; any
 * unknown event is rendered as a terse `[type]` fallback.
 */

type Humanizer = (event: AgentfootprintEvent) => string | null;
/**
 * Default humanizer — the library's canonical rendering. Covers every
 * event domain; consumers who want domain-specific wording compose
 * their own via `humanizeWith` (below).
 */
declare const defaultHumanizer: Humanizer;
/**
 * Compose a humanizer with consumer overrides. Overrides run first;
 * when they return `undefined`, the default humanizer fills in. This
 * keeps consumer code small — they only author lines for the events
 * they care about.
 *
 * @example
 *   const humanizer = humanizeWith({
 *     'agentfootprint.stream.tool_start': (e) =>
 *       `🛠️  ${e.payload.toolName}(${JSON.stringify(e.payload.args)})`,
 *   });
 */
declare function humanizeWith(overrides: Partial<{
    [K in AgentfootprintEvent['type']]: (event: Extract<AgentfootprintEvent, {
        type: K;
    }>) => string | null | undefined;
}>): Humanizer;
/**
 * Default `teachingHumanizer` — uses `'Chatbot'` as the app name. For
 * consumer-specific naming, use `makeTeachingHumanizer({ appName })`.
 */
declare const teachingHumanizer: Humanizer;

/**
 * `selectHops` — derive the ordered list of LOGICAL ARROWS for a run.
 *
 * Pattern: pure function over (graph, drillPath, agents). Returns one
 *          `Hop` per visible flowchart arrow — so `hops.length` is the
 *          slider step count, and the slider's i-th position highlights
 *          the i-th arrow. "step = arrow" is the user-facing mental
 *          model; this selector is the single source of truth for it.
 *
 * Why this lives in the lens-core (not agentfootprint): the LIBRARY
 * already exposes the right primitives (`StepNode.subflowPath`,
 * `isPrimitiveBoundary`, kind tags). Lens just walks them and labels
 * the transitions. Adding a domain-aware concept ("Hop") to the engine
 * would over-couple it to UI rendering. The selector is a thin
 * derivation, not new state.
 *
 * Two modes — driven by the SAME primitive (subflow boundaries):
 *
 *   ── Multi-agent top-level ──
 *   Drill path empty AND >1 primitive boundary. Hops are the
 *   AGENT-CHAIN arrows: User → agent[0], agent[i] → agent[i+1],
 *   agent[N-1] → User. Slider walks `agents.length + 1` positions.
 *
 *   ── Single-agent OR drilled-in ──
 *   The visible steps inside the active agent (filtered by
 *   subflowPath) are themselves the hops — each `user->llm`,
 *   `llm->tool`, `tool->llm`, `llm->user` step IS one arrow.
 *   Sub-flow / fork-branch / decision-branch nodes are NOT hops
 *   (they're container nodes, not arrows).
 *
 * The two modes are NOT special cases; they're the same rule applied
 * at different scopes — at top-level, the "agents" themselves are the
 * unit of traversal; drilled in, the ReAct steps inside one agent are.
 */

/**
 * One arrow on the flowchart = one slider position. Each Hop carries:
 *
 *   - `id`              — stable key (slider index, edge React key)
 *   - `kind`            — what kind of transition this is
 *   - `source`/`target` — actor or agent IDs (matches flowchart node ids)
 *   - `label`           — short edge label (asks / forwards / answers / token count / tool name)
 *   - `anchorStep`      — the StepNode the slider should focus when this hop is active
 *
 * Hops are ordered: index 0 is the first arrow drawn in the run.
 */
interface Hop {
    readonly id: string;
    readonly kind: 'asks' | 'forwards' | 'answers' | StepNode['kind'];
    readonly source: string;
    readonly target: string;
    readonly label: string;
    /** The StepNode the slider focuses when this hop is the active one.
     *  `undefined` for synthetic hops that don't anchor to a single step
     *  (e.g., a top-level "User asks classify" hop anchors on classify's
     *  boundary, not on a specific internal step). */
    readonly anchorStep?: StepNode;
}
interface SelectHopsArgs {
    readonly graph: StepGraph;
    readonly drillPath: readonly string[];
    readonly agents: readonly AgentInstance[];
}
declare function selectHops(args: SelectHopsArgs): Hop[];

/**
 * ViewModel types — consumer-facing shapes produced by `lens/core/selectors/`.
 *
 * These are the SINGLE data contract between the headless selector
 * layer and every framework binding (React today, Vue / Angular / CLI
 * tomorrow). Selectors return these shapes; framework components
 * render them. No framework-specific fields leak here.
 */

/**
 * The four actor roles a ReAct cycle surfaces to the user:
 *
 *   - `user`   — outside the Agent container; asks + receives answers
 *   - `llm`    — the LLM primitive inside an Agent
 *   - `tool`   — external execution bound to the Agent
 *   - `skill`  — activated capability that contributed to a slot
 *
 * Consumer renderers map these to their own node components. Adding
 * a new actor requires a type widening here + mapping in consumers.
 */
type ActorId = 'user' | 'llm' | 'tool' | 'skill';
/**
 * One agent boundary in the run. Single-agent runs produce ONE
 * `AgentInstance` (`groupId: 'agent-root'`); multi-agent runs
 * (Swarm / Debate / Hierarchy) produce one per sub-agent.
 *
 * `subflowPath` mirrors the footprintjs topology path — use it to
 * filter StepGraph steps that belong to this agent (drill-down mode).
 */
interface AgentInstance {
    readonly groupId: string;
    readonly llmId: string;
    readonly toolId: string;
    readonly label: string;
    readonly subflowPath: readonly string[];
    /**
     * Primitive kind (`'Agent'` / `'LLMCall'` / `'Sequence'` / `'Parallel'`
     * / `'Conditional'` / `'Loop'`) parsed from the runner's root
     * `<Kind>:` taxonomy prefix. Drives the container subtitle in
     * `AgentGroupNode` so an LLMCall renders as `'LLMCall · one-shot'`,
     * a Sequence as `'Sequence · pipeline'`, etc. — instead of the
     * (legacy) hardcoded `'ReAct loop'`. Undefined when the StepGraph
     * carries no description metadata; the renderer falls back to a
     * neutral subtitle.
     */
    readonly primitiveKind?: string;
}
/**
 * One AGGREGATED edge for the triangle view. Multiple steps between
 * the same two actors collapse to one edge with:
 *   - count of traversals
 *   - label from the most-recent step (tokens / tool name)
 *   - `kind` preserved from the driving step
 *
 * Eliminates the "four stacked arrows" problem for multi-iteration
 * runs. Rendered as one line per `(source, target)` pair.
 */
interface EdgeAgg {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    /** Named handle on source node (e.g. `llm-right-out`) for precise routing. */
    readonly sourceHandle?: string;
    /** Named handle on target node (e.g. `tool-left-in`) for precise routing. */
    readonly targetHandle?: string;
    readonly kind: StepNode['kind'];
    readonly label: string;
    readonly count: number;
    readonly mostRecentIdx: number;
    readonly dashed: boolean;
}
/**
 * Detail for the currently-focused step — what the right-side debug
 * pane renders. Pulled from the EventLog at selection time; no
 * caching, pure derivation.
 */
interface FocusDetail {
    readonly stepId: string;
    readonly kind: StepNode['kind'];
    /**
     * LLM output text — for `user->llm` / `tool->llm` / `llm->user` steps.
     * Empty string `''` is a valid value (LLM returned no content, only
     * tool_calls). `undefined` means no matching `llm_end` event was
     * found in the log. Renderers should distinguish the two.
     */
    readonly llmReasoning?: string;
    /** Decision the LLM made — route picked, tool selected, or 'final'. */
    readonly llmDecision?: {
        readonly route: string;
        readonly rationale?: string;
    };
    /** Tool call args — for `llm->tool` steps. */
    readonly toolArgs?: Record<string, unknown>;
    /** Tool result — for `llm->tool` steps (after tool_end fires). */
    readonly toolResult?: string;
    /** Token usage — for LLM steps. */
    readonly tokens?: {
        readonly in: number;
        readonly out: number;
    };
}
interface BreadcrumbItem {
    readonly id: string;
    readonly label: string;
}
/**
 * Everything a renderer needs in ONE shape. `useStepView` (React hook)
 * or equivalent bindings in other frameworks produce this on every
 * render, passing it to dumb components.
 */
interface StepView {
    /**
     * Rendering mode:
     *   - `top-level`  → each agent is a collapsed node; edges = handoffs
     *   - `drill-down` → one agent expanded; edges = internal ReAct cycle
     */
    readonly mode: 'top-level' | 'drill-down';
    readonly agents: readonly AgentInstance[];
    /** Steps up to focusIndex. `visibleSteps.length === focusIndex + 1`. */
    readonly visibleSteps: readonly StepNode[];
    /** Actors that have been touched by at least one visible step. */
    readonly touched: ReadonlySet<ActorId>;
    readonly edges: readonly EdgeAgg[];
    readonly activeEdgeKey?: string;
    readonly currentStep?: StepNode;
    readonly totalSteps: number;
    readonly breadcrumb: readonly BreadcrumbItem[];
    /** The full graph; consumers usually use `visibleSteps` instead. */
    readonly graph: StepGraph;
    /**
     * Logical arrows for THIS scope — one per slider position. Drives:
     *   - flowchart edge rendering (no inline edge synthesis)
     *   - slider total (`hops.length`)
     *   - focused-step lookup (`hops[focusStep].anchorStep`)
     *
     * Multi-agent top-level: `agents.length + 1` hops (asks + N-1
     * forwards + answers). Single-agent / drilled-in: one hop per
     * `user->llm` / `llm->tool` / `tool->llm` / `llm->user` step.
     */
    readonly hops: readonly Hop[];
}

/**
 * `selectAgentInstances` — derive AgentInstance[] from a StepGraph.
 *
 * Pattern: pure function over the `isPrimitiveBoundary` flag that
 *          agentfootprint sets on every subflow StepNode whose root
 *          description carries a known `<Kind>:` prefix (Agent /
 *          LLMCall / Sequence / Parallel / Conditional / Loop).
 *          Single-primitive runs produce one synthetic root instance;
 *          composed runs produce one per primitive subflow.
 * Role:    Feeds the top-level agent-grouping layer in Lens (one
 *          container per primitive instance). Framework-agnostic.
 *
 * Naming: kept as `selectAgentInstances` for backwards compatibility —
 * "Agent" here means "an outlined container in the run-tree view," not
 * specifically "ReAct agent." The narrow flag (`isAgentBoundary`)
 * remains available on each StepNode for callers that care about the
 * distinction (cost / iteration attribution).
 */

/**
 * Produce one AgentInstance per primitive boundary in the graph.
 *
 * Derivation:
 *   - If ANY StepNode has `isPrimitiveBoundary === true`, use those.
 *     Their `id` becomes the instance's `subflowPath` root segment.
 *   - Otherwise, synthesize a single root instance covering the run.
 *     Matches the common case of a standalone primitive run (e.g., a
 *     standalone LLMCall whose chart has no top-level subflow).
 *
 * Each instance carries a `primitiveKind` (when the StepGraph supplies
 * one) so the renderer picks the correct icon + subtitle:
 *   - Agent boundary       → `'Agent'`       → `'🤖 Agent · ReAct loop'`
 *   - LLMCall boundary     → `'LLMCall'`     → `'📡 LLMCall · one-shot'`
 *   - Sequence boundary    → `'Sequence'`    → `'➡️ Sequence · pipeline'`
 *   - Parallel boundary    → `'Parallel'`    → `'🔀 Parallel · fan-out'`
 *   - Conditional boundary → `'Conditional'` → `'🪧 Conditional · route'`
 *   - Loop boundary        → `'Loop'`        → `'🔁 Loop · iterate'`
 *
 * IDs are stable within a run — safe to use as React keys.
 */
declare function selectAgentInstances(graph: StepGraph): AgentInstance[];

/**
 * `selectTouched` — compute the set of actors touched by the visible steps.
 *
 * Pattern: pure reduce over a step slice. Drives "hide un-used actors"
 *          rendering (Tool stays hidden until an `llm->tool` /
 *          `tool->llm` step appears within focus).
 * Role:    Progressive-reveal support. Matches v1's `touched` set
 *          used in `StageFlow.tsx`.
 */

/**
 * Return the set of actors (user / llm / tool / skill) that at least
 * one step in `visibleSteps` involves. USER is always included — the
 * run begins with a user message regardless.
 *
 * Note: `skill` currently piggy-backs on step labels containing
 * "skill" — upgraded to a real field once agentfootprint surfaces
 * skill activation as a distinct step kind.
 */
declare function selectTouched(visibleSteps: readonly StepNode[]): ReadonlySet<ActorId>;

/**
 * `selectEdges` — aggregate ReAct steps into per-actor-pair edges.
 *
 * Pattern: reduce visible steps into a Map<`source->target`, EdgeAgg>.
 *          Multiple traversals of the same hand-off (e.g., user→llm
 *          across two iterations) collapse to one line with a count.
 * Role:    Eliminates the "stack of N arrows between User and LLM"
 *          visual clutter. Matches v1's `StageFlow.edges` aggregation.
 */

/**
 * Map a step to its actor-pair edge endpoints for a given agent
 * instance. Returns null for steps that don't lift to ReAct edges
 * (subflow / fork-branch / decision-branch — those render as nodes,
 * not edges).
 *
 * @internal used by `selectEdges`; exported for testing.
 */
declare function stepToStageEndpoints(step: StepNode, agent: AgentInstance): {
    readonly source: string;
    readonly target: string;
    readonly sourceHandle?: string;
    readonly targetHandle?: string;
    readonly dashed: boolean;
} | null;
/**
 * Short, human-friendly label for a step's edge. Tokens for LLM steps,
 * tool name for tool steps, duration for timed steps, empty for
 * zero-duration markers.
 */
declare function stepEdgeLabel(step: StepNode): string;
/**
 * Aggregate visible steps into one `EdgeAgg` per actor-pair.
 *
 * Invariants:
 *   - Every returned edge has `count >= 1`.
 *   - `mostRecentIdx` is the highest step index using this edge.
 *   - `label` reflects the most-recent step's label (falls back to
 *     any earlier non-empty one so edges aren't unlabeled in the
 *     rare case where a later step has nothing useful to show).
 */
declare function selectEdges(visibleSteps: readonly StepNode[], agent: AgentInstance): EdgeAgg[];

/**
 * `selectFocusDetail` — pull the debug-pane detail for one focused step.
 *
 * Pattern: single forward scan of the event log to find the events
 *          bracketing this step. Returns the LLM reasoning / decision
 *          / tool args / tool result that belongs to the selected
 *          step, or `undefined` if the step has no bound detail.
 * Role:    Feeds the right-side Debug Pane in Lens (or equivalent
 *          detail view in other frameworks). Pure — framework-agnostic.
 */

/**
 * Extract detail for the given step from the event log.
 *
 * Match strategy: the step was opened by an `llm_start` (for LLM
 * steps) or `tool_start` (for tool steps) whose `runOffsetMs` aligns
 * with `step.startOffsetMs`. We walk the log, find that event, then
 * read the matching `_end` event plus any nearby `agent.route_decided`
 * to fill in the detail fields.
 *
 * Zero caching. Small log = cheap to re-run per render.
 */
declare function selectFocusDetail(step: StepNode | undefined, log: readonly EventLogEntry[]): FocusDetail | undefined;

/**
 * `selectStepAgentName` — pick the human-friendly agent name a step
 * "belongs to" in a multi-agent run.
 *
 * Pattern: walk the agent list, prefix-match the step's `subflowPath`,
 *          and return the deepest matching agent's label. Used to
 *          enrich step labels in multi-agent contexts so callers can
 *          render "user → classify" instead of generic "user → llm".
 *
 * Returns `undefined` for single-agent runs (caller falls back to the
 * step's own label) and for steps that don't lift to any agent (root
 * synthetic nodes, the User actor, etc.).
 */

/**
 * Find the agent whose `subflowPath` is the deepest prefix of the
 * step's `subflowPath`. Returns the cleaned label of that agent or
 * `undefined` when no agent matches (or only ONE agent exists, in
 * which case the caller already shows the agent in the container
 * header and prefixing every step would be redundant).
 */
declare function selectStepAgentName(step: StepNode, agents: readonly AgentInstance[]): string | undefined;

/**
 * `selectStepView` — top-level ViewModel composer.
 *
 * Pattern: compose the smaller selectors into the `StepView` shape
 *          consumers render. Pure function over `(graph, log,
 *          focusIndex, drillPath)`.
 * Role:    The one function every Lens binding calls. React's
 *          `useStepView` hook wraps this in `useMemo`; Vue / Angular
 *          / CLI bindings call it directly.
 *
 * No framework imports. No caching inside the selector (React's
 * `useMemo` or equivalent handles per-render stability).
 */

interface SelectStepViewArgs {
    readonly graph: StepGraph;
    readonly log: readonly EventLogEntry[];
    /** Current focus position. Clamped to [0, graph.nodes.length - 1]. */
    readonly focusIndex: number;
    /** Drill stack. Empty = top-level; `['triage']` = drilled into triage agent. */
    readonly drillPath: readonly string[];
}
/**
 * Compose the ViewModel.
 *
 * Mode selection:
 *   - `drillPath.length === 0` → top-level view. All agents surface.
 *     For single-agent runs this is equivalent to the triangle.
 *   - `drillPath.length > 0` → drill-down. Filter steps to the agent
 *     whose subflowPath matches. Edges compute against that agent's
 *     stage ids.
 *
 * Invariants:
 *   - `totalSteps` always equals `graph.nodes.length` (not the visible
 *     count) so consumers size their slider to the WHOLE run.
 *   - `visibleSteps.length === focusIndex + 1` (or graph.nodes.length
 *     if focus is at max).
 *   - `touched` includes at least `user` (run begins with user msg).
 */
declare function selectStepView(args: SelectStepViewArgs): StepView;

/**
 * `selectContextEngineeringInjections` — filter injections to the
 * ENGINEERED set (exclude baseline user + tool-result).
 *
 * Pattern: pure function over a step's injections. Applies the stable
 *          `BASELINE_SOURCES` filter: `user` and `tool-result` are the
 *          standard LLM-API flow and don't constitute "context
 *          engineering." Everything else (`rag`, `skill`, `memory`,
 *          `instruction`, `grounding`, consumer-custom) is engineered.
 * Role:    The teaching surface for Lens's Context Engineering bin.
 *          Matches the filter that `agent.enable.contextEngineering()`
 *          will apply once that API lands — consumers get identical
 *          results whether they derive client-side via this selector
 *          or subscribe to the enable handle.
 *
 * Why the filter lives here (selector) AND in agentfootprint (enable
 * handle) when that lands:
 *   - Today's Lens consumes `StepNode.injections[]` directly; the
 *     selector is the only place to drop baseline.
 *   - Tomorrow, `enable.contextEngineering({ onInjection })` gives
 *     non-Lens consumers a pre-filtered stream — they don't need the
 *     selector at all.
 *   - The filter rule is the SAME (stable set of baseline sources),
 *     so the two paths produce identical output. Documenting once
 *     here keeps them in sync.
 */

/**
 * Sources that represent baseline LLM-API flow — NOT context engineering:
 *
 *   - `user`        → the user's current-turn message OR prior user-turn
 *                     history replay (standard conversation flow)
 *   - `tool-result` → tool return for the current call OR prior-turn
 *                     tool-result history replay
 *   - `assistant`   → prior-turn assistant output replayed as history
 *                     (standard conversation continuity)
 *   - `base`        → static system prompt configured at build time
 *                     via `.system('...')` — NOT engineered
 *   - `registry`    → tool registry configured at build time via
 *                     `.tool(...)` — the static tool list
 *
 * What's left — the ENGINEERED sources (chips in the Lens bin):
 *   `rag` · `skill` · `memory` · `instruction` · `grounding` +
 *   consumer-custom sources
 *
 * Contract for library extensions: if you re-inject content with
 * engineered intent (memory strategy, RAG retriever, skill activator,
 * instruction system, grounding rule), you MUST set your own source
 * at the injection site — don't let role-based inference drop you
 * into the baseline bucket.
 */
declare const BASELINE_SOURCES: ReadonlySet<string>;
/**
 * True when this injection represents engineered context (not baseline
 * API flow). Reads the immutable `source` field — no derivation from
 * role or slot.
 */
declare function isContextEngineering(inj: ContextInjection): boolean;
/**
 * Filter a step's injections to the engineered subset. Returns a new
 * readonly array; empty if the step had only baseline injections.
 *
 * Use: Lens's ContextBinNode gets this array; empty → "No engineered
 * context yet" empty state. Full → the 5-axis teaching chips.
 */
declare function selectContextEngineeringInjections(injections: readonly ContextInjection[] | undefined): readonly ContextInjection[];

/**
 * selectCommentary — Phase 5 Layer 3 selectors over BoundaryRecorder's
 * commit-range index. Pure functions; no framework imports.
 *
 * `selectCommentaryAt(boundary, commitIdx)` returns the active chip +
 * breadcrumb + sibling list at one commit position.
 *
 * `selectCommentaryRanges(boundary)` returns all known ranges as a
 * flat list for snap-point rendering in the slider.
 *
 * See `docs/design/commentary-slider.md` for the contract.
 */

interface CommentaryAtCommit {
    /** Leaf-most enclosing boundary at this commit — the ACTIVE chip.
     *  Undefined if no boundary encloses the position (e.g., commit at
     *  index 0 before any subflow opened). */
    readonly active: BoundaryRangeLabel | undefined;
    /** All enclosing boundaries, ordered outer→inner. Renders as the
     *  breadcrumb path. Parallel-sibling boundaries (e.g., legal +
     *  ethics in a Committee) both appear here when commitIdx lies in
     *  the overlap — consumers that need a strict tree path should
     *  filter by `depth` or `subflowPath` prefix. */
    readonly breadcrumb: readonly BoundaryRangeLabel[];
}
interface CommentaryRange {
    readonly label: BoundaryRangeLabel;
    readonly startIdx: number;
    /** Undefined while the range is still open (mid-run boundary). */
    readonly endIdx: number | undefined;
}
/**
 * Snap a commit position to its commentary state — active chip +
 * breadcrumb path.
 *
 * Both results derive from BoundaryRecorder's CommitRangeIndex —
 * Layer 2 owns the data, this selector projects it for UI.
 *
 * Note on siblings: an earlier draft computed parallel-sibling
 * boundaries via `overlapping(commitIdx, commitIdx) - enclosing(commitIdx)`,
 * but at a single-point query those sets are identical — the subtraction
 * is always empty. Proper sibling computation needs a tree-walk over
 * the breadcrumb (group ranges by depth and detect parents). Deferred
 * to a future layer; for now consumers can compute siblings themselves
 * by filtering `breadcrumb` by depth.
 */
declare function selectCommentaryAt(boundary: BoundaryRecorder, commitIdx: number): CommentaryAtCommit;
/**
 * Get all commit-range entries (open + closed) for snap-point
 * rendering. Returns a stable order: by `startIdx` ascending. Used by
 * the slider in commentary mode to mark each range's entry position
 * as a snap target.
 *
 * We query `overlapping(0, +Infinity)` (effectively all ranges) — the
 * underlying CommitRangeIndex doesn't expose a "list all" method, but
 * a wide-overlap query returns every range. O(N) on the index.
 */
declare function selectCommentaryRanges(boundary: BoundaryRecorder): readonly CommentaryRange[];

/**
 * cursorPositionsAtDrill — compute the slider's valid cursor positions
 * for the current drill level.
 *
 * Pure function. Layer 1 / Tier B / Lens v0.1.
 *
 * The COMPOUND time axis rule (locked architecture):
 *
 *   The slider does NOT iterate every commit. Its positions equal the
 *   chart's visible nodes at the current drill level. One slider stop
 *   per chart box.
 *
 *     drill depth 0       → top-level groups (each composition = ONE stop)
 *     drill depth N       → direct sub-groups of the drilled group
 *     leaf (no sub-groups) → commits enclosed by the drilled group
 *
 *   Cursor type is still `runtimeStageId`. Only the SUBSET of valid
 *   positions changes with drill depth. ONE cursor concept; the
 *   position set scales by drill.
 *
 * Inputs
 * ──────
 *   `groups`     — all groups in the run (from `buildGroups`)
 *   `commits`    — the full commit log (for leaf-group commit detail)
 *   `drillPath`  — the chain of `runtimeGroupId`s the user has drilled
 *                  into. Empty means "top-level Run." The LAST element
 *                  is the currently-drilled group; everything BEFORE it
 *                  is the path used by the breadcrumb.
 */

interface CursorPosition {
    /** Slider value — a runtimeStageId in footprintjs's address space,
     *  OR one of the lens-synthetic ids above for user-in/user-out. */
    readonly runtimeStageId: string;
    /** Same as runtimeStageId when this position IS a group's start/end. */
    readonly runtimeGroupId: string;
    /** Human-readable label ("Committee · forks", "merged", "Run · start"). */
    readonly label: string;
    /** Discriminates slider tick rendering. `user-in` and `user-out` are
     *  lens-synthesized bookends at top-level drill. `parallel` is a single stop
     *  that represents a parallel fork — see `coActiveGroupIds`. */
    readonly kind: 'group-start' | 'group-end' | 'commit' | 'user-in' | 'user-out' | 'parallel';
    /** Depth in the outline (for indentation / breadcrumb sync). */
    readonly depth: number;
    /** Commit index this position anchors to (for footprintjs jumpTo). */
    readonly commitIdx: number;
    /**
     * When this stop represents a PARALLEL fork (the context slots, or parallel
     * branches), the runtimeGroupIds of ALL concurrent branches that ran — so the
     * chart can highlight them SIMULTANEOUSLY at this one stop. `undefined` for
     * ordinary single-node stops (old behaviour byte-identical). The canonical
     * `runtimeStageId` above is still ONE id (the earliest-opening branch — the
     * fork anchor); this is auxiliary chart-highlight data only, never a second
     * cursor. The one-cursor invariant holds: panels (commentary/details/trace)
     * stay on `runtimeStageId`; only the CHART lights the whole set.
     */
    readonly coActiveGroupIds?: readonly string[];
}

/**
 * selectToolChoiceCall — resolve the ONE cursor to a tool-choice call.
 *
 * Layer 1 / pure selector (RFC-002 block C7).
 *
 * The Lens has exactly ONE time cursor — a `runtimeStageId` (see
 * `memory/lens_v0_1_one_cursor_architecture.md`). The Tool-choice panel
 * derives its visible call FROM that cursor; it never owns a second
 * cursor or a parallel "call index". Resolution rule (spec order):
 *
 *   1. cursor AT a recorded LLM call (exact runtimeStageId) → that call;
 *   2. cursor WITHIN an LLM call's enclosing subflow (the cursor is the
 *      subflow-root position, e.g. `sf-llm-call#5`, and a recorded call
 *      ran inside it, e.g. `sf-llm-call/call-llm#7`) → that call. The
 *      call belonging to THIS execution of the subflow is the one with
 *      the SMALLEST executionIndex greater than the cursor's — the next
 *      loop iteration's subflow root already has a higher index than
 *      this iteration's call;
 *   3. otherwise → the nearest-PREVIOUS call (largest executionIndex
 *      ≤ the cursor's). Before the first call → `undefined`.
 *
 * Root / synthetic positions: `__root__` at `group-start` (and the
 * lens-synthetic `user-in` bookend) mean "nothing happened yet" →
 * `undefined`; `__root__` at `group-end` / `user-out` mean "the whole
 * run" → the LAST call (the run-summary view). An empty cursor (no
 * positions yet — live edge before the first commit) also resolves to
 * the last call so live monitoring shows the most recent choice.
 *
 * Documented edge: when a loop iteration's LLM call offered NO tools
 * (the recorder skips menu-less calls), a cursor on that iteration's
 * subflow root resolves to the NEXT recorded call under the same
 * subflow (rule 2 cannot tell the iterations apart without group
 * ranges). Monotone with the cursor, never throws.
 */

declare function selectToolChoiceCall(calls: readonly ToolChoiceCall[], cursorRuntimeStageId: string, cursorKind?: CursorPosition['kind']): ToolChoiceCall | undefined;

/**
 * `buildLLMText(recorder, stepGraph)` — assembles a single Markdown
 * blob describing the entire run, ready to paste into a chat (Claude,
 * ChatGPT) for debugging assistance.
 *
 * Design parallel to footprint-explainable-ui's NarrativePanel "Copy
 * for LLM" — same audience (a developer asking an LLM "why did this
 * happen?"), same shape (run summary + per-step payloads + per-
 * boundary rollups + commentary). Lens-specific because the data
 * sources are the StepGraph + BoundaryRecorder + LensRecorder
 * (extends SequenceRecorder<EventLogEntry>), not the footprintjs
 * narrative entries.
 *
 * Sections produced (in order):
 *
 *   1. Run Summary                — status, duration, totals
 *   2. Per-Boundary Rollups       — one block per Agent / LLMCall /
 *                                    Sequence / etc. (multi-agent runs
 *                                    benefit most; single-Agent runs
 *                                    print one block)
 *   3. Steps                      — every visible StepNode with its
 *                                    payload (assistantText / toolArgs
 *                                    / toolResult / final answer /
 *                                    boundary entry+exit payloads)
 *   4. Commentary                 — humanized per-event lines (one
 *                                    per emitted event, time-stamped)
 *
 * Pure projection — no DOM, no clipboard. The caller (Lens.tsx) wires
 * the result to navigator.clipboard.writeText().
 */

interface BuildLLMTextArgs {
    readonly recorder: LensRecorder;
    readonly stepGraph?: StepGraph;
    /** Optional per-boundary rollups (from
     *  `BoundaryRecorder.aggregateAllBoundaries`). When provided, the
     *  output includes a "Per-Boundary Rollups" section keyed by
     *  runtimeStageId. */
    readonly boundaryRollups?: readonly BoundaryAggregate[];
    /** Humanizer used to render the Commentary section. Defaults to a
     *  bare `[type]` formatter when not supplied. */
    readonly humanizer?: Humanizer;
    /** App name woven into commentary lines. Default: `'Chatbot'`. */
    readonly appName?: string;
    /** Optional snapshot of the consumer's current view state — slider
     *  position, focused step, drill path, etc. When provided, output
     *  includes a "Current View State" section so an LLM (or human
     *  reviewer) can diagnose slider-sync / focus / drill issues from
     *  the paste alone. */
    readonly viewState?: ViewStateSnapshot;
}
/** Snapshot of the Lens render state at copy time. All fields optional
 *  — pass whichever the consumer can cheaply provide. */
interface ViewStateSnapshot {
    /** Slider position (0-based step index). */
    readonly focusStep?: number;
    /** Total number of steps in the slider. */
    readonly totalSteps?: number;
    /** Live or paused (autoAdvance state). */
    readonly isLive?: boolean;
    /** Drill-down path (`[]` = top-level). */
    readonly drillPath?: readonly string[];
    /** `'top-level'` or `'drill-down'`. */
    readonly mode?: "top-level" | "drill-down";
    /** Currently-focused StepNode at the slider position. */
    readonly currentStep?: {
        readonly label?: string;
        readonly kind?: string;
        readonly runtimeStageId?: string;
        readonly subflowPath?: readonly string[];
        readonly iterationIndex?: number;
    };
    /** Number of visible steps at the current slider position. */
    readonly visibleStepsCount?: number;
    /** Resolved event-log seq the slider currently anchors to. */
    readonly focusedEventSeq?: number;
    /** Which actor lanes are "lit" at the current slider position
     *  (e.g. `['user', 'llm', 'tool']`). */
    readonly touched?: readonly string[];
    /** Active edge key (the edge highlighted as "current"). */
    readonly activeEdgeKey?: string;
}
/** Build the full LLM-ready Markdown blob for the current run. */
declare function buildLLMText(args: BuildLLMTextArgs): string;

/**
 * LensGroupOutput — the UI-agnostic shape every per-kind Lens translator
 * emits.
 *
 * Layer 0 (pure types) / Lens v0.1 translator pipeline.
 *
 * Why a graph (nodes + edges) and not a tree
 * ──────────────────────────────────────────
 *   The locked Lens v0.1 architecture (`memory/lens_v0_1_one_cursor_architecture.md`)
 *   renders compositions as a flat graph of compound containers, leaves,
 *   and control-flow edges. xyflow / React Flow consume this shape
 *   directly: `nodes` become `Node[]` (with `parentId` for compound
 *   containment), `edges` become `Edge[]` typed by kind. Vue/D3
 *   consumers map the same graph to their own primitives — no Lens
 *   logic needs to change per UI framework.
 *
 * Why this lives ABOVE agentfootprint's `GroupMetadata`
 * ──────────────────────────────────────────────────────
 *   `GroupMetadata` is the agentfootprint primitive — UI-agnostic,
 *   single-composition. The Lens translator FOLDS over it (and its
 *   recursive `member.uiGroup` outputs) to produce a single flat
 *   `LensGroupOutput` for the WHOLE tree. The fold lives in Lens —
 *   agentfootprint stays unaware of graph shape, parent-child
 *   pinning, edge kinds, or any rendering concern.
 *
 * Composition rule
 * ────────────────
 *   Every per-kind translator returns a `LensGroupOutput`. Parents
 *   merge children's outputs via `mergeOutputs` + (optionally)
 *   `pinUnderParent` to set the compound-container relationship.
 *   The same fold pattern composes ANY depth.
 */

/**
 * One ReactFlow / xyflow-ready node, in UI-agnostic shape. Consumers
 * map this to their framework's Node primitive without inspecting
 * agentfootprint internals.
 *
 * `kind` discriminates rendering:
 *   - `'group'` — compound container (ReactFlow `type: 'group'`).
 *                 Holds children via the children's `parentId`.
 *   - `'stage'` — leaf node. Renders as a pill / card. Can be drillable
 *                 when the composition kind supports it (Agent / LLMCall).
 *
 * `primitiveKind` carries the agentfootprint kind (`'Parallel'` /
 * `'Agent'` / ...) — Lens uses it to pick icons, theme colors, and
 * drill-in behaviour without re-deriving from labels.
 *
 * `metadata` is the bag of consumer-facing extras a per-kind translator
 * surfaces: slot ids for Agent / LLMCall cards, merge strategy for
 * Parallel, iteration budgets for Loop, etc. Closed enough per
 * `primitiveKind` that consumers can switch on it safely.
 *
 * Renderer escaping note
 * ──────────────────────
 *   `label` and string values inside `metadata` reach the consumer's
 *   renderer VERBATIM. React's default JSX text-node behaviour escapes
 *   them automatically; renderers that bypass that path (raw HTML
 *   insertion, custom non-React frameworks) own their own escaping.
 *   Lens does not sanitise.
 */
interface LensNode {
    readonly id: string;
    readonly kind: 'group' | 'stage';
    /**
     * Display label. Reaches the renderer verbatim — renderer owns
     * escaping if it bypasses React's default JSX text-node behaviour.
     */
    readonly label: string;
    readonly primitiveKind: GroupKind;
    /**
     * Parent compound container's `id` when this node renders INSIDE a
     * group. xyflow uses this for `parentId` + `extent: 'parent'`
     * pinning so the child can't be dragged outside the container.
     * `undefined` for top-level nodes.
     */
    readonly parentId?: string;
    /**
     * Per-kind metadata bag. Closed enough that consumers can switch on
     * `primitiveKind` and read the expected fields safely. Concrete
     * shapes per kind:
     *
     *   Parallel:     { mergeStrategy: 'fn' | 'llm' | 'outcomes-fn' }
     *   Agent:        { slots: readonly string[], toolNames: readonly string[],
     *                   maxIterations: number }
     *   LLMCall:      { slots: readonly string[] }
     *   Sequence:     {} (empty — pure linear)
     *   Loop:         { maxIterations, maxWallclockMs?, hasUntilGuard }
     *   Conditional:  { fallbackId: string }
     *
     * Agent / LLMCall note
     * ────────────────────
     *   Their `GroupMetadata.members` array is EMPTY by design — slots,
     *   tool names, iteration budgets arrive via `GroupMetadata.extra`
     *   and surface here in `metadata`. Per-kind translators must NOT
     *   try to map slots to child members; the slot-rendering belongs
     *   inside the Agent/LLMCall stage node itself.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/**
 * One control-flow edge. `kind` mirrors the footprintjs control-flow
 * vocabulary so consumers can theme each kind (solid arrow for `next`,
 * fanned-out for `fork-branch`, dashed back-arrow for `loop-iteration`,
 * decision arrow for `decision-branch`).
 *
 * `label` is optional and used for the user-facing edge annotation
 * (the predicate name on a Conditional decision branch, the branch id
 * on a Parallel fork, the iteration counter on a Loop back-edge).
 */
interface LensEdge {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly kind: 'next' | 'fork-branch' | 'loop-iteration' | 'decision-branch';
    /**
     * Optional edge annotation. Reaches the renderer verbatim — renderer
     * owns escaping if it bypasses React's default JSX text-node
     * behaviour. Lens does not sanitise.
     */
    readonly label?: string;
}
/**
 * One per-kind translator's complete output: a flat graph (nodes +
 * edges) ready for a UI framework to render. Frozen at construction
 * time — translator outputs are immutable so reference identity holds
 * (matching the `getUIGroup()` contract on the runner side).
 *
 * `rootNodeId` names the SEMANTIC root of this output — the node a
 * parent composition would pin children under via `pinUnderParent`,
 * and the target of any incoming control-flow edge from upstream.
 * For Parallel it's the compound container; for Sequence / Loop /
 * Conditional / Agent / LLMCall it's the lead node of the linear
 * walk.
 *
 * `exitNodeId` names the SEMANTIC exit of this output — the source
 * of any outgoing control-flow edge to a downstream composition.
 * For most leaves and chains it equals `rootNodeId` (entry == exit).
 * For compositions that emit a SYNTHETIC tail node:
 *
 *   - Parallel emits a `Merge` synthetic stage that collects all
 *     branches; `exitNodeId` = merge node id.
 *   - Conditional emits a `Converge` synthetic stage that collects
 *     all branches; `exitNodeId` = converge node id.
 *   - Sequence's `exitNodeId` = the LAST member's `exitNodeId`.
 *   - Loop's `exitNodeId` = the body's `exitNodeId` (loop bounds
 *     are decorative, not part of the linear walk).
 *
 * Outer compositions chain by drawing `next` edges from the inner
 * `exitNodeId` to the next member's `rootNodeId`. Without this
 * distinction, chains-of-chains would emit edges from the Sequence's
 * first step instead of its last, breaking the visual flow.
 *
 * Empty-fold sentinel
 * ───────────────────
 *   `mergeOutputs([], rootNodeId)` returns an output with
 *   `nodes: []`, `edges: []`, and the caller-supplied `rootNodeId`.
 *   A caller producing a 0-member parent is probably mis-modeling its
 *   composition — Lens does not throw, but the empty output should be
 *   treated as an observability signal upstream.
 */
interface LensGroupOutput {
    readonly nodes: readonly LensNode[];
    readonly edges: readonly LensEdge[];
    readonly rootNodeId: string;
    /**
     * Exit node id. Defaults to `rootNodeId` when omitted (leaves and
     * single-entry compositions). Per-kind translators that emit a
     * synthetic tail node (Parallel → Merge, Conditional → Converge)
     * set this to the synthetic node's id so outer compositions chain
     * from the right place.
     */
    readonly exitNodeId?: string;
}

/**
 * lensGroupTranslator — kind-discriminated dispatcher composing the
 * six per-kind translators into a single `GroupTranslator` ready to
 * pass to any agentfootprint composition's `groupTranslator`
 * constructor option (or `getUIGroupWith(...)` per-method override).
 *
 * Layer 2.4 (dispatcher) / Lens v0.1 translator pipeline.
 *
 * Recursion strategy
 * ──────────────────
 *   The per-kind translators are PURE — they don't import the
 *   dispatcher and don't recurse on their own. Instead, each
 *   compound translator (Parallel / Sequence / Loop / Conditional)
 *   takes a `MemberResolver` callback. The dispatcher constructs a
 *   resolver that:
 *
 *     1. If `member.uiGroup` is already populated (because the
 *        consumer wired a `groupTranslator` at that level), trust
 *        it and cast to `LensGroupOutput`.
 *     2. Otherwise call `member.runner.getUIGroupWith(lensGroupTranslator)`
 *        to recurse with the same dispatcher. This means the
 *        consumer only needs to wire `lensGroupTranslator` ONCE
 *        at the top of the tree.
 *     3. If both paths yield undefined, throw — the member's
 *        runner doesn't expose any UI group shape, which is a
 *        consumer bug (or a footprintjs bug if a built-in runner
 *        forgot to implement `buildUIGroupMetadata`).
 *
 * Why a single dispatcher, not a Map of translators
 * ──────────────────────────────────────────────────
 *   A `switch` on the discriminator keeps the dispatcher
 *   well-typed without `as` casts: the compiler narrows
 *   `metadata.kind` inside each branch so the per-kind translator
 *   call type-checks. A `Record<GroupKind, GroupTranslator>` would
 *   widen the `metadata` argument and lose narrowing.
 *
 * Pure function — no closures over module state. The dispatcher is
 * its own resolver: the `getUIGroupWith` call passes a reference to
 * the same exported function, closing the recursion cleanly.
 */

/**
 * Translate one `GroupMetadata` into a `LensGroupOutput`. Dispatches
 * to the appropriate per-kind translator based on `metadata.kind`.
 * Throws `TypeError` on unknown kinds — keeps the union closed at
 * runtime, not just at compile time.
 */
declare const lensGroupTranslator: GroupTranslator<LensGroupOutput>;

/**
 * makeNodeId — stable, collision-free node id derivation for
 * `LensNode.id`.
 *
 * Layer 1 (helpers, pure) / Lens v0.1 translator pipeline.
 *
 * Why a dedicated helper
 * ──────────────────────
 *   Per-kind translators need deterministic ids that survive across
 *   re-builds AND don't collide when the same `GroupMetadata.id`
 *   string appears at different composition levels (e.g., two
 *   sub-Parallels both named `'committee'` under different parents).
 *   Centralising the rule keeps the per-kind translators free of
 *   "did I get the prefix right" mistakes and gives one canonical
 *   shape for tests to assert against.
 *
 * Convention
 * ──────────
 *   Top-level node:        `<kindLowerCase>:<id>`         e.g., `parallel:committee`
 *   Member of a parent:    `<parentNodeId>/<memberId>`    e.g., `parallel:committee/legal`
 *
 *   The `<parentNodeId>` form is what a caller passes when stamping
 *   children — it already includes its own prefix, so collisions
 *   across composition trees are impossible.
 *
 * Pure function — no closures, no module state.
 */

/** Build a top-level node id from the composition kind + id. */
declare function makeRootNodeId(kind: GroupKind, id: string): string;
/**
 * Build a child node id rooted under a parent node. The parent's id is
 * passed verbatim — it already contains its own kind prefix so the
 * resulting id is collision-free across composition trees.
 */
declare function makeChildNodeId(parentNodeId: string, memberId: string): string;

/**
 * makeEdge — factory for `LensEdge` with deterministic id derivation.
 *
 * Layer 1 (helpers, pure) / Lens v0.1 translator pipeline.
 *
 * Why a dedicated factory
 * ───────────────────────
 *   Edge ids must be globally unique within a `LensGroupOutput` (xyflow
 *   keys edges by `id` for diff). Per-kind translators previously had to
 *   roll their own id strings, leaking the "did I encode kind + source
 *   + target consistently" responsibility across the codebase. This
 *   helper centralises the rule so every edge id is predictable and
 *   collision-free.
 *
 * Convention
 * ──────────
 *   `<kind>:<source>->\<target>`           e.g., `next:seed->merge`
 *   `<kind>:<source>->\<target>#<n>`        when N edges share endpoints
 *
 *   The optional `#N` disambiguator handles cases where the same logical
 *   edge appears twice (rare; e.g., loop-iteration self-edges across
 *   two iteration contexts). Callers pass `n` explicitly — the helper
 *   does NOT track state.
 *
 * Pure function — no closures, no module state.
 */

/**
 * Build a `LensEdge` with a deterministic id from kind + endpoints.
 * Optional `n` disambiguates collisions when the same logical edge
 * appears more than once.
 */
declare function makeEdge(kind: LensEdge['kind'], source: string, target: string, options?: {
    label?: string;
    n?: number;
}): LensEdge;

/**
 * mergeOutputs — fold N `LensGroupOutput`s into one.
 *
 * Layer 1 (helpers, pure) / Lens v0.1 translator pipeline.
 *
 * Why a dedicated fold
 * ────────────────────
 *   Compositions with multiple members (Parallel, Sequence,
 *   Conditional) each produce one `LensGroupOutput` per member. The
 *   parent composition merges them — concatenating nodes + edges and
 *   preserving order. Centralising the fold means every per-kind
 *   translator follows the same merge semantics (concat, no dedup, no
 *   reorder) so consumers can reason about the final graph from any
 *   translator output without surprise.
 *
 * Identity
 * ────────
 *   `mergeOutputs([])` returns the EMPTY output (no nodes, no edges,
 *   empty rootNodeId). Callers must NOT rely on this empty form for
 *   semantic meaning — they own picking a real `rootNodeId` AFTER the
 *   fold (e.g., the parent container's id). The empty `rootNodeId`
 *   is a sentinel: any caller producing a 0-member parent is
 *   probably mis-modeling its composition.
 *
 * Order preservation (locked)
 * ───────────────────────────
 *   Nodes appear in the order they're encountered (depth-first by
 *   caller). xyflow renders nodes in array order — preserving the
 *   composition's natural ordering means Lens defaults to "left-to-
 *   right by declaration" which matches developer mental models.
 *
 * Dev-mode collision guard
 * ────────────────────────
 *   When footprintjs `isDevMode()` is on, the fold asserts that node
 *   ids and edge ids are globally unique across the merged subgraphs.
 *   Duplicate ids would silently produce a malformed xyflow graph
 *   (xyflow keys both nodes and edges by id; duplicates cause
 *   rendering and diff surprises that are hard to debug). The check
 *   is gated on dev mode so production paths pay zero overhead, in
 *   line with the footprintjs convention (CLAUDE.md → "Dev Mode").
 *   Collision sources we have seen in practice:
 *
 *     - two sibling compositions sharing the same caller-supplied id
 *     - a nested Loop emitting a duplicate `loop-iteration` self-edge
 *       whose endpoints alias an outer loop's body root
 *     - a Sequence whose first member's `rootNodeId` collides with
 *       another sibling's leading node
 *
 *   Production callers can opt in to the guard via `enableDevMode()`.
 *
 * Pure function — no closures, no module state.
 */

/**
 * Concatenate N outputs' nodes + edges into a single output. The
 * caller supplies the `rootNodeId` AFTER the fold (typically the
 * parent composition's container id; for a flat fold with no
 * container, the lead member's `rootNodeId`).
 */
declare function mergeOutputs(outputs: readonly LensGroupOutput[], rootNodeId: string): LensGroupOutput;

/**
 * pinUnderParent — set `parentId` on every TOP-LEVEL node of a child
 * output so xyflow renders the child inside the parent's compound
 * container.
 *
 * Layer 1 (helpers, pure) / Lens v0.1 translator pipeline.
 *
 * Why "all top-level nodes" (not just the root)
 * ─────────────────────────────────────────────
 *   Top-level = "no `parentId` set in the child output". That nicely
 *   subsumes both compositional shapes:
 *
 *     1. Child has its OWN container (Parallel / Agent / LLMCall)
 *        ─ the container is the only top-level node; the container's
 *          internal members already carry `parentId: container`.
 *          Result: only the container is re-pinned under the new
 *          parent, preserving the inner compound structure.
 *
 *     2. Child has NO own container (Sequence / Loop / Conditional)
 *        ─ all of the child's nodes are top-level. xyflow needs each
 *          one to live INSIDE the parent's compound box, so every
 *          top-level node gets the new `parentId`.
 *
 *   This matches xyflow's compound model: `parentId` is single-level,
 *   and a node renders inside whichever container its `parentId`
 *   points to. We never overwrite an already-set `parentId`, which
 *   would otherwise re-parent grandchildren away from their proper
 *   compound box.
 *
 * Why a new output (not in-place mutation)
 * ────────────────────────────────────────
 *   `LensGroupOutput` is documented as reference-stable. Mutating an
 *   input output would silently change a value the runner has memoised
 *   in its `uiGroupCache`. Returning a new output preserves the
 *   runner-side memoisation invariant.
 *
 * Pure function — no closures, no module state.
 */

/**
 * Return a new `LensGroupOutput` identical to `child` except every
 * TOP-LEVEL node (no `parentId`) now carries `parentId: parentNodeId`.
 * Nodes that already carry a `parentId` pass through unchanged so
 * grandchildren stay pinned inside their proper inner container.
 *
 * `child.rootNodeId` is preserved verbatim — it remains the semantic
 * entry point for parent compositions wiring control-flow edges.
 */
declare function pinUnderParent(child: LensGroupOutput, parentNodeId: string): LensGroupOutput;

/**
 * translateAgent — `Agent` GroupMetadata → `LensGroupOutput`.
 *
 * Layer 2 (per-kind translator, pure) / Lens v0.1 translator pipeline.
 *
 * What it emits
 * ─────────────
 *   ONE `stage` node carrying the Agent's `extra` (slots, toolNames,
 *   maxIterations) as `metadata`. No edges. `rootNodeId` points at
 *   the single node so a parent composition can attach control-flow
 *   edges to it.
 *
 * Why a leaf node (not a compound group)
 * ──────────────────────────────────────
 *   Agent's slots (SystemPrompt / Messages / Tools) and tool list
 *   render INSIDE the Agent card itself in Lens v0.1 — the
 *   slot/tool UI is a per-card concern, not a compound-graph
 *   concern. The Agent's iteration loop is a runtime artifact
 *   (visualised via timeline / step recorder), not a graph
 *   topology element here.
 *
 *   The whole point of Lens's three render boxes (Parallel / Agent /
 *   LLMCall) is that an Agent card opens to its detail view on drill-
 *   in; the card itself stays as one graph node.
 *
 * Pure function — no closures, no module state. Member array is
 * always empty for Agent (`buildUIGroupMetadata` returns
 * `members: []`); the translator does not iterate it.
 */

declare function translateAgent(metadata: GroupMetadata): LensGroupOutput;

/**
 * MemberResolver — per-kind translator callback for resolving a
 * `GroupMember` into the `LensGroupOutput` of its subgraph.
 *
 * Layer 2 (per-kind translator interfaces, pure) / Lens v0.1.
 *
 * Why parameterise this in
 * ────────────────────────
 *   Per-kind translators are PURE — they must not close over module
 *   state or import the dispatcher. The dispatcher (L2.4) constructs
 *   a `MemberResolver` that recurses via
 *   `member.runner.getUIGroupWith(lensGroupTranslator)` when
 *   `member.uiGroup` is undefined, and passes the resolver to the
 *   per-kind translator. This keeps the recursion in ONE place
 *   (the dispatcher) and makes per-kind translators trivially
 *   testable against any `LensGroupOutput` you can hand-construct.
 *
 * Contract
 * ────────
 *   Given a `GroupMember`, return its `LensGroupOutput`. The
 *   dispatcher's default resolver throws when both `member.uiGroup`
 *   is undefined AND `member.runner.getUIGroupWith(...)` returns
 *   undefined (meaning the member's runner does not expose any UI
 *   group shape — caller bug). Per-kind translators trust the
 *   resolver to always succeed or throw upstream — they do not
 *   tolerate undefined return values themselves.
 */

type MemberResolver = (member: GroupMember) => LensGroupOutput;

/**
 * translateConditional — `Conditional` GroupMetadata → `LensGroupOutput`.
 *
 * Layer 2 (per-kind translator, pure) / Lens v0.1 translator pipeline.
 *
 * What it emits
 * ─────────────
 *   ONE synthetic `stage` node (the decision point) carrying the
 *   conditional's `extra` (`fallbackId`) as `metadata`, plus each
 *   branch's subgraph, plus N `decision-branch` edges from the
 *   decision point to each branch's `rootNodeId`. The decision
 *   point's id is `conditional:<id>`. The edge for the fallback
 *   branch is labelled `'<memberId> (default)'` so the renderer
 *   can highlight it without reading the metadata bag.
 *
 * Why a synthetic decision node
 * ─────────────────────────────
 *   xyflow needs a concrete source for every edge. Conditional has
 *   no caller-supplied node to serve as that source (the runtime
 *   decision is data, not a node) — so we synthesise one. It
 *   renders as a small diamond / "?" stage in the default theme,
 *   matching the convention readers expect from BPMN-style
 *   flowcharts.
 *
 *   The decision node is NOT a compound box: only Parallel / Agent /
 *   LLMCall get those (locked Lens v0.1 architecture). Conditional's
 *   visual presence is the decision point + the fanout edges.
 *
 * Pure function — no closures, no module state.
 */

declare function translateConditional(metadata: GroupMetadata, resolve: MemberResolver): LensGroupOutput;

/**
 * translateLLMCall — `LLMCall` GroupMetadata → `LensGroupOutput`.
 *
 * Layer 2 (per-kind translator, pure) / Lens v0.1 translator pipeline.
 *
 * What it emits
 * ─────────────
 *   ONE `stage` node carrying the LLMCall's slot list as `metadata`.
 *   No edges (leaves are terminal). The output's `rootNodeId` points
 *   at this single node so a parent composition can attach control-
 *   flow edges to it.
 *
 * Why a leaf node (not a compound group)
 * ──────────────────────────────────────
 *   LLMCall's slots (SystemPrompt / Messages / Tools) render INSIDE
 *   the stage card itself in Lens v0.1 — the slot UI is a per-card
 *   concern, not a compound-graph concern. Translating slots into
 *   xyflow child nodes would scatter them across the graph and break
 *   the locked "three boxes only" rendering rule (Parallel / Agent /
 *   LLMCall).
 *
 * Pure function — no closures, no module state. Member array is
 * always empty for LLMCall (`buildUIGroupMetadata` returns
 * `members: []`); the translator does not iterate it.
 */

declare function translateLLMCall(metadata: GroupMetadata): LensGroupOutput;

/**
 * translateLoop — `Loop` GroupMetadata → `LensGroupOutput`.
 *
 * Layer 2 (per-kind translator, pure) / Lens v0.1 translator pipeline.
 *
 * What it emits
 * ─────────────
 *   The body's subgraph unchanged, plus ONE self-edge of kind
 *   `loop-iteration` from the body's `rootNodeId` back to itself.
 *   The self-edge label encodes the loop's iteration budget (and
 *   optional wallclock budget) so the renderer can show "max N" /
 *   "max N · 30s" without having to read the edge's metadata bag.
 *
 * Why no own container
 * ────────────────────
 *   Loop is a control-flow decoration on its body, not a visual
 *   cluster. Wrapping the body in a "Loop box" would force the
 *   renderer to draw an extra frame on every loop, which the locked
 *   Lens v0.1 architecture (`memory/lens_v0_1_one_cursor_architecture.md`)
 *   rejects — only Parallel / Agent / LLMCall get boxes.
 *
 * Why label-encode, not separate-edge-metadata
 * ────────────────────────────────────────────
 *   v0.1 doesn't need programmatic access to a Loop's iteration
 *   budget from the rendered graph — the budget is already
 *   visible in the agentfootprint runner's snapshot. The label
 *   keeps the visualisation self-contained without inflating
 *   `LensEdge` with a metadata bag we'd only fill for this one
 *   kind. YAGNI applies until a renderer requires it.
 *
 * Pure function — no closures, no module state.
 */

declare function translateLoop(metadata: GroupMetadata, resolve: MemberResolver): LensGroupOutput;

/**
 * translateParallel — `Parallel` GroupMetadata → `LensGroupOutput`.
 *
 * Layer 2 (per-kind translator, pure) / Lens v0.1 translator pipeline.
 *
 * What it emits
 * ─────────────
 *   ONE compound `group` node (the Parallel container) carrying
 *   `extra.mergeStrategy` as `metadata`, plus each branch's
 *   subgraph PINNED inside the container via `pinUnderParent`,
 *   plus N `fork-branch` edges from the container to each branch's
 *   `rootNodeId`. Container node id is `parallel:<id>`. Container
 *   appears FIRST in the nodes array so xyflow sees the parent
 *   before its children (xyflow renders in array order).
 *
 * Why a compound container
 * ────────────────────────
 *   Parallel is one of the THREE rendering boxes in Lens v0.1
 *   (Parallel / Agent / LLMCall) — see
 *   `memory/lens_v0_1_one_cursor_architecture.md`. The container
 *   visually groups the branches so a reader instantly sees "these
 *   N things run concurrently." Without the box, parallel branches
 *   look identical to a fan-out from a decision point.
 *
 * Why fork-branch edges in ADDITION to compound containment
 * ─────────────────────────────────────────────────────────
 *   The container expresses "which branches belong together"; the
 *   `fork-branch` edges express "the parent fans out to each
 *   branch's entry point." Some renderers theme fork-branch edges
 *   differently (dotted, dashed) to distinguish from sequential
 *   `next` edges — keeping them explicit lets every renderer
 *   theme consistently without inferring intent from the
 *   parent-child relationship alone.
 *
 * Pure function — no closures, no module state. The branches'
 * subgraphs arrive resolved via the `resolve` callback; this
 * translator does not call other translators directly.
 */

declare function translateParallel(metadata: GroupMetadata, resolve: MemberResolver): LensGroupOutput;

/**
 * translateSequence — `Sequence` GroupMetadata → `LensGroupOutput`.
 *
 * Layer 2 (per-kind translator, pure) / Lens v0.1 translator pipeline.
 *
 * What it emits
 * ─────────────
 *   The concatenation of each member's subgraph, plus N-1 `next`
 *   edges chaining consecutive members through their `rootNodeId`s.
 *   Sequence has NO own container node — the locked Lens v0.1
 *   architecture renders only Parallel / Agent / LLMCall as compound
 *   boxes. Sequence is a control-flow pattern, not a visual cluster.
 *
 * Why no own container
 * ────────────────────
 *   A "Sequence box" would force the renderer to draw two visually
 *   redundant frames (the Sequence's container + each member's own
 *   card), which clutters multi-agent flowcharts. The chain of
 *   `next` edges between members carries all the semantic weight
 *   the user needs to read the sequence. Layout engines (dagre,
 *   ELK) handle this naturally as a horizontal chain.
 *
 * rootNodeId convention
 * ─────────────────────
 *   The first member's `rootNodeId` becomes the Sequence's
 *   `rootNodeId` — that's the entry point a parent composition
 *   wires control-flow edges to. Empty Sequence (zero members) is
 *   a caller bug; the translator throws so the bug surfaces loudly
 *   at translation time, not as a silent empty graph.
 *
 * Pure function — no closures, no module state. Member subgraphs
 * arrive resolved via the `resolve` callback supplied by the
 * dispatcher; this translator does not call back into other
 * translators directly.
 */

declare function translateSequence(metadata: GroupMetadata, resolve: MemberResolver): LensGroupOutput;

/**
 * structureGraphFromRunner — convert an already-built agentfootprint Runner
 * into the FINE-GRAINED (uncollapsed) TraceGraph: every real stage of the
 * runner appears as its own node, keyed by its real footprintjs id
 * (`[subflowPath/]stageId`).
 *
 * This is the sibling of `collapserFromRunner`: same spec walk
 * (`walkSubflowSpec` over `runner.getSpec().buildTimeStructure`), but it feeds
 * explain-ui's plain `createTraceStructureRecorder` instead of `lensCollapser`,
 * so NOTHING is collapsed into domain cards.
 *
 * WHY this exists: the runtime time-travel monitor wants to render the run's
 * REAL structure (so each node id equals the run's `runtimeStageId` minus its
 * `#executionIndex`). explain-ui's overlay strips only the `#index` and matches
 * the remainder against `node.id` — so a fine-grained, real-id graph lights its
 * execution path automatically, with zero mapping table. (A separate, idealized
 * flat blueprint can't: its ids don't match what actually ran.) The merge-tree
 * LOOK then comes purely from the layout + node renderers the consumer passes —
 * the structure here stays faithful to the run.
 */

interface RunnerLike {
    readonly getSpec: () => {
        readonly buildTimeStructure: unknown;
    };
}
/** Build the fine-grained (uncollapsed) real-id TraceGraph from a Runner. */
declare function structureGraphFromRunner(runner: RunnerLike): TraceGraph;
/**
 * Build the fine-grained TraceGraph from a serialized `buildTimeStructure`
 * DIRECTLY (not a live runner) — so an offline `Trace` (Replay Option A, which
 * stores `trace.structure`) can rebuild the same flowchart the live `<Lens>`
 * shows, with no runner present. `structureGraphFromRunner` delegates here.
 */
declare function structureGraphFromSpec(buildTimeStructure: unknown): TraceGraph;

/**
 * toReactFlow — pure mapper `LensGroupOutput` → xyflow `Node[]` + `Edge[]`.
 *
 * Layer 3.1 (pure render mapper) / Lens v0.1 translator pipeline.
 *
 * Why a pure mapper (no layout, no React, no DOM)
 * ───────────────────────────────────────────────
 *   The translate pipeline (L2) produces a UI-framework-agnostic
 *   `LensGroupOutput`. The xyflow mapping is the FIRST place a
 *   framework dependency enters — keep it isolated in this one file
 *   so a Vue / D3 consumer can swap in their own mapper without
 *   touching the data layer or the React hook above.
 *
 *   Positions are NOT set here: dagre (or any layout engine) runs
 *   downstream over the result. Keeping layout out of the mapper
 *   means the mapper is trivially testable against fixed outputs.
 *
 * Node mapping
 * ────────────
 *   LensNode.kind = 'group'  → xyflow Node with `type: 'group'`,
 *                              `style: { width, height }` placeholders
 *                              (final dims come from layout).
 *   LensNode.kind = 'stage'  → xyflow Node with `type: 'lensStage'`
 *                              (consumer registers a renderer for that
 *                              type — Lens does NOT bake in JSX here).
 *   parentId  → xyflow parentId + `extent: 'parent'` so the child is
 *               clipped to its compound container.
 *   data      → { label, primitiveKind, metadata } — exactly what a
 *               renderer needs to theme by kind without re-importing
 *               LensNode.
 *
 * Edge mapping
 * ────────────
 *   LensEdge maps 1:1 to xyflow Edge. `data` carries the LensEdge
 *   `kind` so consumers can theme:
 *
 *     next             → solid arrow (default)
 *     fork-branch      → dashed / fanned
 *     decision-branch  → conditional / dashed
 *     loop-iteration   → curved back-edge
 *
 *   `label` passes through verbatim. `type` defaults to 'default'
 *   (xyflow's straight-line) so the consumer-supplied edgeTypes map
 *   can pick a custom edge component per kind without bezier/straight
 *   conflicts.
 *
 * Pure function — no closures, no module state.
 */

/**
 * Data payload xyflow renderers receive on each node. Closed enough
 * that a consumer renderer can switch on `primitiveKind` and consume
 * `metadata` safely.
 *
 * `userActor` is set ONLY on the synthetic user-frame nodes
 * (`__lens_user_in` / `__lens_user_out`) added by `layoutLensGraph`
 * when `withUserFrame` is on. Real composition nodes leave it
 * undefined. Renderers theme accordingly: a circular actor pill for
 * `'in' | 'out'`, the standard stage card otherwise.
 */
interface LensReactFlowNodeData {
    readonly label: string;
    readonly primitiveKind: LensNode['primitiveKind'];
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly userActor?: 'in' | 'out';
    readonly [key: string]: unknown;
}
/**
 * Data payload xyflow renderers receive on each edge. Carries the
 * LensEdge `kind` so the consumer can switch on it without re-deriving.
 */
interface LensReactFlowEdgeData {
    readonly kind: LensEdge['kind'];
    readonly [key: string]: unknown;
}
interface ToReactFlowResult {
    readonly nodes: Node<LensReactFlowNodeData>[];
    readonly edges: Edge<LensReactFlowEdgeData>[];
}
declare function toReactFlow(output: LensGroupOutput): ToReactFlowResult;
/**
 * Default size hint per LensNode kind — exported so the layout step
 * can sit alongside the mapper and consumers can override at one
 * boundary instead of inferring sizes from CSS during layout.
 */
declare function defaultSize(node: LensNode): {
    width: number;
    height: number;
};

/**
 * dagreLayout — pure fn `(nodes, edges) → positioned nodes`.
 *
 * Pattern: thin wrapper around dagre's `graphlib` layout. Lens hands
 *          over its node-set (User actor + agent containers + LLM /
 *          Tool / ContextBin children) and edge-set (asks / forwards /
 *          answers / loop-back / fork-branch); dagre returns one
 *          coordinate per node, computed top-to-bottom.
 * Role:    Replaces the hand-tuned position constants that previously
 *          lived in `RunTreeFlow.buildFlow`. One layout path now
 *          handles Sequence (vertical chain), Parallel (auto fan-out),
 *          Loop (self-edge + back-edge), Conditional (single chosen
 *          branch), and arbitrary nesting — anything we feed dagre,
 *          dagre lays out.
 *
 * Why dagre and not elk: dagre is ~12kb gzipped, layered-tree is the
 * shape we always want, and xyflow has well-trodden integration docs
 * for it. ELK is more powerful but ~10× the bundle and overkill for
 * the patterns Lens actually renders.
 *
 * The function is pure: same input → same output, no side effects.
 * That keeps it testable in isolation and — crucially — keeps the
 * step-slider sync logic unchanged. Selection / focus ring uses node
 * IDs and ViewModel state; coordinates are purely visual.
 */

interface DagreLayoutOptions {
    /** Layout direction. `'TB'` (top-to-bottom) is the Lens default —
     *  matches "User asks → pipeline → User answers" reading order.
     *  Use `'LR'` for left-to-right when displaying very long chains
     *  side-by-side. */
    readonly direction?: 'TB' | 'BT' | 'LR' | 'RL';
    /** Vertical spacing between rank layers (px). */
    readonly rankSep?: number;
    /** Horizontal spacing between siblings within a rank (px). */
    readonly nodeSep?: number;
    /** Spacing between edges (px). */
    readonly edgeSep?: number;
}

/**
 * layoutLensGraph — pure orchestrator: LensGroupOutput → laid-out xyflow.
 *
 * Layer 3.2 (pure layout orchestrator) / Lens v0.1 translator pipeline.
 *
 * Pipeline
 * ────────
 *
 *   LensGroupOutput
 *     │
 *     ▼  toReactFlow (L3.1)
 *   Node[] + Edge[]              (xyflow shape, no positions)
 *     │
 *     ▼  defaultSize (L3.1)
 *   SizedNode[]                  (per-node width/height hints)
 *     │
 *     ▼  dagreLayout (existing pure layout)
 *   Positioned Node[] + Edge[]   (ready for <ReactFlow>)
 *
 * Why orchestrate here and not in the hook
 * ────────────────────────────────────────
 *   The hook is a thin React shim that subscribes to the runner and
 *   calls this function. Keeping the data pipeline OUTSIDE the hook
 *   makes it framework-agnostic: a Vue / D3 consumer running on the
 *   same upstream `LensGroupOutput` can call `layoutLensGraph` to
 *   get a positioned graph without dragging in any React deps. The
 *   `@xyflow/react` import is the only React-adjacent piece, and
 *   it's a pure data type (`Node` / `Edge`) — no DOM, no JSX.
 *
 * Pure function — no closures, no module state.
 */

interface LayoutLensGraphOptions {
    readonly direction?: DagreLayoutOptions['direction'];
    readonly rankSep?: DagreLayoutOptions['rankSep'];
    readonly nodeSep?: DagreLayoutOptions['nodeSep'];
    readonly edgeSep?: DagreLayoutOptions['edgeSep'];
    /**
     * Per-node size override. Receives the source `LensNode` so the
     * consumer can theme by `primitiveKind` or `kind`. Falls back to
     * `defaultSize` when the override returns `undefined` — lets
     * consumers tweak ONE kind without re-implementing all six.
     */
    readonly sizeOverride?: (node: LensNode) => {
        width: number;
        height: number;
    } | undefined;
    /**
     * When true, augment the laid-out graph with two synthetic "user"
     * nodes — one above the root, one below the exit — connected to
     * the composition by plain `next` edges. Reflects the Lens v0.1
     * mental model: every run is "user asks → composition runs → user
     * gets answer back".
     *
     * Default is `false` because the orchestrator is a general-purpose
     * layout tool — headless / preview / non-Lens consumers should NOT
     * receive synthetic user actors by surprise. The `<LensFlow>`
     * component flips it on as its UX convention.
     *
     * The synthetic nodes use xyflow `type: 'lensUser'`; consumers
     * registering custom `nodeTypes` should include a renderer for
     * that type (the default `<LensFlow>` ships one).
     */
    readonly withUserFrame?: boolean;
}
interface LayoutLensGraphResult {
    readonly nodes: Node<LensReactFlowNodeData>[];
    readonly edges: Edge<LensReactFlowEdgeData>[];
}
declare function layoutLensGraph(output: LensGroupOutput, options?: LayoutLensGraphOptions): LayoutLensGraphResult;

export { lensRecorder as $, type ActorId as A, BASELINE_SOURCES as B, type CursorPosition as C, DEFAULT_MAX_EVENTS as D, type EventLogEntry as E, type FocusDetail as F, type SelectHopsArgs as G, type Humanizer as H, type IterationDetails as I, type SelectStepViewArgs as J, type SpecNode as K, LensRecorder as L, type MemberResolver as M, type ToolCallDetails as N, buildLLMText as O, type PauseDetails as P, buildSpecTreeFromBoundary as Q, type RunTreeNode as R, type StepView as S, type ToReactFlowResult as T, buildStepGraphFromSnapshot as U, defaultHumanizer as V, defaultSize as W, humanizeWith as X, isContextEngineering as Y, layoutLensGraph as Z, lensGroupTranslator as _, type RunSummary as a, lensSnapshotRecorder as a0, makeChildNodeId as a1, makeEdge as a2, makeRootNodeId as a3, mergeOutputs as a4, pinUnderParent as a5, selectAgentInstances as a6, selectCommentaryAt as a7, selectCommentaryRanges as a8, selectContextEngineeringInjections as a9, selectEdges as aa, selectFocusDetail as ab, selectHops as ac, selectStepAgentName as ad, selectStepView as ae, selectToolChoiceCall as af, selectTouched as ag, stepEdgeLabel as ah, stepToStageEndpoints as ai, structureGraphFromRunner as aj, structureGraphFromSpec as ak, teachingHumanizer as al, toReactFlow as am, translateAgent as an, translateConditional as ao, translateLLMCall as ap, translateLoop as aq, translateParallel as ar, translateSequence as as, type CommentaryAtCommit as b, type CommentaryRange as c, type LayoutLensGraphOptions as d, type LayoutLensGraphResult as e, type AgentInstance as f, type BreadcrumbItem as g, type BuildLLMTextArgs as h, ChangeNotifier as i, type CompositionDetails as j, type EdgeAgg as k, type Hop as l, type LLMCallDetails as m, type LensDiagnostics as n, type LensEdge as o, type LensGroupOutput as p, type LensNode as q, type LensReactFlowEdgeData as r, type LensReactFlowNodeData as s, type LensRecorderOptions as t, LensSnapshotRecorder as u, type LensSnapshotRecorderOptions as v, type LensSnapshotRunnerLike as w, type RunNodeDetails as x, type RunNodeKind as y, type RunNodeStatus as z };
