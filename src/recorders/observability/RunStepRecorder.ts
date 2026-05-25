/**
 * RunStepRecorder — slider-ready ordered list of RunSteps, BUILT
 * INCREMENTALLY during traversal. Real-time recorder, not a walker.
 *
 * Pattern: extends `SequenceRecorder<RunStep>` (shared storage shelf)
 *          and implements `CombinedRecorder` (FlowRecorder hooks).
 *          Subscribes to the agentfootprint typed-event dispatcher
 *          for actor-arrow events. Each event handler decides whether
 *          to emit a step; state lives on the instance and persists
 *          across the run.
 * Role:    The single source of truth for "what slider positions
 *          exist in this run, and what transitions does each light
 *          up." Lens consumers attach the recorder once and read
 *          `getSteps()` — no per-render re-derivation.
 *
 * Why this matters: the older `buildRunSteps(events)` walker violated
 * footprintjs's core principle ("collect during traversal, never
 * post-process"). Each call walked the full event log multiple times;
 * the playground triggered a full walk on every flowchart update,
 * yielding O(N²) total work for a streaming run. The recorder pattern
 * is O(N) — one handler call per event — and matches BoundaryRecorder /
 * FlowchartRecorder / KeyedRecorder idioms throughout the library.
 *
 * The `buildRunSteps(...)` function is RETAINED as a thin compatibility
 * shim that constructs a fresh recorder, replays events through it,
 * and returns the resulting entries. Useful for snapshot-from-saved-
 * events use cases (replay, testing, post-hoc analysis). Live consumers
 * should attach the recorder directly via `runner.attach(rec)`.
 */

import {
  ROOT_RUNTIME_STAGE_ID,
  ROOT_SUBFLOW_ID,
  SequenceStore,
  splitStageId,
} from 'footprintjs/trace';
import type {
  CombinedRecorder,
  FlowDecisionEvent,
  FlowForkEvent,
  FlowLoopEvent,
  FlowSubflowEvent,
  TraversalContext,
} from 'footprintjs';
// FlowRunEvent isn't re-exported from footprintjs's main barrel; mirror
// the structural shape locally — same shim BoundaryRecorder uses.
interface FlowRunEvent {
  readonly payload?: unknown;
  readonly traversalContext?: TraversalContext;
}
import type { AgentfootprintEvent, AgentfootprintEventType } from '../../events/registry.js';
import type { EventDispatcher, Unsubscribe } from '../../events/dispatcher.js';
import type { BoundaryRecorder, DomainEvent } from './BoundaryRecorder.js';
import { createRunIdObserver, type RunIdObserver } from './observeRunId.js';
import { ForkTracker } from './internal/ForkTracker.js';
import { SequenceSiblingTracker } from './internal/SequenceSiblingTracker.js';
import { CandidateAnswerBuffer } from './internal/CandidateAnswerBuffer.js';
import { RootInferrer } from './internal/RootInferrer.js';
import { ActorArrowClassifier } from './internal/ActorArrowClassifier.js';

// ─── Public types ───────────────────────────────────────────────────

/**
 * One slider position. The smallest scrubable unit of the run.
 *
 * `transitions` is 1+ — fan-out / merge steps light up multiple
 * transitions at once; sequential / decide / react steps light up
 * exactly one. Renderers iterate `transitions` to highlight edges;
 * details panels read `anchor.runtimeStageId`.
 */
export interface RunStep {
  /** 0-based slider index (matches array position in `getSteps()`). */
  readonly seq: number;
  readonly kind: RunStepKind;
  readonly transitions: readonly RunStepTransition[];
  /**
   * Per-step key — required by `SequenceRecorder<T>` for time-travel
   * utilities (`getEntriesForStep`, `getEntryRanges`). Mirrors
   * `anchor.runtimeStageId`; both fields point at the same value.
   * Top-level placement satisfies the recorder's storage contract.
   */
  readonly runtimeStageId: string;
  /** Anchor for commentary highlight + details pane lookup. */
  readonly anchor: {
    readonly runtimeStageId: string;
    readonly subflowPath: readonly string[];
  };
  /** Human label — short, kind-specific. */
  readonly label: string;
  /** Wall-clock ms at which this step occurred. */
  readonly tsMs: number;
  /** Kind-specific decoration. Discriminate on `kind`. */
  readonly meta?: RunStepMeta;
}

