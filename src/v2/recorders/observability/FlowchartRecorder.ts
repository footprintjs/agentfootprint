/**
 * FlowchartRecorder — live StepGraph for any Runner.
 *
 * Pattern: Wraps footprintjs `TopologyRecorder` (for control-flow edges
 *          and composition-structure nodes) + subscribes to the v2 event
 *          dispatcher (for ReAct step transitions: user→llm, llm→tool,
 *          tool→llm, llm→user). Produces a single StepGraph consumers
 *          render directly.
 * Role:    Tier 3 observability. Enabled via
 *          `runner.enable.flowchart({ onUpdate })`. Zero footprintjs
 *          imports in the consumer; zero monkey-patching. Consumer gets
 *          a live, step-level graph + a subscription.
 * Emits:   Does NOT emit v2 events. Reads the footprintjs FlowRecorder
 *          channel AND the v2 typed event stream, merges them into one
 *          consumer-facing graph.
 *
 * Why this lives here (not in Lens):
 *   - Step grouping (user→llm / llm→tool / tool→llm / llm→user) is ReAct
 *     semantics. That's the library's domain, not a UI concern.
 *   - Vue / Angular / CLI consumers get the same StepGraph for free.
 *   - Edge kinds (next / loop-iteration / fork-branch / decision-branch)
 *     are reused directly from footprintjs topology — no translation
 *     layer, no duplicate derivation.
 *   - Progressive rendering is free: every event updates the graph
 *     synchronously; `onUpdate` fires the moment the structure changes.
 *
 * Consumer example:
 *
 *     const handle = agent.enable.flowchart({
 *       onUpdate: (graph) => {
 *         for (const step of graph.nodes) {
 *           if (step.kind === 'user->llm' || step.kind === 'tool->llm') {
 *             // step.injections carries the 5-axis chips for this call:
 *             //   slot × role × source × timing (upstreamRef) × decision
 *             // No post-walk, no correlation — the field is ready to render.
 *             for (const inj of step.injections ?? []) {
 *               console.log(`[${inj.slot}] ${inj.source}:${inj.sourceId ?? ''}`);
 *             }
 *           }
 *         }
 *       },
 *     });
 */

import { topologyRecorder, type TopologyRecorder } from 'footprintjs/trace';
import type { CombinedRecorder } from 'footprintjs';
import type {
  AgentfootprintEvent,
  AgentfootprintEventType,
} from '../../events/registry.js';
import type { EventDispatcher } from '../../events/dispatcher.js';

// ─── Public types ────────────────────────────────────────────────────

/**
 * One node in the step-level flowchart. Node kind drives rendering
 * (actor icon, color). ReAct steps carry token + tool details; topology
 * nodes (subflow / fork-branch / decision-branch) mirror their
 * footprintjs counterparts and exist so composition structure (Loop,
 * Parallel, Conditional, Swarm) stays visible in the graph.
 */
