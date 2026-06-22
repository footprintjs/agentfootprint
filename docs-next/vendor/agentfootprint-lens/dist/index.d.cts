import { L as LensRecorder, H as Humanizer, R as RunTreeNode, E as EventLogEntry, a as RunSummary, C as CursorPosition, S as StepView, b as CommentaryAtCommit, c as CommentaryRange, d as LayoutLensGraphOptions, e as LayoutLensGraphResult } from './index-BH_ctbLK.cjs';
export { A as ActorId, f as AgentInstance, B as BASELINE_SOURCES, g as BreadcrumbItem, h as BuildLLMTextArgs, i as ChangeNotifier, j as CompositionDetails, D as DEFAULT_MAX_EVENTS, k as EdgeAgg, F as FocusDetail, l as Hop, I as IterationDetails, m as LLMCallDetails, n as LensDiagnostics, o as LensEdge, p as LensGroupOutput, q as LensNode, r as LensReactFlowEdgeData, s as LensReactFlowNodeData, t as LensRecorderOptions, u as LensSnapshotRecorder, v as LensSnapshotRecorderOptions, w as LensSnapshotRunnerLike, M as MemberResolver, P as PauseDetails, x as RunNodeDetails, y as RunNodeKind, z as RunNodeStatus, G as SelectHopsArgs, J as SelectStepViewArgs, K as SpecNode, T as ToReactFlowResult, N as ToolCallDetails, O as buildLLMText, Q as buildSpecTreeFromBoundary, U as buildStepGraphFromSnapshot, V as defaultHumanizer, W as defaultSize, X as humanizeWith, Y as isContextEngineering, Z as layoutLensGraph, _ as lensGroupTranslator, $ as lensRecorder, a0 as lensSnapshotRecorder, a1 as makeChildNodeId, a2 as makeEdge, a3 as makeRootNodeId, a4 as mergeOutputs, a5 as pinUnderParent, a6 as selectAgentInstances, a7 as selectCommentaryAt, a8 as selectCommentaryRanges, a9 as selectContextEngineeringInjections, aa as selectEdges, ab as selectFocusDetail, ac as selectHops, ad as selectStepAgentName, ae as selectStepView, af as selectToolChoiceCall, ag as selectTouched, ah as stepEdgeLabel, ai as stepToStageEndpoints, aj as structureGraphFromRunner, ak as structureGraphFromSpec, al as teachingHumanizer, am as toReactFlow, an as translateAgent, ao as translateConditional, ap as translateLLMCall, aq as translateLoop, ar as translateParallel, as as translateSequence } from './index-BH_ctbLK.cjs';
import * as agentfootprint_observe from 'agentfootprint/observe';
import { ToolChoiceCall, ToolChoiceSummary, Trace, StepGraph } from 'agentfootprint/observe';
import * as agentfootprint from 'agentfootprint';
import { CommentaryTemplates, Runner } from 'agentfootprint';
import React from 'react';
import { NodeTypes } from '@xyflow/react';
import { TraceGraph, TraceFlowLayout, RuntimeOverlay } from 'footprint-explainable-ui/flowchart';
import 'footprintjs';

/**
 * LensFlow — the canonical Lens chart renderer.
 *
 *   <LensFlow chart={{ graph, layout, nodeTypes }} selectedRuntimeStageId={cursorStageId} />
 *
 * Renders a consumer-supplied build-time chart (from `structureGraphFromRunner`)
 * through explainable-ui's `<TracedFlow>`. The chart's node ids ARE the run's
 * `runtimeStageId`s, so the runtime overlay lights the executed path as the
 * cursor scrubs; `coActiveStageIds` lights a whole parallel cohort at one cursor
 * (the context slots, or the branches of a parallel fork). Lens owns the shell
 * (slider / commentary / details); this file owns only the chart canvas.
 *
 * One graph path: the consumer builds the chart with `structureGraphFromRunner`
 * (real runtime-stage ids + hero/plumbing emphasis) and supplies it via `chart`.
 * The older lens-card collapser (lensCollapser / collapserFromRunner) was removed
 * — there is exactly one runner→graph path now.
 */

interface LensFlowProps {
    /**
     * The build-time chart to render: the `TraceGraph` (from
     * `structureGraphFromRunner`), the layout algorithm that positions it, and the
     * node renderers. Node ids ARE the run's `runtimeStageId`s so the overlay lights
     * the executed path as the cursor scrubs.
     */
    readonly chart: {
        readonly graph: TraceGraph;
        readonly layout: TraceFlowLayout;
        readonly nodeTypes?: NodeTypes;
    };
    /**
     * Consumer node renderer overrides, merged ON TOP of `chart.nodeTypes`
     * (consumer keys win). Use to swap a renderer or add types your graph emits.
     */
    readonly nodeTypes?: NodeTypes;
    /**
     * Slider cursor's `runtimeStageId` (format `[subflowPath/]stageId#index`).
     * Resolved to a scrubIndex into the overlay's executionOrder.
     */
    readonly selectedRuntimeStageId?: string;
    /**
     * Slider cursor's `kind` — distinguishes Run · start from Run · end (both share
     * the root `runtimeStageId`): at `group-start` nothing is done yet; at
     * `group-end` everything is done.
     */
    readonly selectedCursorKind?: 'group-start' | 'group-end' | 'commit' | 'user-in' | 'user-out' | 'parallel';
    /** Fired when the user clicks a chart node, with that node's id. */
    readonly onNodeClick?: (nodeId: string) => void;
    /** Whether to render `<Controls>` (zoom / fit-view). Default `true`. */
    readonly showControls?: boolean;
    /** Whether to render `<Background>` (dot pattern). Default `true`. */
    readonly showBackground?: boolean;
    /**
     * Chart node ids to light as active SIMULTANEOUSLY at the current cursor — the
     * concurrent branches of a parallel fork (context slots, or parallel agent
     * branches). Resolved by `<Lens>` from the cursor position's `coActiveGroupIds`
     * (strip `#index`). The single canonical cursor still governs the panels.
     */
    readonly coActiveStageIds?: ReadonlySet<string>;
    /**
     * Explain-ui's authoritative runtime overlay (`lensRecorder.runtime.getOverlay()`).
     * `<TracedFlow>` slices it at `scrubIndex` and injects active/done/error state
     * into every chart node's `data`.
     */
    readonly traceRuntimeOverlay?: RuntimeOverlay;
}
declare const LensFlow: React.FC<LensFlowProps>;