export type RunStepKind =
  | 'sequential'
  | 'fork'
  | 'merge'
  | 'decide'
  | 'iteration'
  | 'iteration-exit'
  | 'react';

export interface RunStepTransition {
  readonly from: string;
  readonly to: string;
  readonly via: 'next' | 'fork-branch' | 'decision-branch' | 'loop-iteration' | 'actor-arrow';
  readonly label?: string;
}

export type RunStepMeta =
  | { readonly kind: 'decide'; readonly chosen: string; readonly rationale?: string }
  | { readonly kind: 'iteration'; readonly index: number; readonly target: string }
  | { readonly kind: 'iteration-exit'; readonly index: number; readonly reason?: string }
  | { readonly kind: 'fork'; readonly parentSubflowId: string }
  | { readonly kind: 'merge'; readonly mergedCount: number }
  | {
      readonly kind: 'react';
      readonly actorArrow: 'user→llm' | 'tool→llm' | 'llm→tool' | 'llm→user';
    };

export interface RunStepRecorderOptions {
  readonly id?: string;
}

let _counter = 0;

/** Factory — matches the `boundaryRecorder()` / `topologyRecorder()` style. */
export function runStepRecorder(options: RunStepRecorderOptions = {}): RunStepRecorder {
  return new RunStepRecorder(options);
}

// ─── Constants ──────────────────────────────────────────────────────

const ACTOR_USER = 'actor:user';

const LEAF_PRIMITIVES = new Set(['Agent', 'LLMCall']);

function isLeafPrimitive(kind: string | undefined): boolean {
  return kind !== undefined && LEAF_PRIMITIVES.has(kind);
}

function lastSegment(subflowId: string): string {
  const i = subflowId.lastIndexOf('/');
  return i >= 0 ? subflowId.slice(i + 1) : subflowId;
}

function isPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) return false;
  }
  return true;
}

function pathFromCtx(s: string | undefined): readonly string[] {
  const segments = s ? s.split('/').filter(Boolean) : [];
  return [ROOT_SUBFLOW_ID, ...segments];
}

interface BoundaryFrame {
  readonly subflowId: string;
  readonly subflowPath: readonly string[];
  readonly primitiveKind?: string;
  readonly depth: number;
}

// ─── Recorder class ────────────────────────────────────────────────

/**
 * Real-time slider-step recorder. Emits a `RunStep` whenever an event
 * marks a meaningful slider transition. State persists on the instance
 * so successive events update bookkeeping in O(1).
 *
 * Attach via `runner.attach(rec)` for FlowRecorder events; call
 * `rec.subscribe(runner.dispatcher)` for actor-arrow events. The
 * `getSteps(drillPath?)` method returns the already-built list (no
 * walking) with optional drill-scope filtering.
 */
export class RunStepRecorder implements CombinedRecorder {
  readonly id: string;

  /** Composition: storage shelf for the slider-step sequence. */
  private readonly store = new SequenceStore<RunStep>();

  /** Run-boundary observer — fires this.clear() when traversalContext.runId
   *  changes between events. THIS IS THE FIX for the Parallel multi-run
   *  aliasing bug — without it `forkKey = ${parent}@${rid}` collides
   *  because rid resets to `seed#0` on each run. */
  private readonly runIdGuard: RunIdObserver = createRunIdObserver(() => this.resetForNewRun());

  // ── Composed sub-trackers (one concern each) ─────────────────────
  /** Stack of currently-open boundaries. The recorder owns this
   *  directly because it's a simple stack and frames are recorder-
   *  shaped. */
  private boundaryStack: BoundaryFrame[] = [];
  /** Fork-emission coalescing + branch-exit tally. */
  private readonly forks = new ForkTracker();
  /** Tracks the most-recent leaf exit per depth → "forwards" handoff. */
  private readonly siblings = new SequenceSiblingTracker();
  /** Buffers a "this MIGHT be the answer" leaf until onRunEnd. */
  private readonly answerBuffer = new CandidateAnswerBuffer<BoundaryFrame>();
  /** Run-root inference state machine (leaf vs composition). */
  private readonly rootInferrer = new RootInferrer();
  /** llm.start / llm.end actor-arrow classifier. */
  private readonly actorArrows = new ActorArrowClassifier();
  /** Has the first `asks` step fired? */
  private asksEmitted = false;