export interface StepNode {
  readonly id: string;
  readonly kind:
    | 'user->llm' // context built → LLM call begins (first iteration)
    | 'llm->tool' // LLM returned tool_calls → tool execution begins
    | 'tool->llm' // tool_result returned → next LLM call begins
    | 'llm->user' // terminal LLM response (no tool_calls)
    | 'subflow' // agentfootprint subflow boundary (agent-as-tool, hierarchy)
    | 'fork-branch' // one branch of a Parallel fan-out
    | 'decision-branch'; // chosen branch of a Conditional
  readonly label: string;
  readonly startOffsetMs: number;
  readonly endOffsetMs?: number;
  /** LLM step: token usage of the call that bounded this step. */
  readonly tokens?: { readonly in: number; readonly out: number };
  /** llm->tool / tool->llm: the tool name. */
  readonly toolName?: string;
  /** user->llm / tool->llm: the model that was invoked. */
  readonly llmModel?: string;
  /**
   * Full subflow path from topology. Lens uses this to drill into a
   * subflow boundary — click a `subflow` node → rendered its internal
   * graph via `getSubtreeSnapshot` or nested FlowchartRecorder.
   */
  readonly subflowPath: readonly string[];
  /**
   * Context injections attributed to THIS step.
   *
   * Populated when:
   *   - `kind === 'user->llm'` / `'tool->llm'` → the LLM call consumed
   *     any `context.injected` events that fired in its slot-assembly
   *     phase. Array length equals the event count; empty array means
   *     the call was made with no injections (extremely rare — user
   *     message is almost always injected).
   *
   * Undefined when:
   *   - `kind === 'llm->user'` → terminal delivery marker; no
   *     `llm_start` event opened it, so there's nothing to flush.
   *   - `kind === 'subflow' / 'fork-branch' / 'decision-branch'` →
   *     topology nodes; context is attributed to the LLM steps INSIDE
   *     the subflow, not to the boundary itself.
   *
   * Attribution is deterministic: every `context.injected` event is
   * consumed by the NEXT `stream.llm_start` that follows it. No
   * ancestor walking, no time-window math, no post-walk in the
   * consumer. See `ContextInjection` for the field set.
   */
  readonly injections?: readonly ContextInjection[];
  /**
   * 1-based ReAct iteration this step belongs to.
   *
   * The iteration counter increments each time a new LLM call opens:
   *   - First `user->llm` → iteration 1
   *   - Each `tool->llm` (tool result → next LLM call) → iteration N+1
   *   - `llm->tool` and `llm->user` inherit the iteration of the LLM
   *     call they're bound to.
   *
   * Special cases:
   *   - LLMCall (single-shot primitive) → always iteration 1
   *   - LLMCall never has `tool->llm`, so never advances past 1
   *   - Agent with no tool calls → terminal marker at iteration 1
   *
   * Undefined for topology nodes (subflow / fork-branch / decision-branch)
   * where the concept of "ReAct iteration" doesn't apply — those are
   * composition boundaries, not LLM-call boundaries.
   *
   * Distinct from Loop iterations: footprintjs topology carries
   * `loop-iteration` edges with their own `iteration?: number`.
   * `iterationIndex` is ReAct-specific; `StepEdge.iteration` is
   * Loop-specific. Different concepts, different fields.
   *
   * Use: Lens renders an "iter N/total" badge on the Agent container
   * so the student knows which round they're scrubbing. No consumer-
   * side counting required.
   */
  readonly iterationIndex?: number;
  /**
   * Which of the Agent's three slots observably CHANGED at this step.
   * Drives per-slot highlight / pulse on the LLM card so the student
   * sees the flow of context one step at a time.
   *
   * Derivation (by step kind):
   *   - `user->llm` → `messages` (user message just arrived in-slot)
   *   - `tool->llm` → `messages` (tool result just arrived as tool-role)
   *   - `llm->tool` → `tools` (LLM invoking from the tools slot)
   *   - `llm->user` → undefined (answer delivery; nothing new in-slot)
   *   - subflow / fork-branch / decision-branch → undefined
   */
  readonly slotUpdated?: 'system-prompt' | 'messages' | 'tools';
  /**
   * True when this node represents an AGENT boundary (a real agent in
   * a multi-agent composition, e.g. `triage` / `billing` / `tech` in a
   * Swarm). Agent-internal subflows like `System Prompt` / `Messages`
   * / `Tools` / `callLLM` / `route` are filtered out before they
   * become StepNodes, so all surviving `subflow` nodes are agent
   * boundaries. Downstream: Lens renders each as its own Agent
   * container in drill-down mode.
   */
  readonly isAgentBoundary?: boolean;
}

/**
 * Consumer-facing shape of a context injection — the teaching payload
 * for one chip in Lens (and for any non-React consumer's equivalent).
 *
 * Mirrors the 5 axes of the unified context-engineering model:
 *   1. `slot`      — which of system-prompt / messages / tools
 *   2. `asRole`    — role assigned inside the slot (for messages)
 *   3. `source`    — the flavor (rag / skill / memory / instruction / user / tool-result)
 *   4. Timing      — carried by `upstreamRef` + `reason`
 *   5. Decision    — rule-based vs LLM-guided; derivable from `source`
 *                    or explicit via `decisionKind`
 *
 * Every field below is sourced verbatim from the `context.injected`
 * event payload. No reinterpretation, no renaming.
 */
