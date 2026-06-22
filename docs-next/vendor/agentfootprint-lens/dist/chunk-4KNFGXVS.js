import {
  selectAgentInstances
} from "./chunk-KQOLJKKM.js";

// src/core/LensRecorder.ts
import { SequenceStore } from "footprintjs/trace";
import { LiveStateRecorder, BoundaryRecorder } from "agentfootprint/observe";
import {
  createTraceRuntimeOverlay
} from "footprint-explainable-ui/flowchart";

// src/core/ChangeNotifier.ts
var ChangeNotifier = class {
  constructor() {
    this.version = 0;
    this.listeners = /* @__PURE__ */ new Set();
  }
  /** Register a change listener. Returns a disposer. Idempotent — the
   *  same listener function added twice is stored once. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Monotonic version. Bumped before each `notify()` call. Use as the
   *  snapshot key for `useSyncExternalStore` / Vue ref / Angular signal. */
  getVersion() {
    return this.version;
  }
  /** Bump version + fire every listener synchronously. A throwing
   *  listener doesn't abort the others. */
  notify() {
    this.version++;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
      }
    }
  }
  /** Listener count — exposed for diagnostics + tests. */
  get listenerCount() {
    return this.listeners.size;
  }
};

// src/core/LensSnapshotRecorder.ts
var KNOWN_PRIMITIVES = /* @__PURE__ */ new Set([
  "Agent",
  "LLMCall",
  "Sequence",
  "Parallel",
  "Conditional",
  "Loop"
]);
var _counter = 0;
function lensSnapshotRecorder(options = {}) {
  return new LensSnapshotRecorder(options);
}
var LensSnapshotRecorder = class {
  constructor(options = {}) {
    // ── Pre-built graph state — accessed via getStepGraph() ──────────
    /** Nodes in registration order — matches slider position. Stored as
     *  the mutable shadow so we can decorate in place; exposed as the
     *  readonly StepNode via `getStepGraph()`. */
    this.nodes = [];
    /** O(1) lookup index for payload joins, keyed by runtimeStageId. */
    this.nodesById = /* @__PURE__ */ new Map();
    /** Edges in registration order. */
    this.edges = [];
    /** Stack of currently-open subflow runtimeStageIds for boundary tracking. */
    this.boundaryStack = [];
    /** When the run started (for relative timestamps). */
    this.runStartMs = 0;
    this.id = options.id ?? `lens-snapshot-${++_counter}`;
  }
  // ─── Lifecycle ─────────────────────────────────────────────────────
  /**
   * Wipe all state. Called by:
   *   - The runId guard when a new run is detected.
   *   - The owning LensRecorder when consumer calls `lens.clear()`.
   */
  clear() {
    this.nodes = [];
    this.nodesById.clear();
    this.edges = [];
    this.boundaryStack = [];
    this.runStartMs = 0;
    this.lastRunId = void 0;
    this.graphCache = void 0;
  }
  /**
   * Subscribe this recorder to agentfootprint's typed-event dispatcher
   * for payload decoration. The structure side (FlowRecorder) is wired
   * separately via `executor.attachCombinedRecorder(this)` — the owning
   * LensRecorder handles both wirings.
   */
  subscribePayload(runner) {
    const offs = [];
    offs.push(
      runner.on("agentfootprint.stream.llm_start", (event) => {
        this.decorate(event.meta.runtimeStageId, (n) => {
          n.llmModel = event.payload.model;
          n.iterationIndex = event.payload.iteration;
        });
      })
    );
    offs.push(
      runner.on("agentfootprint.stream.llm_end", (event) => {
        const p = event.payload;
        this.decorate(event.meta.runtimeStageId, (n) => {
          n.tokens = { in: p.usage.input, out: p.usage.output };
          if (p.content) n.assistantText = p.content;
        });
      })
    );
    offs.push(
      runner.on("agentfootprint.stream.tool_start", (event) => {
        this.decorate(event.meta.runtimeStageId, (n) => {
          n.toolName = event.payload.toolName;
          n.toolArgs = event.payload.args;
        });
      })
    );
    offs.push(
      runner.on("agentfootprint.stream.tool_end", (event) => {
        this.decorate(event.meta.runtimeStageId, (n) => {
          n.toolResult = event.payload.result;
        });
      })
    );
    return () => offs.forEach((off) => off());
  }
  // ─── FlowRecorder hooks (STRUCTURE — footprintjs side) ─────────────
  onRunStart(event) {
    this.observeRunId(event.traversalContext?.runId);
    this.runStartMs = Date.now();
    this.invalidateCache();
  }
  onRunEnd(_event) {
    this.invalidateCache();
  }
  onSubflowEntry(event) {
    if (!event.subflowId) return;
    this.observeRunId(event.traversalContext?.runId);
    const runtimeStageId = event.traversalContext?.runtimeStageId ?? event.subflowId;
    const subflowPath = pathFromCtx(event.traversalContext?.subflowPath, event.subflowId);
    const primitiveKind = parsePrimitiveKind(event.description);
    const isPrimitive = primitiveKind !== void 0;
    if (isPrimitive) {
      const node = {
        id: runtimeStageId,
        kind: "subflow",
        label: event.name,
        startOffsetMs: relTime(this.runStartMs),
        subflowPath,
        primitiveKind,
        isPrimitiveBoundary: true,
        ...primitiveKind === "Agent" ? { isAgentBoundary: true } : {},
        runtimeStageId
      };
      this.pushNode(node);
    }
    this.boundaryStack.push(runtimeStageId);
  }
  onSubflowExit(event) {
    this.observeRunId(event.traversalContext?.runId);
    const runtimeStageId = event.traversalContext?.runtimeStageId;
    if (runtimeStageId) {
      this.decorate(runtimeStageId, (n) => {
        n.endOffsetMs = relTime(this.runStartMs);
      });
    }
    this.boundaryStack.pop();
  }
  /**
   * The KEY hook for the bug fix. Engine fires `onFork` ATOMICALLY with
   * the full child list when a Parallel composition spawns. Lens emits
   * one fork-branch node per child + one fork-branch edge from the
   * parent. No inference, no missed branches — the engine carries the
   * truth.
   */
  onFork(event) {
    this.observeRunId(event.traversalContext?.runId);
    const runtimeStageId = event.traversalContext?.runtimeStageId ?? event.parent;
    const subflowPath = pathFromCtx(event.traversalContext?.subflowPath, event.parent);
    const ts = relTime(this.runStartMs);
    for (const childName of event.children) {
      const childRid = `${childName}#${runtimeStageId}`;
      const node = {
        id: childRid,
        kind: "fork-branch",
        label: childName,
        startOffsetMs: ts,
        subflowPath: [...subflowPath, childName],
        runtimeStageId: childRid
      };
      this.pushNode(node);
      this.edges.push({
        id: `${runtimeStageId}->${childRid}`,
        from: runtimeStageId,
        to: childRid,
        kind: "fork-branch"
      });
    }
    this.invalidateCache();
  }
  onDecision(event) {
    this.observeRunId(event.traversalContext?.runId);
    const runtimeStageId = event.traversalContext?.runtimeStageId ?? "";
    this.edges.push({
      id: `${runtimeStageId}->${event.chosen}`,
      from: runtimeStageId,
      to: event.chosen,
      kind: "decision-branch"
    });
    this.invalidateCache();
  }
  onLoop(event) {
    this.observeRunId(event.traversalContext?.runId);
    const runtimeStageId = event.traversalContext?.runtimeStageId ?? event.target;
    this.edges.push({
      id: `${runtimeStageId}->${event.target}#iter${event.iteration}`,
      from: runtimeStageId,
      to: event.target,
      kind: "loop-iteration",
      iteration: event.iteration
    });
    this.invalidateCache();
  }
  // ─── Read API for UI ───────────────────────────────────────────────
  /** Returns the pre-built StepGraph. O(1). Stable reference until the
   *  next mutating event. UI consumers pair with ChangeNotifier for
   *  identity-based change detection (useSyncExternalStore et al). */
  getStepGraph() {
    if (!this.graphCache) {
      this.graphCache = {
        nodes: this.nodes.slice(),
        edges: this.edges.slice()
      };
    }
    return this.graphCache;
  }
  /** O(1) lookup of one node's full payload — useful for detail panes. */
  getNode(runtimeStageId) {
    return this.nodesById.get(runtimeStageId);
  }
  // ─── Internals ─────────────────────────────────────────────────────
  /** Push a node into both the ordered list and the lookup index, and
   *  invalidate the cached graph. O(1). */
  pushNode(node) {
    this.nodes.push(node);
    this.nodesById.set(node.runtimeStageId ?? node.id, node);
    this.invalidateCache();
  }
  /** Apply a mutation to one node by runtimeStageId. No-op if the node
   *  hasn't been registered yet (out-of-order events). Invalidates the
   *  graph cache so consumers see the decoration on next read. */
  decorate(runtimeStageId, mutator) {
    const node = this.nodesById.get(runtimeStageId);
    if (!node) return;
    mutator(node);
    this.invalidateCache();
  }
  invalidateCache() {
    this.graphCache = void 0;
  }
  /**
   * Detect a fresh run via `runId` on the TraversalContext (or typed-
   * event meta). On change, wipe ALL state — the same recorder reused
   * across runs starts each one cleanly. First-time observation just
   * records the runId without resetting.
   */
  observeRunId(runId) {
    if (!runId) return;
    if (this.lastRunId === void 0) {
      this.lastRunId = runId;
      return;
    }
    if (runId !== this.lastRunId) {
      this.clear();
      this.lastRunId = runId;
    }
  }
};
var ROOT_SUBFLOW_ID = "__root__";
function parsePrimitiveKind(description) {
  if (!description) return void 0;
  const colon = description.indexOf(":");
  if (colon < 0) return void 0;
  const prefix = description.slice(0, colon).trim();
  return KNOWN_PRIMITIVES.has(prefix) ? prefix : void 0;
}
function pathFromCtx(ctxSubflowPath, subflowId) {
  const segments = ctxSubflowPath ? ctxSubflowPath.split("/").filter(Boolean) : [];
  return [ROOT_SUBFLOW_ID, ...segments, subflowId];
}
function relTime(runStartMs) {
  if (runStartMs === 0) return 0;
  return Math.max(0, Date.now() - runStartMs);
}