  constructor(options: RunStepRecorderOptions = {}) {
    this.id = options.id ?? `run-step-${++_counter}`;
  }

  /**
   * Emit a RunStep, auto-mirroring `anchor.runtimeStageId` to the
   * top-level `runtimeStageId` field that the keyed index uses. Single
   * source of truth (the anchor) — never inconsistent with the storage
   * key.
   */
  private push(step: Omit<RunStep, 'runtimeStageId'>): void {
    this.store.push({ ...step, runtimeStageId: step.anchor.runtimeStageId });
  }

  /** Internal seq-numbering helper — mirrors the store size so each
   *  RunStep gets a unique 0-based index in emit order. */
  private get entryCount(): number {
    return this.store.size;
  }

  clear(): void {
    this.resetForNewRun();
    this.runIdGuard.reset();
  }

  /** Internal — wipe all per-run state WITHOUT resetting the runIdGuard
   *  itself. Called by `clear()` (which then resets the guard) AND by
   *  the runIdGuard's onNewRun callback (where the guard is mid-update
   *  and must NOT be reset, only the recorder's data should be).
   *
   *  Note: each sub-tracker owns its OWN clear; the orchestrator just
   *  fans out. Adding new state to a sub-tracker requires no edit here. */
  private resetForNewRun(): void {
    this.store.clear();
    this.boundaryStack = [];
    this.forks.clear();
    this.siblings.clear();
    this.answerBuffer.clear();
    this.rootInferrer.clear();
    this.actorArrows.clear();
    this.asksEmitted = false;
  }

  private observeRunId(runId: string | undefined): void {
    this.runIdGuard.observe(runId);
  }

  // ── FlowRecorder hooks ─────────────────────────────────────────

  onRunStart(event: FlowRunEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    // Nothing to emit yet — the first leaf entry / fork event starts
    // the slider.
  }

  onRunEnd(event: FlowRunEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    // Emit the deferred `answers` step for the last leaf exit at run
    // scope. Without this, runs with a Sequence-rooted shape never
    // see their final answer reflected on the slider.
    this.flushCandidateAnswer();
  }

  onSubflowEntry(event: FlowSubflowEvent): void {
    if (!event.subflowId) return;
    this.observeRunId(event.traversalContext?.runId);
    const ctx = event.traversalContext;
    const runtimeStageId = ctx?.runtimeStageId ?? '';
    const subflowPath = pathFromCtx(ctx?.subflowPath);
    const depth = subflowPath.length - 1;
    const ts = Date.now();
    const subflowId: string = event.subflowId;
    const description = event.description;
    const primitiveKind = parsePrimitiveKind(description);

    // Delegate root inference to the dedicated state machine.
    this.rootInferrer.observeSubflowEntry(depth, primitiveKind);

    const frame: BoundaryFrame = {
      subflowId,
      subflowPath,
      ...(primitiveKind ? { primitiveKind } : {}),
      depth,
    };

    const isLeaf = isLeafPrimitive(primitiveKind);

    if (this.forks.isForkChild(subflowId)) {
      // Branch wrapper of a tracked fork — push frame so the matching
      // exit can tally for the merge step. No sequential emission.
      this.boundaryStack.push(frame);
      return;
    }

    if (isLeaf) {
      const prevSibling = this.siblings.peekPrevSibling(depth);
      if (prevSibling) {
        // Sequence-style sibling handoff: previous leaf exited, new
        // leaf entered at the same depth → emit `forwards`.
        this.push({
          seq: this.entryCount,
          kind: 'sequential',
          transitions: [{ from: prevSibling, to: subflowId, via: 'next', label: 'forwards' }],
          anchor: { runtimeStageId, subflowPath },
          label: 'forwards',
          tsMs: ts,
        });
      } else if (!this.asksEmitted) {
        // First leaf in the run — User asks it.
        this.push({
          seq: this.entryCount,
          kind: 'sequential',
          transitions: [{ from: ACTOR_USER, to: subflowId, via: 'next', label: 'asks' }],
          anchor: { runtimeStageId, subflowPath },
          label: 'asks',
          tsMs: ts,
        });
        this.asksEmitted = true;
      }
    }

    this.boundaryStack.push(frame);
  }