export interface ContextInjection {
  /**
   * Which of the three Agent input slots this injection targets.
   * Closed set — adding a slot kind is a breaking change to the v2
   * API surface. Keep in sync with `ContextSlot` in
   * `src/events/payloads.ts`.
   */
  readonly slot: 'system-prompt' | 'messages' | 'tools';
  /**
   * Role inside the slot (for `messages` only). Closed set —
   * widening requires a major version bump.
   */
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

/**
 * One edge between two step nodes. Kinds mirror footprintjs topology
 * exactly — consumers don't have to learn a separate vocabulary.
 */
export interface StepEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'next' | 'loop-iteration' | 'fork-branch' | 'decision-branch';
  /** Loop body index — only set for `loop-iteration` edges. */
  readonly iteration?: number;
}

export interface StepGraph {
  readonly nodes: readonly StepNode[];
  readonly edges: readonly StepEdge[];
  readonly activeNodeId?: string;
}

export interface FlowchartOptions {
  /**
   * Called each time the graph changes (ReAct step starts/ends, subflow
   * entry/exit, fork/decision branch taken, loop iterates). Fires
   * synchronously on the driving event, so the UI updates the moment
   * the structure changes.
   */
  readonly onUpdate?: (graph: StepGraph) => void;
}

export interface FlowchartHandle {
  /** Current step graph. Safe to call during or after a run. */
  readonly getSnapshot: () => StepGraph;
  /** Detach from executor + dispatcher. Subsequent events ignored. */
  readonly unsubscribe: () => void;
}

// Deprecated shapes — kept exported so external consumers that fetched
// the raw topology don't break during migration. Lens reads StepGraph now.
// TODO: delete after the playground migration is verified.
export type {
  // Re-exported for back-compat; new code should use `StepGraph`.
};

// ─── Attach entry point ──────────────────────────────────────────────

/**
 * Attach a live FlowchartRecorder to a runner.
 *
 * Internal contract: the caller hands us:
 *   - `runnerAttach(recorder)` — wires a CombinedRecorder through to the
 *     executor's attachCombinedRecorder chain. We pass in a
 *     TopologyRecorder-backed CombinedRecorder here.
 *   - `dispatcher` — the v2 EventDispatcher we subscribe to for ReAct
 *     step transitions (stream.llm_* / stream.tool_*).
 *
 * Called from `RunnerBase.enable.flowchart`.
 *
 * @internal
 */
export function attachFlowchart(
  runnerAttach: (recorder: CombinedRecorder) => () => void,
  dispatcher: EventDispatcher,
  options: FlowchartOptions = {},
): FlowchartHandle {
  const builder = new StepGraphBuilder(options.onUpdate);
  const topo = topologyRecorder();
  const recorder = wrapTopology(topo, builder);
  const offAttach = runnerAttach(recorder);

  // Subscribe to ReAct transitions from the v2 dispatcher.
  const offDispatcher = dispatcher.on(
    '*' as unknown as AgentfootprintEventType,
    (event: AgentfootprintEvent) => {
      builder.ingestV2(event);
    },
  );

  return {
    getSnapshot: () => builder.snapshot(topo),
    unsubscribe: () => {
      offAttach();
      offDispatcher();
    },
  };
}

// ─── Step builder ────────────────────────────────────────────────────