// src/core/LensRecorder.ts
var LensRecorder = class {
  constructor(rootLabel = "Run") {
    /** Stable id for idempotent attach. */
    this.id = "lens";
    /** Composition: ordered + keyed event-log storage. */
    this.store = new SequenceStore();
    this.stack = [];
    this.seqCounter = 0;
    this.unsubscribes = [];
    this.finalStatus = "running";
    /** Live transient state of the in-flight run. Subscribed in `observe()`,
     *  cleared/disposed on `detach()`. Lens reads `liveState.isLLMInFlight()`
     *  / `getPartialLLM()` / etc. for O(1) live commentary, instead of
     *  folding the event log every render. */
    this.liveState = new LiveStateRecorder();
    /** Incremental StepGraph projection — Phase 4 single source of
     *  structural truth for the UI. Built event-by-event during traversal
     *  (footprintjs FlowRecorder channel + agentfootprint typed events),
     *  read O(1) via `snapshot.getStepGraph()`. See
     *  `docs/design/lens-snapshot-recorder.md` for the contract. */
    this.snapshot = new LensSnapshotRecorder({ id: "lens-snapshot" });
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
    this.boundary = new BoundaryRecorder({
      id: "lens-boundary",
      getCommitCount: () => this.runnerCommitCount()
    });
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
    this.runtime = createTraceRuntimeOverlay({
      id: "lens-runtime-overlay"
    });
    /**
     * Change-notification primitive composed in. Push-based refresh for
     * React (useSyncExternalStore), Vue (refs), Angular (signals),
     * Recoil (atoms), CLI/DOM consumers — all subscribe to the SAME
     * notifier. See `ChangeNotifier` JSDoc for adapter examples.
     */
    this.notifier = new ChangeNotifier();
    this.root = {
      id: "run-root",
      kind: "run",
      label: rootLabel,
      status: "running",
      startOffsetMs: 0,
      children: [],
      events: []
    };
    this.stack.push(this.root);
  }
  /** Reset all transient state. Called on detach + on detected runId
   *  change so a recorder reused across runs doesn't accumulate. */
  clear() {
    this.store.clear();
    this.stack.length = 0;
    this.stack.push(this.root);
    this.root.children.length = 0;
    this.root.events.length = 0;
    this.root.endOffsetMs = void 0;
    this.root.status = "running";
    this.seqCounter = 0;
    this.runStartMs = void 0;
    this.finalStatus = "running";
    this.runError = void 0;
    this.lastRunId = void 0;
    this.liveState.clear();
    this.boundary.clear();
    this.runtime.reset();
    this.bumpVersion();
  }
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
  getStepGraph() {
    return this.flowchartHandle?.getSnapshot() ?? this.snapshot.getStepGraph();
  }
  /**
   * Live commit count for the currently-observed run. PUBLIC accessor
   * used by `useCommentarySlider` to size the slider extent (Law 1 of
   * the design doc: slider total = commitLog.length, not max of
   * boundary ranges). Returns 0 before any `observe()` or when the
   * runner exposes no executor.
   */
  getCommitCount() {
    return this.runnerCommitCount();
  }
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
  getCommitLog() {
    const runner = this.currentRunner;
    if (!runner) return [];
    const snap = runner.getLastSnapshot?.();
    const log = snap?.commitLog ?? [];
    return log.map((c) => ({
      runtimeStageId: c.runtimeStageId,
      stageId: c.stageId,
      overwriteKeys: [...Object.keys(c.overwrite ?? {}), ...Object.keys(c.updates ?? {})]
    }));
  }
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
  runnerCommitCount() {
    const runner = this.currentRunner;
    if (!runner) return 0;
    const snap = runner.getLastSnapshot?.();
    return snap?.commitLog?.length ?? 0;
  }
  /**
   * Push-based change subscription. Delegates to the composed
   * `ChangeNotifier` so React / Vue / Angular / Recoil / vanilla DOM
   * adapters all share the same primitive.
   *
   * @returns Disposer; safe to call multiple times.
   */
  subscribe(listener) {
    return this.notifier.subscribe(listener);
  }
  /** Monotonic version — snapshot key for `useSyncExternalStore` /
   *  Vue ref / Angular signal. Bumped on every observed event. */
  getVersion() {
    return this.notifier.getVersion();
  }
  /**
   * Subscribe to a v2 Runner's typed dispatcher. Call once per run.
   * Returns an unsubscribe for the consumer — calling it detaches the
   * recorder (useful for cleanup after post-run rendering is done).
   */
  observe(runner) {
    this.currentRunner = runner;
    const offEvent = runner.on("*", (event) => {
      this.handleEvent(event);
    });
    const offLive = this.liveState.subscribe(runner);
    const offSnapshotAttach = runner.attach(this.snapshot);
    const offSnapshotPayload = this.snapshot.subscribePayload(runner);
    const offBoundaryAttach = runner.attach(this.boundary);
    const offBoundarySubscribe = this.boundary.subscribe(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runner
    );
    const offRuntimeAttach = runner.attach(this.runtime.recorder);
    this.flowchartHandle = runner.enable.flowchart({
      onUpdate: () => this.bumpVersion()
    });
    const composed = () => {
      offEvent();
      offLive();
      offSnapshotPayload();
      offSnapshotAttach();
      offBoundarySubscribe();
      offBoundaryAttach();
      offRuntimeAttach();
      this.flowchartHandle?.unsubscribe();
      this.flowchartHandle = void 0;
      if (this.currentRunner === runner) this.currentRunner = void 0;
    };
    this.unsubscribes.push(composed);
    return () => {
      const idx = this.unsubscribes.indexOf(composed);
      if (idx >= 0) {
        this.unsubscribes.splice(idx, 1);
        composed();
      }
    };
  }
  /** Detach from all observed runners. Idempotent. */
  detach() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }
  // ─── Event handling ────────────────────────────────────────────
  handleEvent(event) {
    const incomingRunId = event.meta?.runId;
    if (incomingRunId !== void 0 && this.lastRunId === void 0) {
      this.lastRunId = incomingRunId;
    }
    const wallClockMs = event.meta.wallClockMs;
    if (this.runStartMs === void 0) {
      this.runStartMs = wallClockMs;
      this.root.startOffsetMs = 0;
    }
    const runOffsetMs = wallClockMs - this.runStartMs;
    const entry = {
      seq: this.seqCounter++,
      wallClockMs,
      runOffsetMs,
      event,
      // Lift runtimeStageId onto the entry so the keyed index works
      // — gives O(1) `getEntriesForStep(rid)` and the per-step range
      // index for free, no parallel data structure.
      runtimeStageId: event.meta.runtimeStageId
    };
    this.store.push(entry);
    this.top().events.push(entry);
    this.dispatch(event, runOffsetMs, entry);
    this.bumpVersion();
  }
  /** Notify all subscribers + bump version. Delegated to ChangeNotifier. */
  bumpVersion() {
    this.notifier.notify();
  }
  /**
   * Kind-specific handling. Keeps the switch exhaustive over every v2
   * event type we structurally care about; the default branch is the
   * "attach to current top, no structural change" path which has
   * already fired above.
   */
  dispatch(event, runOffsetMs, entry) {
    const type = event.type;
    if (type === "agentfootprint.composition.enter") {
      const p = event.payload;
      this.push({
        id: `comp:${p.id}:${entry.seq}`,
        kind: "composition",
        label: `${p.kind}: ${p.name}`,
        status: "running",
        startOffsetMs: runOffsetMs,
        children: [],
        events: [],
        composition: { compositionKind: p.kind, childCount: p.childCount }
      });
      return;
    }
    if (type === "agentfootprint.composition.exit") {
      const p = event.payload;
      this.popIfKind("composition", {
        endOffsetMs: runOffsetMs,
        status: p.status === "ok" ? "ok" : p.status === "budget_exhausted" ? "budget_exhausted" : "err"
      });
      return;
    }
    if (type === "agentfootprint.composition.iteration_start") {
      const p = event.payload;
      this.push({
        id: `iter:${p.loopId}:${p.iteration}`,
        kind: "iteration",
        label: `Iteration ${p.iteration}`,
        status: "running",
        startOffsetMs: runOffsetMs,
        children: [],
        events: [],
        iteration: { iteration: p.iteration }
      });
      return;
    }
    if (type === "agentfootprint.composition.iteration_exit") {
      const p = event.payload;
      this.popIfKind("iteration", {
        endOffsetMs: runOffsetMs,
        status: p.reason === "budget" ? "budget_exhausted" : "ok",
        iterationExit: p.reason
      });
      return;
    }
    if (type === "agentfootprint.agent.turn_start") {
      this.push({
        id: `turn:${entry.seq}`,
        kind: "iteration",
        label: "Turn",
        status: "running",
        startOffsetMs: runOffsetMs,
        children: [],
        events: [],
        iteration: { iteration: 0 }
      });
      return;
    }
    if (type === "agentfootprint.agent.turn_end") {
      this.popIfKind("iteration", { endOffsetMs: runOffsetMs, status: "ok" });
      return;
    }
    if (type === "agentfootprint.agent.iteration_start") {
      const p = event.payload;
      this.push({
        id: `agent-iter:${p.iterIndex}`,
        kind: "iteration",
        label: `Iteration ${p.iterIndex}`,
        status: "running",
        startOffsetMs: runOffsetMs,
        children: [],
        events: [],
        iteration: { iteration: p.iterIndex }
      });
      return;
    }
    if (type === "agentfootprint.agent.iteration_end") {
      this.popIfKind("iteration", { endOffsetMs: runOffsetMs, status: "ok" });
      return;
    }
    if (type === "agentfootprint.stream.llm_start") {
      const p = event.payload;
      const node = {
        id: `llm:${entry.seq}`,
        kind: "llm-call",
        label: `LLM: ${p.model}`,
        status: "running",
        startOffsetMs: runOffsetMs,
        children: [],
        events: [entry],
        llm: {
          provider: p.provider,
          model: p.model,
          systemPromptChars: p.systemPromptChars,
          messagesCount: p.messagesCount,
          toolsCount: p.toolsCount
        }
      };
      this.top().children.push(node);
      this.stack.push(node);
      return;
    }
    if (type === "agentfootprint.stream.llm_end") {
      const p = event.payload;
      this.popIfKind("llm-call", {
        endOffsetMs: runOffsetMs,
        status: "ok",
        llmEnd: {
          content: p.content,
          toolCallCount: p.toolCallCount,
          usage: p.usage,
          stopReason: p.stopReason
        }
      });
      return;
    }
    if (type === "agentfootprint.stream.tool_start") {
      const p = event.payload;
      const node = {
        id: `tool:${p.toolCallId}`,
        kind: "tool-call",
        label: `Tool: ${p.toolName}`,
        status: "running",
        startOffsetMs: runOffsetMs,
        children: [],
        events: [entry],
        tool: {
          toolName: p.toolName,
          toolCallId: p.toolCallId,
          args: p.args
        }
      };
      this.top().children.push(node);
      this.stack.push(node);
      return;
    }
    if (type === "agentfootprint.stream.tool_end") {
      const p = event.payload;
      this.popIfKind("tool-call", {
        endOffsetMs: runOffsetMs,
        status: p.error === true ? "err" : "ok",
        toolEnd: { result: p.result, error: p.error ?? false }
      });
      return;
    }
    if (type === "agentfootprint.pause.request") {
      const p = event.payload;
      const node = {
        id: `pause:${entry.seq}`,
        kind: "pause",
        label: `Paused: ${p.reason}`,
        status: "paused",
        startOffsetMs: runOffsetMs,
        endOffsetMs: runOffsetMs,
        children: [],
        events: [entry],
        pause: { reason: p.reason, questionPayload: p.questionPayload }
      };
      this.top().children.push(node);
      this.finalStatus = "paused";
      return;
    }
    if (type === "agentfootprint.error.fatal") {
      this.finalStatus = "err";
      this.runError = event.payload.error;
      return;
    }
  }
  // ─── Stack helpers ────────────────────────────────────────────
  top() {
    return this.stack[this.stack.length - 1] ?? this.root;
  }
  push(node) {
    this.top().children.push(node);
    this.stack.push(node);
  }
  /**
   * Pop the top node IF its kind matches, applying finalization fields.
   * Mismatched kinds (indicating malformed event ordering) are logged
   * but don't throw — Lens prefers partial correctness to crashes.
   */
  popIfKind(kind, finalize) {
    const top = this.top();
    if (top.kind !== kind) {
      return;
    }
    top.endOffsetMs = finalize.endOffsetMs;
    top.status = finalize.status;
    if (finalize.iterationExit && top.iteration) {
      top.iteration.exitReason = finalize.iterationExit;
    }
    if (finalize.llmEnd && top.llm) {
      Object.assign(top.llm, finalize.llmEnd);
    }
    if (finalize.toolEnd && top.tool) {
      top.tool.result = finalize.toolEnd.result;
      top.tool.error = finalize.toolEnd.error;
    }
    this.stack.pop();
  }
  // ─── Storage delegators (kept public for backward compat) ────────
  /** Number of entries stored. O(1). Mirrors `SequenceStore.size`. */
  get entryCount() {
    return this.store.size;
  }
  /** All entries in append order. Returns a shallow copy. */
  getEntries() {
    return this.store.getAll();
  }
  /** All entries that share `runtimeStageId`. Returns a shallow copy. */
  getEntriesForStep(runtimeStageId) {
    return this.store.getByKey(runtimeStageId);
  }
  /** O(1) per-step range index for time-travel scrubbing. */
  getEntryRanges() {
    return this.store.getEntryRanges();
  }
  /** Single-pass fold over every entry. */
  aggregate(reducer, init) {
    return this.store.aggregate(reducer, init);
  }
  /** Single-pass fold over entries whose `runtimeStageId` is in `keys`.
   *  Used for time-travel scrubbing — pass the slider's revealed
   *  runtimeStageIds and get the cumulative value up to that position. */
  accumulate(reducer, init, keys) {
    return this.store.accumulate(reducer, init, keys);
  }
  // ─── Selectors ────────────────────────────────────────────────
  /** The complete ordered event log. Composition over the underlying store. */
  selectEventLog() {
    return this.store.getAll();
  }
  /** The RunTree — frozen, recursive, immutable snapshot. */
  selectRunTree() {
    if (this.root.endOffsetMs === void 0 && this.store.size > 0) {
      const all = this.store.getAll();
      const last = all[all.length - 1];
      this.root.endOffsetMs = last.runOffsetMs;
      this.root.status = this.finalStatus === "running" ? "ok" : this.finalStatus;
    }
    return freezeNode(this.root);
  }
  /** Summary stats — computed lazily via `store.aggregate()`.
   *  Single-pass fold; types derived from the AgentfootprintEvent
   *  discriminated union. */
  selectSummary() {
    const init = {
      llmCallCount: 0,
      toolCallCount: 0,
      iterationCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalUsd: void 0,
      permissionDenials: 0,
      paused: false
    };
    const acc = this.store.aggregate((a, { event }) => {
      switch (event.type) {
        case "agentfootprint.stream.llm_start":
          return { ...a, llmCallCount: a.llmCallCount + 1 };
        case "agentfootprint.stream.tool_start":
          return { ...a, toolCallCount: a.toolCallCount + 1 };
        case "agentfootprint.agent.iteration_start":
        case "agentfootprint.composition.iteration_start":
          return { ...a, iterationCount: a.iterationCount + 1 };
        case "agentfootprint.stream.llm_end":
          return {
            ...a,
            totalInputTokens: a.totalInputTokens + event.payload.usage.input,
            totalOutputTokens: a.totalOutputTokens + event.payload.usage.output
          };
        case "agentfootprint.cost.tick":
          return { ...a, totalUsd: event.payload.cumulative.estimatedUsd };
        case "agentfootprint.permission.check":
          return event.payload.result === "deny" ? { ...a, permissionDenials: a.permissionDenials + 1 } : a;
        case "agentfootprint.pause.request":
          return { ...a, paused: true };
        case "agentfootprint.pause.resume":
          return { ...a, paused: false };
        default:
          return a;
      }
    }, init);
    const entries = this.store.getAll();
    const startedAt = entries[0]?.wallClockMs ?? 0;
    const endedAt = entries[entries.length - 1]?.wallClockMs;
    return {
      startedAt,
      ...endedAt !== void 0 && { endedAt, durationMs: endedAt - startedAt },
      status: acc.paused ? "paused" : this.finalStatus === "running" ? "ok" : this.finalStatus,
      llmCallCount: acc.llmCallCount,
      toolCallCount: acc.toolCallCount,
      iterationCount: acc.iterationCount,
      totalTokens: { input: acc.totalInputTokens, output: acc.totalOutputTokens },
      ...acc.totalUsd !== void 0 && { totalUsd: acc.totalUsd },
      permissionDenials: acc.permissionDenials,
      paused: acc.paused,
      ...this.runError !== void 0 && { error: this.runError }
    };
  }
};
function freezeNode(n) {
  const children = n.children.map(freezeNode);
  const base = {
    id: n.id,
    kind: n.kind,
    label: n.label,
    status: n.status,
    startOffsetMs: n.startOffsetMs,
    ...n.endOffsetMs !== void 0 && {
      durationMs: n.endOffsetMs - n.startOffsetMs
    },
    children,
    events: [...n.events],
    ...buildDetails(n) && { details: buildDetails(n) }
  };
  return base;
}
function buildDetails(n) {
  if (n.kind === "llm-call" && n.llm) {
    const l = n.llm;
    return { kind: "llm-call", llm: l };
  }
  if (n.kind === "tool-call" && n.tool) {
    const t = n.tool;
    return { kind: "tool-call", tool: t };
  }
  if (n.kind === "composition" && n.composition) {
    return { kind: "composition", composition: n.composition };
  }
  if (n.kind === "iteration" && n.iteration) {
    const i = n.iteration;
    return { kind: "iteration", iteration: i };
  }
  if (n.kind === "pause" && n.pause) {
    return { kind: "pause", pause: n.pause };
  }
  return void 0;
}
function lensRecorder(rootLabel) {
  return new LensRecorder(rootLabel);
}

