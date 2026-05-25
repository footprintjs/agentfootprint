/**
 * LiveStateRecorder — domain trackers built on the footprintjs
 * `BoundaryStateTracker<TState>` storage primitive (v4.17.2+).
 *
 * **What this answers:** "Right now, mid-run, what's happening?"
 *
 *   - Is an LLM call in flight? What's the partial answer so far?
 *   - Is a tool executing? Which tool? What args?
 *   - Is the agent in a turn? Which turn index?
 *
 * All reads are O(1) — the trackers maintain incremental state via
 * the framework's bracket-scoped storage primitive. No event-log fold,
 * no walking arrays per render.
 *
 * **Mental model — observers vs. bookkeepers:**
 *
 *   `BoundaryStateTracker<TState>` (footprintjs) = STORAGE shelf.
 *   `EventDispatcher.on(...)` (agentfootprint)  = OBSERVER source.
 *
 *   Each domain tracker (`LiveLLMTracker`, `LiveToolTracker`,
 *   `LiveAgentTurnTracker`) extends the storage shelf AND subscribes
 *   to the dispatcher. The composition `LiveStateRecorder` bundles
 *   all three so a consumer only attaches once.
 *
 * **Tier 1 (live) only.** Past states are not stored — when a boundary
 * closes, its transient state clears. For time-travel queries, snapshot
 * to a `SequenceRecorder<TState>` instead. See the BoundaryStateTracker
 * JSDoc for the rationale.
 *
 * @example Use the bundled façade — one attach, three live views:
 *
 * ```typescript
 * import { LiveStateRecorder } from 'agentfootprint';
 *
 * const liveState = new LiveStateRecorder();
 * liveState.subscribe(runner);
 *
 * await runner.run({ input });
 *
 * // Read at any moment during the run (e.g., from another async task):
 * liveState.isLLMInFlight();          // true between llm_start ↔ llm_end
 * liveState.getPartialLLM();          // accumulated tokens so far
 * liveState.isToolExecuting();        // true between tool_start ↔ tool_end
 * liveState.isAgentInTurn();          // true between turn_start ↔ turn_end
 *
 * liveState.unsubscribe();
 * ```
 *
 * @example Use a single tracker directly when you only need one slice:
 *
 * ```typescript
 * import { LiveLLMTracker } from 'agentfootprint';
 *
 * const llm = new LiveLLMTracker();
 * llm.subscribe(runner);
 * await runner.run({ input });
 *
 * llm.isInFlight();                   // O(1)
 * llm.getLatestPartial();             // most recent active call's partial
 * llm.getActive(rid)?.tokens;         // tokens accumulated for one call
 * ```
 */

import { BoundaryStateStore } from 'footprintjs/trace';
import type { Unsubscribe } from '../../events/dispatcher.js';
import type { AgentfootprintEvent, AgentfootprintEventType } from '../../events/registry.js';
import { createRunIdObserver, type RunIdObserver } from './observeRunId.js';

/** Minimal Runner shape this recorder needs — only the public `on(...)`
 *  subscription method, so the same trackers can attach to a real Runner
 *  (Agent, etc.) OR to a test mock without exposing the protected
 *  internal dispatcher. */
export interface LiveStateRunnerLike {
  on<K extends AgentfootprintEventType>(
    type: K,
    listener: (event: Extract<AgentfootprintEvent, { type: K }>) => void,
  ): Unsubscribe;
}

// ─── Per-domain state shapes ────────────────────────────────────────

/** Live transient state of one in-flight LLM call. */
export interface LLMLiveState {
  /** Accumulated content from `stream.token` events since `llm_start`. */
  readonly partial: string;
  /** Number of tokens received so far. */
  readonly tokens: number;
  /** Iteration index (from the LLMStartPayload). */
  readonly iteration: number;
  /** Provider name (e.g., 'anthropic', 'openai'). */
  readonly provider: string;
  /** Model id. */
  readonly model: string;
  /** Wall-clock ms when llm_start fired. */
  readonly startedAtMs: number;
}

/** Live transient state of one in-flight tool call. */
export interface ToolLiveState {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly toolCallId: string;
  readonly startedAtMs: number;
}

/** Live transient state of one in-flight agent turn. */
export interface AgentTurnLiveState {
  readonly turnIndex: number;
  readonly userPrompt: string;
  readonly startedAtMs: number;
}

