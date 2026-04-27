/**
 * FlowchartRecorder — StepGraph projection over `BoundaryRecorder`.
 *
 * Pattern: Pure projection. `attachFlowchart` wires a `BoundaryRecorder`
 *          to the executor + dispatcher; `buildStepGraph` is a fold over
 *          `boundary.getEvents()` that produces the renderer-friendly
 *          `StepGraph` shape Lens (and any other consumer) renders.
 *
 *          ZERO state machine in this file. ZERO event subscription.
 *          ZERO name-based filters. Everything that decides "what's a
 *          step" lives in BoundaryRecorder via capture-time tags
 *          (`actorArrow`, `slotKind`, `primitiveKind`, `isAgentInternal`).
 *
 * Role:    Tier 3 observability. Enabled via
 *          `runner.enable.flowchart({ onUpdate })`. The handle exposes:
 *
 *            handle.getSnapshot()  → derived StepGraph (back-compat)
 *            handle.boundary       → the underlying BoundaryRecorder
 *                                     (Lens reads it directly for richer
 *                                     queries: getSlotBoundaries(),
 *                                     getEventsByType, etc.)
 *
 * Event → StepNode mapping (the entire policy):
 *
 *   run.entry            → StepNode kind='subflow', primitiveKind='Run'
 *   subflow.entry        → StepNode kind='subflow' (skipped if isAgentInternal
 *                                                    or slotKind set —
 *                                                    those are sub-components
 *                                                    of the actor arrows)
 *   fork.branch          → StepNode kind='fork-branch'
 *   decision.branch      → StepNode kind='decision-branch'
 *   llm.start            → StepNode kind=actorArrow ('user→llm' | 'tool→llm')
 *   tool.start           → StepNode kind='llm->tool'
 *   llm.end terminal     → StepNode kind='llm->user' (delivery marker)
 *   loop.iteration       → loop-iteration StepEdge
 *   context.injected     → attached to NEXT user→llm / tool→llm StepNode
 *
 * Result: a one-to-one correspondence between visible scrubbable steps
 * and DomainEvents. Adding a new event type adds one mapping line here
 * (or in the pure projection); no state machine, no merging.
 */

import type { CombinedRecorder } from 'footprintjs';
import type {
  AgentfootprintEvent,
  AgentfootprintEventType,
} from '../../events/registry.js';
import type { EventDispatcher } from '../../events/dispatcher.js';
import {
  BoundaryRecorder,
  boundaryRecorder,
  type DomainSubflowEvent,
} from './BoundaryRecorder.js';

// ─── Public types (preserved shape — Lens consumes these today) ─────

/**
 * One node in the step-level flowchart. Node kind drives rendering
 * (actor icon, color). ReAct steps carry token + tool details; topology
 * nodes (subflow / fork-branch / decision-branch) mirror the footprintjs
 * composition events and exist so composition structure (Loop, Parallel,
 * Conditional, Swarm) stays visible in the graph.
 */