// src/core/buildStepGraphFromSnapshot.ts
function buildStepGraphFromSnapshot(snapshot) {
  if (!snapshot?.executionTree) {
    return { nodes: [], edges: [] };
  }
  const ctx = {
    nodes: [],
    edges: [],
    runStartMs: snapshot.executionTree.flowMessages?.[0]?.timestamp ?? 0
  };
  visit(snapshot.executionTree, [], ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}
function visit(stage, parentPath, ctx) {
  const primitiveKind = parsePrimitiveKind2(stage.description);
  const isPrimitive = primitiveKind !== void 0;
  const subflowPath = stage.subflowId ? [...parentPath, stage.subflowId] : parentPath;
  const startOffsetMs = relTime2(stage.flowMessages?.[0]?.timestamp, ctx.runStartMs);
  const stageRid = stage.runtimeStageId ?? stage.id ?? "";
  if (isPrimitive) {
    const node = {
      id: stageRid,
      kind: "subflow",
      label: stage.name ?? stage.id ?? "unnamed",
      startOffsetMs,
      subflowPath: subflowPath.length > 0 ? subflowPath : ["__root__"],
      primitiveKind,
      isPrimitiveBoundary: true,
      ...primitiveKind === "Agent" ? { isAgentBoundary: true } : {},
      runtimeStageId: stageRid
    };
    ctx.nodes.push(node);
  }
  if (stage.flowMessages) {
    for (const msg of stage.flowMessages) {
      if (msg.type === "children" && Array.isArray(msg.targetStage)) {
        for (const childId of msg.targetStage) {
          const childRid = `${childId}#${stageRid}`;
          ctx.nodes.push({
            id: childRid,
            kind: "fork-branch",
            label: childId,
            startOffsetMs: relTime2(msg.timestamp, ctx.runStartMs),
            subflowPath: [...subflowPath, childId],
            runtimeStageId: childRid
          });
          ctx.edges.push({
            id: `${stageRid}->${childRid}`,
            from: stageRid,
            to: childRid,
            kind: "fork-branch"
          });
        }
      } else if (msg.type === "decision" && typeof msg.targetStage === "string") {
        ctx.edges.push({
          id: `${stageRid}->${msg.targetStage}`,
          from: stageRid,
          to: msg.targetStage,
          kind: "decision-branch"
        });
      } else if (msg.type === "loop" && typeof msg.targetStage === "string") {
        ctx.edges.push({
          id: `${stageRid}->${msg.targetStage}#loop`,
          from: stageRid,
          to: msg.targetStage,
          kind: "loop-iteration"
        });
      }
    }
  }
  if (stage.next) {
    if (isPrimitive) {
      const nextPrimitive = findFirstPrimitive(stage.next);
      if (nextPrimitive) {
        const nextRid = nextPrimitive.runtimeStageId ?? nextPrimitive.id ?? "";
        ctx.edges.push({
          id: `${stageRid}->${nextRid}`,
          from: stageRid,
          to: nextRid,
          kind: "next"
        });
      }
    }
    visit(stage.next, parentPath, ctx);
  }
}
function findFirstPrimitive(stage) {
  let cur = stage;
  while (cur) {
    if (parsePrimitiveKind2(cur.description) !== void 0) return cur;
    cur = cur.next;
  }
  return void 0;
}
var KNOWN_PRIMITIVES2 = /* @__PURE__ */ new Set([
  "Agent",
  "LLMCall",
  "Sequence",
  "Parallel",
  "Conditional",
  "Loop"
]);
function parsePrimitiveKind2(description) {
  if (!description) return void 0;
  const colon = description.indexOf(":");
  if (colon < 0) return void 0;
  const prefix = description.slice(0, colon).trim();
  return KNOWN_PRIMITIVES2.has(prefix) ? prefix : void 0;
}
function relTime2(absMs, runStartMs) {
  if (absMs === void 0) return 0;
  return Math.max(0, absMs - runStartMs);
}

// src/core/buildSpecTreeFromBoundary.ts
var PRIMITIVE_ICON = {
  Agent: "agent",
  LLMCall: "llm",
  Sequence: "sequence",
  Parallel: "fork",
  Conditional: "guard",
  Loop: "loop"
};
var FANOUT_KINDS = /* @__PURE__ */ new Set(["Parallel", "Conditional"]);
function buildSpecTreeFromBoundary(boundary) {
  const all = boundary.boundaryIndex.overlapping(0, Number.MAX_SAFE_INTEGER).filter((entry) => {
    const label = entry.label;
    if (!label.primitiveKind) return false;
    if (label.slotKind) return false;
    if (label.isAgentInternal) return false;
    return true;
  });
  const root = {
    name: "Run",
    id: "__root__",
    children: []
  };
  const byPath = /* @__PURE__ */ new Map();
  byPath.set("__root__", root);
  const seenRid = /* @__PURE__ */ new Set(["__root__#0"]);
  const sorted = [...all].sort((a, b) => labelDepth(a.label) - labelDepth(b.label));
  for (const entry of sorted) {
    const label = entry.label;
    const rid = label.runtimeStageId;
    if (seenRid.has(rid)) continue;
    if (!label.subflowPath || label.subflowPath.length === 0) continue;
    seenRid.add(rid);
    const node = toSpecNode(label);
    const pathKey = label.subflowPath.join("/");
    const parentKey = label.subflowPath.slice(0, -1).join("/");
    byPath.set(pathKey, node);
    const parent = parentKey ? byPath.get(parentKey) ?? root : root;
    if (isFanoutKind(parent.__kind)) {
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    } else {
      attachToNextChain(parent, node);
    }
  }
  return root;
}
function labelDepth(label) {
  return label.depth ?? 0;
}
function isFanoutKind(kind) {
  return kind !== void 0 && FANOUT_KINDS.has(kind);
}
function toSpecNode(label) {
  const primitiveKind = label.primitiveKind;
  const subflowName = label.subflowName;
  const node = {
    name: subflowName ?? label.runtimeStageId,
    id: label.runtimeStageId
  };
  if (primitiveKind && PRIMITIVE_ICON[primitiveKind]) {
    node.icon = PRIMITIVE_ICON[primitiveKind];
  }
  if (primitiveKind) {
    node.description = `${primitiveKind}: ${node.name}`;
    node.__kind = primitiveKind;
  }
  const subflowId = label.subflowId;
  if (subflowId) {
    node.subflowId = subflowId;
  }
  return node;
}
function attachToNextChain(parent, node) {
  if (parent.id === "__root__") {
    if (!parent.children) parent.children = [];
    parent.children.push(node);
    return;
  }
  let cur = parent;
  while (cur.next) cur = cur.next;
  cur.next = node;
}

// src/core/humanizer.ts
import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey
} from "agentfootprint";
var defaultHumanizer = (event) => {
  if (event.type === "agentfootprint.context.evaluated") return null;
  switch (event.type) {
    // Composition
    case "agentfootprint.composition.enter":
      return `Entered ${event.payload.kind} "${event.payload.name}" with ${event.payload.childCount} children.`;
    case "agentfootprint.composition.exit":
      return `${event.payload.kind} finished \u2014 ${event.payload.status} in ${event.payload.durationMs}ms.`;
    case "agentfootprint.composition.fork_start":
      return `Fanning out ${event.payload.branches.length} branches.`;
    case "agentfootprint.composition.merge_end":
      return `Merged ${event.payload.mergedBranchCount} branches via ${event.payload.strategy}.`;
    case "agentfootprint.composition.route_decided":
      return `Routed to "${event.payload.chosen}" \u2014 ${event.payload.rationale}`;
    case "agentfootprint.composition.iteration_start":
      return `Iteration ${event.payload.iteration} begins.`;
    case "agentfootprint.composition.iteration_exit":
      return `Iteration ${event.payload.iteration} ended (${event.payload.reason}).`;
    // Agent
    case "agentfootprint.agent.turn_start":
      return `Agent turn begins: "${event.payload.userPrompt}".`;
    case "agentfootprint.agent.turn_end":
      return `Agent turn complete: "${event.payload.finalContent}" (${event.payload.iterationCount} iterations, ${event.payload.totalInputTokens}+${event.payload.totalOutputTokens} tokens).`;
    case "agentfootprint.agent.iteration_start":
      return `ReAct iteration ${event.payload.iterIndex}.`;
    case "agentfootprint.agent.iteration_end":
      return `Iteration ${event.payload.iterIndex} ended (${event.payload.toolCallCount} tool calls).`;
    case "agentfootprint.agent.route_decided":
      return `Agent routed to "${event.payload.chosen}" \u2014 ${event.payload.rationale}`;
    // Stream
    case "agentfootprint.stream.llm_start":
      return `Calling ${event.payload.provider}/${event.payload.model} (iter ${event.payload.iteration}, ${event.payload.messagesCount} messages, ${event.payload.toolsCount} tools).`;
    case "agentfootprint.stream.llm_end":
      return `Model replied in ${event.payload.durationMs}ms (${event.payload.usage.input}+${event.payload.usage.output} tokens, ${event.payload.toolCallCount} tool calls, stop: ${event.payload.stopReason}).`;
    case "agentfootprint.stream.tool_start":
      return `Calling tool "${event.payload.toolName}" with ${JSON.stringify(event.payload.args)}.`;
    case "agentfootprint.stream.tool_end":
      return `Tool "${event.payload.toolCallId}" returned in ${event.payload.durationMs}ms${event.payload.error === true ? " (error)" : ""}.`;
    case "agentfootprint.stream.token":
      return null;
    // too low-signal for the analyst view
    // Context
    case "agentfootprint.context.injected":
      return `Injected ${event.payload.slot}: "${event.payload.contentSummary}" (from ${event.payload.source}).`;
    case "agentfootprint.context.slot_composed":
      return `Slot "${event.payload.slot}" composed (iter ${event.payload.iteration}, ${event.payload.budget.used}/${event.payload.budget.cap} tokens).`;
    case "agentfootprint.context.evicted":
      return `Evicted from "${event.payload.slot}" \u2014 ${event.payload.reason} (survived ${event.payload.survivalMs}ms).`;
    case "agentfootprint.context.budget_pressure":
      return `Budget pressure on "${event.payload.slot}": ${event.payload.projectedTokens}/${event.payload.capTokens} tokens \u2192 plan: ${event.payload.planAction}.`;
    // Cost
    case "agentfootprint.cost.tick":
      return `Cost +$${event.payload.estimatedUsd.toFixed(6)} \u2014 cumulative $${event.payload.cumulative.estimatedUsd.toFixed(6)}.`;
    case "agentfootprint.cost.limit_hit":
      return `\u26A0 Cost budget ${event.payload.limit} crossed \u2014 actual ${event.payload.actual} (${event.payload.action}).`;
    // Permission
    case "agentfootprint.permission.check":
      return `Permission: ${event.payload.capability} \u2192 "${event.payload.target}" = ${event.payload.result}${event.payload.rationale ? ` (${event.payload.rationale})` : ""}.`;
    case "agentfootprint.permission.gate_opened":
      return `Gate "${event.payload.gateId}" opened by ${event.payload.openedBy}.`;
    case "agentfootprint.permission.gate_closed":
      return `Gate "${event.payload.gateId}" closed \u2014 ${event.payload.reason}.`;
    // Pause
    case "agentfootprint.pause.request":
      return `\u23F8 Paused \u2014 ${event.payload.reason}.`;
    case "agentfootprint.pause.resume":
      return `\u25B6 Resumed after ${event.payload.pausedDurationMs}ms.`;
    // Eval / memory / skill (consumer-emitted, often domain-specific)
    case "agentfootprint.eval.score":
      return `Eval "${event.payload.metricId}" = ${event.payload.value}${event.payload.threshold !== void 0 ? ` (threshold ${event.payload.threshold})` : ""}.`;
    case "agentfootprint.eval.threshold_crossed":
      return `Eval "${event.payload.metricId}" crossed ${event.payload.threshold} ${event.payload.direction} \u2192 ${event.payload.value}.`;
    case "agentfootprint.memory.strategy_applied":
      return `Memory strategy "${event.payload.strategyKind}" applied \u2014 ${event.payload.reason}.`;
    case "agentfootprint.memory.written":
      return `Memory write: "${event.payload.memoryId}" \u2014 ${event.payload.contentSummary} (${event.payload.source}).`;
    case "agentfootprint.skill.activated":
      return `Skill "${event.payload.skillId}" activated \u2014 ${event.payload.reason}.`;
    case "agentfootprint.skill.deactivated":
      return `Skill "${event.payload.skillId}" deactivated \u2014 ${event.payload.reason}.`;
    // Error
    case "agentfootprint.error.fatal":
      return `\u26D4 The run failed \u2014 ${event.payload.error}`;
    default:
      return `[${event.type}]`;
  }
};
function humanizeWith(overrides) {
  return (event) => {
    const override = overrides[event.type];
    if (override) {
      const result = override(event);
      if (result !== void 0) return result;
    }
    return defaultHumanizer(event);
  };
}
function makeTeachingHumanizer(options = {}) {
  const appName = options.appName ?? "Chatbot";
  const getToolDescription = options.getToolDescription;
  const templates = options.commentaryTemplates ? { ...defaultCommentaryTemplates, ...options.commentaryTemplates } : defaultCommentaryTemplates;
  const ctx = { appName, getToolDescription };
  return (event) => {
    const key = selectCommentaryKey(event);
    if (key === null) return null;
    if (key === void 0) return defaultHumanizer(event);
    const template = templates[key];
    if (template === void 0) return defaultHumanizer(event);
    const vars = extractCommentaryVars(event, ctx, templates);
    return renderCommentary(template, vars);
  };
}
var teachingHumanizer = makeTeachingHumanizer();