/**
 * Accumulates step nodes + edges as events arrive. State machine
 * tracks the ReAct cycle so consecutive events collapse into the
 * right step:
 *
 *   stream.llm_start (first)       → open 'user->llm'
 *   stream.llm_end (toolCalls>0)   → close current LLM step, next is 'llm->tool'
 *   stream.tool_start              → open 'llm->tool'
 *   stream.tool_end                → close, pending 'tool->llm'
 *   stream.llm_start (after tool)  → open 'tool->llm'
 *   stream.llm_end (toolCalls===0) → close as 'llm->user' (terminal)
 *
 * Topology nodes (subflow/fork/decision) append directly from the
 * FlowRecorder hooks in `wrapTopology()`.
 */
class StepGraphBuilder {
  private readonly nodes: StepNode[] = [];
  private readonly edges: StepEdge[] = [];
  /** The currently-open step id — `undefined` when between steps. */
  private openStepId?: string;
  /** Run-start wall clock; used to compute startOffsetMs. */
  private runStartMs?: number;
  /** Seq counter for unique node ids across the run. */
  private seq = 0;
  /** True when the last closed LLM step had tool calls → next LLM is tool->llm. */
  private pendingToolToLLM = false;
  /**
   * 1-based ReAct iteration counter. Incremented on every LLM call
   * open (user->llm / tool->llm); llm->tool and llm->user markers
   * inherit the current value. Zero before the first LLM call.
   */
  private iterationCounter = 0;
  /**
   * Context injections seen since the last `stream.llm_start` — attributed
   * to the NEXT LLM call at open-step time. This is the "every injection
   * belongs to the upcoming LLM call" rule made concrete: a single buffer
   * that's flushed into the StepNode on creation. No post-walk, no
   * ancestor scan, no time-window math.
   *
   * Cleared at every `stream.llm_start` after the StepNode absorbs it.
   * Accumulates from any `agentfootprint.context.injected` event that
   * lands between llm calls — which is precisely the slot-assembly phase.
   *
   * Ordering invariant: context.injected events ALWAYS precede the
   * llm_start they feed. Enforced by the library — slot assembly runs
   * synchronously before the LLM call is dispatched. An out-of-order
   * event (hypothetical race) would be lost from StepNode.injections
   * but still appears in the EventLog, so consumers retain access.
   */
  private pendingInjections: ContextInjection[] = [];

  constructor(private readonly onUpdate?: (g: StepGraph) => void) {}

  /** Snapshot the graph. Topology param supplies composition structure. */
  snapshot(topo: TopologyRecorder): StepGraph {
    // Merge ReAct step nodes with topology nodes. Topology nodes use
    // their own ids (subflow paths) — they won't collide with the
    // `step-N` ids we assign.
    const topology = topo.getTopology();
    const mergedNodes = [...this.nodes, ...mapTopologyToSteps(topology.nodes)];
    const mergedEdges = [...this.edges, ...mapTopologyEdges(topology.edges, topology.nodes)];
    return {
      nodes: mergedNodes,
      edges: mergedEdges,
      activeNodeId: this.openStepId ?? topology.activeNodeId ?? undefined,
    };
  }

