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

import { SequenceStore, ROOT_SUBFLOW_ID, ROOT_RUNTIME_STAGE_ID } from 'footprintjs/trace';
import { CommitRangeIndex } from 'foottrace';
import type { RangeToken } from 'foottrace';
import type {
  CombinedRecorder,
  FlowSubflowEvent,
  FlowForkEvent,
  FlowDecisionEvent,
  FlowLoopEvent,
} from 'footprintjs';
import type { AgentfootprintEvent } from '../../events/registry.js';
import type { Unsubscribe } from '../../events/dispatcher.js';
import '../../lib/conventions.js';
import type { RunIdObserver } from './observeRunId.js';
import { createRunIdObserver } from './observeRunId.js';
import { summarizeEmbeddings } from './embeddingSummary.js';
import type { LeanDomainEvent } from './boundaryRecorder/leanContent.js';
import { stripContent } from './boundaryRecorder/leanContent.js';
import { isAgentInternalId } from './boundaryRecorder/agentInternal.js';
import type { BoundaryRecorderOptions, TypedEventSource } from './boundaryRecorder/options.js';
import type {
  DomainEvent,
  DomainCompositionEvent,
  DomainRunEvent,
  DomainSubflowEvent,
} from './boundaryRecorder/domainEvents.js';
import type { BoundaryRangeLabel } from './boundaryRecorder/rangeLabels.js';
import {
  sanitizeCommitCount,
  buildRunEvent,
  buildSubflowEvent,
  pathFromCtx,
  ctxDepth,
} from './boundaryRecorder/eventBuilders.js';
import type { FlowRunEvent, FlowRunFailedEvent } from './boundaryRecorder/flowEvents.js';
import { toBoundaryLabel, toCompositionBoundaryLabel } from './boundaryRecorder/rangeLabels.js';
import type { BoundaryAggregate } from './boundaryRecorder/rollups.js';
import { foldRollup } from './boundaryRecorder/rollups.js';

export type {
  DomainRunEvent,
  DomainSubflowEvent,
  DomainForkBranchEvent,
  DomainDecisionBranchEvent,
  DomainLoopIterationEvent,
  DomainCompositionEvent,
  ActorArrow,
  DomainLLMStartEvent,
  DomainLLMEndEvent,
  DomainToolStartEvent,
  DomainToolEndEvent,
  DomainContextInjectedEvent,
  DomainEvent,
} from './boundaryRecorder/domainEvents.js';

export type { LeanDomainEvent } from './boundaryRecorder/leanContent.js';

export type { BoundaryAggregate } from './boundaryRecorder/rollups.js';

export type { TypedEventSource, BoundaryRecorderOptions } from './boundaryRecorder/options.js';

export type { BoundaryRangeLabel } from './boundaryRecorder/rangeLabels.js';

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
          // 9.88.0 — these two used to be dropped. Both are already governed
          // upstream (the text by `recordSystemPrompt`, the catalog by there
          // being any tools), so dropping them here removed evidence from the
          // one stream a replay walks without adding a single guarantee.
          ...(p.systemPromptText !== undefined ? { systemPromptText: p.systemPromptText } : {}),
          ...(p.messagesCount !== undefined ? { messagesCount: p.messagesCount } : {}),
          ...(p.toolsCount !== undefined ? { toolsCount: p.toolsCount } : {}),
          ...(p.tools !== undefined ? { tools: p.tools } : {}),
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
          // The batch settlement's marker (9.113.0), carried as the stream
          // carries it. Not the only "this call never ran": `tool_end.entered` is
          // not carried here yet (`answer-account/README.md`, "Not covered yet").
          ...(p.notDispatched !== undefined ? { notDispatched: p.notDispatched } : {}),
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
          ...(p.notDispatched !== undefined ? { notDispatched: p.notDispatched } : {}),
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