// src/core/selectors/selectTouched.ts
function selectTouched(visibleSteps) {
  const touched = /* @__PURE__ */ new Set(["user"]);
  for (const s of visibleSteps) {
    if (s.kind === "llm->tool" || s.kind === "tool->llm") touched.add("tool");
    if (s.kind === "user->llm" || s.kind === "tool->llm" || s.kind === "llm->user") {
      touched.add("llm");
    }
    if (s.label.toLowerCase().includes("skill")) touched.add("skill");
  }
  return touched;
}

// src/core/selectors/selectEdges.ts
function stepToStageEndpoints(step, agent) {
  switch (step.kind) {
    case "user->llm":
      return {
        source: "actor-user",
        target: agent.llmId,
        sourceHandle: "user-out",
        targetHandle: "llm-top-in",
        dashed: false
      };
    case "llm->tool":
      return {
        source: agent.llmId,
        target: agent.toolId,
        sourceHandle: "llm-right-out",
        targetHandle: "tool-left-in",
        dashed: false
      };
    case "tool->llm":
      return {
        source: agent.toolId,
        target: agent.llmId,
        sourceHandle: "tool-bottom-out",
        targetHandle: "llm-bottom-in",
        dashed: true
      };
    case "llm->user":
      return {
        source: agent.llmId,
        target: "actor-user",
        sourceHandle: "llm-top-out",
        targetHandle: "user-in",
        dashed: false
      };
    default:
      return null;
  }
}
function stepEdgeLabel(step) {
  if (step.tokens) return `${step.tokens.in}\u2192${step.tokens.out} tok`;
  if (step.toolName) return step.toolName;
  const dur = step.endOffsetMs !== void 0 ? step.endOffsetMs - step.startOffsetMs : 0;
  if (dur > 0) return dur < 1e3 ? `${Math.round(dur)}ms` : `${(dur / 1e3).toFixed(2)}s`;
  return "";
}
function selectEdges(visibleSteps, agent) {
  const byKey = /* @__PURE__ */ new Map();
  visibleSteps.forEach((step, idx) => {
    const mapping = stepToStageEndpoints(step, agent);
    if (!mapping) return;
    const id = `${mapping.source}->${mapping.target}`;
    const label = stepEdgeLabel(step);
    const existing = byKey.get(id);
    if (existing) {
      existing.count = existing.count + 1;
      existing.mostRecentIdx = idx;
      if (label) existing.label = label;
    } else {
      byKey.set(id, {
        id,
        source: mapping.source,
        target: mapping.target,
        sourceHandle: mapping.sourceHandle,
        targetHandle: mapping.targetHandle,
        kind: step.kind,
        label,
        count: 1,
        mostRecentIdx: idx,
        dashed: mapping.dashed
      });
    }
  });
  return [...byKey.values()];
}