// ─── LiveLLMTracker ─────────────────────────────────────────────────

/**
 * Tracks the in-flight state of LLM calls. Subscribes to:
 *   - `agentfootprint.stream.llm_start`  → opens a boundary
 *   - `agentfootprint.stream.token`      → appends to partial
 *   - `agentfootprint.stream.llm_end`    → closes the boundary
 *
 * Boundary key: `runtimeStageId` of the call-llm stage. Parallel LLM
 * calls (Parallel composition with multiple branches) get distinct
 * keys and are tracked independently.
 */
export class LiveLLMTracker {
  readonly id = 'live-llm';

  /** Composition: bracket-scoped storage primitive. */
  private readonly store = new BoundaryStateStore<LLMLiveState>();
  /** Wipes the store when a fresh run reuses identical runtimeStageId keys. */
  private readonly runIdGuard: RunIdObserver = createRunIdObserver(() =>
    this.store.clear(),
  );

  private observeRunId(runId: string | undefined): void {
    this.runIdGuard.observe(runId);
  }

  /** Subscribe to a runner's dispatcher. Returns an Unsubscribe. */
  subscribe(runner: LiveStateRunnerLike): Unsubscribe {
    const offs: Unsubscribe[] = [];
    offs.push(
      runner.on('agentfootprint.stream.llm_start', (event) => {
        this.observeRunId(event.meta.runId);
        const p = event.payload;
        this.store.start(event.meta.runtimeStageId, {
          partial: '',
          tokens: 0,
          iteration: p.iteration,
          provider: p.provider,
          model: p.model,
          startedAtMs: event.meta.wallClockMs,
        });
      }),
    );
    offs.push(
      runner.on('agentfootprint.stream.token', (event) => {
        this.observeRunId(event.meta.runId);
        this.store.update(event.meta.runtimeStageId, (s) => ({
          ...s,
          partial: s.partial + event.payload.content,
          tokens: s.tokens + 1,
        }));
      }),
    );
    offs.push(
      runner.on('agentfootprint.stream.llm_end', (event) => {
        this.observeRunId(event.meta.runId);
        this.store.stop(event.meta.runtimeStageId);
      }),
    );
    return () => offs.forEach((off) => off());
  }

  /** Reset all transient state. Called by `LiveStateRecorder.clear()`. */
  clear(): void {
    this.store.clear();
    this.runIdGuard.reset();
  }

  /** True if any LLM call is currently in flight. */
  isInFlight(): boolean {
    return this.store.hasActive;
  }

  /** Same as `store.hasActive` — exposed for parity with the v4 API. */
  get hasActive(): boolean {
    return this.store.hasActive;
  }

  /** Number of currently-active boundaries. */
  get activeCount(): number {
    return this.store.activeCount;
  }

  /** Currently-active boundary state for one runtimeStageId. */
  getActive(runtimeStageId: string): LLMLiveState | undefined {
    return this.store.get(runtimeStageId);
  }

  /** All currently-active boundaries. */
  getAllActive(): ReadonlyMap<string, LLMLiveState> {
    return this.store.getAll();
  }

  /** Accumulated partial content of the MOST RECENTLY started active
   *  LLM call. Empty string when no call is active. Useful for the
   *  classic "Chatbot is responding: …" live commentary line. */
  getLatestPartial(): string {
    if (!this.store.hasActive) return '';
    let latest: LLMLiveState | undefined;
    let latestStart = -Infinity;
    for (const state of this.store.getAll().values()) {
      if (state.startedAtMs > latestStart) {
        latestStart = state.startedAtMs;
        latest = state;
      }
    }
    return latest?.partial ?? '';
  }
}

// ─── LiveToolTracker ────────────────────────────────────────────────

/**
 * Tracks in-flight tool calls. Subscribes to:
 *   - `agentfootprint.stream.tool_start` → opens a boundary
 *   - `agentfootprint.stream.tool_end`   → closes the boundary
 *
 * Boundary key: `toolCallId` (more granular than `runtimeStageId` —
 * parallel tools share one calling stage but have distinct toolCallIds).
 */
export class LiveToolTracker {
  readonly id = 'live-tool';