/**
 * useToolChoice — async reader for the agentfootprint/observe
 * `toolChoiceRecorder` handle (RFC-002 block C7).
 *
 * The recorder's read API is LAZY: `getCalls()` / `getSummary()` run the
 * injected embedder on first read and memoize per entry (C5 — embedding
 * I/O never rides the agent's hot path). That makes the surface async,
 * so this hook bridges it into React state:
 *
 *   - reads are SERIALIZED (one in flight at a time — concurrent
 *     `ensureScored` passes would double-call the embedder);
 *   - queued stale reads are SKIPPED — only the newest revision does a
 *     real read ("latest wins");
 *   - a read that resolves after unmount / a newer revision never
 *     touches state.
 *
 * `revision` is the re-read signal — pass something that changes when
 * new data may exist (Lens passes the event-log length). Entries score
 * once each (memoized by the recorder), so per-tick re-reads cost one
 * array copy, not repeated embedding.
 *
 * Mid-run reads are SAFE but mean the embedder runs while the agent is
 * still working (closed entries score progressively). Consumers who
 * want strictly post-run scoring simply mount the panel after the run.
 */

/**
 * Structural subset of `ToolChoiceRecorderHandle` the lens reads —
 * pass the real recorder handle, or any object exposing the two async
 * getters (e.g., pre-extracted data wrapped in resolved promises).
 */
interface ToolChoiceSource {
    getCalls(): Promise<readonly ToolChoiceCall[]>;
    getSummary(): Promise<ToolChoiceSummary>;
}
interface UseToolChoiceResult {
    /** All recorded LLM calls that offered tools, recording order. */
    readonly calls: readonly ToolChoiceCall[];
    /** Run-summary counts (flagged / narrow / proxy-disagreement). */
    readonly summary: ToolChoiceSummary | undefined;
    /** True while the first read (or a newer one) is in flight. */
    readonly pending: boolean;
    /** Message of the last failed read — surfaced, never swallowed. */
    readonly error: string | undefined;
}
declare function useToolChoice(source: ToolChoiceSource | undefined, revision: number): UseToolChoiceResult;

type LensView = "engineer" | "analyst" | "user";
/**
 * Lens reads the chart from a real agentfootprint `Runner`. The chart
 * is derived at build time via the runner's `getUIGroupWith` API
 * (memoised on the runner side) — full composition graph visible
 * from t=0, no growth as events fire. Cursor movement only
 * HIGHLIGHTS positions; it does not reshape the chart. See
 * `memory/lens_v0_1_one_cursor_architecture.md`.
 */
type LensRunnerLike = agentfootprint.Runner;
interface LensProps {
    /** The recorder that was observing the run. Drives EventStream +
     *  Summary + selected-node detail. */
    readonly recorder: LensRecorder;
    /**
     * Optional — when provided, Lens reads the static flowchart blueprint
     * from `runner.getSpec().buildTimeStructure` and renders the FULL
     * structure from t=0. Without this prop, Lens falls back to the
     * live-built spec from the recorder's boundary index (chart grows
     * as events fire). The static path is strictly better for live
     * monitoring: chart visible immediately, no scrub-back shrinkage,
     * no layout jitter. See `memory/lens_v0_1_one_cursor_architecture.md`.
     */
    readonly runner?: LensRunnerLike;
    /**
     * StepGraph from `runner.enable.flowchart()`. agentfootprint owns the
     * step derivation; Lens just renders. When absent, Lens reads from
     * `recorder.snapshot.getStepGraph()` (the Phase 4 incremental
     * snapshot recorder, attached automatically by `recorder.observe()`).
     *
     * Recommended: omit this prop and let Lens use `recorder.snapshot` —
     * that path is the canonical Phase 4 source-of-structural-truth and
     * fixes multi-branch Parallel rendering. The prop remains for
     * backward compat with consumers wiring their own FlowchartRecorder.
     */
    readonly stepGraph?: agentfootprint_observe.StepGraph;
    /**
     * Consumer-driven chart override (engineer view). When provided, the chart
     * renders THIS footprintjs-derived graph with THIS explain-ui layout +
     * node renderers, instead of Lens's default collapsed composition graph.
     * The shell (slider / commentary / details) and runtime time-travel are
     * unchanged. See `LensFlowProps['chart']`.
     */
    readonly chart?: LensFlowProps["chart"];
    /** Which audience view to render. Default: `engineer`. */
    readonly view?: LensView;
    /** Optional humanizer override. Default: a `teachingHumanizer`
     *  configured with `appName` (below). Pass `defaultHumanizer` (or
     *  your own) for terse / customized prose. */
    readonly humanizer?: Humanizer;
    /**
     * Name of the system the developer is building. Substituted as the
     * **active** actor in every commentary line ("Neo dispatched the
     * tool", "Chatbot called the LLM"). Default: `'Chatbot'`.
     *
     * The LLM is always *passive* in the narrative ("the LLM suggested",
     * "the LLM gave the answer"). This split reflects architectural
     * truth: LLMs don't act, your code does — naming the system as the
     * subject of every active verb teaches that.
     *
     * Ignored when the `humanizer` prop is set (your humanizer owns
     * the wording in that case).
     */
    readonly appName?: string;
    /**
     * Override agentfootprint's bundled commentary templates. The hook
     * for shipping a different locale (Spanish, Japanese) or a custom
     * brand voice without forking either package.
     *
     * Spread on top of the defaults — partial overrides are safe; missing
     * keys fall back to bundled English.
     *
     * Example (locale):
     * ```ts
     * import esTemplates from './commentary.es.json';
     * <Lens recorder={r} commentaryTemplates={esTemplates} />
     * ```
     *
     * Example (brand voice — override only one key):
     * ```ts
     * <Lens
     *   recorder={r}
     *   commentaryTemplates={{
     *     'agent.turn_start': 'You: "{{userPrompt}}"',
     *   }}
     * />
     * ```
     *
     * Ignored when the `humanizer` prop is set (your humanizer owns the
     * wording in that case).
     */
    readonly commentaryTemplates?: Partial<CommentaryTemplates>;
    /**
     * Optional — the `toolChoiceRecorder` handle from
     * `agentfootprint/observe` (RFC-002 C4–C6). When provided, the
     * engineer view mounts the "Tool choice" panel: per-iteration bars of
     * the offered-tool scores (chosen highlighted), margin badge,
     * ⚠ NARROW / ⚠ PROXY-DISAGREEMENT flags, and a flagged-call run
     * summary. The visible call derives from the ONE Lens cursor (exact →
     * within-subflow → nearest-previous) — no second cursor.
     *
     * The recorder scores LAZILY (the embedder runs on first read,
     * memoized per entry) — the Lens reads asynchronously as the log
     * ticks; entries score once each. Omitted → the panel does not mount;
     * zero impact.
     */
    readonly toolChoice?: ToolChoiceSource;
}
declare const Lens: React.FC<LensProps>;