// src/core/selectors/selectFocusDetail.ts
function selectFocusDetail(step, log) {
  if (!step) return void 0;
  const isLLM = step.kind === "user->llm" || step.kind === "tool->llm" || step.kind === "llm->user";
  const isTool = step.kind === "llm->tool";
  if (!isLLM && !isTool) return void 0;
  const openType = isLLM ? "agentfootprint.stream.llm_start" : "agentfootprint.stream.tool_start";
  let openIdx = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (entry.event.type !== openType) continue;
    const delta = Math.abs(entry.runOffsetMs - step.startOffsetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      openIdx = i;
    }
  }
  if (openIdx === -1) return { stepId: step.id, kind: step.kind };
  const detail = { stepId: step.id, kind: step.kind };
  if (isTool) {
    const openEvent = log[openIdx].event;
    detail.toolArgs = openEvent.payload.args;
    for (let i = openIdx + 1; i < log.length; i++) {
      const e = log[i].event;
      if (e.type === "agentfootprint.stream.tool_end" && e.payload.toolCallId === openEvent.payload.toolCallId) {
        detail.toolResult = String(e.payload.result ?? "");
        break;
      }
    }
    return detail;
  }
  for (let i = openIdx + 1; i < log.length; i++) {
    const e = log[i].event;
    if (e.type === "agentfootprint.stream.llm_end") {
      const p = e.payload;
      detail.llmReasoning = p.content;
      detail.tokens = { in: p.usage.input, out: p.usage.output };
      break;
    }
  }
  for (let i = openIdx + 1; i < Math.min(log.length, openIdx + 12); i++) {
    const e = log[i].event;
    if (e.type === "agentfootprint.agent.route_decided") {
      const p = e.payload;
      detail.llmDecision = { route: p.chosen, rationale: p.rationale };
      break;
    }
  }
  return detail;
}

// src/core/selectors/selectHops.ts
var ACTOR_USER = "actor-user";
var STEP_KINDS_THAT_LIFT_TO_ARROWS = /* @__PURE__ */ new Set(["user->llm", "llm->tool", "tool->llm", "llm->user"]);
function selectHops(args) {
  const { graph, drillPath, agents } = args;
  const isMultiAgentTopLevel = drillPath.length === 0 && agents.length > 1;
  if (isMultiAgentTopLevel) {
    return chainHops(agents, graph);
  }
  const activeAgent = drillPath.length > 0 ? agents.find((a) => a.subflowPath.join("/") === drillPath.join("/")) ?? agents[0] : agents[0];
  if (!activeAgent) return [];
  const scoped = drillPath.length > 0 ? graph.nodes.filter((n) => startsWith(n.subflowPath, drillPath)) : graph.nodes;
  return scoped.filter((n) => STEP_KINDS_THAT_LIFT_TO_ARROWS.has(n.kind)).map((step, idx) => stepToHop(step, idx, activeAgent));
}
function chainHops(agents, graph) {
  const out = [];
  const firstAgent = agents[0];
  const lastAgent = agents[agents.length - 1];
  out.push({
    id: "hop-asks",
    kind: "asks",
    source: ACTOR_USER,
    target: agentNodeId(firstAgent),
    label: "asks",
    ...firstAgentAnchor(firstAgent, graph) ? { anchorStep: firstAgentAnchor(firstAgent, graph) } : {}
  });
  for (let i = 0; i < agents.length - 1; i++) {
    const from = agents[i];
    const to = agents[i + 1];
    const anchor = firstAgentAnchor(to, graph);
    out.push({
      id: `hop-forwards-${i}`,
      kind: "forwards",
      source: agentNodeId(from),
      target: agentNodeId(to),
      label: "forwards",
      ...anchor ? { anchorStep: anchor } : {}
    });
  }
  const finalAnchor = lastAgentFinalAnchor(lastAgent, graph);
  out.push({
    id: "hop-answers",
    kind: "answers",
    source: agentNodeId(lastAgent),
    target: ACTOR_USER,
    label: "answers",
    ...finalAnchor ? { anchorStep: finalAnchor } : {}
  });
  return out;
}
function agentNodeId(agent) {
  return `agent-card-${agent.groupId.replace(/^agent-group-/, "")}`;
}
function firstAgentAnchor(agent, graph) {
  if (agent.subflowPath.length === 0) return graph.nodes[0];
  for (const n of graph.nodes) {
    if (startsWith(n.subflowPath, agent.subflowPath)) {
      if (STEP_KINDS_THAT_LIFT_TO_ARROWS.has(n.kind)) return n;
    }
  }
  return graph.nodes.find(
    (n) => n.kind === "subflow" && joinPath(n.subflowPath) === joinPath(agent.subflowPath)
  );
}
function lastAgentFinalAnchor(agent, graph) {
  if (agent.subflowPath.length === 0) {
    return [...graph.nodes].reverse().find((n) => n.kind === "llm->user");
  }
  let last;
  for (const n of graph.nodes) {
    if (!startsWith(n.subflowPath, agent.subflowPath)) continue;
    if (n.kind === "llm->user") last = n;
  }
  return last;
}
function stepToHop(step, index, agent) {
  const { source, target } = stepEndpoints(step.kind, agent);
  return {
    id: `hop-step-${index}-${step.id}`,
    kind: step.kind,
    source,
    target,
    label: step.label ?? step.kind,
    anchorStep: step
  };
}
function stepEndpoints(kind, agent) {
  switch (kind) {
    case "user->llm":
      return { source: ACTOR_USER, target: agent.llmId };
    case "llm->tool":
      return { source: agent.llmId, target: agent.toolId };
    case "tool->llm":
      return { source: agent.toolId, target: agent.llmId };
    case "llm->user":
      return { source: agent.llmId, target: ACTOR_USER };
    default:
      return { source: agent.groupId, target: agent.groupId };
  }
}
function startsWith(path, prefix) {
  if (path.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) return false;
  }
  return true;
}
function joinPath(p) {
  return p.join("/");
}