export interface StepNode {
  readonly id: string;
  readonly kind:
    | 'user->llm'         // input arrived at the LLM (first iteration)
    | 'llm->tool'         // LLM requested tool execution
    | 'tool->llm'         // tool result returned, next LLM call begins
    | 'llm->user'         // terminal LLM response (no tool calls remaining)
    | 'subflow'           // composition boundary (root run + non-internal subflows)
    | 'fork-branch'       // one branch of a Parallel fan-out
    | 'decision-branch';  // chosen branch of a Conditional
  readonly label: string;
  readonly startOffsetMs: number;
  readonly endOffsetMs?: number;
  /** LLM step: token usage of the call that bounded this step. */
  readonly tokens?: { readonly in: number; readonly out: number };
  /** llm->tool / tool->llm: the tool name. */
  readonly toolName?: string;
  /** user->llm / tool->llm: the model that was invoked. */
  readonly llmModel?: string;
  /** Decomposition of the underlying subflowId (rooted under '__root__'). */
  readonly subflowPath: readonly string[];
  /** Context injections attributed to this step (LLM steps only). */
  readonly injections?: readonly ContextInjection[];
  /** 1-based ReAct iteration this step belongs to. Undefined for
   *  topology / composition nodes. */
  readonly iterationIndex?: number;
  /** Which slot the step's input updated. ReAct steps only. */
  readonly slotUpdated?: 'system-prompt' | 'messages' | 'tools';
  /** True ONLY for `subflow` StepNodes whose primitiveKind is `'Agent'`.
   *  Narrow flag for callers that distinguish ReAct agents from other
   *  composition primitives (cost / iteration / token attribution). */
  readonly isAgentBoundary?: boolean;
  /** Primitive kind from the subflow root description prefix
   *  (`'Agent'` / `'LLMCall'` / `'Sequence'` / etc.). */
  readonly primitiveKind?: string;
  /** True for `subflow` StepNodes representing any KNOWN primitive
   *  (Agent / LLMCall / Sequence / Parallel / Conditional / Loop) —
   *  drives Lens's drill-in container treatment. */
  readonly isPrimitiveBoundary?: boolean;
  /** `inputMapper` payload at the subflow's entry. Subflow nodes only. */
  readonly entryPayload?: unknown;
  /** Subflow shared state at exit. Subflow nodes only.
   *  Undefined for in-progress / paused subflows. */
  readonly exitPayload?: unknown;
  /** Stable per-execution key — same `runtimeStageId` Trace view uses. */
  readonly runtimeStageId?: string;
  /**
   * Slot boundary payloads composed for THIS LLM step.
   *
   * Set ONLY for `kind === 'user->llm'` and `kind === 'tool->llm'`
   * StepNodes — the moments where context flows INTO the LLM. Each
   * entry carries the slot subflow's `inputMapper` result (entryPayload)
   * and rendered slot output (exitPayload).
   *
   * Attribution: any slot subflow that fired BETWEEN the previous LLM
   * end (or run start) and THIS LLM start is attributed to this call.
   * Done at projection time over `boundary.getEvents()`; no consumer-
   * side correlation required.
   *
   * Lens uses this to make the 3 slot rows inside the LLM card
   * clickable — clicking a slot reveals its entry/exit payloads in
   * the right-pane detail panel without needing direct BoundaryRecorder
   * access.
   */
  readonly slotBoundaries?: {
    readonly systemPrompt?: SlotBoundary;
    readonly messages?: SlotBoundary;
    readonly tools?: SlotBoundary;
  };
}

/** One slot's boundary pair attributed to a specific LLM step. */
export interface SlotBoundary {
  /** runtimeStageId of the slot subflow execution. */
  readonly runtimeStageId: string;
  /** `inputMapper` payload — the data the slot was COMPOSED FROM
   *  (RAG hits, skill content, user message, tool result, etc). */
  readonly entryPayload?: unknown;
  /** Subflow shared state at exit — the rendered slot content
   *  (system prompt string, messages array, tools array). */
  readonly exitPayload?: unknown;
}

/** Consumer-facing context injection (5 axes of context engineering). */
export interface ContextInjection {
  readonly slot: 'system-prompt' | 'messages' | 'tools';
  readonly asRole?: 'system' | 'user' | 'assistant' | 'tool';
  readonly source: string;
  readonly sourceId?: string;
  readonly contentSummary?: string;
  readonly reason?: string;
  readonly sectionTag?: string;
  readonly upstreamRef?: string;
  readonly retrievalScore?: number;
  readonly rankPosition?: number;
  readonly budgetTokens?: number;
  readonly budgetFraction?: number;
}

export interface StepEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'next' | 'loop-iteration' | 'fork-branch' | 'decision-branch';
  readonly iteration?: number;
}

export interface StepGraph {
  readonly nodes: readonly StepNode[];
  readonly edges: readonly StepEdge[];
  readonly activeNodeId?: string;
}

export interface FlowchartOptions {
  /** Called each time the graph changes; fires synchronously on the
   *  driving event so the UI updates the moment the structure changes. */
  readonly onUpdate?: (graph: StepGraph) => void;
}

export interface FlowchartHandle {
  /** Current step graph (derived from boundary events). Safe during or
   *  after a run. */
  readonly getSnapshot: () => StepGraph;
  /** Underlying BoundaryRecorder. Use for richer queries — slot data,
   *  full event log, type-narrowed lookups. The single source of truth
   *  Lens reads. */
  readonly boundary: BoundaryRecorder;
  /** Detach from executor + dispatcher. Subsequent events ignored. */
  readonly unsubscribe: () => void;
}