  onSubflowExit(event: FlowSubflowEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const ctx = event.traversalContext;
    const runtimeStageId = ctx?.runtimeStageId ?? '';
    const ts = Date.now();
    const frame = this.boundaryStack.pop();
    if (!frame) return;
    const isLeaf = isLeafPrimitive(frame.primitiveKind);

    // Fork-branch exit: ForkTracker tallies completion and signals
    // when ALL branches have exited so we can emit the merge step.
    const merge = this.forks.recordChildExit(frame.subflowId);
    if (merge) {
      this.push({
        seq: this.entryCount,
        kind: 'merge',
        transitions: merge.branches.map((sid) => ({
          from: sid,
          to: ACTOR_USER,
          via: 'next' as const,
          label: lastSegment(sid),
        })),
        anchor: { runtimeStageId, subflowPath: frame.subflowPath },
        label: `merge (${merge.branches.length})`,
        tsMs: ts,
        meta: { kind: 'merge', mergedCount: merge.branches.length },
      });
      return;
    }
    // If it WAS a fork child but not the last to exit, still skip the
    // leaf-handoff path below.
    if (this.forks.isForkChild(frame.subflowId)) return;

    if (isLeaf) {
      // Sibling handoff + answer-candidate buffering. Both delegated.
      this.siblings.recordExit(frame.depth, frame.subflowId);
      this.answerBuffer.set(frame, ts, runtimeStageId);
    }
  }

  onFork(event: FlowForkEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const ctx = event.traversalContext;
    const runtimeStageId = ctx?.runtimeStageId ?? '';
    const subflowPath = pathFromCtx(ctx?.subflowPath);
    const ts = Date.now();
    const depth = subflowPath.length - 1;

    // ForkTracker handles registration + dedup. Cross-run collisions
    // (Committee + TolerantCommittee back-to-back, both emitting
    // `seed#0` as the parent stage) are prevented by observeRunId
    // above — the tracker's state is wiped when runId changes.
    const reg = this.forks.registerFork(event.parent, runtimeStageId, event.children);
    if (!reg.fresh) return;

    // Fork at depth 0 = Parallel root signal.
    this.rootInferrer.observeFork(depth);

    const branches = [...event.children];
    this.push({
      seq: this.entryCount,
      kind: 'fork',
      transitions: branches.map((childName) => ({
        from: ACTOR_USER,
        to: childName,
        via: 'fork-branch' as const,
        label: childName,
      })),
      anchor: { runtimeStageId, subflowPath },
      label: `fork (${branches.length})`,
      tsMs: ts,
      meta: { kind: 'fork', parentSubflowId: event.parent },
    });
  }

  onDecision(event: FlowDecisionEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const ctx = event.traversalContext;
    // Skip Agent-internal decisions — those are encoded by the actor
    // arrows that follow.
    const stageId = ctx?.stageId ?? '';
    const { localStageId } = splitStageId(stageId);
    if (isAgentInternalStageId(localStageId)) return;

    const runtimeStageId = ctx?.runtimeStageId ?? '';
    const subflowPath = pathFromCtx(ctx?.subflowPath);
    const ts = Date.now();
    const depth = subflowPath.length - 1;
    this.rootInferrer.observeDecision(depth);

    this.push({
      seq: this.entryCount,
      kind: 'decide',
      transitions: [
        {
          from: runtimeStageId,
          to: event.chosen,
          via: 'decision-branch',
          label: event.chosen,
        },
      ],
      anchor: { runtimeStageId, subflowPath },
      label: `routes to ${event.chosen}`,
      tsMs: ts,
      meta: {
        kind: 'decide',
        chosen: event.chosen,
        ...(event.rationale ? { rationale: event.rationale } : {}),
      },
    });
  }

  onLoop(event: FlowLoopEvent): void {
    this.observeRunId(event.traversalContext?.runId);
    const ctx = event.traversalContext;
    const runtimeStageId = ctx?.runtimeStageId ?? '';
    const subflowPath = pathFromCtx(ctx?.subflowPath);
    const ts = Date.now();
    const depth = subflowPath.length - 1;
    this.rootInferrer.observeLoop(depth);

    this.push({
      seq: this.entryCount,
      kind: 'iteration',
      transitions: [
        {
          from: event.target,
          to: event.target,
          via: 'loop-iteration',
          label: `iter ${event.iteration}`,
        },
      ],
      anchor: { runtimeStageId, subflowPath },
      label: `iter ${event.iteration}`,
      tsMs: ts,
      meta: { kind: 'iteration', index: event.iteration, target: event.target },
    });
  }