// src/core/selectors/selectStepView.ts
function selectStepView(args) {
  const { graph, focusIndex, drillPath } = args;
  const agents = selectAgentInstances(graph);
  const mode = drillPath.length === 0 ? "top-level" : "drill-down";
  const agentForEdges = drillPath.length > 0 ? agents.find((a) => a.subflowPath.join("/") === drillPath.join("/")) ?? agents[0] : agents[0];
  const hops = selectHops({ graph, drillPath, agents });
  const totalHops = hops.length;
  const clampedFocus = Math.min(
    Math.max(0, focusIndex),
    Math.max(0, totalHops - 1)
  );
  const focusedHop = hops[clampedFocus];
  const currentStep = focusedHop?.anchorStep;
  const visibleSteps = [];
  for (let i = 0; i <= clampedFocus; i++) {
    const a = hops[i]?.anchorStep;
    if (a && !visibleSteps.includes(a)) visibleSteps.push(a);
  }
  const touched = selectTouched(visibleSteps);
  const edges = selectEdges(visibleSteps, agentForEdges);
  const activeEdgeKey = focusedHop ? `${focusedHop.source}->${focusedHop.target}` : void 0;
  void selectFocusDetail;
  void stepToStageEndpoints;
  return {
    mode,
    agents: drillPath.length > 0 ? [agentForEdges] : agents,
    visibleSteps,
    touched,
    edges,
    ...activeEdgeKey ? { activeEdgeKey } : {},
    ...currentStep ? { currentStep } : {},
    totalSteps: totalHops,
    breadcrumb: buildBreadcrumb(drillPath, agents),
    graph,
    hops
  };
}
function buildBreadcrumb(drillPath, agents) {
  const out = [{ id: "", label: "Run" }];
  for (let i = 0; i < drillPath.length; i++) {
    const partial = drillPath.slice(0, i + 1);
    const key = partial.join("/");
    const match = agents.find((a) => a.subflowPath.join("/") === key);
    out.push({ id: key, label: match?.label ?? key });
  }
  return out;
}

// src/core/selectors/selectContextEngineeringInjections.ts
var BASELINE_SOURCES = /* @__PURE__ */ new Set([
  "user",
  "tool-result",
  "assistant",
  "base",
  "registry"
]);
function isContextEngineering(inj) {
  return !BASELINE_SOURCES.has(inj.source);
}
function selectContextEngineeringInjections(injections) {
  if (!injections || injections.length === 0) return [];
  return injections.filter(isContextEngineering);
}

// src/core/selectors/selectCommentary.ts
function selectCommentaryAt(boundary, commitIdx) {
  if (!Number.isFinite(commitIdx) || commitIdx < 0) {
    return { active: void 0, breadcrumb: [] };
  }
  const enclosing = boundary.boundaryIndex.enclosing(commitIdx);
  const breadcrumb = enclosing.map((e) => e.label);
  const active = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1] : void 0;
  return { active, breadcrumb };
}
function selectCommentaryRanges(boundary) {
  const all = boundary.boundaryIndex.overlapping(0, Number.MAX_SAFE_INTEGER);
  return all.map((e) => ({
    label: e.label,
    startIdx: e.startIdx,
    endIdx: e.endIdx
  }));
}

// src/core/translate/helpers/makeNodeId.ts
function makeRootNodeId(kind, id) {
  return `${kind.toLowerCase()}:${id}`;
}
function makeChildNodeId(parentNodeId, memberId) {
  return `${parentNodeId}/${memberId}`;
}

// src/core/translate/perKind/translateAgent.ts
function translateAgent(metadata) {
  if (metadata.kind !== "Agent") {
    throw new TypeError(
      `translateAgent: expected GroupMetadata.kind = 'Agent', got '${metadata.kind}'`
    );
  }
  const id = makeRootNodeId("Agent", metadata.id);
  const node = {
    id,
    kind: "stage",
    label: metadata.name,
    primitiveKind: "Agent",
    ...metadata.extra !== void 0 && { metadata: metadata.extra }
  };
  return {
    nodes: [node],
    edges: [],
    rootNodeId: id,
    exitNodeId: id
  };
}

// src/core/translate/helpers/exitNodeId.ts
function exitNodeIdOf(output) {
  return output.exitNodeId ?? output.rootNodeId;
}

// src/core/translate/helpers/makeEdge.ts
function makeEdge(kind, source, target, options = {}) {
  const idCore = `${kind}:${source}->${target}`;
  const id = options.n !== void 0 ? `${idCore}#${options.n}` : idCore;
  return {
    id,
    source,
    target,
    kind,
    ...options.label !== void 0 && { label: options.label }
  };
}

// src/core/translate/helpers/mergeOutputs.ts
import { isDevMode } from "footprintjs";
function mergeOutputs(outputs, rootNodeId) {
  const nodes = [];
  const edges = [];
  for (const o of outputs) {
    for (const n of o.nodes) nodes.push(n);
    for (const e of o.edges) edges.push(e);
  }
  if (isDevMode()) assertNoCollisions(nodes, edges);
  return { nodes, edges, rootNodeId };
}
function assertNoCollisions(nodes, edges) {
  const nodeIds = /* @__PURE__ */ new Set();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) {
      throw new Error(
        `mergeOutputs: duplicate node id '${n.id}' detected during fold. Cause: two sibling compositions share the same caller-supplied id, or a nested composition aliases its parent's rootNodeId. Disambiguate the upstream composition ids.`
      );
    }
    nodeIds.add(n.id);
  }
  const edgeIds = /* @__PURE__ */ new Set();
  for (const e of edges) {
    if (edgeIds.has(e.id)) {
      throw new Error(
        `mergeOutputs: duplicate edge id '${e.id}' detected during fold. Cause: nested compositions emit the same control-flow edge (commonly a self-edge in nested loops). Use makeEdge's 'n' disambiguator at the inner level.`
      );
    }
    edgeIds.add(e.id);
  }
}

// src/core/translate/perKind/translateConditional.ts
function translateConditional(metadata, resolve2) {
  if (metadata.kind !== "Conditional") {
    throw new TypeError(
      `translateConditional: expected GroupMetadata.kind = 'Conditional', got '${metadata.kind}'`
    );
  }
  if (metadata.members.length === 0) {
    throw new RangeError(
      `translateConditional: Conditional '${metadata.id}' has zero branches \u2014 caller bug.`
    );
  }
  const decisionId = makeRootNodeId("Conditional", metadata.id);
  const convergeId = `${decisionId}/converge`;
  const fallbackId = metadata.extra !== void 0 && typeof metadata.extra["fallbackId"] === "string" ? metadata.extra["fallbackId"] : void 0;
  const decisionNode = {
    id: decisionId,
    kind: "stage",
    label: metadata.name,
    primitiveKind: "Conditional",
    ...metadata.extra !== void 0 && { metadata: metadata.extra }
  };
  const convergeNode = {
    id: convergeId,
    kind: "stage",
    label: "converge",
    primitiveKind: "Conditional",
    metadata: { synthetic: "converge" }
  };
  const branchOutputs = metadata.members.map(resolve2);
  const merged = mergeOutputs(branchOutputs, decisionId);
  const fanoutEdges = metadata.members.map((m, i) => {
    const branchOut = branchOutputs[i];
    const isFallback = fallbackId !== void 0 && m.memberId === fallbackId;
    const label = isFallback ? `${m.memberId} (default)` : m.memberId;
    return makeEdge("decision-branch", decisionId, branchOut.rootNodeId, {
      label
    });
  });
  const joinEdges = branchOutputs.map(
    (b) => makeEdge("next", exitNodeIdOf(b), convergeId)
  );
  return {
    nodes: [decisionNode, ...merged.nodes, convergeNode],
    edges: [...merged.edges, ...fanoutEdges, ...joinEdges],
    rootNodeId: decisionId,
    exitNodeId: convergeId
  };
}