  ingestV2(event: AgentfootprintEvent): void {
    const wall = event.meta.wallClockMs;
    if (this.runStartMs === undefined) this.runStartMs = wall;
    const offset = wall - this.runStartMs;

    switch (event.type) {
      case 'agentfootprint.context.injected': {
        // Buffer the injection; it will be attributed to the NEXT
        // llm_start when the step is created. This is the architectural
        // commitment: the LLM call consumes its context-assembly
        // output; we record the hand-off by baking the injections into
        // the StepNode at open time.
        this.pendingInjections.push(mapInjection(event.payload));
        this.emit();
        break;
      }
      case 'agentfootprint.stream.llm_start': {
        const kind = this.pendingToolToLLM ? 'tool->llm' : 'user->llm';
        // Flush pending injections into this step. Consumers read
        // `step.injections` directly — no post-walk in the renderer.
        const injections: readonly ContextInjection[] = this.pendingInjections;
        this.pendingInjections = [];
        // Bump the ReAct iteration counter. Every LLM call opens a
        // new iteration — first call is iter 1; every tool->llm
        // advances. llm->tool and llm->user markers inherit from
        // their bound LLM call via `this.iterationCounter`.
        this.iterationCounter += 1;
        this.openStep({
          kind,
          label: kind === 'tool->llm' ? 'tool → llm' : 'user → llm',
          startOffsetMs: offset,
          llmModel: event.payload.model,
          subflowPath: event.meta.subflowPath ?? [],
          injections,
          iterationIndex: this.iterationCounter,
          slotUpdated: 'messages',
        });
        this.pendingToolToLLM = false;
        break;
      }
      case 'agentfootprint.stream.llm_end': {
        const hasToolCalls = event.payload.toolCallCount > 0;
        const justClosed = this.nodes[this.nodes.length - 1];
        this.closeStep(offset, {
          tokens: { in: event.payload.usage.input, out: event.payload.usage.output },
        });
        if (hasToolCalls) {
          // LLM emitted tool_calls. DO NOT add a zero-duration marker
          // here — the upcoming `tool_start` event will open the real
          // `llm->tool` step with its own non-zero duration. A marker
          // here would double-count the same transition and render as
          // a dangling edge before the tool execution actually begins.
          // The LLM's decision-to-call-a-tool is observable IN step 1
          // (this closed step) by the presence of toolCallCount > 0.
          this.pendingToolToLLM = false;
          this.emit();
        } else if (justClosed && justClosed.kind === 'user->llm') {
          // Simple one-call path (no tool ever invoked): user asked,
          // LLM answered terminal. Collapse into one `llm->user` step.
          // Keep iterationIndex (same iteration), clear slotUpdated
          // (terminal delivery doesn't "update a slot").
          (justClosed as { kind: StepNode['kind'] }).kind = 'llm->user';
          (justClosed as { label: string }).label = 'llm → user';
          (justClosed as { slotUpdated?: StepNode['slotUpdated'] }).slotUpdated = undefined;
          this.emit();
        } else {
          // Terminal LLM call AFTER a tool round-trip. Keep the closed
          // `tool->llm` node (the LLM ingested the tool result) AND
          // append a zero-duration `llm->user` delivery marker. This
          // gives the user's 4-step mental model a distinct scrub
          // position for "answer delivered" without double-counting
          // the tool transition.
          const id = this.newId();
          // Terminal delivery marker — inherits the iteration of the
          // call that just terminated. No slot update (it's outbound).
          this.nodes.push({
            id,
            kind: 'llm->user',
            label: 'llm → user',
            startOffsetMs: offset,
            endOffsetMs: offset,
            subflowPath: event.meta.subflowPath ?? [],
            iterationIndex: this.iterationCounter,
          });
          this.connectPrev(id);
          this.emit();
        }
        break;
      }
      case 'agentfootprint.stream.tool_start': {
        // llm->tool step "updates" the tools slot (LLM invoked a tool
        // from there). Inherits the current iteration.
        this.openStep({
          kind: 'llm->tool',
          label: `llm → tool (${event.payload.toolName})`,
          startOffsetMs: offset,
          toolName: event.payload.toolName,
          subflowPath: event.meta.subflowPath ?? [],
          iterationIndex: this.iterationCounter,
          slotUpdated: 'tools',
        });
        break;
      }
      case 'agentfootprint.stream.tool_end': {
        this.closeStep(offset);
        this.pendingToolToLLM = true;
        break;
      }
    }
  }

  private openStep(data: Omit<StepNode, 'id' | 'endOffsetMs'>): void {
    const id = this.newId();
    this.nodes.push({ ...data, id });
    this.connectPrev(id);
    this.openStepId = id;
    this.emit();
  }

  private closeStep(endOffsetMs: number, extra?: Pick<StepNode, 'tokens'>): void {
    if (!this.openStepId) return;
    const last = this.nodes[this.nodes.length - 1];
    if (!last || last.id !== this.openStepId) {
      this.openStepId = undefined;
      return;
    }
    (last as { endOffsetMs: number }).endOffsetMs = endOffsetMs;
    if (extra?.tokens) (last as { tokens: StepNode['tokens'] }).tokens = extra.tokens;
    this.openStepId = undefined;
    this.emit();
  }

