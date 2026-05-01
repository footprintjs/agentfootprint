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
 * @example
 * ```typescript
 * import { boundaryRecorder } from 'agentfootprint';
 *
 * const boundary = boundaryRecorder();
 * executor.attachCombinedRecorder(boundary);   // wires FlowRecorder side
 * boundary.subscribe(runner.dispatcher);        // wires typed-event side
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

import { ROOT_RUNTIME_STAGE_ID, ROOT_SUBFLOW_ID, SequenceRecorder } from 'footprintjs/trace';
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
import type { AgentfootprintEvent, AgentfootprintEventType } from '../../events/registry.js';
import type { EventDispatcher, Unsubscribe } from '../../events/dispatcher.js';
import { SUBFLOW_IDS, STAGE_IDS, slotFromSubflowId } from '../../conventions.js';
import type { ContextSlot } from '../../events/types.js';

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
  | DomainForkBranchEvent
  | DomainDecisionBranchEvent
  | DomainLoopIterationEvent
  | DomainLLMStartEvent
  | DomainLLMEndEvent
  | DomainToolStartEvent
  | DomainToolEndEvent
  | DomainContextInjectedEvent;

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
  SUBFLOW_IDS.ROUTE,
  SUBFLOW_IDS.TOOL_CALLS,
  SUBFLOW_IDS.FINAL,
  SUBFLOW_IDS.MERGE,
  SUBFLOW_IDS.CACHE_DECISION, // v2.6 — emits cacheMarkers; not a user step
  // Decider stage ids (the same set is used to filter `decision.branch`
  // events whose deciding stage is plumbing rather than user-facing).
  STAGE_IDS.CACHE_GATE, // v2.6 — apply-markers / no-markers routing; plumbing
]);

export interface BoundaryRecorderOptions {
  readonly id?: string;
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
 * Internally stores events in a `SequenceRecorder<DomainEvent>` so the
 * usual time-travel utilities (`getEntryRanges`, `accumulate`) work
 * out of the box.
 */
export class BoundaryRecorder extends SequenceRecorder<DomainEvent> implements CombinedRecorder {
  readonly id: string;

  /**
   * Tracks whether the most recent `llm.end` had toolCalls. Used to
   * classify the NEXT `llm.start` as `'tool→llm'` (vs `'user→llm'` if
   * there's no pending tool result). Reset on `clear()` and on every
   * `llm.start` event after the classification is applied.
   */
  private prevLLMEndHadTools = false;

  constructor(options: BoundaryRecorderOptions = {}) {
    super();
    this.id = options.id ?? `boundary-${++_counter}`;
  }

  override clear(): void {
    super.clear();
    this.prevLLMEndHadTools = false;
  }

  // ── FlowRecorder hooks (footprintjs side) ───────────────────────────

  onRunStart(event: FlowRunEvent): void {
    this.emit(buildRunEvent('run.entry', event.payload));
  }

  onRunEnd(event: FlowRunEvent): void {
    this.emit(buildRunEvent('run.exit', event.payload));
  }

  onSubflowEntry(event: FlowSubflowEvent): void {
    const e = buildSubflowEvent(event, 'subflow.entry');
    if (e) this.emit(e);
  }

  onSubflowExit(event: FlowSubflowEvent): void {
    const e = buildSubflowEvent(event, 'subflow.exit');
    if (e) this.emit(e);
  }

  onFork(event: FlowForkEvent): void {
    const ts = Date.now();
    const ctx = event.traversalContext;
    const runtimeStageId = ctx?.runtimeStageId ?? '';
    const segments = ctx?.subflowPath ? ctx.subflowPath.split('/').filter(Boolean) : [];
    const subflowPath: readonly string[] = [ROOT_SUBFLOW_ID, ...segments];
    for (const childName of event.children) {
      this.emit({
        type: 'fork.branch',
        runtimeStageId,
        subflowPath,
        depth: subflowPath.length - 1,
        ts,
        parentSubflowId: event.parent,
        childName,
      });
    }
  }

  onDecision(event: FlowDecisionEvent): void {
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
    const isAgentInternal = AGENT_INTERNAL_LOCAL_IDS.has(localStageId);
    this.emit({
      type: 'decision.branch',
      runtimeStageId: ctx?.runtimeStageId ?? '',
      subflowPath: pathFromCtx(ctx?.subflowPath),
      depth: ctxDepth(ctx?.subflowPath),
      ts: Date.now(),
      decider: event.decider,
      chosen: event.chosen,
      ...(event.rationale ? { rationale: event.rationale } : {}),
      isAgentInternal,
    });
  }

  onLoop(event: FlowLoopEvent): void {
    const ctx = event.traversalContext;
    this.emit({
      type: 'loop.iteration',
      runtimeStageId: ctx?.runtimeStageId ?? '',
      subflowPath: pathFromCtx(ctx?.subflowPath),
      depth: ctxDepth(ctx?.subflowPath),
      ts: Date.now(),
      target: event.target,
      iteration: event.iteration,
    });
  }

  // ── Typed-event subscription (agentfootprint dispatcher side) ───────

  /**
   * Subscribe to the runner's typed-event dispatcher and emit a domain
   * event for each `llm.*` / `tool.*` / `context.injected` event.
   *
   * Returns an unsubscribe function; safe to call multiple times (each
   * call adds a new subscription). Most consumers call this once at
   * recorder construction and dispose with the returned function.
   */
  subscribe(dispatcher: EventDispatcher): Unsubscribe {
    return dispatcher.on('*' as unknown as AgentfootprintEventType, (event: AgentfootprintEvent) =>
      this.ingestTypedEvent(event),
    );
  }

  private ingestTypedEvent(event: AgentfootprintEvent): void {
    const meta = event.meta;
    const runtimeStageId = meta.runtimeStageId ?? '';
    const subflowPath = [ROOT_SUBFLOW_ID, ...(meta.subflowPath ?? [])];
    const depth = subflowPath.length - 1;
    const ts = meta.wallClockMs;

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
        this.emit({
          type: 'llm.start',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
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
        this.emit({
          type: 'llm.end',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
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
        this.emit({
          type: 'tool.start',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          toolName: p.toolName,
          toolCallId: p.toolCallId,
          ...(p.args !== undefined ? { args: p.args } : {}),
        });
        break;
      }
      case 'agentfootprint.stream.tool_end': {
        const p = event.payload;
        this.emit({
          type: 'tool.end',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
          toolCallId: p.toolCallId,
          ...(p.result !== undefined ? { result: p.result } : {}),
          ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
          ...(p.error !== undefined ? { error: p.error } : {}),
        });
        break;
      }
      case 'agentfootprint.context.injected': {
        const p = event.payload;
        this.emit({
          type: 'context.injected',
          runtimeStageId,
          subflowPath,
          depth,
          ts,
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
      default:
        // Other typed events (composition.*, agent.*, etc.) are not
        // mapped to DomainEvent for now — they're either implied by
        // FlowRecorder events (composition) or higher-level summaries
        // (agent.turn_*) that downstream selectors derive on demand.
        break;
    }
  }

  // ── Read API ────────────────────────────────────────────────────────

  /** All events in capture order (the canonical projection). */
  getEvents(): DomainEvent[] {
    return this.getEntries();
  }

  /** Type-narrowed lookup: all events of one kind. */
  getEventsByType<T extends DomainEvent['type']>(type: T): Extract<DomainEvent, { type: T }>[] {
    const out: Extract<DomainEvent, { type: T }>[] = [];
    for (const e of this.getEntries()) {
      if (e.type === type) out.push(e as Extract<DomainEvent, { type: T }>);
    }
    return out;
  }

  // ── Back-compat / convenience query helpers ─────────────────────────

  /** All boundary events (run + subflow, entry + exit interleaved). */
  getBoundaries(): (DomainRunEvent | DomainSubflowEvent)[] {
    const out: (DomainRunEvent | DomainSubflowEvent)[] = [];
    for (const e of this.getEntries()) {
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
    const matches = this.getEntriesForStep(runtimeStageId);
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
    for (const e of this.getEntries()) {
      if (e.type !== 'subflow.entry' && e.type !== 'subflow.exit') continue;
      if (e.slotKind === 'system-prompt') systemPrompt.push(e);
      else if (e.slotKind === 'messages') messages.push(e);
      else if (e.slotKind === 'tools') tools.push(e);
    }
    return { systemPrompt, messages, tools };
  }

  /** Snapshot bundle — included in `executor.getSnapshot()` if the
   *  executor implements the snapshot extension protocol. */
  toSnapshot() {
    return {
      name: 'BoundaryEvents',
      description: 'Unified domain event log — run/subflow boundaries + LLM/tool/context events',
      preferredOperation: 'translate' as const,
      data: this.getEvents(),
    };
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

function buildRunEvent(type: 'run.entry' | 'run.exit', payload: unknown): DomainRunEvent {
  return {
    type,
    runtimeStageId: ROOT_RUNTIME_STAGE_ID,
    subflowPath: [ROOT_SUBFLOW_ID],
    depth: 0,
    ts: Date.now(),
    payload,
    isRoot: true,
  };
}

function buildSubflowEvent(
  event: FlowSubflowEvent,
  type: 'subflow.entry' | 'subflow.exit',
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
  const isAgentInternal = AGENT_INTERNAL_LOCAL_IDS.has(localSubflowId);
  const payload = type === 'subflow.entry' ? event.mappedInput : event.outputState;

  return {
    type,
    runtimeStageId,
    subflowPath,
    depth,
    ts: Date.now(),
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