/**
 * <Replay> — render a persisted agentfootprint `Trace` OFFLINE.
 *
 * No live runner, no recorder, no agent re-run. It rebuilds the flowchart from
 * `trace.structure` (the serialized static chart captured by
 * `localObservability().getTrace()` — Replay Option A) and renders it via the
 * same `<LensFlow>` the live `<Lens>` uses, so an offline replay matches the
 * live view's shape.
 *
 *   import { Replay } from 'agentfootprint-lens';
 *   const trace = JSON.parse(fs.readFileSync('run.trace.json', 'utf8'));
 *   return <Replay trace={trace} />;
 *
 * The `Trace` is self-describing about redaction: when it carries raw,
 * un-redacted content (`trace.redaction === 'none'`) `<Replay>` shows a banner,
 * so a trace shared in a bug report / docs is never mistaken for safe.
 *
 * Time-travel overlay (lighting the executed path + a step slider from
 * `trace.events`) is a planned refinement; this renders the executed chart shape.
 */

interface ReplayProps {
    /** A persisted `Trace` from `agentfootprint` `localObservability().getTrace()`. */
    readonly trace: Trace;
    /**
     * Show the "contains raw content" banner when the trace was NOT redacted
     * (`trace.redaction === 'none'`). Default `true`.
     */
    readonly warnOnRawContent?: boolean;
    /** Forwarded to `<LensFlow>` — render zoom/fit controls. Default `true`. */
    readonly showControls?: boolean;
    /** Forwarded to `<LensFlow>` — render the dot background. Default `true`. */
    readonly showBackground?: boolean;
}
declare const Replay: React.FC<ReplayProps>;

/**
 * LENS_NODE_TYPES — the renderer map for the custom node types a Lens chart uses.
 *
 * `structureGraphFromRunner` tags the three context slots with `type: 'slotPill'`
 * (and subflow boxes with `type: 'groupContainer'`). React Flow needs a renderer
 * registered for each custom type, otherwise it falls back to the default node
 * and floods the console with "node type not found" warnings.
 *
 * Exported so consumers (and the Lens's own auto-derived chart) reuse one map
 * instead of hand-rolling it. Stage nodes use TraceFlow's built-in StageNode.
 */

declare const LENS_NODE_TYPES: NodeTypes;

/**
 * LensChartBoundary — a small error boundary around the chart renderer.
 *
 * A malformed `chart` prop (or an internal render error in the flow graph)
 * should NOT white-screen the whole Lens. This catches the error and shows a
 * compact fallback while the rest of the monitor (timeline, commentary,
 * details) keeps working.
 */

interface Props {
    readonly children: React.ReactNode;
    readonly fallback?: React.ReactNode;
}
interface State {
    readonly error: Error | null;
}
declare class LensChartBoundary extends React.Component<Props, State> {
    state: State;
    static getDerivedStateFromError(error: Error): State;
    render(): React.ReactNode;
}

/**
 * RunTreeView — expandable tree of RunTreeNodes.
 *
 * Pattern: flatten-then-window. The tree is flattened to its VISIBLE
 *          rows (respecting expand/collapse) each render; past
 *          `virtualizeThreshold` rows only the scrolled-to window is
 *          mounted (U3 — the recursive-render version degraded beyond
 *          ~500 nodes because every visible node was a live component).
 * Role:    Primary structural view of the engineer mode. Each node shows
 *          kind icon + label + status + duration. Leaves (LLM / tool /
 *          pause) don't expand; composition + iteration nodes do.
 *
 * Expansion state is a node-id keyed override map: nodes default to
 * expanded at depth < 3 (so LLM / tool leaves are visible without a
 * click), and a click toggles the override. Because the default is
 * DERIVED per render, a shallow node that gains children mid-run now
 * auto-expands (the old mount-time `useState` initial froze it closed).
 */