// ─── Attach entry point ──────────────────────────────────────────────

/**
 * Attach a live FlowchartRecorder to a runner.
 *
 *   1. Creates a `BoundaryRecorder` (the unified domain event log).
 *   2. Attaches it to the executor's FlowRecorder channel via
 *      `runnerAttach` — captures run / subflow / fork / decision / loop.
 *   3. Subscribes it to the dispatcher — captures llm.* / tool.* /
 *      context.injected.
 *   4. Wires `onUpdate` so the consumer sees a fresh derived StepGraph
 *      on every event.
 *
 * @internal Called from `RunnerBase.enable.flowchart`.
 */
export function attachFlowchart(
  runnerAttach: (recorder: CombinedRecorder) => () => void,
  dispatcher: EventDispatcher,
  options: FlowchartOptions = {},
): FlowchartHandle {
  const boundary = boundaryRecorder();
  const onUpdate = options.onUpdate;

  // Wrap the recorder to also re-emit StepGraph after each FlowRecorder
  // event. Without this, consumers see updates only on dispatcher events
  // (which fire less often than subflow boundaries).
  const wrapped: CombinedRecorder = onUpdate
    ? wrapWithEmit(boundary, () => onUpdate(buildStepGraph(boundary)))
    : boundary;

  const offAttach = runnerAttach(wrapped);

  // Subscribe to typed events. The boundary recorder emits a domain
  // event per llm/tool/context event and we re-derive the StepGraph.
  const offDispatcher = dispatcher.on(
    '*' as unknown as AgentfootprintEventType,
    (event: AgentfootprintEvent) => {
      // Boundary recorder ingests directly via its own subscribe — but
      // since we own the lifecycle here, route through it explicitly so
      // we control the onUpdate timing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (boundary as any).ingestTypedEvent?.(event);
      onUpdate?.(buildStepGraph(boundary));
    },
  );

  return {
    getSnapshot: () => buildStepGraph(boundary),
    boundary,
    unsubscribe: () => {
      offAttach();
      offDispatcher();
    },
  };
}

/**
 * Wrap a recorder so each FlowRecorder hook also calls `afterEach` with
 * a fresh snapshot. `afterEach` runs AFTER the wrapped hook returns so
 * the snapshot reflects the just-applied event.
 */
function wrapWithEmit(boundary: BoundaryRecorder, afterEach: () => void): CombinedRecorder {
  return {
    id: boundary.id,
    onRunStart: (e) => { boundary.onRunStart!(e); afterEach(); },
    onRunEnd: (e) => { boundary.onRunEnd!(e); afterEach(); },
    onSubflowEntry: (e) => { boundary.onSubflowEntry!(e); afterEach(); },
    onSubflowExit: (e) => { boundary.onSubflowExit!(e); afterEach(); },
    onFork: (e) => { boundary.onFork!(e); afterEach(); },
    onDecision: (e) => { boundary.onDecision!(e); afterEach(); },
    onLoop: (e) => { boundary.onLoop!(e); afterEach(); },
  };
}

// ─── Pure projection: events → StepGraph ─────────────────────────────

/**
 * Closed set of primitives Lens treats as drill-in containers.
 * Adding a new primitive: ship its `'Kind:'` description prefix at the
 * builder's `flowChart('...', ..., 'Kind: …')` call site AND add the
 * name here. Both sides are required.
 */
const KNOWN_PRIMITIVES: ReadonlySet<string> = new Set([
  'Agent',
  'LLMCall',
  'Sequence',
  'Parallel',
  'Conditional',
  'Loop',
]);

/**
 * Project a `BoundaryRecorder`'s event stream into a `StepGraph`.
 *
 * Pure function — no side effects, no recorder mutation, deterministic.
 * Called on every snapshot request and on every `onUpdate` fire. O(N)
 * over the event stream; consumer-side memoization (e.g., React's
 * `useMemo`) is straightforward when needed.
 *
 * The mapping is local to each event type: see the mapping table in
 * the file header. State carried across the fold:
 *   - `iter`: 1-based ReAct iteration counter, incremented on each
 *     `llm.start`. ReAct nodes inherit the current value.
 *   - `pendingInjections`: context.injected events buffered between
 *     LLM calls; flushed onto the next user→llm or tool→llm StepNode.
 *   - `prevReActId`: id of the previous ReAct StepNode for `next`-edge
 *     wiring within an iteration.
 *   - `runStartTs`: wall-clock at run start, for relative offsets.
 */