  private readonly store = new BoundaryStateStore<ToolLiveState>();
  private readonly runIdGuard: RunIdObserver = createRunIdObserver(() =>
    this.store.clear(),
  );

  private observeRunId(runId: string | undefined): void {
    this.runIdGuard.observe(runId);
  }

  subscribe(runner: LiveStateRunnerLike): Unsubscribe {
    const offs: Unsubscribe[] = [];
    offs.push(
      runner.on('agentfootprint.stream.tool_start', (event) => {
        this.observeRunId(event.meta.runId);
        const p = event.payload;
        this.store.start(p.toolCallId, {
          toolName: p.toolName,
          args: p.args,
          toolCallId: p.toolCallId,
          startedAtMs: event.meta.wallClockMs,
        });
      }),
    );
    offs.push(
      runner.on('agentfootprint.stream.tool_end', (event) => {
        this.observeRunId(event.meta.runId);
        this.store.stop(event.payload.toolCallId);
      }),
    );
    return () => offs.forEach((off) => off());
  }

  clear(): void {
    this.store.clear();
    this.runIdGuard.reset();
  }

  /** True if any tool is currently executing. */
  isExecuting(): boolean {
    return this.store.hasActive;
  }

  get hasActive(): boolean {
    return this.store.hasActive;
  }

  get activeCount(): number {
    return this.store.activeCount;
  }

  getActive(toolCallId: string): ToolLiveState | undefined {
    return this.store.get(toolCallId);
  }

  getAllActive(): ReadonlyMap<string, ToolLiveState> {
    return this.store.getAll();
  }

  /** Names of tools currently executing. Empty when none. */
  getExecutingToolNames(): readonly string[] {
    return [...this.store.getAll().values()].map((s) => s.toolName);
  }
}

// ─── LiveAgentTurnTracker ───────────────────────────────────────────

/**
 * Tracks in-flight agent turns. Subscribes to:
 *   - `agentfootprint.agent.turn_start` → opens a boundary
 *   - `agentfootprint.agent.turn_end`   → closes the boundary
 *
 * Boundary key: stringified `turnIndex` from the payload — survives
 * across runner instances because turnIndex resets per-session.
 */
export class LiveAgentTurnTracker {
  readonly id = 'live-agent-turn';

  private readonly store = new BoundaryStateStore<AgentTurnLiveState>();
  private readonly runIdGuard: RunIdObserver = createRunIdObserver(() =>
    this.store.clear(),
  );

  private observeRunId(runId: string | undefined): void {
    this.runIdGuard.observe(runId);
  }

  subscribe(runner: LiveStateRunnerLike): Unsubscribe {
    const offs: Unsubscribe[] = [];
    offs.push(
      runner.on('agentfootprint.agent.turn_start', (event) => {
        this.observeRunId(event.meta.runId);
        const p = event.payload;
        this.store.start(String(p.turnIndex), {
          turnIndex: p.turnIndex,
          userPrompt: p.userPrompt,
          startedAtMs: event.meta.wallClockMs,
        });
      }),
    );
    offs.push(
      runner.on('agentfootprint.agent.turn_end', (event) => {
        this.observeRunId(event.meta.runId);
        this.store.stop(String(event.payload.turnIndex));
      }),
    );
    return () => offs.forEach((off) => off());
  }

  clear(): void {
    this.store.clear();
    this.runIdGuard.reset();
  }

  /** True if the agent is currently inside a turn. */
  isInTurn(): boolean {
    return this.store.hasActive;
  }

  get hasActive(): boolean {
    return this.store.hasActive;
  }

  get activeCount(): number {
    return this.store.activeCount;
  }

  getActive(turnIndex: string): AgentTurnLiveState | undefined {
    return this.store.get(turnIndex);
  }

  getAllActive(): ReadonlyMap<string, AgentTurnLiveState> {
    return this.store.getAll();
  }

  /** Index of the most-recently started active turn (-1 if none). */
  getCurrentTurnIndex(): number {
    if (!this.store.hasActive) return -1;
    let latest = -1;
    let latestStart = -Infinity;
    for (const state of this.store.getAll().values()) {
      if (state.startedAtMs > latestStart) {
        latestStart = state.startedAtMs;
        latest = state.turnIndex;
      }
    }
    return latest;
  }
}

// ─── LiveStateRecorder — façade composing the three trackers ────────