interface RunTreeViewProps {
    readonly node: RunTreeNode;
    /** Callback when user clicks a node — fires with the full node. */
    readonly onSelect?: (node: RunTreeNode) => void;
    /** Currently-selected node id (for highlight). */
    readonly selectedId?: string;
    /** Starting indent depth. Internal — leave undefined at call sites. */
    readonly depth?: number;
    /** Visible-row count past which windowed rendering engages (inside a
     *  `maxHeight` scroll container). Default 300. Below it the tree
     *  renders every visible row with no scroll wrapper — unchanged
     *  layout for typical runs. */
    readonly virtualizeThreshold?: number;
    /** Fixed row height (px) used when windowing is active. Default 26. */
    readonly rowHeight?: number;
    /** Scroll-container height (px) used when windowing is active.
     *  Default 480. */
    readonly maxHeight?: number;
}
/** Render a node + its children. Top-level consumers pass the tree root. */
declare const RunTreeView: React.FC<RunTreeViewProps>;

/**
 * EventStream — renders the raw event log as a scrolling list,
 * optionally filtered by domain.
 *
 * Pattern: list-of-lines, each row is one event.
 * Role:    Engineer view's firehose. The RunTree shows the STRUCTURE;
 *          this shows every single event in chronological order.
 *
 * U3 — windowed rendering: past `virtualizeThreshold` rows the list
 * renders only the visible window (spacer-based, `useWindowedList`),
 * so a 100K-event firehose costs ~one viewport of DOM nodes. Below the
 * threshold the DOM is identical to the pre-U3 render. Windowed rows
 * are pinned to `rowHeight` px with ellipsis overflow — full content
 * stays reachable via `onSelect`.
 *
 * Honesty: when the `LensRecorder` `maxEvents` cap has evicted events,
 * pass `droppedCount` (from `recorder.getDiagnostics().droppedEvents`)
 * and the stream leads with an explicit eviction notice — the log
 * starting mid-run is never silent.
 */

interface EventStreamProps {
    readonly log: readonly EventLogEntry[];
    /** Optional humanizer for a natural-language column alongside the event type. */
    readonly humanizer?: Humanizer;
    /** Filter: only events whose type starts with any of these prefixes. */
    readonly domainFilter?: readonly string[];
    /** Callback for row click. */
    readonly onSelect?: (entry: EventLogEntry) => void;
    /** Number of events evicted by the recorder's `maxEvents` FIFO cap
     *  (U3) — wire `recorder.getDiagnostics().droppedEvents`. When > 0 an
     *  eviction notice renders above the stream so the missing head of
     *  the log is visible, not silent. */
    readonly droppedCount?: number;
    /** Row count past which windowed rendering engages. Default 300. */
    readonly virtualizeThreshold?: number;
    /** Fixed row height (px) used when windowing is active. Default 24. */
    readonly rowHeight?: number;
}
declare const EventStream: React.FC<EventStreamProps>;

/**
 * skillGraphFlowLayout — pure layout for the interactive skill-graph view.
 *
 * Takes the STRUCTURE that `agentfootprint`'s `skillGraph().build()` produces
 * (`{ nodes, edges }` — predicate diamonds + skill boxes, branch edges) and lays
 * it out top-to-bottom with dagre into absolute positions xyflow can render.
 *
 * Pure + framework-free: no React, no agentfootprint import. The prop shapes are
 * STRUCTURAL copies of agentfootprint's `SkillNode` / `SkillEdge`, so a consumer
 * passes `graph.nodes` / `graph.edges` straight through (TypeScript structural
 * typing makes them assignable) without the lens taking a hard dependency on the
 * exact agentfootprint types. Keeping the layout here (not in the component) means
 * it unit-tests without rendering — the lens "pure core + thin React" convention.
 */