  /** Connect the new node to the previous ReAct-step node via a `next` edge. */
  private connectPrev(toId: string): void {
    if (this.nodes.length < 2) return;
    const from = this.nodes[this.nodes.length - 2];
    // Only wire edges between ReAct-step nodes; topology nodes bring
    // their own edges via the topology merge.
    if (!isReActStep(from.kind)) return;
    this.edges.push({
      id: `${from.id}->${toId}`,
      from: from.id,
      to: toId,
      kind: 'next',
    });
  }

  private newId(): string {
    return `step-${++this.seq}`;
  }

  private emit(): void {
    if (!this.onUpdate) return;
    // snapshot() needs the topology object; we don't hold one here, so
    // emit a stub and rely on the snapshot helper at the call site. The
    // real consumer entry point is `handle.getSnapshot()` which combines
    // ReAct nodes + topology. For the onUpdate firing path we emit just
    // the ReAct portion so the UI still updates; topology-only changes
    // flow through `wrapTopology`'s own emit call.
    this.onUpdate({
      nodes: this.nodes,
      edges: this.edges,
      activeNodeId: this.openStepId,
    });
  }
}

function isReActStep(kind: StepNode['kind']): boolean {
  return (
    kind === 'user->llm' ||
    kind === 'llm->tool' ||
    kind === 'tool->llm' ||
    kind === 'llm->user'
  );
}

/**
 * Wrap TopologyRecorder so its FlowRecorder hooks additionally nudge the
 * StepGraphBuilder's emit path — when a subflow/fork/decision/loop
 * event fires, the consumer's `onUpdate` gets a fresh snapshot that
 * includes the new topology structure.
 */
function wrapTopology(
  topo: TopologyRecorder,
  builder: StepGraphBuilder,
): CombinedRecorder {
  const emit = () => {
    const topology = topo.getTopology();
    builder['onUpdate']?.({
      nodes: [...builder['nodes'], ...mapTopologyToSteps(topology.nodes)],
      edges: [...builder['edges'], ...mapTopologyEdges(topology.edges, topology.nodes)],
      activeNodeId: builder['openStepId'] ?? topology.activeNodeId ?? undefined,
    });
  };
  return {
    id: topo.id,
    onSubflowEntry: (e) => {
      topo.onSubflowEntry?.(e);
      emit();
    },
    onSubflowExit: (e) => {
      topo.onSubflowExit?.(e);
      emit();
    },
    onFork: (e) => {
      topo.onFork?.(e);
      emit();
    },
    onDecision: (e) => {
      topo.onDecision?.(e);
      emit();
    },
    onLoop: (e) => {
      topo.onLoop?.(e);
      emit();
    },
  };
}

// ─── Topology → StepNode/StepEdge mapping ──────────────────────────

/**
 * Subflow names that are INTERNAL to the Agent primitive — its own
 * context-assembly pipeline and routing sub-stages. These are
 * implementation details of Agent, not scrubbable ReAct steps:
 *
 *   - "System Prompt" / "Messages" / "Tools"  → 3 input slots;
 *     already surfaced as slot rows inside the LLM card.
 *   - "callLLM" / "route" / "ToolCalls" / "Final" → internal branches
 *     of the Agent's state machine; the ReAct step transitions
 *     (user→llm / llm→tool / tool→llm / llm→user) already capture
 *     the observable moments these produce.
 *   - "body" / "Compose … slot" → footprintjs-level wrappers.
 *
 * Emitting these as StepNodes pollutes the scrub axis with ~7 extra
 * "steps" per Agent turn and clutters the flowchart with boxes that
 * duplicate what the LLM/Tool stage + slot rows already show. They
 * stay in the raw TopologyRecorder graph for low-level consumers; the
 * StepGraph just omits them.
 */