/**
 * One-stop façade bundling `LiveLLMTracker` + `LiveToolTracker` +
 * `LiveAgentTurnTracker`. Consumers attach this once and get O(1)
 * reads across all three live-state slices.
 *
 * Use the bundled façade unless you ONLY need one slice — using a
 * single tracker directly avoids subscribing to events you don't read.
 *
 * **Lifecycle**: call `subscribe(runner)` to wire all three trackers,
 * then `unsubscribe()` to detach. `clear()` resets all transient state
 * across the three (called automatically by consumers like Lens between
 * runs).
 *
 * **What this is NOT for:**
 *   - Time-travel queries (Tier 1 only — live state)
 *   - Aggregations (use SequenceRecorder.aggregate)
 *   - Stage-level observation (use Recorder.onStageStart/End)
 *
 * **Composition over inheritance:** the façade does NOT extend
 * `BoundaryStateTracker` itself — different boundary kinds need
 * separate active maps to avoid key collisions between LLM and tool
 * boundaries. Each sub-tracker keeps its own state.
 */
export class LiveStateRecorder {
  readonly id = 'live-state';

  /** LLM call live state. */
  readonly llm: LiveLLMTracker;
  /** Tool execution live state. */
  readonly tool: LiveToolTracker;
  /** Agent turn live state. */
  readonly turn: LiveAgentTurnTracker;

  /** Active subscription disposer, if `subscribe()` is called. */
  private active: Unsubscribe | undefined;

  constructor() {
    this.llm = new LiveLLMTracker();
    this.tool = new LiveToolTracker();
    this.turn = new LiveAgentTurnTracker();
  }

  /** Subscribe all three trackers to one runner. Idempotent — calling
   *  twice on the same recorder unsubscribes the prior subscription
   *  first to avoid double-counting.
   *
   *  Adds a wildcard `*` listener that observes runId on EVERY event
   *  (regardless of which tracker subscribes to it) and calls
   *  `clear()` on all three trackers when the runId changes. This
   *  closes the gap where a tracker that never saw events in run 1
   *  would fail to reset in run 2. */
  subscribe(runner: LiveStateRunnerLike): Unsubscribe {
    this.unsubscribe();
    // Each tracker observes runId in its own per-event handler. A
    // facade-level wildcard would fire AFTER the per-event handler
    // (dispatcher order: byType → domainWildcards → allWildcards),
    // wiping state the tracker just stored. Per-tracker observation is
    // sufficient: a tracker that stores data necessarily ran its
    // handler, which set lastRunId. A tracker that holds no data
    // doesn't need a reset.
    const offs = [
      this.llm.subscribe(runner),
      this.tool.subscribe(runner),
      this.turn.subscribe(runner),
    ];
    this.active = () => offs.forEach((off) => off());
    return this.active;
  }


  /** Detach all three trackers from the current runner. Idempotent. */
  unsubscribe(): void {
    if (this.active) {
      this.active();
      this.active = undefined;
    }
  }

  /** Reset transient state across all three trackers. Called by the
   *  executor / consumer between runs. */
  clear(): void {
    this.llm.clear();
    this.tool.clear();
    this.turn.clear();
  }

  // ── Convenience reads (O(1)) ──────────────────────────────────────

  /** True if any LLM call is currently in flight. */
  isLLMInFlight(): boolean {
    return this.llm.isInFlight();
  }

  /** Accumulated partial content of the most-recently started LLM call. */
  getPartialLLM(): string {
    return this.llm.getLatestPartial();
  }

  /** True if any tool is currently executing. */
  isToolExecuting(): boolean {
    return this.tool.isExecuting();
  }

  /** Names of tools currently executing. */
  getExecutingToolNames(): readonly string[] {
    return this.tool.getExecutingToolNames();
  }

  /** True if the agent is currently inside a turn. */
  isAgentInTurn(): boolean {
    return this.turn.isInTurn();
  }

  /** Current turn index (-1 if not in a turn). */
  getCurrentTurnIndex(): number {
    return this.turn.getCurrentTurnIndex();
  }
}

/** Convenience factory — same shape as `boundaryRecorder()` /
 *  `topologyRecorder()` / `inOutRecorder()` in footprintjs. */
export function liveStateRecorder(): LiveStateRecorder {
  return new LiveStateRecorder();
}