// src/core/translate/perKind/translateLLMCall.ts
function translateLLMCall(metadata) {
  if (metadata.kind !== "LLMCall") {
    throw new TypeError(
      `translateLLMCall: expected GroupMetadata.kind = 'LLMCall', got '${metadata.kind}'`
    );
  }
  const id = makeRootNodeId("LLMCall", metadata.id);
  const node = {
    id,
    kind: "stage",
    label: metadata.name,
    primitiveKind: "LLMCall",
    ...metadata.extra !== void 0 && { metadata: metadata.extra }
  };
  return {
    nodes: [node],
    edges: [],
    rootNodeId: id,
    exitNodeId: id
  };
}

// src/core/translate/perKind/translateLoop.ts
function buildLoopLabel(extra) {
  if (extra === void 0) return "iterate";
  const maxIterations = extra["maxIterations"];
  const maxWallclockMs = extra["maxWallclockMs"];
  const parts = [];
  if (typeof maxIterations === "number") parts.push(`max ${maxIterations}`);
  if (typeof maxWallclockMs === "number") parts.push(`${Math.round(maxWallclockMs / 1e3)}s`);
  return parts.length > 0 ? parts.join(" \xB7 ") : "iterate";
}
function translateLoop(metadata, resolve2) {
  if (metadata.kind !== "Loop") {
    throw new TypeError(
      `translateLoop: expected GroupMetadata.kind = 'Loop', got '${metadata.kind}'`
    );
  }
  if (metadata.members.length !== 1) {
    throw new RangeError(
      `translateLoop: Loop '${metadata.id}' must have exactly 1 member (the body), got ${metadata.members.length}.`
    );
  }
  const body = resolve2(metadata.members[0]);
  const selfEdge = makeEdge(
    "loop-iteration",
    exitNodeIdOf(body),
    body.rootNodeId,
    { label: buildLoopLabel(metadata.extra) }
  );
  return {
    nodes: body.nodes,
    edges: [...body.edges, selfEdge],
    rootNodeId: body.rootNodeId,
    exitNodeId: exitNodeIdOf(body)
  };
}

// src/core/translate/helpers/pinUnderParent.ts
function pinUnderParent(child, parentNodeId) {
  const nodes = child.nodes.map(
    (n) => n.parentId === void 0 ? { ...n, parentId: parentNodeId } : n
  );
  return {
    nodes,
    edges: child.edges,
    rootNodeId: child.rootNodeId
  };
}

// src/core/translate/perKind/translateParallel.ts
function translateParallel(metadata, resolve2) {
  if (metadata.kind !== "Parallel") {
    throw new TypeError(
      `translateParallel: expected GroupMetadata.kind = 'Parallel', got '${metadata.kind}'`
    );
  }
  if (metadata.members.length === 0) {
    throw new RangeError(
      `translateParallel: Parallel '${metadata.id}' has zero branches \u2014 caller bug.`
    );
  }
  const containerId = makeRootNodeId("Parallel", metadata.id);
  const mergeId = `${containerId}/merge`;
  const container = {
    id: containerId,
    kind: "group",
    label: metadata.name,
    primitiveKind: "Parallel",
    ...metadata.extra !== void 0 && { metadata: metadata.extra }
  };
  const mergeNode = {
    id: mergeId,
    kind: "stage",
    label: "merge",
    primitiveKind: "Parallel",
    metadata: { synthetic: "merge" }
  };
  const branchOutputs = metadata.members.map(resolve2);
  const pinnedBranches = branchOutputs.map(
    (out) => pinUnderParent(out, containerId)
  );
  const merged = mergeOutputs(pinnedBranches, containerId);
  const forkEdges = metadata.members.map((m, i) => {
    const branchOut = branchOutputs[i];
    return makeEdge("fork-branch", containerId, branchOut.rootNodeId, {
      label: m.memberId
    });
  });
  const joinEdges = branchOutputs.map(
    (b) => makeEdge("next", exitNodeIdOf(b), mergeId)
  );
  return {
    // Order: container first (so xyflow sees parent before children),
    // then pinned children, then Merge synthetic sibling.
    nodes: [container, ...merged.nodes, mergeNode],
    edges: [...merged.edges, ...forkEdges, ...joinEdges],
    rootNodeId: containerId,
    exitNodeId: mergeId
  };
}

// src/core/translate/perKind/translateSequence.ts
function translateSequence(metadata, resolve2) {
  if (metadata.kind !== "Sequence") {
    throw new TypeError(
      `translateSequence: expected GroupMetadata.kind = 'Sequence', got '${metadata.kind}'`
    );
  }
  if (metadata.members.length === 0) {
    throw new RangeError(
      `translateSequence: Sequence '${metadata.id}' has zero members \u2014 caller bug (a Sequence must declare at least one step).`
    );
  }
  const memberOutputs = metadata.members.map(resolve2);
  const rootNodeId = memberOutputs[0].rootNodeId;
  const exitNodeId = exitNodeIdOf(memberOutputs[memberOutputs.length - 1]);
  const merged = mergeOutputs(memberOutputs, rootNodeId);
  const chainEdges = [];
  for (let i = 0; i < memberOutputs.length - 1; i++) {
    chainEdges.push(
      makeEdge(
        "next",
        exitNodeIdOf(memberOutputs[i]),
        memberOutputs[i + 1].rootNodeId
      )
    );
  }
  return {
    nodes: merged.nodes,
    edges: [...merged.edges, ...chainEdges],
    rootNodeId,
    exitNodeId
  };
}

// src/core/translate/lensGroupTranslator.ts
function isLensGroupOutput(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return Array.isArray(v.nodes) && Array.isArray(v.edges) && typeof v.rootNodeId === "string";
}
var resolve = (member) => {
  if (member.uiGroup !== void 0) {
    if (!isLensGroupOutput(member.uiGroup)) {
      throw new TypeError(
        `lensGroupTranslator: member '${member.memberId}' has a uiGroup but it is not a LensGroupOutput. A consumer wired a different GroupTranslator at that level \u2014 Lens cannot consume the result.`
      );
    }
    return member.uiGroup;
  }
  const fromRunner = member.runner.getUIGroupWith(
    lensGroupTranslator
  );
  if (fromRunner === void 0) {
    throw new Error(
      `lensGroupTranslator: member '${member.memberId}' has no translatable UI group shape \u2014 its runner returned undefined from getUIGroupWith.`
    );
  }
  return fromRunner;
};
var lensGroupTranslator = (metadata) => {
  switch (metadata.kind) {
    case "LLMCall":
      return translateLLMCall(metadata);
    case "Agent":
      return translateAgent(metadata);
    case "Sequence":
      return translateSequence(metadata, resolve);
    case "Loop":
      return translateLoop(metadata, resolve);
    case "Conditional":
      return translateConditional(metadata, resolve);
    case "Parallel":
      return translateParallel(metadata, resolve);
    default: {
      const exhaustive = metadata.kind;
      throw new TypeError(
        `lensGroupTranslator: unknown GroupMetadata.kind '${exhaustive}'`
      );
    }
  }
};

// src/core/collapser/structureGraphFromRunner.ts
import { walkSubflowSpec, splitStageId } from "footprintjs/trace";
import { createTraceStructureRecorder } from "footprint-explainable-ui/flowchart";
import { stageRole } from "agentfootprint";
function emphasisForRole(role) {
  if (role === "hero-slot" || role === "hero-llm" || role === "hero-action") return "hero";
  if (role === "plumbing") return "muted";
  return void 0;
}
function iconForRole(localId, role) {
  if (role === "hero-llm") return "llm";
  if (role === "hero-action") return "tool";
  if (role === "hero-slot") {
    if (localId === "sf-system-prompt") return "system-prompt";
    if (localId === "sf-messages") return "messages";
    if (localId === "sf-tools") return "tool";
  }
  return void 0;
}
function sizeForRole(role) {
  if (role === "hero-llm") return "lg";
  if (role === "plumbing") return "sm";
  return void 0;
}
function slotKindForLocalId(localId) {
  if (localId === "sf-system-prompt") return "system-prompt";
  if (localId === "sf-messages") return "messages";
  if (localId === "sf-tools") return "tools";
  return void 0;
}
function structureGraphFromRunner(runner) {
  const trace = createTraceStructureRecorder();
  const recorder = trace.recorder;
  const spec = runner.getSpec().buildTimeStructure;
  const subflowSpecs = [];
  for (const item of walkSubflowSpec(spec, "", { recurse: false })) {
    switch (item.kind) {
      case "stage":
        recorder.onStageAdded?.({
          stageId: item.stageId,
          name: item.name,
          type: item.type,
          ...item.isPausable !== void 0 && { isPausable: item.isPausable },
          spec: item.spec
        });
        break;
      case "edge":
        recorder.onEdgeAdded?.({
          from: item.from,
          to: item.to,
          kind: item.edgeKind,
          ...item.label !== void 0 && { label: item.label }
        });
        break;
      case "loop":
        recorder.onLoopEdgeAdded?.({ from: item.from, to: item.to });
        break;
      case "subflow":
        recorder.onSubflowMounted?.({
          subflowId: item.subflowId,
          subflowName: item.subflowName,
          rootStageId: item.mountStageId,
          subflowSpec: item.subflowSpec,
          subflowPath: item.subflowPath
        });
        subflowSpecs.push({
          subflowId: item.subflowId,
          spec: item.subflowSpec,
          // Strip any leading slash so qualified ids read `sf-x/stage`, matching
          // the runtime overlay key (runtimeStageId minus #index has no leading /).
          path: (typeof item.subflowPath === "string" && item.subflowPath.length > 0 ? item.subflowPath : item.subflowId).replace(/^\/+/, "")
        });
        break;
      case "subflow-start":
        break;
    }
  }
  const baseGraph = trace.getGraph();
  const internal = expandSubflowInternals(subflowSpecs);
  const nodes = [...baseGraph.nodes, ...internal.nodes];
  const edges = [...baseGraph.edges, ...internal.edges];
  for (const node of nodes) {
    const role = stageRole(node.id);
    const data = node.data;
    const { localStageId } = splitStageId(node.id);
    const emphasis = emphasisForRole(role);
    if (emphasis !== void 0) data.emphasis = emphasis;
    if (data.icon === void 0) {
      const icon = iconForRole(localStageId, role);
      if (icon !== void 0) data.icon = icon;
    }
    const size = sizeForRole(role);
    if (size !== void 0) data.size = size;
    if (role === "hero-slot") {
      node.type = "slotPill";
      const slotKind = slotKindForLocalId(localStageId);
      if (slotKind !== void 0) data.slotKind = slotKind;
    }
  }
  return { ...baseGraph, nodes, edges };
}
function expandSubflowInternals(subflows) {
  const nodes = [];
  const edges = [];
  for (const { subflowId, spec, path } of subflows) {
    const subTrace = createTraceStructureRecorder();
    const subRec = subTrace.recorder;
    for (const item of walkSubflowSpec(spec, path, { recurse: false })) {
      switch (item.kind) {
        case "stage":
          subRec.onStageAdded?.({
            stageId: item.stageId,
            name: item.name,
            type: item.type,
            ...item.isPausable !== void 0 && { isPausable: item.isPausable },
            spec: item.spec
          });
          break;
        case "edge":
          subRec.onEdgeAdded?.({
            from: item.from,
            to: item.to,
            kind: item.edgeKind,
            ...item.label !== void 0 && { label: item.label }
          });
          break;
        case "loop":
          subRec.onLoopEdgeAdded?.({ from: item.from, to: item.to });
          break;
        case "subflow":
          subRec.onSubflowMounted?.({
            subflowId: item.subflowId,
            subflowName: item.subflowName,
            rootStageId: item.mountStageId,
            subflowSpec: item.subflowSpec,
            subflowPath: item.subflowPath
          });
          break;
        case "subflow-start":
          break;
      }
    }
    const sub = subTrace.getGraph();
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const q = (id) => id.startsWith(prefix) ? id : `${prefix}${id}`;
    for (const n of sub.nodes) {
      nodes.push({ ...n, id: q(n.id), data: { ...n.data, subflowOf: subflowId } });
    }
    for (const e of sub.edges) {
      edges.push({ ...e, id: `${q(e.source)}->${q(e.target)}`, source: q(e.source), target: q(e.target) });
    }
  }
  return { nodes, edges };
}