  // ── Typed-event subscription (actor arrows) ──────────────────────

  /**
   * Subscribe to the runner's typed-event dispatcher and emit a
   * `react` RunStep on every `llm.start` / `llm.end`. The recorder
   * classifies `actorArrow` locally (mirrors BoundaryRecorder's
   * pattern) so consumers don't have to depend on BoundaryRecorder's
   * own subscription order.
   */
  subscribe(dispatcher: EventDispatcher): Unsubscribe {
    return dispatcher.on('*' as unknown as AgentfootprintEventType, (event: AgentfootprintEvent) =>
      this.ingestTypedEvent(event),
    );
  }

  /** Internal — also called by `ingestDomainEvent` for shim replay.
   *
   *  NOTE: deliberately does NOT call observeRunId(event.meta.runId).
   *  The agentfootprint dispatcher's runId is a DIFFERENT generator
   *  than footprintjs's traversalContext.runId — mixing them would
   *  toggle lastRunId on every event and trigger a false reset.
   *  Run-boundary detection happens reliably on the FlowRecorder side
   *  (onRunStart fires FIRST in any new run before any typed event). */
  protected ingestTypedEvent(event: AgentfootprintEvent): void {
    if (event.type === 'agentfootprint.stream.llm_start') {
      const meta = event.meta;
      const runtimeStageId = meta.runtimeStageId ?? '';
      const subflowPath = [ROOT_SUBFLOW_ID, ...(meta.subflowPath ?? [])];
      const ts = meta.wallClockMs;
      const arrow = this.actorArrows.classifyStart();
      const llmStage = `stage:llm:${runtimeStageId}`;
      const from = arrow === 'tool→llm' ? `stage:tool:${runtimeStageId}` : ACTOR_USER;
      this.push({
        seq: this.entryCount,
        kind: 'react',
        transitions: [{ from, to: llmStage, via: 'actor-arrow', label: arrow }],
        anchor: { runtimeStageId, subflowPath },
        label: arrow,
        tsMs: ts,
        meta: { kind: 'react', actorArrow: arrow },
      });
    } else if (event.type === 'agentfootprint.stream.llm_end') {
      const p = event.payload;
      const meta = event.meta;
      const runtimeStageId = meta.runtimeStageId ?? '';
      const subflowPath = [ROOT_SUBFLOW_ID, ...(meta.subflowPath ?? [])];
      const ts = meta.wallClockMs;
      const arrow = this.actorArrows.classifyEnd(p.toolCallCount);
      const llmStage = `stage:llm:${runtimeStageId}`;
      const to = arrow === 'llm→user' ? ACTOR_USER : `stage:tool:${runtimeStageId}`;
      this.push({
        seq: this.entryCount,
        kind: 'react',
        transitions: [{ from: llmStage, to, via: 'actor-arrow', label: arrow }],
        anchor: { runtimeStageId, subflowPath },
        label: arrow,
        tsMs: ts,
        meta: { kind: 'react', actorArrow: arrow },
      });
    }
  }

  // ── Replay API (for shim / tests / offline analysis) ─────────────