export function buildStepGraph(boundary: BoundaryRecorder): StepGraph {
  const events = boundary.getEvents();
  const nodes: StepNode[] = [];
  const edges: StepEdge[] = [];

  let iter = 0;
  let pendingInjections: ContextInjection[] = [];
  let prevReActId: string | undefined;
  let runStartTs: number | undefined;
  let activeNodeId: string | undefined;

  /**
   * Slot boundaries that fired since the LAST llm boundary; flushed
   * onto the next user→llm or tool→llm StepNode at its `llm.start`
   * event. Mirrors how `pendingInjections` works — same "buffer until
   * the next LLM call consumes it" pattern.
   *
   * Cleared on each llm.start (after attribution) AND on llm.end with
   * actorArrow='llm→tool' (the slots assembled BEFORE the next iteration
   * may still fire after this point — keep buffering).
   */
  let pendingSlotBoundaries: {
    systemPrompt?: SlotBoundary;
    messages?: SlotBoundary;
    tools?: SlotBoundary;
  } = {};

  // Track open "subflow" nodes so we can close them on subflow.exit
  // (set endOffsetMs, exitPayload). Keyed by runtimeStageId — same key
  // the entry event carries; pause/in-progress subflows simply never
  // close their entry.
  const openSubflowsByRuntimeId = new Map<string, StepNode>();

  for (const e of events) {
    if (runStartTs === undefined) runStartTs = e.ts;
    const t = e.ts - runStartTs;

    switch (e.type) {
      case 'run.entry': {
        const node: StepNode = {
          id: e.runtimeStageId,
          kind: 'subflow',
          label: 'Run',
          startOffsetMs: t,
          subflowPath: e.subflowPath,
          primitiveKind: 'Run',
          isPrimitiveBoundary: false,
          ...(e.payload !== undefined ? { entryPayload: e.payload } : {}),
          runtimeStageId: e.runtimeStageId,
        };
        nodes.push(node);
        openSubflowsByRuntimeId.set(e.runtimeStageId, node);
        activeNodeId = node.id;
        break;
      }
      case 'run.exit': {
        const open = openSubflowsByRuntimeId.get(e.runtimeStageId);
        if (open) {
          (open as { endOffsetMs?: number }).endOffsetMs = t;
          if (e.payload !== undefined) {
            (open as { exitPayload?: unknown }).exitPayload = e.payload;
          }
          openSubflowsByRuntimeId.delete(e.runtimeStageId);
        }
        activeNodeId = undefined;
        break;
      }
      case 'subflow.entry': {
        // Slot subflows: NOT separate timeline steps — buffer their
        // entry payload to attach to the next LLM call's StepNode.
        if (e.slotKind) {
          pendingSlotBoundaries[slotPropName(e.slotKind)] = {
            runtimeStageId: e.runtimeStageId,
            ...(e.payload !== undefined ? { entryPayload: e.payload } : {}),
          };
          break;
        }
        // Agent-internal routing: pure plumbing, not a step.
        if (e.isAgentInternal) break;
        const node = subflowToStepNode(e, t);
        nodes.push(node);
        connectAdjacent(nodes, edges);
        openSubflowsByRuntimeId.set(e.runtimeStageId, node);
        activeNodeId = node.id;
        break;
      }
      case 'subflow.exit': {
        // Slot subflow exit: enrich the buffered slot boundary with
        // its rendered output (the actual slot content the LLM saw).
        if (e.slotKind) {
          const key = slotPropName(e.slotKind);
          const existing = pendingSlotBoundaries[key];
          if (existing) {
            pendingSlotBoundaries[key] = {
              ...existing,
              ...(e.payload !== undefined ? { exitPayload: e.payload } : {}),
            };
          }
          break;
        }
        if (e.isAgentInternal) break;
        const open = openSubflowsByRuntimeId.get(e.runtimeStageId);
        if (open) {
          (open as { endOffsetMs?: number }).endOffsetMs = t;
          if (e.payload !== undefined) {
            (open as { exitPayload?: unknown }).exitPayload = e.payload;
          }
          openSubflowsByRuntimeId.delete(e.runtimeStageId);
        }
        break;
      }
      case 'fork.branch': {
        const id = `fork-${e.runtimeStageId}-${e.childName}`;
        nodes.push({
          id,
          kind: 'fork-branch',
          label: e.childName,
          startOffsetMs: t,
          subflowPath: e.subflowPath,
        });
        break;
      }
      case 'decision.branch': {
        // Agent-internal Route decisions (tool-calls / final) are
        // wiring, not steps — the actor arrows that follow already
        // encode the routing observably. Filter them out of the
        // timeline; the rationale is still in the event log for the
        // right-pane / commentary to read.
        if (e.isAgentInternal) break;
        const id = `decision-${e.runtimeStageId}-${e.chosen}`;
        nodes.push({
          id,
          kind: 'decision-branch',
          label: e.chosen,
          startOffsetMs: t,
          subflowPath: e.subflowPath,
        });
        break;
      }
      case 'loop.iteration': {
        // Self-edge on the currently active subflow node. If no active
        // subflow node, drop the edge (edge with no `from` is invalid).
        if (activeNodeId) {
          edges.push({
            id: `loop-${activeNodeId}-${e.iteration}`,
            from: activeNodeId,
            to: activeNodeId,
            kind: 'loop-iteration',
            iteration: e.iteration,
          });
        }
        break;
      }
      case 'context.injected': {
        pendingInjections.push({
          slot: e.slot,
          source: e.source,
          ...(e.sourceId ? { sourceId: e.sourceId } : {}),
          ...(e.asRole ? { asRole: e.asRole } : {}),
          ...(e.contentSummary ? { contentSummary: e.contentSummary } : {}),
          ...(e.reason ? { reason: e.reason } : {}),
          ...(e.sectionTag ? { sectionTag: e.sectionTag } : {}),
          ...(e.upstreamRef ? { upstreamRef: e.upstreamRef } : {}),
          ...(e.retrievalScore !== undefined ? { retrievalScore: e.retrievalScore } : {}),
          ...(e.rankPosition !== undefined ? { rankPosition: e.rankPosition } : {}),
          ...(e.budgetTokens !== undefined ? { budgetTokens: e.budgetTokens } : {}),
          ...(e.budgetFraction !== undefined ? { budgetFraction: e.budgetFraction } : {}),
        });
        break;
      }
      case 'llm.start': {
        iter += 1;
        const id = `step-llm-start-${e.runtimeStageId}-${iter}`;
        const injections = pendingInjections;
        pendingInjections = [];
        // Flush buffered slot boundaries onto this LLM step. Slot
        // subflows that fired since the previous LLM end (or run start)
        // are attributed to THIS call.
        const slotBoundaries = Object.keys(pendingSlotBoundaries).length > 0
          ? pendingSlotBoundaries
          : undefined;
        pendingSlotBoundaries = {};
        // BoundaryRecorder uses the unicode arrow `→` for the typed
        // `actorArrow` field; StepNode.kind uses ASCII `->` for legacy
        // compatibility. Map between them.
        const stepKind: StepNode['kind'] =
          e.actorArrow === 'tool→llm' ? 'tool->llm' : 'user->llm';
        const node: StepNode = {
          id,
          kind: stepKind,
          label: stepKind === 'tool->llm' ? 'tool → llm' : 'user → llm',
          startOffsetMs: t,
          llmModel: e.model,
          subflowPath: e.subflowPath,
          injections,
          iterationIndex: iter,
          slotUpdated: 'messages',
          // Bind to the underlying boundary event's runtimeStageId so
          // consumers (Lens commentary, custom dashboards) can look up
          // every event that belongs to this LLM call by id.
          runtimeStageId: e.runtimeStageId,
          ...(slotBoundaries ? { slotBoundaries } : {}),
        };
        nodes.push(node);
        if (prevReActId) {
          edges.push({
            id: `${prevReActId}->${id}`,
            from: prevReActId,
            to: id,
            kind: 'next',
          });
        }
        prevReActId = id;
        break;
      }
      case 'llm.end': {
        // The just-prior llm.start's StepNode gets tokens added.
        // For terminal calls (actorArrow='llm→user') we ALSO append a
        // separate llm→user delivery marker so the slider has a
        // distinct "answer delivered" position.
        const lastStart = findLastByKind(nodes, ['user->llm', 'tool->llm']);
        if (lastStart) {
          (lastStart as { tokens?: StepNode['tokens'] }).tokens = {
            in: e.usage.input,
            out: e.usage.output,
          };
          (lastStart as { endOffsetMs?: number }).endOffsetMs = t;
        }
        if (e.actorArrow === 'llm→user') {
          const id = `step-llm-end-${e.runtimeStageId}-${iter}`;
          const node: StepNode = {
            id,
            kind: 'llm->user',
            label: 'llm → user',
            startOffsetMs: t,
            endOffsetMs: t,
            subflowPath: e.subflowPath,
            iterationIndex: iter,
            runtimeStageId: e.runtimeStageId,
          };
          nodes.push(node);
          if (prevReActId) {
            edges.push({
              id: `${prevReActId}->${id}`,
              from: prevReActId,
              to: id,
              kind: 'next',
            });
          }
          prevReActId = id;
        }
        break;
      }
      case 'tool.start': {
        const id = `step-tool-start-${e.runtimeStageId}-${e.toolCallId}`;
        const node: StepNode = {
          id,
          kind: 'llm->tool',
          label: `llm → tool (${e.toolName})`,
          startOffsetMs: t,
          toolName: e.toolName,
          subflowPath: e.subflowPath,
          iterationIndex: iter,
          slotUpdated: 'tools',
          runtimeStageId: e.runtimeStageId,
        };
        nodes.push(node);
        if (prevReActId) {
          edges.push({
            id: `${prevReActId}->${id}`,
            from: prevReActId,
            to: id,
            kind: 'next',
          });
        }
        prevReActId = id;
        break;
      }
      case 'tool.end': {
        const lastTool = findLastByKind(nodes, ['llm->tool']);
        if (lastTool) {
          (lastTool as { endOffsetMs?: number }).endOffsetMs = t;
        }
        break;
      }
    }
  }

  return { nodes, edges, activeNodeId };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function subflowToStepNode(e: DomainSubflowEvent, t: number): StepNode {
  const isAgentBoundary = e.primitiveKind === 'Agent';
  const isPrimitiveBoundary =
    e.primitiveKind !== undefined && KNOWN_PRIMITIVES.has(e.primitiveKind);
  return {
    id: e.runtimeStageId,
    kind: 'subflow',
    label: e.subflowName,
    startOffsetMs: t,
    subflowPath: e.subflowPath,
    isAgentBoundary,
    isPrimitiveBoundary,
    ...(e.primitiveKind ? { primitiveKind: e.primitiveKind } : {}),
    ...(e.payload !== undefined ? { entryPayload: e.payload } : {}),
    runtimeStageId: e.runtimeStageId,
  };
}

/** Append a `next` edge between the previous and current node IF both
 *  are ReAct steps (we don't auto-wire subflow-to-subflow edges; those
 *  come from explicit fork/decision events). */
function connectAdjacent(nodes: StepNode[], edges: StepEdge[]): void {
  if (nodes.length < 2) return;
  const prev = nodes[nodes.length - 2];
  const curr = nodes[nodes.length - 1];
  if (!isReActKind(prev.kind) || !isReActKind(curr.kind)) return;
  edges.push({
    id: `${prev.id}->${curr.id}`,
    from: prev.id,
    to: curr.id,
    kind: 'next',
  });
}

function isReActKind(kind: StepNode['kind']): boolean {
  return (
    kind === 'user->llm' ||
    kind === 'llm->tool' ||
    kind === 'tool->llm' ||
    kind === 'llm->user'
  );
}

function findLastByKind(
  nodes: readonly StepNode[],
  kinds: readonly StepNode['kind'][],
): StepNode | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (kinds.includes(nodes[i].kind)) return nodes[i];
  }
  return undefined;
}

/** Map a `slotKind` (kebab-case) to the camelCase property name on
 *  `StepNode.slotBoundaries`. Single source — change here if either
 *  side ever renames. */
function slotPropName(slotKind: 'system-prompt' | 'messages' | 'tools'): 'systemPrompt' | 'messages' | 'tools' {
  switch (slotKind) {
    case 'system-prompt':
      return 'systemPrompt';
    case 'messages':
      return 'messages';
    case 'tools':
      return 'tools';
  }
}