const AGENT_INTERNAL_SUBFLOW_NAMES: ReadonlySet<string> = new Set([
  'System Prompt',
  'Messages',
  'Tools',
  'ToolCalls',
  'Final',
  'callLLM',
  'route',
  'body',
  'Compose system-prompt slot',
  'Compose messages slot',
  'Compose tools slot',
]);

function isAgentInternalSubflow(n: { name?: string; id?: string }): boolean {
  const name = n.name ?? '';
  if (AGENT_INTERNAL_SUBFLOW_NAMES.has(name)) return true;
  // decision-body/... wrappers are synthetic routing artifacts; the
  // chosen sub-agent surfaces as its own topology subflow node.
  if (typeof n.id === 'string' && n.id.startsWith('decision-body')) return true;
  return false;
}

/**
 * Topology nodes become `subflow` / `fork-branch` / `decision-branch`
 * StepNodes. Agent-internal subflows are filtered out — they're not
 * meaningful scrub targets.
 *
 * `isAgentBoundary` is narrowed by the `'Agent:'` description prefix
 * that `Agent.buildChart()` writes onto its root stage. Composition
 * primitives (`Sequence:` / `Parallel:` / `Conditional:` / `Loop:`) and
 * `LLMCall:` subflows are NOT agent boundaries — they're composition
 * nodes. A Sequence of 2 LLMCalls thus produces zero agent boundaries;
 * a Swarm of 3 Agents produces 3 (once Swarm topology gap is fixed).
 *
 * Unknown / unmarked subflows default to `false` — consumer-authored
 * FlowCharts aren't treated as agents unless the author opts in by
 * prefixing their root description with `'Agent:'`. Forward-compatible:
 * future primitives self-identify with `'<Kind>:'` at build time.
 *
 * The prefix convention is the temporary contract. Long-term plan is a
 * dedicated metadata field; prefix is minimum-surface for v2.
 */
function mapTopologyToSteps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topoNodes: readonly any[],
): StepNode[] {
  return topoNodes
    .filter((n) => !isAgentInternalSubflow(n))
    .map((n) => {
      const description: string | undefined = n.metadata?.description;
      const isAgentBoundary =
        n.kind === 'subflow' &&
        typeof description === 'string' &&
        description.startsWith('Agent:');
      return {
        id: n.id,
        kind: n.kind as StepNode['kind'],
        label: n.name ?? n.id,
        startOffsetMs: 0,
        subflowPath: [n.id],
        isAgentBoundary,
      };
    });
}

/**
 * Translate a `context.injected` event payload into the consumer-facing
 * `ContextInjection` shape. Straight field copy — no interpretation,
 * no derivation. Consumers render the 5-axis model from this shape.
 *
 * @internal — called from the v2 event handler in StepGraphBuilder.
 */
function mapInjection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
): ContextInjection {
  return {
    slot: payload.slot as ContextInjection['slot'],
    asRole: payload.asRole,
    source: payload.source ?? 'unknown',
    sourceId: payload.sourceId,
    contentSummary: payload.contentSummary,
    reason: payload.reason,
    sectionTag: payload.sectionTag,
    upstreamRef: payload.upstreamRef,
    retrievalScore: payload.retrievalScore,
    rankPosition: payload.rankPosition,
    budgetTokens: payload.budgetSpent?.tokens,
    budgetFraction: payload.budgetSpent?.fractionOfCap,
  };
}

function mapTopologyEdges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topoEdges: readonly any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  topoNodes: readonly any[],
): StepEdge[] {
  // Drop edges whose endpoints we filtered out with the Agent internals.
  // Keeping them would dangle — renderer would have no target to attach.
  const keptIds = new Set(
    topoNodes.filter((n) => !isAgentInternalSubflow(n)).map((n) => n.id),
  );
  return topoEdges
    .filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
    .map((e) => ({
      id: `topo-${e.from}->${e.to}-${e.kind}`,
      from: e.from,
      to: e.to,
      kind: e.kind as StepEdge['kind'],
    }));
}