  /**
   * Feed a single recorded `DomainEvent` (from BoundaryRecorder) into
   * this recorder as if it had fired live. Used by `buildRunSteps`
   * for snapshot replay; tests use it for fixture-driven projection.
   *
   * Live consumers should use `runner.attach(rec)` +
   * `rec.subscribe(dispatcher)` instead — the recorder's hooks fire
   * naturally during traversal.
   */
  ingestDomainEvent(e: DomainEvent): void {
    const traversalContext: TraversalContext = {
      runId: 'replay',
      stageId: lastSegment(e.subflowPath.join('/') || ROOT_SUBFLOW_ID),
      runtimeStageId: e.runtimeStageId,
      stageName: lastSegment(e.subflowPath.join('/') || ROOT_SUBFLOW_ID),
      depth: e.depth,
      ...(e.subflowPath.length > 1 ? { subflowPath: e.subflowPath.slice(1).join('/') } : {}),
    };
    switch (e.type) {
      case 'run.entry':
        this.onRunStart({ payload: e.payload, traversalContext });
        break;
      case 'run.exit':
        this.onRunEnd({ payload: e.payload, traversalContext });
        break;
      case 'subflow.entry':
        this.onSubflowEntry({
          name: e.subflowName,
          subflowId: e.subflowId,
          ...(e.description ? { description: e.description } : {}),
          traversalContext,
        });
        break;
      case 'subflow.exit':
        this.onSubflowExit({
          name: e.subflowName,
          subflowId: e.subflowId,
          traversalContext,
        });
        break;
      case 'fork.branch':
        // Replay layer; coalescing is handled at the call-site
        // (`buildRunSteps`) which groups events by parent+ts and
        // calls `onFork` once. A single fork.branch slipping through
        // to here is treated as a 1-child fork — degenerate but
        // harmless.
        this.onFork({
          parent: e.parentSubflowId,
          children: [e.childName],
          traversalContext,
        });
        break;
      case 'decision.branch':
        this.onDecision({
          decider: e.decider,
          chosen: e.chosen,
          ...(e.rationale ? { rationale: e.rationale } : {}),
          traversalContext,
        });
        break;
      case 'loop.iteration':
        this.onLoop({
          target: e.target,
          iteration: e.iteration,
          traversalContext,
        });
        break;
      case 'llm.start': {
        // Synthesize a typed event matching the dispatcher payload
        // shape so `ingestTypedEvent` produces the same react step.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ingestTypedEvent({
          type: 'agentfootprint.stream.llm_start',
          payload: {
            provider: e.provider,
            model: e.model,
            ...(e.systemPromptChars !== undefined
              ? { systemPromptChars: e.systemPromptChars }
              : {}),
            ...(e.messagesCount !== undefined ? { messagesCount: e.messagesCount } : {}),
            ...(e.toolsCount !== undefined ? { toolsCount: e.toolsCount } : {}),
          },
          meta: {
            wallClockMs: e.ts,
            runOffsetMs: 0,
            runtimeStageId: e.runtimeStageId,
            // Strip the ROOT_SUBFLOW_ID prefix for the typed-event
            // convention (typed events use the inner path, BoundaryRecorder
            // adds the root prefix on ingest).
            subflowPath: e.subflowPath.slice(1),
            compositionPath: [],
            runId: 'replay',
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        break;
      }
      case 'llm.end': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ingestTypedEvent({
          type: 'agentfootprint.stream.llm_end',
          payload: {
            content: e.content,
            toolCallCount: e.toolCallCount,
            usage: e.usage,
            ...(e.stopReason ? { stopReason: e.stopReason } : {}),
          },
          meta: {
            wallClockMs: e.ts,
            runOffsetMs: 0,
            runtimeStageId: e.runtimeStageId,
            subflowPath: e.subflowPath.slice(1),
            compositionPath: [],
            runId: 'replay',
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        break;
      }
      // tool.start / tool.end / context.injected — not currently used
      // by the projection (tools are paired with the next llm.start;
      // context injections decorate steps but don't add new ones).
      default:
        break;
    }
  }

  // ── Query API ─────────────────────────────────────────────────

  /**
   * Read-only query — returns the already-built step list filtered to
   * `drillPath` scope. O(1) per call when scope is empty; O(N) filter
   * otherwise. Composition-vs-leaf root filter is applied so the
   * slider semantics match the user's mental model:
   *
   *   - **Leaf root** (single Agent / LLMCall): show `react` steps only.
   *   - **Composition root** (Sequence / Parallel / Conditional / Loop):
   *     show composition steps; hide intra-leaf `react` steps.
   *
   * Drill-down filters by `anchor.subflowPath` prefix and re-applies
   * the leaf-vs-composition rule for the drilled scope.
   */
  getSteps(drillPath?: readonly string[]): readonly RunStep[] {
    const all = this.store.getAll();
    const path = drillPath ?? [];

    // Leaf-vs-composition filter — delegated to RootInferrer.
    const isLeafRoot = this.rootInferrer.isLeafRoot();
    const kindFiltered = isLeafRoot
      ? all.filter((s) => s.kind === 'react')
      : all.filter((s) => s.kind !== 'react');

    if (path.length === 0) {
      return reseq(kindFiltered);
    }
    return reseq(kindFiltered.filter((s) => isPathPrefix(path, s.anchor.subflowPath)));
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Flush any deferred answer-candidate from the buffer. Called by
   *  `onRunEnd` so a single `answers` step appears for runs that end
   *  on a leaf exit (no further leaf entries followed). */
  private flushCandidateAnswer(): void {
    const c = this.answerBuffer.flush();
    if (!c) return;
    this.push({
      seq: this.entryCount,
      kind: 'sequential',
      transitions: [{ from: c.frame.subflowId, to: ACTOR_USER, via: 'next', label: 'answers' }],
      anchor: {
        runtimeStageId: c.runtimeStageId,
        subflowPath: c.frame.subflowPath,
      },
      label: 'answers',
      tsMs: c.tsMs,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function parsePrimitiveKind(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const colon = description.indexOf(':');
  if (colon < 0) return undefined;
  const prefix = description.slice(0, colon).trim();
  return prefix.length > 0 ? prefix : undefined;
}

const AGENT_INTERNAL_STAGES = new Set(['route', 'tool-calls', 'final', 'merge']);

function isAgentInternalStageId(localStageId: string): boolean {
  return AGENT_INTERNAL_STAGES.has(localStageId);
}

/** Renumber `seq` after filtering so consumers see contiguous indices. */
function reseq(steps: readonly RunStep[]): RunStep[] {
  return steps.map((s, i) => (s.seq === i ? s : { ...s, seq: i }));
}

// ─── Compatibility shim ────────────────────────────────────────────

export interface RunStepGraph {
  readonly steps: readonly RunStep[];
}

export interface BuildRunStepsOptions {
  readonly drillPath?: readonly string[];
}

/**
 * Compatibility shim for snapshot-from-events use cases (replay,
 * post-hoc analysis, tests). For LIVE use, prefer attaching a
 * `RunStepRecorder` directly via `runner.attach(rec)` —
 * `buildRunSteps(events)` constructs a fresh recorder, replays the
 * events through its handlers, and returns the resulting entries.
 *
 * @deprecated Prefer `runStepRecorder()` + `runner.attach(rec)` for
 *             live consumers. This shim remains for offline / testing
 *             scenarios where only a recorded event list is available.
 */
export function buildRunSteps(
  source: BoundaryRecorder | readonly DomainEvent[],
  options: BuildRunStepsOptions = {},
): RunStep[] {
  const events: readonly DomainEvent[] = Array.isArray(source)
    ? (source as readonly DomainEvent[])
    : (source as BoundaryRecorder).getEvents();
  const rec = new RunStepRecorder();

  // Coalesce fork.branch bursts before replay. BoundaryRecorder emits
  // N fork.branch events per fork (all sharing parent+ts); the
  // recorder expects ONE `onFork` call carrying all children. We pass
  // through the first occurrence of each (parent, ts) pair as a single
  // synthetic event with all children, and drop the rest.
  const forkSeen = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'fork.branch') {
      const key = `${e.parentSubflowId}@${e.ts}`;
      if (forkSeen.has(key)) continue;
      forkSeen.add(key);
      const children: string[] = [];
      for (let j = i; j < events.length; j++) {
        const f = events[j];
        if (f.type === 'fork.branch' && f.parentSubflowId === e.parentSubflowId && f.ts === e.ts) {
          children.push(f.childName);
        } else if (f.ts > e.ts) {
          break;
        }
      }
      rec.onFork({
        parent: e.parentSubflowId,
        children,
        traversalContext: {
          runId: 'replay',
          stageId: lastSegment(e.subflowPath.join('/') || ROOT_SUBFLOW_ID),
          runtimeStageId: e.runtimeStageId,
          stageName: lastSegment(e.subflowPath.join('/') || ROOT_SUBFLOW_ID),
          depth: e.depth,
        },
      });
      continue;
    }
    rec.ingestDomainEvent(e);
  }
  return [...rec.getSteps(options.drillPath)];
}

// Touch unused imports defensively for tree-shaking.
void ROOT_RUNTIME_STAGE_ID;