// src/core/render/toReactFlow.ts
var DEFAULT_STAGE_SIZE = { width: 180, height: 56 };
var DEFAULT_GROUP_SIZE = { width: 260, height: 120 };
function toReactFlow(output) {
  const nodes = output.nodes.map(
    (n) => nodeToXyflow(n)
  );
  const edges = output.edges.map(
    (e) => edgeToXyflow(e)
  );
  return { nodes, edges };
}
function nodeToXyflow(n) {
  const data = {
    label: n.label,
    primitiveKind: n.primitiveKind,
    ...n.metadata !== void 0 && { metadata: n.metadata }
  };
  const base = {
    id: n.id,
    position: { x: 0, y: 0 },
    data,
    ...n.kind === "group" ? { type: "group", style: { ...DEFAULT_GROUP_SIZE } } : { type: "lensStage" },
    ...n.parentId !== void 0 && {
      parentId: n.parentId,
      extent: "parent"
    }
  };
  return base;
}
function edgeToXyflow(e) {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: "default",
    data: { kind: e.kind },
    ...e.label !== void 0 && { label: e.label }
  };
}
function defaultSize(node) {
  return node.kind === "group" ? { ...DEFAULT_GROUP_SIZE } : { ...DEFAULT_STAGE_SIZE };
}

// src/react/layout/dagreLayout.ts
import dagre from "dagre";
function dagreLayout(sized, edges, options = {}) {
  const direction = options.direction ?? "TB";
  const rankSep = options.rankSep ?? 80;
  const nodeSep = options.nodeSep ?? 60;
  const edgeSep = options.edgeSep ?? 20;
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep, edgesep: edgeSep });
  g.setDefaultEdgeLabel(() => ({}));
  for (const { node, width, height } of sized) {
    g.setNode(node.id, { width, height });
    if (node.parentId) {
      g.setParent(node.id, node.parentId);
    }
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);
  const out = [];
  for (const { node, width, height } of sized) {
    const laidOut = g.node(node.id);
    if (!laidOut) {
      out.push(node);
      continue;
    }
    let x = laidOut.x - width / 2;
    let y = laidOut.y - height / 2;
    if (node.parentId) {
      const parent = g.node(node.parentId);
      const parentSized = sized.find((s) => s.node.id === node.parentId);
      if (parent && parentSized) {
        x -= parent.x - parentSized.width / 2;
        y -= parent.y - parentSized.height / 2;
      }
    }
    out.push({ ...node, position: { x, y } });
  }
  return out;
}

// src/core/render/layoutLensGraph.ts
var USER_IN_NODE_ID = "__lens_user_in";
var USER_OUT_NODE_ID = "__lens_user_out";
var USER_NODE_SIZE = { width: 100, height: 44 };
function layoutLensGraph(output, options = {}) {
  const { nodes: unpositionedNodes, edges } = toReactFlow(output);
  const withUserFrame = options.withUserFrame ?? false;
  const sized = unpositionedNodes.map((node, i) => {
    const sourceLensNode = output.nodes[i];
    const size = options.sizeOverride?.(sourceLensNode) ?? defaultSize(sourceLensNode);
    return { node, width: size.width, height: size.height };
  });
  const parentIdByNodeId = /* @__PURE__ */ new Map();
  for (const n of unpositionedNodes) {
    if (n.parentId !== void 0) parentIdByNodeId.set(n.id, n.parentId);
  }
  const layoutEdges = edges.filter(
    (e) => parentIdByNodeId.get(e.target) !== e.source && parentIdByNodeId.get(e.source) !== e.target
  );
  const positionedNodes = dagreLayout(sized, layoutEdges, {
    ...options.direction !== void 0 && { direction: options.direction },
    ...options.rankSep !== void 0 && { rankSep: options.rankSep },
    ...options.nodeSep !== void 0 && { nodeSep: options.nodeSep },
    ...options.edgeSep !== void 0 && { edgeSep: options.edgeSep }
  });
  const PADDING = { top: 36, right: 24, bottom: 24, left: 24 };
  const sizedById = new Map(sized.map((s) => [s.node.id, s]));
  const resizedNodes = positionedNodes.map((node) => {
    if (node.type !== "group") return node;
    const children = positionedNodes.filter((c) => c.parentId === node.id);
    if (children.length === 0) return node;
    let maxRight = 0;
    let maxBottom = 0;
    for (const child of children) {
      const childSized = sizedById.get(child.id);
      if (!childSized) continue;
      const right = child.position.x + childSized.width;
      const bottom = child.position.y + childSized.height;
      if (right > maxRight) maxRight = right;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return {
      ...node,
      style: {
        ...node.style ?? {},
        width: maxRight + PADDING.right + PADDING.left,
        height: maxBottom + PADDING.bottom + PADDING.top
      }
    };
  });
  if (!withUserFrame) {
    return { nodes: resizedNodes, edges };
  }
  const USER_GAP = 60;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of resizedNodes) {
    if (n.parentId !== void 0) continue;
    const sizedEntry = sizedById.get(n.id);
    const w = n.style?.width ?? sizedEntry?.width ?? 180;
    const h = n.style?.height ?? sizedEntry?.height ?? 56;
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + w > maxX) maxX = n.position.x + w;
    if (n.position.y + h > maxY) maxY = n.position.y + h;
  }
  const centerX = (minX + maxX) / 2 - USER_NODE_SIZE.width / 2;
  const userIn = {
    id: USER_IN_NODE_ID,
    type: "lensUser",
    position: { x: centerX, y: minY - USER_GAP - USER_NODE_SIZE.height },
    data: { label: "user", primitiveKind: "Agent", userActor: "in" }
  };
  const userOut = {
    id: USER_OUT_NODE_ID,
    type: "lensUser",
    position: { x: centerX, y: maxY + USER_GAP },
    data: { label: "user", primitiveKind: "Agent", userActor: "out" }
  };
  const exitNodeId = output.exitNodeId ?? output.rootNodeId;
  const userEdges = [
    {
      id: "__lens_edge_user_in",
      source: USER_IN_NODE_ID,
      target: output.rootNodeId,
      type: "default",
      data: { kind: "next" }
    },
    {
      id: "__lens_edge_user_out",
      source: exitNodeId,
      target: USER_OUT_NODE_ID,
      type: "default",
      data: { kind: "next" }
    }
  ];
  return {
    nodes: [userIn, ...resizedNodes, userOut],
    edges: [...edges, ...userEdges]
  };
}

export {
  ChangeNotifier,
  lensSnapshotRecorder,
  LensSnapshotRecorder,
  LensRecorder,
  lensRecorder,
  buildStepGraphFromSnapshot,
  buildSpecTreeFromBoundary,
  defaultHumanizer,
  humanizeWith,
  makeTeachingHumanizer,
  teachingHumanizer,
  selectTouched,
  stepToStageEndpoints,
  stepEdgeLabel,
  selectEdges,
  selectFocusDetail,
  selectHops,
  selectStepView,
  BASELINE_SOURCES,
  isContextEngineering,
  selectContextEngineeringInjections,
  selectCommentaryAt,
  selectCommentaryRanges,
  makeRootNodeId,
  makeChildNodeId,
  translateAgent,
  makeEdge,
  mergeOutputs,
  translateConditional,
  translateLLMCall,
  translateLoop,
  pinUnderParent,
  translateParallel,
  translateSequence,
  lensGroupTranslator,
  structureGraphFromRunner,
  toReactFlow,
  defaultSize,
  layoutLensGraph
};
//# sourceMappingURL=chunk-4KNFGXVS.js.map