/** A drawn node — mirrors agentfootprint's `SkillNode`. */
interface SkillGraphNodeView {
    readonly id: string;
    readonly kind: 'predicate' | 'skill';
    readonly label?: string;
}
/** A drawn edge — mirrors agentfootprint's `SkillEdge`. `from: null` = START. */
interface SkillGraphEdgeView {
    readonly from: string | null;
    readonly to: string;
    /** `'model'` edges draw dashed (model-reachable via read_skill); others solid. */
    readonly kind?: string;
    readonly label?: string;
}
interface SkillGraphInput {
    readonly nodes: readonly SkillGraphNodeView[];
    readonly edges: readonly SkillGraphEdgeView[];
}
/** The synthetic START node id (a turn's entry point). */
declare const SKILL_GRAPH_START_ID = "__start__";
type FlowNodeKind = 'start' | 'predicate' | 'skill';
/** A positioned node ready for xyflow (`position` = top-left, not dagre center). */
interface SkillFlowNode {
    readonly id: string;
    readonly kind: FlowNodeKind;
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
interface SkillFlowEdge {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label?: string;
    readonly dashed: boolean;
}
interface SkillGraphLayoutOptions {
    /** Render the synthetic START chip + its entry edges. Default `true`. */
    readonly showStart?: boolean;
    /** Vertical gap between ranks. Default `64`. */
    readonly rankSep?: number;
    /** Horizontal gap between siblings. Default `40`. */
    readonly nodeSep?: number;
}
/**
 * Lay the skill graph out top-to-bottom. Dangling edges (endpoint not in
 * `nodes`) are skipped rather than throwing — a renderer should draw what it can.
 */
declare function layoutSkillGraph(graph: SkillGraphInput, opts?: SkillGraphLayoutOptions): {
    nodes: SkillFlowNode[];
    edges: SkillFlowEdge[];
};
/** One predicate on the path that reaches a node, and the branch taken. */
interface SkillRoutingPathStep {
    /** The predicate node's caption. */
    readonly predicate: string;
    /** The branch (edge caption) taken to descend toward the target. */
    readonly branch: string;
}
/**
 * Walk the graph backwards from `nodeId` to START, collecting the decision path
 * that reaches it — each predicate + the branch taken — in root→leaf order. For a
 * decision tree this is the conjunction that activates the skill; for a flat
 * entry it's empty (reached directly), for a route it's the single edge. Pure +
 * derived from the drawn edges (no agentfootprint dependency); cycle-guarded.
 */
declare function routingPathTo(graph: SkillGraphInput, nodeId: string): SkillRoutingPathStep[];

/**
 * <SkillGraphFlow> — an interactive, two-panel view of a skill graph.
 *
 *   import { SkillGraphFlow } from 'agentfootprint-lens';
 *   import { skillGraph, decide } from 'agentfootprint';
 *
 *   const graph = skillGraph().tree(decide(isIo, ioSkill, triageSkill, 'io?')).build();
 *   <SkillGraphFlow graph={graph} detailFor={(node) => describe(node.id)} />
 *
 * The richer companion to `graph.toMermaid()`: predicate **diamonds** route to
 * skill **boxes** (the decision tree from `skillGraph().tree(...)`), or entry +
 * routing edges (the flat `entry`/`route` model). Click a node → its detail shows
 * in the side panel. Pure presentation: it renders the STRUCTURE the graph already
 * carries (`graph.nodes` / `graph.edges`); it doesn't run the agent.
 *
 * Decoupled from agentfootprint by structural typing — `SkillGraphView` matches
 * the shape of agentfootprint's `SkillGraph`, so a built graph passes straight in.
 */

/** The graph structure to draw — matches agentfootprint's `SkillGraph`. */
interface SkillGraphView {
    readonly nodes: readonly SkillGraphNodeView[];
    readonly edges: readonly SkillGraphEdgeView[];
}
/** Detail shown in the side panel when a node is selected. */
interface SkillNodeDetail {
    /** Heading; defaults to the node's label/id. */
    readonly title?: string;
    /** One-line description (a skill's `description`). */
    readonly description?: string;
    /** The skill body / system prompt (rendered monospace). */
    readonly body?: string;
    /** Tool names the skill unlocks. */
    readonly tools?: readonly string[];
    /** Extra label/value rows (e.g. trigger kind). */
    readonly meta?: ReadonlyArray<{
        readonly label: string;
        readonly value: string;
    }>;
}
interface SkillGraphFlowProps {
    /** The built graph (`skillGraph()....build()`). */
    readonly graph: SkillGraphView;
    /** Resolve a node → its side-panel detail. Called for skill + predicate nodes. */
    readonly detailFor?: (node: SkillGraphNodeView) => SkillNodeDetail | undefined;
    /** Controlled selection — the selected node id (or `null`). */
    readonly selectedId?: string | null;
    /** Uncontrolled initial selection. Ignored when `selectedId` is set. */
    readonly defaultSelectedId?: string | null;
    /** Fired when the selection changes (node click, or pane click → `null`). */
    readonly onSelectNode?: (id: string | null) => void;
    /** Draw the synthetic START chip + entry edges. Default `true`. */
    readonly showStart?: boolean;
    /** Hide the side detail panel (graph-only). Default `false`. */
    readonly hideDetailPanel?: boolean;
    /** Initial detail-panel width in px (drag the divider to resize). Default `320`. */
    readonly defaultPanelWidth?: number;
    /** Container height. Default `'100%'`. */
    readonly height?: number | string;
    readonly className?: string;
    readonly style?: React.CSSProperties;
}
declare const SkillGraphFlow: React.FC<SkillGraphFlowProps>;

/**
 * SummaryCard — compact stats overview rendered from a `RunSummary`.
 * Analyst view's top-of-panel glance; engineer view's header.
 */

interface SummaryCardProps {
    readonly summary: RunSummary;
}
declare const SummaryCard: React.FC<SummaryCardProps>;

/**
 * TimeTravel — scrub slider.
 *
 * Pattern: frosted-pill control with ◀ ▶ ⟳Live buttons + range slider.
 *          State shape: one `focusSeq` number. At `max` → live (new
 *          events auto-advance). Below `max` → user pinned, auto-
 *          advance off. Arrow keys scrub. Space toggles live.
 * Role:    Replay past states of a run without post-walking the tree.
 *          Lens filters the RunTree + EventStream to entries with
 *          `seq <= focusSeq`; RunTreeFlow hides nodes whose
 *          `startOffsetMs > focusRunOffsetMs`. The recorder keeps all
 *          events — the view just slices.
 *
 * Why a separate component (not inlined in Lens):
 *   - Reused across views (Engineer, Analyst)
 *   - Keyboard bindings live here so the scope is explicit
 *   - Theme/styling lives in one place
 */

interface TimeTravelProps {
    /** Total number of events in the log (= max seq + 1 for zero-indexed seq). */
    readonly total: number;
    /** Current focus position. Clamped to [0, total - 1]. */
    readonly focusSeq: number;
    /** Called on every scrub / step / live click. */
    readonly onFocusChange: (seq: number) => void;
    /** True when `focusSeq === total - 1`. Drives ⟳Live button visual. */
    readonly isLive: boolean;
    /**
     * Compact mode — render ONLY the ◀ ▶ ⟳Live controls + position count, NOT the
     * drag track. Used in the monitor where the "WHAT HAPPENED" timeline IS the
     * scrubber, so a second draggable track would be redundant. Keyboard scrubbing
     * + Live still work.
     */
    readonly compact?: boolean;
}
declare const TimeTravel: React.FC<TimeTravelProps>;

/**
 * <ToolChoicePanel> — per-iteration tool-choice margins (RFC-002 C7).
 *
 * Visualizes one `toolChoiceRecorder` call at a time: horizontal bars of
 * the offered-tool scores (chosen highlighted), a margin badge, and the
 * ⚠ NARROW / ⚠ PROXY-DISAGREEMENT flags — plus a run-summary line with
 * the flagged-call count.
 *
 * ONE-CURSOR law: the visible call is DERIVED from the Lens cursor via
 * `selectToolChoiceCall` (exact → within-subflow → nearest-previous).
 * The panel owns no call index, no second slider, no parallel data path
 * (see `memory/lens_v0_1_one_cursor_architecture.md`).
 *
 * Honest-claim discipline (RFC-002 §2): the caption states that margins
 * are embedding-geometry PROXIES between the choice context and the
 * tool descriptions — never model internals. Bars are normalized to the
 * top score, so a close call LOOKS close — honesty by construction.
 *
 * U3 windowing: the score-bar list threshold-gates through
 * `useWindowedList` (default 300, same contract as EventStream) so a
 * huge tool catalog renders only the scrolled-to window.
 */

interface ToolChoicePanelProps {
    /** All recorded tool-offering LLM calls (from `useToolChoice`). */
    readonly calls: readonly ToolChoiceCall[];
    /** Run-summary counts — drives the flagged-call summary line. */
    readonly summary?: ToolChoiceSummary;
    /** The ONE Lens cursor — the visible call derives from it. */
    readonly cursorRuntimeStageId: string;
    /** Cursor position kind — discriminates Run·start vs Run·end. */
    readonly cursorKind?: CursorPosition['kind'];
    /** True while the lazy scoring read is in flight. */
    readonly pending?: boolean;
    /** Last read error — rendered, never swallowed. */
    readonly error?: string;
    /** Offered-tool row count past which windowing engages. Default 300. */
    readonly virtualizeThreshold?: number;
    /** Fixed row height (px) for windowed bar rows. Default 22. */
    readonly rowHeight?: number;
}
declare const ToolChoicePanel: React.FC<ToolChoicePanelProps>;

/**
 * useLensRecorder — React hook bridging `LensRecorder` to React's render cycle.
 *
 * Pattern: `useSyncExternalStore` (React 18+). Recorder is an external
 *          store; each handled event increments a version counter and
 *          fires every subscriber synchronously. The hook subscribes
 *          once, re-renders event-by-event, and exposes the recorder's
 *          three selectors as memoized getters.
 * Role:    Replace the 100ms polling pattern (setInterval + setState)
 *          with push-based reactivity. Zero polling, zero post-flush
 *          debt, progressive rendering for every run length from 5ms
 *          to 5 minutes.
 *
 * Why not just `useState` in the consumer?
 *   - The consumer would have to re-subscribe on every recorder swap.
 *   - `useSyncExternalStore` batches tear-safely across concurrent
 *     renders (React 18+ requirement).
 *   - Snapshots are stable across renders unless the version actually
 *     bumped — identity check avoids redundant downstream re-renders.
 */

/**
 * Subscribe a React component to a LensRecorder. Returns the recorder
 * itself; call `recorder.selectRunTree()` / `selectEventLog()` /
 * `selectSummary()` in the component body — they re-run every render
 * because the version bumped, so they see the fresh state.
 */
declare function useLensRecorder(recorder: LensRecorder): LensRecorder;

/**
 * useStepFocus — scrub cursor with auto-advance when live.
 *
 * Pattern: one state field (`focus`) + one ref (`wasLive`) + a
 *          `setFocus` setter. Auto-advances to `max` when the user
 *          was already at `max` before the last event fired; pins
 *          to the user's chosen index when they've manually scrubbed
 *          back. Matches v1's TimeTravel auto-advance semantics.
 * Role:    Owns scrub state. Consumers pass `max` (total step count
 *          from the selectors) and receive the controlled position
 *          + an `isLive` flag for the ⟳Live button.
 */
interface UseStepFocusResult {
    readonly focus: number;
    /** True when the user is at the most-recent step (new events advance). */
    readonly isLive: boolean;
    readonly setFocus: (next: number) => void;
}
/**
 * Controlled scrub cursor. Keeps pace with `max` when the user is at
 * the end; pins to the manually-scrubbed position otherwise.
 *
 * Contract:
 *   - Initial `focus` = `max` (at the end / live).
 *   - When `max` grows (a new step landed), if the user WAS at the
 *     previous `max` (i.e., was live), snap to the new `max`. Else
 *     leave `focus` where it is.
 *   - `setFocus(max)` re-engages live mode for subsequent events.
 */
declare function useStepFocus(max: number): UseStepFocusResult;

/**
 * useDrillPath — drill-down state (which agent is the user zoomed into).
 *
 * Pattern: one state field (a readonly string[]). `drillInto(id)`
 *          appends a segment; `drillBack()` pops the last segment;
 *          `drillTo(path)` replaces. Empty path = top-level view.
 * Role:    Owns the "mode switch" that turns the flowchart from the
 *          multi-agent overview into one-agent-expanded view. Used
 *          by the breadcrumb navigator and the selector's
 *          `drillPath` parameter.
 */
interface UseDrillPathResult {
    readonly drillPath: readonly string[];
    /** Drill into a specific boundary by its FULL subflowPath. Replaces
     *  `drillPath` (does NOT append) — nested boundaries' subflowPaths
     *  already include their parent segments, so replacement composes
     *  correctly for nested drills (Agent A → Agent B: passing B's
     *  subflowPath, which contains A's prefix, drills into B). */
    readonly drillInto: (subflowPath: readonly string[]) => void;
    readonly drillBack: () => void;
    readonly drillToRoot: () => void;
    readonly drillTo: (path: readonly string[]) => void;
}
/**
 * Drill-down state. `drillInto('triage')` puts the user "inside"
 * the triage agent; `drillBack()` pops one level; `drillToRoot()`
 * returns to the top-level view.
 *
 * No reducer, no context, no global store — the state is scoped to
 * the Lens component that owns it. Share across siblings by lifting
 * the hook and passing the result down.
 */
declare function useDrillPath(initial?: readonly string[]): UseDrillPathResult;

/**
 * useStepView — wires core selectors to React's render cycle.
 *
 * Pattern: memoized call to `selectStepView` — runs fresh on every
 *          change of its inputs, stable reference otherwise. Works
 *          under React 18 concurrent rendering because the selector
 *          is pure (no side effects, no external mutation).
 * Role:    The one hook components call to get the ViewModel. All
 *          upstream derivation (agents / touched / edges / focus
 *          detail) flows through here.
 *
 * Consumers:
 *
 *     const view = useStepView(graph, log, focus, drillPath);
 *     return <RunTreeFlow view={view} />;
 *
 * Zero framework-specific code inside; just a `useMemo` wrapper over
 * the shared selector. Bindings for Vue / Angular write the
 * equivalent `computed` / `Observable` wrappers the same way.
 */

/**
 * Derive the ViewModel for the Lens flowchart from its four inputs.
 *
 * Inputs:
 *   - `graph`      → full StepGraph from `runner.enable.flowchart()`
 *   - `log`        → full EventLog from `LensRecorder.selectEventLog()`
 *   - `focusIndex` → current scrub position; `max` = graph.nodes.length - 1
 *   - `drillPath`  → drill-down state; `[]` = top-level
 *
 * Output: `StepView` — everything a renderer needs in one object.
 */
declare function useStepView(graph: StepGraph, log: readonly EventLogEntry[], focusIndex: number, drillPath: readonly string[]): StepView;

/**
 * useCommentarySlider — Phase 5 Layer 3 React hook for the commit-axis
 * commentary slider. Subscribes to the LensRecorder's change-notifier
 * for live updates and projects the commentary state for the slider
 * UI to render.
 *
 * See `docs/design/commentary-slider.md` (sections 4 + 7) for the
 * contract.
 *
 * Two modes:
 *   - `commit`     — slider snaps to every commit index
 *   - `commentary` — slider snaps to boundary range entry points
 *
 * Both modes share the same `commitIdx` state. Mode change is purely
 * cosmetic — the underlying time axis is the commit log.
 */

type CommentarySliderMode = 'commit' | 'commentary';
interface UseCommentarySliderResult {
    /** Current slider position on the commit-log axis. */
    readonly commitIdx: number;
    /** Current slider mode. */
    readonly mode: CommentarySliderMode;
    /** Total commit count for slider extent. */
    readonly totalCommits: number;
    /** Commentary snap points (commentary mode). Each is a range entry
     *  index. Empty array if mode is `commit` (every position is a snap). */
    readonly snapPoints: readonly number[];
    /** Commentary state at the current slider position. */
    readonly active: CommentaryAtCommit;
    /** All known ranges — UI may render them as chips on the slider track. */
    readonly ranges: readonly CommentaryRange[];
    /** Move slider to a specific commit index. Clamped to [0, totalCommits-1]. */
    setCommitIdx: (idx: number) => void;
    /** Switch between commit-by-commit and commentary-by-commentary modes. */
    setMode: (mode: CommentarySliderMode) => void;
    /** Drill into a specific commentary range — switches mode to `commit`
     *  and clamps subsequent slider movement to [range.startIdx, range.endIdx]. */
    drillInto: (range: CommentaryRange) => void;
    /** When drilled in, the range we're clamped to. Undefined otherwise. */
    readonly drillRange: CommentaryRange | undefined;
}
declare function useCommentarySlider(recorder: LensRecorder, initialMode?: CommentarySliderMode): UseCommentarySliderResult;

/**
 * useLensRenderGraph — React hook that turns an agentfootprint Runner
 * into a laid-out xyflow graph (`Node[]` + `Edge[]`).
 *
 * Layer 3.3 (React adapter) / Lens v0.1 translator pipeline.
 *
 * What it does
 * ────────────
 *
 *   Runner
 *     │ runner.getUIGroupWith(lensGroupTranslator)
 *     ▼
 *   LensGroupOutput
 *     │ layoutLensGraph (toReactFlow + defaultSize + dagre)
 *     ▼
 *   { nodes: Node[], edges: Edge[] }   (ready to drop into <ReactFlow>)
 *
 * Why a hook and not a useEffect/useState dance
 * ─────────────────────────────────────────────
 *   `runner.getUIGroup()` is memoised by the runner (see
 *   `agentfootprint/src/core/RunnerBase.ts:170` — uiGroupCache). The
 *   shape is build-time and stable across renders. We wrap the
 *   call in `useMemo` keyed on the runner identity so the laid-out
 *   graph is recomputed only when the runner reference changes —
 *   not on every render.
 *
 *   No useState, no useEffect, no subscription: build-time data is
 *   not reactive. Runtime updates (cursor position, step highlight,
 *   live status) belong to a SEPARATE hook that overlays the static
 *   graph — they don't reshape it.
 *
 * Error contract
 * ──────────────
 *   The hook throws (via the translator) when:
 *     - The runner does not expose a UI group shape
 *     - A nested member returns undefined from `getUIGroupWith`
 *     - A nested `member.uiGroup` is not a `LensGroupOutput`
 *
 *   Throws are loud — they make consumer wiring bugs visible at
 *   the first render. React's error boundary catches them; for
 *   v0.1 we expect every Lens-supported runner to translate
 *   cleanly so this is a development-time signal.
 */

/**
 * Like `LayoutLensGraphResult` but also surfaces the composition's
 * `rootNodeId`, which the React render layer needs to map engine-
 * level cursor positions (e.g., `seed#0`, `merge#21`) back to the
 * top-level chart node when no subflow path is present.
 */
interface UseLensRenderGraphResult extends LayoutLensGraphResult {
    readonly rootNodeId: string;
}
declare function useLensRenderGraph(runner: Runner, options?: LayoutLensGraphOptions): UseLensRenderGraphResult;

/**
 * useWindowedList — minimal fixed-row-height list windowing (backlog U3).
 *
 * Pattern: spacer-based virtualization. The consumer renders only rows
 * `[start, end)` inside its OWN scroll container, with two spacer divs
 * (`topPad` / `bottomPad` px tall) standing in for the off-screen rows —
 * the scrollbar geometry stays correct while the DOM holds ~one
 * viewport of rows instead of the full list.
 *
 * Why hand-rolled: the lens has NO virtualization dependency (deps are
 * dagre only; xyflow/react are peers) and U3's scope is "windowed
 * EventStream / virtualized tree" — a fixed-row windower is ~40 lines
 * and avoids a new dependency for v1. Swap in a measured-row library
 * later if variable-height windowing is ever needed.
 *
 * Threshold contract: below `threshold` rows the hook is a no-op
 * (`windowed: false`, full range, zero pads) so small runs render the
 * exact same DOM as before — windowing only engages where the full
 * render would actually degrade.
 *
 * Usage:
 * ```tsx
 * const w = useWindowedList({ count: rows.length, rowHeight: 24 });
 * <div style={{ maxHeight: 400, overflowY: 'auto' }} onScroll={w.onScroll}>
 *   {w.topPad > 0 && <div style={{ height: w.topPad }} />}
 *   {rows.slice(w.start, w.end).map(renderRow)}
 *   {w.bottomPad > 0 && <div style={{ height: w.bottomPad }} />}
 * </div>
 * ```
 *
 * Rows must be (close to) `rowHeight` px tall when windowing is active —
 * consumers typically pin `height: rowHeight` + ellipsis overflow on
 * windowed rows (acceptable for firehose/tree rows; full content stays
 * reachable via the row's detail/select affordance).
 */

interface UseWindowedListOptions {
    /** Total number of rows in the list. */
    readonly count: number;
    /** Fixed pixel height of one row (when windowing is active). */
    readonly rowHeight: number;
    /** Row count below which windowing stays OFF (render-all). Default 300. */
    readonly threshold?: number;
    /** Extra rows rendered above/below the viewport. Default 12. */
    readonly overscan?: number;
    /** Viewport height assumed before the first scroll event (the hook
     *  reads the real `clientHeight` on every scroll). Default 400. */
    readonly initialViewportHeight?: number;
}
interface UseWindowedListResult {
    /** True when the list is long enough that windowing engaged. */
    readonly windowed: boolean;
    /** First row index to render (inclusive). */
    readonly start: number;
    /** Last row index to render (exclusive). */
    readonly end: number;
    /** Height (px) of the spacer ABOVE the rendered rows. */
    readonly topPad: number;
    /** Height (px) of the spacer BELOW the rendered rows. */
    readonly bottomPad: number;
    /** Attach to the scroll container's `onScroll`. Stable identity. */
    readonly onScroll: React.UIEventHandler<HTMLElement>;
}
declare function useWindowedList({ count, rowHeight, threshold, overscan, initialViewportHeight, }: UseWindowedListOptions): UseWindowedListResult;

export { CommentaryAtCommit, CommentaryRange, type CommentarySliderMode, EventLogEntry, EventStream, Humanizer, LENS_NODE_TYPES, LayoutLensGraphOptions, LayoutLensGraphResult, Lens, LensChartBoundary, LensFlow, type LensFlowProps, type LensProps, LensRecorder, type LensView, Replay, type ReplayProps, RunSummary, RunTreeNode, RunTreeView, SKILL_GRAPH_START_ID, type SkillFlowEdge, type SkillFlowNode, type SkillGraphEdgeView, SkillGraphFlow, type SkillGraphFlowProps, type SkillGraphInput, type SkillGraphNodeView, type SkillGraphView, type SkillNodeDetail, type SkillRoutingPathStep, StepView, SummaryCard, TimeTravel, type TimeTravelProps, ToolChoicePanel, type ToolChoicePanelProps, type ToolChoiceSource, type UseCommentarySliderResult, type UseDrillPathResult, type UseStepFocusResult, type UseToolChoiceResult, type UseWindowedListOptions, type UseWindowedListResult, layoutSkillGraph, routingPathTo, useCommentarySlider, useDrillPath, useLensRecorder, useLensRenderGraph, useStepFocus, useStepView, useToolChoice, useWindowedList };
