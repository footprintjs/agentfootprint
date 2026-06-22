"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/selectors/selectAgentInstances.ts
function selectAgentInstances(graph) {
  const allBoundaries = graph.nodes.filter((n) => n.isPrimitiveBoundary === true);
  if (allBoundaries.length === 0) {
    const rootSubflow = graph.nodes.find((n) => n.kind === "subflow");
    const primitiveKind = rootSubflow?.primitiveKind;
    return [
      {
        groupId: "agent-root",
        llmId: "stage-llm-root",
        toolId: "stage-tool-root",
        label: primitiveKind ?? "Runner",
        subflowPath: [],
        ...primitiveKind ? { primitiveKind } : {}
      }
    ];
  }
  const boundaries = allBoundaries.filter(
    (b) => !allBoundaries.some(
      (other) => other !== b && isStrictDescendant(other.subflowPath, b.subflowPath)
    )
  );
  return boundaries.map((b) => ({
    groupId: `agent-group-${b.id}`,
    llmId: `stage-llm-${b.id}`,
    toolId: `stage-tool-${b.id}`,
    label: b.label,
    subflowPath: b.subflowPath,
    ...b.primitiveKind ? { primitiveKind: b.primitiveKind } : {}
  }));
}
function isStrictDescendant(child, parent) {
  if (child.length <= parent.length) return false;
  for (let i = 0; i < parent.length; i++) {
    if (child[i] !== parent[i]) return false;
  }
  return true;
}
var init_selectAgentInstances = __esm({
  "src/core/selectors/selectAgentInstances.ts"() {
    "use strict";
  }
});

// src/core/selectors/selectStepAgentName.ts
function cleanLabel(label) {
  return label.replace(/^step-/, "");
}
function selectStepAgentName(step, agents) {
  if (agents.length < 2) return void 0;
  const stepPath = step.subflowPath ?? [];
  if (stepPath.length === 0) return void 0;
  let best;
  let bestDepth = -1;
  for (const agent of agents) {
    const ap = agent.subflowPath;
    if (ap.length === 0) continue;
    if (!isPrefix(ap, stepPath)) continue;
    if (ap.length > bestDepth) {
      best = agent;
      bestDepth = ap.length;
    }
  }
  return best ? cleanLabel(best.label) : void 0;
}
function isPrefix(prefix, path) {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) return false;
  }
  return true;
}
var init_selectStepAgentName = __esm({
  "src/core/selectors/selectStepAgentName.ts"() {
    "use strict";
  }
});

// src/core/copyForLLM.ts
var copyForLLM_exports = {};
__export(copyForLLM_exports, {
  buildLLMText: () => buildLLMText
});
function buildLLMText(args) {
  const {
    recorder,
    stepGraph,
    boundaryRollups,
    humanizer,
    appName = "Chatbot",
    viewState
  } = args;
  const summary = recorder.selectSummary();
  const log = recorder.selectEventLog();
  const sections = [];
  sections.push("# Run Summary\n");
  sections.push(`- **Status:** ${summary.status}`);
  if (summary.durationMs !== void 0) {
    sections.push(`- **Duration:** ${formatMs(summary.durationMs)}`);
  }
  if (summary.llmCallCount > 0)
    sections.push(`- **LLM calls:** ${summary.llmCallCount}`);
  if (summary.toolCallCount > 0)
    sections.push(`- **Tool calls:** ${summary.toolCallCount}`);
  if (summary.iterationCount > 0)
    sections.push(`- **Iterations:** ${summary.iterationCount}`);
  if (summary.totalTokens.input > 0 || summary.totalTokens.output > 0) {
    sections.push(
      `- **Tokens:** ${summary.totalTokens.input} in / ${summary.totalTokens.output} out`
    );
  }
  if (summary.totalUsd !== void 0)
    sections.push(`- **Estimated cost:** $${summary.totalUsd.toFixed(4)}`);
  if (summary.permissionDenials > 0)
    sections.push(`- **Permission denials:** ${summary.permissionDenials}`);
  if (summary.paused) sections.push(`- **Paused:** yes`);
  if (viewState) {
    sections.push("\n# Current View State (at copy time)\n");
    if (viewState.focusStep !== void 0 && viewState.totalSteps !== void 0) {
      sections.push(
        `- **Slider position:** ${viewState.focusStep + 1} / ${viewState.totalSteps}`
      );
    }
    if (viewState.isLive !== void 0) {
      sections.push(
        `- **Live (auto-advancing):** ${viewState.isLive ? "yes" : "no"}`
      );
    }
    if (viewState.mode) sections.push(`- **Mode:** ${viewState.mode}`);
    if (viewState.drillPath && viewState.drillPath.length > 0) {
      sections.push(`- **Drill path:** ${viewState.drillPath.join(" / ")}`);
    }
    if (viewState.currentStep) {
      const cs = viewState.currentStep;
      const parts = [];
      if (cs.label) parts.push(cs.label);
      if (cs.kind) parts.push(`(\`${cs.kind}\`)`);
      if (cs.iterationIndex !== void 0)
        parts.push(`iter #${cs.iterationIndex}`);
      sections.push(`- **Current step:** ${parts.join(" ")}`);
      if (cs.runtimeStageId)
        sections.push(`  - runtimeStageId: \`${cs.runtimeStageId}\``);
      if (cs.subflowPath && cs.subflowPath.length > 1) {
        sections.push(
          `  - subflowPath: ${cs.subflowPath.slice(1).join(" \u2192 ")}`
        );
      }
    }
    if (viewState.visibleStepsCount !== void 0) {
      sections.push(`- **Visible steps:** ${viewState.visibleStepsCount}`);
    }
    if (viewState.focusedEventSeq !== void 0) {
      sections.push(`- **Focused event seq:** ${viewState.focusedEventSeq}`);
    }
    if (viewState.touched && viewState.touched.length > 0) {
      sections.push(`- **Touched actors:** ${viewState.touched.join(", ")}`);
    }
    if (viewState.activeEdgeKey) {
      sections.push(`- **Active edge:** \`${viewState.activeEdgeKey}\``);
    }
  }
  if (boundaryRollups && boundaryRollups.length > 0) {
    sections.push("\n# Per-Boundary Rollups\n");
    for (const r of boundaryRollups) {
      const kind = r.primitiveKind ?? "Boundary";
      sections.push(`## ${r.label} (${kind}) \u2014 \`${r.runtimeStageId}\``);
      if (r.tokens.input > 0 || r.tokens.output > 0) {
        sections.push(
          `- Tokens: ${r.tokens.input} in / ${r.tokens.output} out`
        );
      }
      const counters = [];
      if (r.llmCalls > 0) counters.push(`LLM calls: ${r.llmCalls}`);
      if (r.toolCalls > 0) counters.push(`Tool calls: ${r.toolCalls}`);
      if (r.iterations > 0) counters.push(`Iterations: ${r.iterations}`);
      if (counters.length > 0) sections.push(`- ${counters.join(" \xB7 ")}`);
      sections.push(
        `- Duration: ${r.durationMs !== void 0 ? formatMs(r.durationMs) : "(in flight)"}`
      );
      sections.push("");
    }
  }
  if (stepGraph && stepGraph.nodes.length > 0) {
    sections.push("\n# Steps\n");
    const agents = selectAgentInstances(stepGraph);
    stepGraph.nodes.forEach((n, i) => {
      sections.push(formatStep(i + 1, n, agents));
    });
  }
  if (log.length > 0) {
    sections.push("\n# Commentary\n");
    sections.push("```");
    for (const entry of log) {
      const line = humanizer ? humanizer(entry.event) : `[${entry.event.type}]`;
      if (line === null) continue;
      const t = `+${Math.round(entry.runOffsetMs)}ms`.padEnd(10);
      sections.push(`${t} ${line.replace(/\{\{appName\}\}/g, appName)}`);
    }
    sections.push("```");
  }
  if (log.length > 0) {
    sections.push("\n# Event Trace (debug \u2014 first 30 events)\n");
    sections.push(
      "Diagnostic: per-event `meta.subflowPath` so a reviewer can verify what `extractAgentName` actually saw. If commentary shows `Chatbot` instead of the agent name, this section tells you whether the event's subflowPath reached the humanizer at all.\n"
    );
    sections.push("```");
    const head = log.slice(0, 30);
    for (const entry of head) {
      const meta = entry.event.meta ?? {};
      const path = Array.isArray(meta.subflowPath) ? meta.subflowPath : "?";
      const rid = meta.runtimeStageId ?? "?";
      sections.push(
        `[${entry.seq}] ${entry.event.type}  rid=${rid}  subflowPath=${JSON.stringify(path)}`
      );
    }
    sections.push("```");
  }
  return sections.join("\n");
}
function compactBoundaryPayload(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return value;
  const out = {};
  for (const [k, v2] of Object.entries(value)) {
    if (LIBRARY_INTERNAL_FIELDS.has(k)) continue;
    out[k] = v2;
  }
  return out;
}
function formatStep(index, n, agents) {
  const lines = [];
  const headerSuffix = n.iterationIndex !== void 0 ? ` (iter ${n.iterationIndex})` : "";
  const kindLabel = formatKindLabel(n);
  const agentName = selectStepAgentName(n, agents);
  const headerLabel = agentName ? `${agentName} \xB7 ${n.label}` : n.label;
  lines.push(`## ${index}. ${headerLabel} \u2014 ${kindLabel}${headerSuffix}`);
  if (n.runtimeStageId) lines.push(`runtimeStageId: \`${n.runtimeStageId}\``);
  if (n.subflowPath.length > 1) {
    lines.push(`Path: ${n.subflowPath.slice(1).join(" \u2192 ")}`);
  }
  const dur = duration(n);
  if (dur !== void 0 && dur > 0) lines.push(`Duration: ${formatMs(dur)}`);
  if (n.tokens) lines.push(`Tokens: ${n.tokens.in} in / ${n.tokens.out} out`);
  if (n.llmModel) lines.push(`Model: ${n.llmModel}`);
  if (n.toolName) lines.push(`Tool: \`${n.toolName}\``);
  if (n.slotUpdated) lines.push(`Slot updated: \`${n.slotUpdated}\``);
  if (n.entryPayload !== void 0) {
    lines.push("\n**Boundary input** (inputMapper result):");
    lines.push("```json");
    lines.push(safeJson(compactBoundaryPayload(n.entryPayload)));
    lines.push("```");
  }
  if (n.exitPayload !== void 0) {
    lines.push("\n**Boundary output** (outputMapper result):");
    lines.push("```json");
    lines.push(safeJson(compactBoundaryPayload(n.exitPayload)));
    lines.push("```");
  }
  if (n.assistantText) {
    const heading = n.kind === "llm->user" ? "Final answer" : "LLM's reasoning";
    lines.push(`
**${heading}:**`);
    lines.push("```");
    lines.push(n.assistantText);
    lines.push("```");
  }
  if (n.toolArgs !== void 0) {
    lines.push("\n**Tool input (args):**");
    lines.push("```json");
    lines.push(safeJson(n.toolArgs));
    lines.push("```");
  }
  if (n.toolResult !== void 0) {
    lines.push("\n**Tool result sent to LLM:**");
    lines.push("```json");
    lines.push(safeJson(n.toolResult));
    lines.push("```");
  }
  if (n.injections && n.injections.length > 0) {
    lines.push("\n**Context injections:**");
    for (const inj of n.injections) {
      const id = inj.sourceId ? `:${inj.sourceId}` : "";
      const role = inj.asRole ? ` (as ${inj.asRole})` : "";
      const summary = inj.contentSummary ? ` \u2014 ${inj.contentSummary}` : "";
      lines.push(`- [${inj.slot}] ${inj.source}${id}${role}${summary}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
function formatKindLabel(n) {
  switch (n.kind) {
    case "subflow":
      return n.primitiveKind ? `${n.primitiveKind} boundary` : "subflow boundary";
    case "user->llm":
      return "user \u2192 llm";
    case "llm->tool":
      return "llm \u2192 tool";
    case "tool->llm":
      return "tool \u2192 llm";
    case "llm->user":
      return "llm \u2192 user (final answer)";
    case "fork-branch":
      return "parallel branch";
    case "decision-branch":
      return "decision branch";
    default:
      return n.kind;
  }
}
function duration(n) {
  if (typeof n.startOffsetMs === "number" && typeof n.endOffsetMs === "number") {
    return n.endOffsetMs - n.startOffsetMs;
  }
  return void 0;
}
function formatMs(ms) {
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  if (ms < 1e4) return `${(ms / 1e3).toFixed(1)}s`;
  return `${(ms / 1e3).toFixed(1)}s`;
}
function safeJson(value) {
  try {
    const s = JSON.stringify(value, null, 2);
    if (s.length > 4e3) {
      return s.slice(0, 4e3) + `
... (truncated; ${s.length - 4e3} chars)`;
    }
    return s;
  } catch {
    return String(value);
  }
}
var LIBRARY_INTERNAL_FIELDS;
var init_copyForLLM = __esm({
  "src/core/copyForLLM.ts"() {
    "use strict";
    init_selectAgentInstances();
    init_selectStepAgentName();
    LIBRARY_INTERNAL_FIELDS = /* @__PURE__ */ new Set([
      "systemPromptInjections",
      "messagesInjections",
      "toolsInjections",
      "cumTokensInput",
      "cumTokensOutput",
      "cumEstimatedUsd",
      "costBudgetHit",
      "iteration"
    ]);
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  BASELINE_SOURCES: () => BASELINE_SOURCES,
  ChangeNotifier: () => ChangeNotifier,
  DEFAULT_MAX_EVENTS: () => DEFAULT_MAX_EVENTS,
  EventStream: () => EventStream,
  LENS_NODE_TYPES: () => LENS_NODE_TYPES,
  Lens: () => Lens,
  LensChartBoundary: () => LensChartBoundary,
  LensFlow: () => LensFlow,
  LensRecorder: () => LensRecorder,
  LensSnapshotRecorder: () => LensSnapshotRecorder,
  Replay: () => Replay,
  RunTreeView: () => RunTreeView,
  SKILL_GRAPH_START_ID: () => SKILL_GRAPH_START_ID,
  SkillGraphFlow: () => SkillGraphFlow,
  SummaryCard: () => SummaryCard,
  TimeTravel: () => TimeTravel,
  ToolChoicePanel: () => ToolChoicePanel,
  buildLLMText: () => buildLLMText,
  buildSpecTreeFromBoundary: () => buildSpecTreeFromBoundary,
  buildStepGraphFromSnapshot: () => buildStepGraphFromSnapshot,
  defaultHumanizer: () => defaultHumanizer,
  defaultSize: () => defaultSize,
  humanizeWith: () => humanizeWith,
  isContextEngineering: () => isContextEngineering,
  layoutLensGraph: () => layoutLensGraph,
  layoutSkillGraph: () => layoutSkillGraph,
  lensGroupTranslator: () => lensGroupTranslator,
  lensRecorder: () => lensRecorder,
  lensSnapshotRecorder: () => lensSnapshotRecorder,
  makeChildNodeId: () => makeChildNodeId,
  makeEdge: () => makeEdge,
  makeRootNodeId: () => makeRootNodeId,
  mergeOutputs: () => mergeOutputs,
  pinUnderParent: () => pinUnderParent,
  routingPathTo: () => routingPathTo,
  selectAgentInstances: () => selectAgentInstances,
  selectCommentaryAt: () => selectCommentaryAt,
  selectCommentaryRanges: () => selectCommentaryRanges,
  selectContextEngineeringInjections: () => selectContextEngineeringInjections,
  selectEdges: () => selectEdges,
  selectFocusDetail: () => selectFocusDetail,
  selectHops: () => selectHops,
  selectStepAgentName: () => selectStepAgentName,
  selectStepView: () => selectStepView,
  selectToolChoiceCall: () => selectToolChoiceCall,
  selectTouched: () => selectTouched,
  stepEdgeLabel: () => stepEdgeLabel,
  stepToStageEndpoints: () => stepToStageEndpoints,
  structureGraphFromRunner: () => structureGraphFromRunner,
  structureGraphFromSpec: () => structureGraphFromSpec,
  teachingHumanizer: () => teachingHumanizer,
  toReactFlow: () => toReactFlow,
  translateAgent: () => translateAgent,
  translateConditional: () => translateConditional,
  translateLLMCall: () => translateLLMCall,
  translateLoop: () => translateLoop,
  translateParallel: () => translateParallel,
  translateSequence: () => translateSequence,
  useCommentarySlider: () => useCommentarySlider,
  useDrillPath: () => useDrillPath,
  useLensRecorder: () => useLensRecorder,
  useLensRenderGraph: () => useLensRenderGraph,
  useStepFocus: () => useStepFocus,
  useStepView: () => useStepView,
  useToolChoice: () => useToolChoice,
  useWindowedList: () => useWindowedList
});
module.exports = __toCommonJS(src_exports);

// src/core/LensRecorder.ts
var import_footprintjs = require("footprintjs");
var import_trace = require("footprintjs/trace");
var import_agentfootprint = require("agentfootprint");
var import_observe = require("agentfootprint/observe");
var import_flowchart = require("footprint-explainable-ui/flowchart");

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
var DEFAULT_MAX_EVENTS = 5e4;
var KNOWN_EVENT_TYPES = new Set(import_agentfootprint.ALL_EVENT_TYPES);
var LensRecorder = class {
  constructor(rootLabel = "Run", options = {}) {
    /** Stable id for idempotent attach. */
    this.id = "lens";
    /** Composition: ordered + keyed event-log storage. */
    this.store = new import_trace.SequenceStore();
    this.stack = [];
    this.seqCounter = 0;
    this.unsubscribes = [];
    this.finalStatus = "running";
    /** Live transient state of the in-flight run. Subscribed in `observe()`,
     *  cleared/disposed on `detach()`. Lens reads `liveState.isLLMInFlight()`
     *  / `getPartialLLM()` / etc. for O(1) live commentary, instead of
     *  folding the event log every render. */
    this.liveState = new import_observe.LiveStateRecorder();
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
    this.boundary = new import_observe.BoundaryRecorder({
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
    this.runtime = (0, import_flowchart.createTraceRuntimeOverlay)({
      id: "lens-runtime-overlay"
    });
    /**
     * Change-notification primitive composed in. Push-based refresh for
     * React (useSyncExternalStore), Vue (refs), Angular (signals),
     * Recoil (atoms), CLI/DOM consumers — all subscribe to the SAME
     * notifier. See `ChangeNotifier` JSDoc for adapter examples.
     */
    this.notifier = new ChangeNotifier();
    /** Per-type count of events outside the agentfootprint registry.
     *  Always maintained (debug only gates console output). */
    this.unknownEventTypes = /* @__PURE__ */ new Map();
    /** Count of `popIfKind` bracket mismatches. Always maintained. */
    this.bracketMismatchCount = 0;
    /** Unknown types already warned about — warn ONCE per type, not per
     *  event, so a chatty unknown emitter can't flood the console. */
    this.warnedUnknownTypes = /* @__PURE__ */ new Set();
    /** Entries evicted by the cap so far. Surfaced via `getDiagnostics()`. */
    this.droppedEventCount = 0;
    /** Eviction already warned about — warn ONCE per run, not per batch. */
    this.warnedEviction = false;
    this.debug = options.debug;
    const cap = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    if (cap !== Number.POSITIVE_INFINITY && (!Number.isInteger(cap) || cap < 1)) {
      throw new RangeError(
        `LensRecorder: maxEvents must be a positive integer or Infinity, got ${cap}`
      );
    }
    this.maxEvents = cap;
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
    this.unknownEventTypes.clear();
    this.bracketMismatchCount = 0;
    this.warnedUnknownTypes.clear();
    this.droppedEventCount = 0;
    this.warnedEviction = false;
    this.liveState.clear();
    this.boundary.clear();
    this.runtime.reset();
    this.bumpVersion();
  }
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
  getDiagnostics() {
    return {
      unknownEventTypes: Object.fromEntries(this.unknownEventTypes),
      bracketMismatches: this.bracketMismatchCount,
      droppedEvents: this.droppedEventCount
    };
  }
  /** Whether diagnostic warnings go to the console: explicit option
   *  wins; otherwise follow footprintjs's global dev-mode flag
   *  (evaluated per event so `enableDevMode()` mid-run takes effect). */
  debugEnabled() {
    return this.debug ?? (0, import_footprintjs.isDevMode)();
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
    this.noteUnknownType(event.type);
    this.dispatch(event, runOffsetMs, entry);
    this.enforceCap();
    this.bumpVersion();
  }
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
  enforceCap() {
    if (this.store.size <= this.maxEvents) return;
    const all = this.store.getAll();
    const evictBatch = Math.max(1, Math.floor(this.maxEvents / 10));
    const retainCount = Math.max(1, this.maxEvents - evictBatch);
    const dropCount = all.length - retainCount;
    const retained = all.slice(dropCount);
    this.store.clear();
    for (const e of retained) this.store.push(e);
    this.droppedEventCount += dropCount;
    this.pruneNodeEvents(this.root, retained[0].seq);
    if (this.debugEnabled() && !this.warnedEviction) {
      this.warnedEviction = true;
      console.warn(
        `[lens] LensRecorder: maxEvents cap (${this.maxEvents}) reached \u2014 evicting oldest events (FIFO, ~10% per batch). Log-derived views now cover only the retained tail; evicted total in getDiagnostics().droppedEvents. Raise the cap via lensRecorder('Run', { maxEvents }) or pass Infinity to disable. (Warned once.)`
      );
    }
  }
  /** Drop entries with `seq < minSeq` from a node's `events` list (and
   *  its descendants'). Per-node lists are seq-ordered, so this is a
   *  prefix splice — in place, preserving the node object identity the
   *  build stack may still hold. */
  pruneNodeEvents(node, minSeq) {
    if (node.events.length > 0 && node.events[0].seq < minSeq) {
      let keepFrom = 0;
      while (keepFrom < node.events.length && node.events[keepFrom].seq < minSeq) keepFrom++;
      node.events.splice(0, keepFrom);
    }
    for (const child of node.children) this.pruneNodeEvents(child, minSeq);
  }
  /** Notify all subscribers + bump version. Delegated to ChangeNotifier. */
  bumpVersion() {
    this.notifier.notify();
  }
  /**
   * U4 diagnostics — count (and, in debug, warn ONCE per type about)
   * event types outside agentfootprint's registry. One Set lookup per
   * event on the happy path.
   */
  noteUnknownType(type) {
    if (KNOWN_EVENT_TYPES.has(type)) return;
    this.unknownEventTypes.set(type, (this.unknownEventTypes.get(type) ?? 0) + 1);
    if (this.debugEnabled() && !this.warnedUnknownTypes.has(type)) {
      this.warnedUnknownTypes.add(type);
      console.warn(
        `[lens] LensRecorder: unknown event type '${type}' \u2014 not in agentfootprint's event registry. Attached to the current node without structural handling. (Warned once per type; counts in getDiagnostics().unknownEventTypes.)`
      );
    }
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
      this.popIfKind(
        "composition",
        {
          endOffsetMs: runOffsetMs,
          status: p.status === "ok" ? "ok" : p.status === "budget_exhausted" ? "budget_exhausted" : "err"
        },
        entry.runtimeStageId
      );
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
      this.popIfKind(
        "iteration",
        {
          endOffsetMs: runOffsetMs,
          status: p.reason === "budget" ? "budget_exhausted" : "ok",
          iterationExit: p.reason
        },
        entry.runtimeStageId
      );
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
      this.popIfKind("iteration", { endOffsetMs: runOffsetMs, status: "ok" }, entry.runtimeStageId);
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
      this.popIfKind("iteration", { endOffsetMs: runOffsetMs, status: "ok" }, entry.runtimeStageId);
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
      this.popIfKind(
        "llm-call",
        {
          endOffsetMs: runOffsetMs,
          status: "ok",
          llmEnd: {
            content: p.content,
            toolCallCount: p.toolCallCount,
            usage: p.usage,
            stopReason: p.stopReason
          }
        },
        entry.runtimeStageId
      );
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
      this.popIfKind(
        "tool-call",
        {
          endOffsetMs: runOffsetMs,
          status: p.error === true ? "err" : "ok",
          toolEnd: { result: p.result, error: p.error ?? false }
        },
        entry.runtimeStageId
      );
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
   * Mismatched kinds (indicating malformed event ordering) are SKIPPED,
   * never thrown — Lens prefers partial correctness to crashes. Every
   * mismatch increments `getDiagnostics().bracketMismatches` (U4), and
   * when debug is on (`LensRecorderOptions.debug` or footprintjs
   * `isDevMode()`) each mismatch logs a `console.warn` with the
   * expected vs found kind plus the closing event's `runtimeStageId`.
   * Well-formed runs stay console-silent either way.
   */
  popIfKind(kind, finalize, runtimeStageId) {
    const top = this.top();
    if (top.kind !== kind) {
      this.bracketMismatchCount += 1;
      if (this.debugEnabled()) {
        console.warn(
          `[lens] LensRecorder: bracket mismatch \u2014 tried to close a '${kind}' node but the top of the stack is '${top.kind}'` + (runtimeStageId !== void 0 ? ` (runtimeStageId: ${runtimeStageId})` : "") + `. Close event skipped; the tree stays partially structured.`
        );
      }
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
   *  discriminated union.
   *
   *  U3 caveat: once the `maxEvents` cap has evicted entries
   *  (`getDiagnostics().droppedEvents > 0`), the folded counts/tokens
   *  reflect only RETAINED events. `startedAt` / `durationMs` stay
   *  anchored to the true first event of the run (tracked outside the
   *  store), so the time axis never shifts. */
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
    const startedAt = this.runStartMs ?? entries[0]?.wallClockMs ?? 0;
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
function lensRecorder(rootLabel, options) {
  return new LensRecorder(rootLabel, options);
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
var import_agentfootprint2 = require("agentfootprint");
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
  const templates = options.commentaryTemplates ? { ...import_agentfootprint2.defaultCommentaryTemplates, ...options.commentaryTemplates } : import_agentfootprint2.defaultCommentaryTemplates;
  const ctx = { appName, getToolDescription };
  return (event) => {
    const key = (0, import_agentfootprint2.selectCommentaryKey)(event);
    if (key === null) return null;
    if (key === void 0) return defaultHumanizer(event);
    const template = templates[key];
    if (template === void 0) return defaultHumanizer(event);
    const vars = (0, import_agentfootprint2.extractCommentaryVars)(event, ctx, templates);
    return (0, import_agentfootprint2.renderCommentary)(template, vars);
  };
}
var teachingHumanizer = makeTeachingHumanizer();

// src/core/selectors/index.ts
init_selectAgentInstances();

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

// src/core/selectors/index.ts
init_selectStepAgentName();

// src/core/selectors/selectStepView.ts
init_selectAgentInstances();
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

// src/core/selectors/selectToolChoiceCall.ts
function execIndex(runtimeStageId) {
  const hash = runtimeStageId.lastIndexOf("#");
  if (hash < 0) return void 0;
  const n = Number(runtimeStageId.slice(hash + 1));
  return Number.isInteger(n) && n >= 0 ? n : void 0;
}
function selectToolChoiceCall(calls, cursorRuntimeStageId, cursorKind) {
  if (calls.length === 0) return void 0;
  const last = calls[calls.length - 1];
  if (cursorKind === "user-in") return void 0;
  if (cursorKind === "user-out") return last;
  if (!cursorRuntimeStageId) return last;
  const base = cursorRuntimeStageId.split("#")[0];
  if (base === "__root__") {
    return cursorKind === "group-start" ? void 0 : last;
  }
  const exact = calls.find((c) => c.runtimeStageId === cursorRuntimeStageId);
  if (exact) return exact;
  const cursorIdx = execIndex(cursorRuntimeStageId);
  if (cursorIdx === void 0) return void 0;
  const prefix = `${base}/`;
  let within;
  let withinIdx = Infinity;
  let prev;
  let prevIdx = -1;
  for (const c of calls) {
    const idx = execIndex(c.runtimeStageId);
    if (idx === void 0) continue;
    if (c.runtimeStageId.startsWith(prefix) && idx > cursorIdx && idx < withinIdx) {
      within = c;
      withinIdx = idx;
    }
    if (idx <= cursorIdx && idx > prevIdx) {
      prev = c;
      prevIdx = idx;
    }
  }
  return within ?? prev;
}

// src/core/index.ts
init_copyForLLM();

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
var import_footprintjs2 = require("footprintjs");
function mergeOutputs(outputs, rootNodeId) {
  const nodes = [];
  const edges = [];
  for (const o of outputs) {
    for (const n of o.nodes) nodes.push(n);
    for (const e of o.edges) edges.push(e);
  }
  if ((0, import_footprintjs2.isDevMode)()) assertNoCollisions(nodes, edges);
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
  const v2 = value;
  return Array.isArray(v2.nodes) && Array.isArray(v2.edges) && typeof v2.rootNodeId === "string";
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
var import_trace2 = require("footprintjs/trace");
var import_flowchart2 = require("footprint-explainable-ui/flowchart");
var import_agentfootprint3 = require("agentfootprint");
function emphasisForRole(role) {
  if (role === "hero-slot" || role === "hero-llm" || role === "hero-action")
    return "hero";
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
  return structureGraphFromSpec(runner.getSpec().buildTimeStructure);
}
function structureGraphFromSpec(buildTimeStructure) {
  const trace = (0, import_flowchart2.createTraceStructureRecorder)();
  const recorder = trace.recorder;
  const spec = buildTimeStructure;
  const subflowSpecs = [];
  for (const item of (0, import_trace2.walkSubflowSpec)(spec, "", { recurse: false })) {
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
  const seenNodes = new Set(baseGraph.nodes.map((n) => n.id));
  const seenEdges = new Set(baseGraph.edges.map((e) => e.id));
  const nodes = [
    ...baseGraph.nodes,
    ...internal.nodes.filter((n) => !seenNodes.has(n.id))
  ];
  const edges = [
    ...baseGraph.edges,
    ...internal.edges.filter((e) => !seenEdges.has(e.id))
  ];
  for (const node of nodes) {
    const role = (0, import_agentfootprint3.stageRole)(node.id);
    const data = node.data;
    const { localStageId } = (0, import_trace2.splitStageId)(node.id);
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
    const subTrace = (0, import_flowchart2.createTraceStructureRecorder)();
    const subRec = subTrace.recorder;
    for (const item of (0, import_trace2.walkSubflowSpec)(spec, path, { recurse: false })) {
      switch (item.kind) {
        case "stage":
          subRec.onStageAdded?.({
            stageId: item.stageId,
            name: item.name,
            type: item.type,
            ...item.isPausable !== void 0 && {
              isPausable: item.isPausable
            },
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
      nodes.push({
        ...n,
        id: q(n.id),
        data: { ...n.data, subflowOf: subflowId }
      });
    }
    for (const e of sub.edges) {
      edges.push({
        ...e,
        id: `${q(e.source)}->${q(e.target)}`,
        source: q(e.source),
        target: q(e.target)
      });
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
var import_dagre = __toESM(require("dagre"), 1);
function dagreLayout(sized, edges, options = {}) {
  const direction = options.direction ?? "TB";
  const rankSep = options.rankSep ?? 80;
  const nodeSep = options.nodeSep ?? 60;
  const edgeSep = options.edgeSep ?? 20;
  const g = new import_dagre.default.graphlib.Graph({ compound: true });
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
  import_dagre.default.layout(g);
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

// src/react/Lens.tsx
var import_react12 = __toESM(require("react"), 1);
var import_agentfootprint5 = require("agentfootprint");
var import_flowchart5 = require("footprint-explainable-ui/flowchart");

// src/react/lensNodeTypes.ts
var import_flowchart3 = require("footprint-explainable-ui/flowchart");
var LENS_NODE_TYPES = {
  slotPill: import_flowchart3.SlotPillNode,
  groupContainer: import_flowchart3.GroupContainerNode
};

// src/react/LensChartBoundary.tsx
var import_react = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
var LensChartBoundary = class extends import_react.default.Component {
  constructor() {
    super(...arguments);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 24, color: "#b45309", fontSize: 12, lineHeight: 1.5 }, children: [
        "The composition chart couldn\u2019t render (",
        this.state.error.message,
        "). The rest of the monitor (timeline, commentary, details) is unaffected."
      ] });
    }
    return this.props.children;
  }
};

// src/react/LensFlow.tsx
var import_react2 = require("react");
var import_react3 = require("@xyflow/react");
var import_style = require("@xyflow/react/dist/style.css");
var import_flowchart4 = require("footprint-explainable-ui/flowchart");
var import_jsx_runtime2 = require("react/jsx-runtime");
var LensFlow = ({
  chart,
  nodeTypes,
  selectedRuntimeStageId,
  selectedCursorKind,
  onNodeClick,
  showControls = true,
  showBackground = true,
  traceRuntimeOverlay,
  coActiveStageIds
}) => {
  const scrubIndex = (0, import_react2.useMemo)(() => {
    if (!selectedRuntimeStageId || !traceRuntimeOverlay) return void 0;
    if (selectedRuntimeStageId.startsWith("__root__")) {
      if (selectedCursorKind === "group-start") return -1;
      if (selectedCursorKind === "group-end") {
        return Math.max(0, traceRuntimeOverlay.executionOrder.length - 1);
      }
      return void 0;
    }
    const idx = traceRuntimeOverlay.executionOrder.findIndex(
      (s) => s.runtimeStageId === selectedRuntimeStageId
    );
    return idx >= 0 ? idx : void 0;
  }, [selectedRuntimeStageId, selectedCursorKind, traceRuntimeOverlay]);
  const mergedNodeTypes = (0, import_react2.useMemo)(
    () => nodeTypes ? { ...chart.nodeTypes ?? {}, ...nodeTypes } : chart.nodeTypes,
    [nodeTypes, chart.nodeTypes]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    import_flowchart4.TracedFlow,
    {
      graph: chart.graph,
      layout: chart.layout,
      ...traceRuntimeOverlay && { overlay: traceRuntimeOverlay },
      ...scrubIndex !== void 0 && { scrubIndex },
      ...onNodeClick && { onNodeClick },
      ...coActiveStageIds && coActiveStageIds.size > 0 && { coActiveStageIds },
      ...mergedNodeTypes && { nodeTypes: mergedNodeTypes },
      children: [
        showBackground && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_react3.Background, {}),
        showControls && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_react3.Controls, {})
      ]
    }
  );
};

// src/react/theme/tokens.ts
var RAW_DEFAULTS = {
  // Surfaces
  bgPrimary: "#0f172a",
  bgSecondary: "#1e293b",
  bgTertiary: "#334155",
  bgElevated: "#1e293b",
  // Text
  textPrimary: "#f8fafc",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  // Border
  border: "#334155",
  // Accent / state
  primary: "#6366f1",
  success: "#22c55e",
  error: "#ef4444",
  warning: "#f59e0b",
  // Edge kinds (control-flow graph)
  edgeUser: "#0284c7",
  edgeTool: "#059669",
  edgeDecision: "#db2777",
  // Injection-source chips
  srcRag: "#0284c7",
  srcSkill: "#7c3aed",
  srcMemory: "#ca8a04",
  srcInstruction: "#db2777",
  srcUser: "#059669",
  srcTool: "#0891b2",
  srcDefault: "#64748b",
  // Typography
  fontSans: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  fontMono: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace"
};
function v(name, fallback) {
  return `var(--lens-${name}, var(--fp-${name}, ${fallback}))`;
}
var T = {
  // Surfaces
  bgPrimary: v("bg-primary", RAW_DEFAULTS.bgPrimary),
  bgSecondary: v("bg-secondary", RAW_DEFAULTS.bgSecondary),
  bgTertiary: v("bg-tertiary", RAW_DEFAULTS.bgTertiary),
  bgElevated: v("bg-elevated", RAW_DEFAULTS.bgElevated),
  // Text
  textPrimary: v("text-primary", RAW_DEFAULTS.textPrimary),
  textSecondary: v("text-secondary", RAW_DEFAULTS.textSecondary),
  textMuted: v("text-muted", RAW_DEFAULTS.textMuted),
  // Border
  border: v("border", RAW_DEFAULTS.border),
  // Accent / state
  primary: v("color-primary", RAW_DEFAULTS.primary),
  success: v("color-success", RAW_DEFAULTS.success),
  error: v("color-error", RAW_DEFAULTS.error),
  warning: v("color-warning", RAW_DEFAULTS.warning),
  // Edge kinds (no `--fp-` cousin — lens-only)
  edgeUser: `var(--lens-edge-user, ${RAW_DEFAULTS.edgeUser})`,
  edgeTool: `var(--lens-edge-tool, ${RAW_DEFAULTS.edgeTool})`,
  edgeDecision: `var(--lens-edge-decision, ${RAW_DEFAULTS.edgeDecision})`,
  edgeDefault: `var(--lens-edge-default, ${RAW_DEFAULTS.textMuted})`,
  // Injection-source chips (lens-only)
  srcRag: `var(--lens-src-rag, ${RAW_DEFAULTS.srcRag})`,
  srcSkill: `var(--lens-src-skill, ${RAW_DEFAULTS.srcSkill})`,
  srcMemory: `var(--lens-src-memory, ${RAW_DEFAULTS.srcMemory})`,
  srcInstruction: `var(--lens-src-instruction, ${RAW_DEFAULTS.srcInstruction})`,
  srcUser: `var(--lens-src-user, ${RAW_DEFAULTS.srcUser})`,
  srcTool: `var(--lens-src-tool, ${RAW_DEFAULTS.srcTool})`,
  srcDefault: `var(--lens-src-default, ${RAW_DEFAULTS.srcDefault})`,
  // Typography
  fontSans: v("font-sans", RAW_DEFAULTS.fontSans),
  fontMono: v("font-mono", RAW_DEFAULTS.fontMono)
};

// src/react/SummaryCard.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function statusLabel(s) {
  switch (s) {
    case "ok":
      return "OK";
    case "err":
      return "Error";
    case "paused":
      return "Paused";
    case "running":
      return "Running";
    case "budget_exhausted":
      return "Budget exhausted";
    default:
      return s;
  }
}
function statusColor(s) {
  if (s === "err") return T.error;
  if (s === "paused" || s === "budget_exhausted") return T.warning;
  return void 0;
}
function formatCost(usd) {
  return `$${usd.toFixed(usd > 0 && usd < 1e-4 ? 6 : 4)}`;
}
var SummaryCard = ({ summary }) => {
  const throughput = summary.durationMs !== void 0 && summary.durationMs > 0 ? Math.round(summary.totalTokens.output / (summary.durationMs / 1e3)) : void 0;
  const items = [
    { label: "Status", value: statusLabel(summary.status), color: statusColor(summary.status) },
    { label: "Latency", value: summary.durationMs !== void 0 ? `${summary.durationMs}ms` : "\u2014" },
    { label: "LLM calls", value: String(summary.llmCallCount) },
    { label: "Tool calls", value: String(summary.toolCallCount) },
    { label: "Tokens in", value: summary.totalTokens.input.toLocaleString() },
    { label: "Tokens out", value: summary.totalTokens.output.toLocaleString() },
    ...summary.totalUsd !== void 0 ? [{ label: "Cost", value: formatCost(summary.totalUsd) }] : [],
    ...throughput !== void 0 ? [{ label: "Throughput", value: `${throughput} tok/s` }] : [],
    ...summary.permissionDenials > 0 ? [{ label: "Denials", value: String(summary.permissionDenials) }] : []
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "div",
    {
      style: {
        // Compact single row of stats. `auto-fit minmax(78px…)` packs all the
        // metrics onto ONE line in the wide monitor (was wrapping to two with the
        // old 120px min) while still wrapping gracefully in a narrow panel.
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
        gap: "8px 12px",
        padding: "10px 14px",
        background: T.bgElevated,
        border: `1px solid ${T.border}`,
        borderRadius: 6,
        fontFamily: T.fontSans
      },
      children: items.map(({ label, value, color }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { minWidth: 0 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }, children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 14, fontWeight: color ? 700 : 500, color: color ?? T.textPrimary, whiteSpace: "nowrap" }, children: value })
      ] }, label))
    }
  );
};

// src/react/TimeTravel.tsx
var import_react4 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var TimeTravel = ({
  total,
  focusSeq,
  onFocusChange,
  isLive,
  compact
}) => {
  const max = Math.max(0, total - 1);
  const step = (delta) => {
    onFocusChange(Math.min(max, Math.max(0, focusSeq + delta)));
  };
  (0, import_react4.useEffect)(() => {
    const onKey = (e) => {
      const target = e.target;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "Home") {
        e.preventDefault();
        onFocusChange(0);
      } else if (e.key === "End") {
        e.preventDefault();
        onFocusChange(max);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSeq, max]);
  const disabled = total <= 1;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        margin: "4px 0",
        background: `color-mix(in srgb, ${T.bgElevated} 70%, transparent)`,
        backdropFilter: "blur(10px) saturate(140%)",
        WebkitBackdropFilter: "blur(10px) saturate(140%)",
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        fontFamily: T.fontSans,
        fontSize: 12,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            onClick: () => step(-1),
            disabled: focusSeq <= 0 || disabled,
            style: btnStyle(false),
            title: "Previous event (\u2190)",
            "aria-label": "Previous event",
            children: "\u25C0"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            onClick: () => step(1),
            disabled: focusSeq >= max || disabled,
            style: btnStyle(false),
            title: "Next event (\u2192)",
            "aria-label": "Next event",
            children: "\u25B6"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            onClick: () => onFocusChange(max),
            disabled: isLive || disabled,
            style: btnStyle(!isLive && total > 0),
            title: "Jump to latest event (End)",
            "aria-label": "Jump to latest",
            children: isLive ? "\u25CF Live" : "\u27F3 Live"
          }
        ),
        compact ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { flex: 1 } }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { flex: 1, position: "relative", display: "flex", alignItems: "center" }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            type: "range",
            min: 0,
            max,
            value: Math.min(focusSeq, max),
            onChange: (e) => onFocusChange(Number(e.target.value)),
            disabled,
            style: {
              flex: 1,
              accentColor: T.primary,
              minWidth: 120,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.4 : 1
            },
            title: disabled ? "Single-step run \u2014 nothing to scrub" : void 0
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "div",
          {
            style: {
              fontSize: 11,
              color: T.textMuted,
              fontFamily: T.fontMono,
              whiteSpace: "nowrap",
              minWidth: 60,
              textAlign: "right"
            },
            children: total === 0 ? "\u2014" : total === 1 ? "1 step" : `${focusSeq + 1} / ${total}`
          }
        )
      ]
    }
  );
};
function btnStyle(accent) {
  return {
    background: accent ? T.primary : "transparent",
    color: accent ? "#fff" : T.textSecondary,
    border: `1px solid ${accent ? T.primary : T.border}`,
    borderRadius: 999,
    padding: "2px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    lineHeight: 1.4
  };
}

// src/react/NodeDetailPanel.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var NodeDetailPanel = ({
  node,
  relatedNodes,
  cursorRuntimeStageId,
  rootPhase,
  runInput,
  runOutput,
  runError,
  internalStage,
  hideEmptyState,
  onClose
}) => {
  if (!node && internalStage) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: panelStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: headerStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: titleStyle, children: internalStage.name }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: pillStyle, children: "stage" })
        ] }),
        onClose && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { onClick: onClose, style: closeButtonStyle, "aria-label": "Close detail panel", title: "Close", children: "\xD7" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: bodyStyle, children: [
        internalStage.description && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: sectionStyle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { ...sectionLabelStyle, padding: "6px 8px" }, children: "What this stage does" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { padding: 8, fontSize: 12, color: T.textPrimary, lineHeight: 1.5 }, children: internalStage.description })
        ] }),
        typeof internalStage.offsetMs === "number" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { fontSize: 11, color: T.textSecondary, padding: "0 2px" }, children: [
          "ran at +",
          Math.round(internalStage.offsetMs),
          "ms"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { fontSize: 11, color: T.textSecondary, fontStyle: "italic", padding: "4px 2px", lineHeight: 1.5 }, children: "This stage runs inside the subflow's own scope, so its detailed inputs/outputs aren't recorded at the parent level yet." })
      ] })
    ] });
  }
  if (!node) {
    const isRoot = cursorRuntimeStageId?.startsWith("__root__") ?? false;
    const hasRelated = !!relatedNodes && relatedNodes.length > 0;
    const showRunError = isRoot && rootPhase === "end" && runError !== void 0;
    const showRunIO = isRoot && (rootPhase === "start" && runInput !== void 0 || rootPhase === "end" && runOutput !== void 0);
    if (showRunError || showRunIO || hasRelated) {
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: panelStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: headerStyle, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: titleStyle, children: isRoot ? "Run" : "Scope" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { ...pillStyle, ...showRunError ? { background: T.error } : {} }, children: showRunError ? "failed" : rootPhase === "start" ? "input" : rootPhase === "end" ? "output" : isRoot ? "overview" : "in scope" })
          ] }),
          onClose && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              onClick: onClose,
              style: closeButtonStyle,
              "aria-label": "Close detail panel",
              title: "Close",
              children: "\xD7"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: bodyStyle, children: [
          showRunError && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { ...sectionStyle, borderColor: T.error }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { ...sectionLabelStyle, padding: "4px 8px", color: T.error }, children: "\u26D4 Run failed" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { style: { ...preStyle, color: T.error }, children: runError })
          ] }),
          rootPhase === "start" && runInput !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(PayloadSection, { label: "You sent", payload: runInput, emptyHint: "(no input recorded)" }),
          !showRunError && rootPhase === "end" && runOutput !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(PayloadSection, { label: "Final answer", payload: runOutput, emptyHint: "(no output recorded)" }),
          hasRelated && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RelatedStepsSection, { nodes: relatedNodes })
        ] })
      ] });
    }
    if (hideEmptyState) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: emptyPanelStyle, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: emptyHintStyle, children: isRoot ? "Scrub past Run \xB7 start to inspect a stage" : "Click a node to inspect" }) });
  }
  const isSubflow = node.kind === "subflow";
  const isTopologyHelper = node.kind === "fork-branch" || node.kind === "decision-branch";
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: panelStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: headerStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: titleStyle, children: node.label }),
        node.primitiveKind && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: pillStyle, children: node.primitiveKind })
      ] }),
      onClose && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          onClick: onClose,
          style: closeButtonStyle,
          "aria-label": "Close detail panel",
          title: "Close",
          children: "\xD7"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(IdentityStrip, { node }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: bodyStyle, children: [
      isSubflow && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          PayloadSection,
          {
            label: inputLabelFor(node),
            payload: node.entryPayload,
            emptyHint: "(no input recorded for this step)"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          PayloadSection,
          {
            label: outputLabelFor(node),
            payload: node.exitPayload,
            emptyHint: node.entryPayload && !node.exitPayload ? "In progress \u2014 this step has not finished yet." : "(no output recorded for this step)"
          }
        )
      ] }),
      isTopologyHelper && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: topologyNoteStyle, children: [
        "This is a ",
        node.kind === "fork-branch" ? "parallel branch" : "decision branch",
        " ",
        "marker \u2014 composition shape only. Boundary payloads attach to the subflow that the branch runs (if any), not to this marker itself."
      ] }),
      !isSubflow && !isTopologyHelper && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ReActStepBody, { node }),
      relatedNodes && relatedNodes.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RelatedStepsSection, { nodes: relatedNodes })
    ] })
  ] });
};
var RelatedStepsSection = ({ nodes }) => {
  const renderable = nodes.filter(
    (n) => n.kind !== "fork-branch" && n.kind !== "decision-branch"
  );
  if (renderable.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { marginTop: 4 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { ...sectionLabelStyle, marginBottom: 6, padding: "0 2px" }, children: "All steps in this scope" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: renderable.map((n) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RelatedStepCard, { node: n }, n.id)) })
  ] });
};
var RelatedStepCard = ({ node }) => {
  const title = node.label && node.label !== node.kind ? `${node.kind} \xB7 ${node.label}` : node.kind;
  const duration2 = typeof node.startOffsetMs === "number" && typeof node.endOffsetMs === "number" ? node.endOffsetMs - node.startOffsetMs : void 0;
  const rows = [];
  if (node.llmModel) rows.push(["model", node.llmModel]);
  if (node.tokens) rows.push(["tokens", `in ${node.tokens.in} \xB7 out ${node.tokens.out}`]);
  if (node.toolName) rows.push(["tool", node.toolName]);
  if (node.slotUpdated) rows.push(["updated slot", node.slotUpdated]);
  if (duration2 !== void 0 && duration2 > 0) {
    rows.push(["duration", `${Math.round(duration2)}ms`]);
  }
  const payloads = [];
  if (node.kind === "subflow") {
    if (node.entryPayload !== void 0) {
      payloads.push({ label: inputLabelFor(node), value: node.entryPayload });
    }
    if (node.exitPayload !== void 0) {
      payloads.push({ label: outputLabelFor(node), value: node.exitPayload });
    }
  }
  if (node.slotBoundaries) {
    if (node.slotBoundaries.systemPrompt) {
      payloads.push({
        label: "System prompt (composed)",
        value: node.slotBoundaries.systemPrompt.exitPayload
      });
    }
    if (node.slotBoundaries.messages) {
      payloads.push({
        label: "Messages (composed)",
        value: node.slotBoundaries.messages.exitPayload
      });
    }
    if (node.slotBoundaries.tools) {
      payloads.push({
        label: "Tools (composed)",
        value: node.slotBoundaries.tools.exitPayload
      });
    }
  }
  if (node.assistantText) {
    const label = node.kind === "llm->user" ? "Final answer" : node.kind === "llm->tool" ? "LLM's reasoning" : "LLM text";
    payloads.push({ label, value: node.assistantText });
  }
  if (node.toolArgs !== void 0) {
    payloads.push({ label: "Tool input (args)", value: node.toolArgs });
  }
  if (node.toolResult !== void 0) {
    payloads.push({ label: "Tool result", value: node.toolResult });
  }
  const hasContent = rows.length > 0 || payloads.length > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: sectionStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: sectionHeaderStyle, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { ...sectionLabelStyle, textTransform: "none" }, children: title }) }),
    rows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: "grid", gap: 4, fontSize: 12, padding: 8 }, children: rows.map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Field, { label, children: value }, label)) }),
    payloads.map((p) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { borderTop: `1px solid ${T.border}` }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { ...sectionLabelStyle, padding: "4px 8px" }, children: p.label }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { style: preStyle, children: prettyPrint(p.value) })
    ] }, p.label)),
    !hasContent && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: emptyHintStyle, children: "(no data recorded for this step)" })
  ] });
};
var IdentityStrip = ({ node }) => {
  if (typeof node.iterationIndex !== "number" && node.subflowPath.length <= 1) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: identityStripStyle, children: [
    typeof node.iterationIndex === "number" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(IdentityField, { label: "iteration", value: `#${node.iterationIndex}` }),
    node.subflowPath.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      IdentityField,
      {
        label: "under",
        value: node.subflowPath.slice(1, -1).join(" / ") || "(top level)"
      }
    )
  ] });
};
var IdentityField = ({ label, value }) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 6 }, children: [
  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: identityLabelStyle, children: label }),
  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: identityValueStyle, children: value })
] });
function inputLabelFor(node) {
  if (node.primitiveKind === "Run" || node.subflowPath[0] === "__root__" && node.subflowPath.length === 1) return "Run input";
  if (node.primitiveKind === "Agent") return "Agent input";
  if (node.primitiveKind === "LLMCall") return "LLM call input";
  return "Input";
}
function outputLabelFor(node) {
  if (node.primitiveKind === "Run" || node.subflowPath[0] === "__root__" && node.subflowPath.length === 1) return "Run output";
  if (node.primitiveKind === "Agent") return "Agent response";
  if (node.primitiveKind === "LLMCall") return "LLM call output";
  return "Output";
}
var PayloadSection = ({ label, payload, emptyHint }) => {
  const hasPayload = payload !== void 0 && payload !== null && !(typeof payload === "object" && Object.keys(payload).length === 0);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: sectionStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: sectionHeaderStyle, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: sectionLabelStyle, children: label }) }),
    hasPayload ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { style: preStyle, children: prettyPrint(payload) }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: emptyHintStyle, children: emptyHint })
  ] });
};
var ReActStepBody = ({ node }) => {
  const duration2 = typeof node.startOffsetMs === "number" && typeof node.endOffsetMs === "number" ? node.endOffsetMs - node.startOffsetMs : void 0;
  const rows = [];
  if (node.tokens) rows.push(["tokens", `in ${node.tokens.in} \xB7 out ${node.tokens.out}`]);
  if (node.toolName) rows.push(["tool", node.toolName]);
  if (node.llmModel) rows.push(["model", node.llmModel]);
  if (node.slotUpdated) rows.push(["what landed in", node.slotUpdated]);
  if (duration2 !== void 0 && duration2 > 0) rows.push(["duration", `${Math.round(duration2)}ms`]);
  const ioSections = ioSectionsFor(node);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: sectionStyle, children: [
      rows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: "grid", gap: 4, fontSize: 12, padding: 8 }, children: rows.map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Field, { label, children: value }, label)) }),
      (() => {
        const engineered = (node.injections ?? []).filter(
          (inj) => !BASELINE_SOURCES2.has(inj.source)
        );
        if (engineered.length === 0) return null;
        return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { padding: "0 8px 8px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: sectionLabelStyle, children: "Context engineering" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("ul", { style: { margin: "4px 0 0", paddingLeft: 14, fontSize: 11, color: T.textSecondary }, children: engineered.map((inj, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { style: { padding: "2px 0" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("code", { style: { fontSize: 11 }, children: [
              "[",
              inj.slot,
              "] ",
              inj.source,
              inj.sourceId ? `:${inj.sourceId}` : ""
            ] }),
            inj.contentSummary && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { opacity: 0.7, marginLeft: 6 }, children: [
              "\xB7 ",
              inj.contentSummary
            ] })
          ] }, i)) })
        ] });
      })()
    ] }),
    ioSections.map((s) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(PayloadSection, { label: s.label, payload: s.payload, emptyHint: "(none)" }, s.label))
  ] });
};
function ioSectionsFor(node) {
  const out = [];
  switch (node.kind) {
    case "llm->tool": {
      if (node.assistantText) {
        out.push({ label: "LLM's reasoning", payload: node.assistantText });
      }
      if (node.toolArgs !== void 0) {
        out.push({ label: "Tool input (args)", payload: node.toolArgs });
      }
      break;
    }
    case "tool->llm": {
      if (node.toolResult !== void 0) {
        out.push({ label: "Tool result sent to LLM", payload: node.toolResult });
      }
      break;
    }
    case "llm->user": {
      if (node.assistantText) {
        out.push({ label: "Final answer", payload: node.assistantText });
      }
      break;
    }
    case "user->llm":
    default:
      break;
  }
  return out;
}
var BASELINE_SOURCES2 = /* @__PURE__ */ new Set([
  "user",
  // current-turn user message
  "tool-result",
  // tool's return value, post-execution
  "assistant",
  // prior assistant turn replayed in messages
  "base",
  // static system-prompt declared at build time
  "registry"
  // tool from the static tool registry
]);
var Field = ({ label, children }) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", gap: 8 }, children: [
  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { color: T.textSecondary, fontVariant: "small-caps", minWidth: 80 }, children: label }),
  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { color: T.textPrimary }, children })
] });
function prettyPrint(value) {
  let str;
  if (typeof value === "string") {
    str = value;
  } else {
    try {
      str = JSON.stringify(value, null, 2);
    } catch {
      return "(unable to serialize)";
    }
  }
  if (str.length > 4e3) {
    return str.slice(0, 4e3) + "\n\n... (truncated; " + (str.length - 4e3) + " chars)";
  }
  return str;
}
var panelStyle = {
  display: "flex",
  flexDirection: "column",
  background: T.bgElevated,
  borderLeft: `1px solid ${T.border}`,
  fontFamily: T.fontSans,
  height: "100%",
  overflow: "hidden"
};
var emptyPanelStyle = {
  ...panelStyle,
  alignItems: "center",
  justifyContent: "center",
  background: T.bgElevated
};
var emptyHintStyle = {
  fontSize: 12,
  color: T.textSecondary,
  fontStyle: "italic",
  padding: 12
};
var headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  padding: "12px 14px 6px",
  borderBottom: `1px solid ${T.border}`
};
var titleStyle = {
  fontSize: 13,
  fontWeight: 600,
  color: T.textPrimary
};
var pillStyle = {
  fontSize: 10,
  fontWeight: 600,
  color: "#fff",
  background: T.primary,
  padding: "2px 6px",
  borderRadius: 3,
  textTransform: "uppercase",
  letterSpacing: 0.4
};
var closeButtonStyle = {
  background: "transparent",
  border: "none",
  fontSize: 18,
  lineHeight: 1,
  color: T.textSecondary,
  cursor: "pointer",
  padding: "0 4px"
};
var identityStripStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  padding: "6px 14px",
  borderBottom: `1px solid ${T.border}`,
  fontSize: 11
};
var identityLabelStyle = {
  color: T.textSecondary,
  fontVariant: "small-caps",
  letterSpacing: 0.3
};
var identityValueStyle = {
  color: T.textSecondary
};
var bodyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  overflowY: "auto",
  flex: 1
};
var sectionStyle = {
  border: `1px solid ${T.border}`,
  borderRadius: 4,
  background: T.bgElevated
};
var sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "6px 8px",
  borderBottom: `1px solid ${T.border}`,
  background: T.bgElevated
};
var sectionLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: T.textSecondary,
  textTransform: "uppercase",
  letterSpacing: 0.4
};
var sectionHintStyle = {
  fontSize: 10,
  color: T.textSecondary,
  fontFamily: T.fontMono
};
var preStyle = {
  margin: 0,
  padding: 8,
  fontSize: 11,
  fontFamily: T.fontMono,
  color: T.textPrimary,
  background: T.bgElevated,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 200,
  overflow: "auto"
};
var topologyNoteStyle = {
  fontSize: 12,
  color: T.textSecondary,
  padding: 12,
  background: T.bgElevated,
  border: `1px solid ${T.border}`,
  borderRadius: 4,
  lineHeight: 1.5
};

// src/react/WhatHappenedTimeline.tsx
var import_react5 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function fmtOffset(ms) {
  if (ms === void 0) return "";
  return ms < 1e3 ? `+${Math.round(ms)}ms` : `+${(ms / 1e3).toFixed(1)}s`;
}
var WhatHappenedTimeline = ({
  moments,
  focusStep,
  onFocusChange,
  detail
}) => {
  const focusedRef = (0, import_react5.useRef)(null);
  (0, import_react5.useEffect)(() => {
    const el = focusedRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusStep]);
  if (moments.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: emptyStyle, children: "No moments yet \u2014 run a sample to see what happened." });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: wrapStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: headerStyle2, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: headerTitleStyle, children: "What happened" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: headerCountStyle, children: [
        "moment ",
        Math.min(focusStep + 1, moments.length),
        " / ",
        moments.length,
        " \xB7 drag any dot to scrub"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: listStyle, role: "listbox", "aria-label": "Run timeline", children: moments.map((m, i) => {
      const focused = i === focusStep;
      const done = i < focusStep;
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { ref: focused ? focusedRef : void 0, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
          "button",
          {
            type: "button",
            role: "option",
            "aria-selected": focused,
            onClick: () => onFocusChange(i),
            style: { ...rowStyle, ...focused ? rowFocusedStyle : null },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: timeStyle, children: fmtOffset(m.offsetMs) }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: railStyle, children: [
                i > 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                  "span",
                  {
                    style: {
                      ...spineStyle,
                      background: done || focused ? T.success : T.border
                    }
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                  "span",
                  {
                    style: {
                      ...dotStyle,
                      background: focused ? T.warning : done ? T.success : T.bgElevated,
                      borderColor: focused ? T.warning : done ? T.success : T.border,
                      ...focused ? { boxShadow: `0 0 0 4px color-mix(in srgb, ${T.warning} 25%, transparent)` } : {}
                    }
                  }
                )
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: iconStyle, children: m.icon }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                "span",
                {
                  style: {
                    ...titleStyle2,
                    color: focused ? T.textPrimary : done ? T.textSecondary : T.textMuted,
                    fontWeight: focused ? 600 : 400
                  },
                  children: m.title
                }
              )
            ]
          }
        ),
        focused && m.description && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: descLineStyle, children: m.description }),
        focused && detail && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: detailCardStyle, children: detail })
      ] }, `${m.runtimeStageId}-${i}`);
    }) })
  ] });
};
var wrapStyle = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
  background: T.bgElevated,
  fontFamily: T.fontSans
};
var headerStyle2 = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "10px 12px 8px",
  borderBottom: `1px solid ${T.border}`,
  flex: "none"
};
var headerTitleStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: T.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.6
};
var headerCountStyle = {
  fontSize: 10,
  color: T.textSecondary,
  fontFamily: T.fontMono
};
var listStyle = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "4px 0 12px"
};
var rowStyle = {
  display: "grid",
  gridTemplateColumns: "46px 18px 18px 1fr",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  borderLeft: "3px solid transparent",
  padding: "7px 10px",
  cursor: "pointer",
  font: "inherit",
  transition: "background 0.15s ease"
};
var rowFocusedStyle = {
  background: `color-mix(in srgb, ${T.warning} 12%, transparent)`,
  borderLeft: `3px solid ${T.warning}`
};
var timeStyle = {
  fontSize: 10,
  fontFamily: T.fontMono,
  color: T.textSecondary,
  textAlign: "right"
};
var railStyle = {
  position: "relative",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  alignSelf: "stretch"
};
var spineStyle = {
  position: "absolute",
  top: 0,
  bottom: "50%",
  width: 2,
  left: "calc(50% - 1px)"
};
var dotStyle = {
  width: 11,
  height: 11,
  borderRadius: "50%",
  border: "2px solid",
  zIndex: 1
};
var iconStyle = {
  fontSize: 13,
  textAlign: "center"
};
var titleStyle2 = {
  fontSize: 12.5,
  lineHeight: 1.4
};
var descLineStyle = {
  margin: "0 12px 8px 64px",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: T.textSecondary
};
var detailCardStyle = {
  margin: "0 10px 10px 64px",
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  overflow: "hidden",
  maxHeight: 360,
  display: "flex",
  flexDirection: "column"
};
var emptyStyle = {
  padding: 16,
  fontSize: 12,
  color: T.textSecondary,
  fontStyle: "italic",
  fontFamily: T.fontSans
};

// src/react/buildTimelineMoments.ts
function momentIcon(label, kind) {
  const l = label.toLowerCase();
  if (l.includes("run \xB7 start")) return "\u25B8";
  if (l.includes("run \xB7 end")) return "\u2713";
  if (kind === "parallel" || l.includes("context")) return "\u2756";
  if (l.includes("iteration")) return "\u21BB";
  if (l.includes("llm")) return "\u25C6";
  if (l.includes("tool")) return "\u2699";
  if (l.includes("route") || l.includes("decision")) return "\u25C7";
  if (l.includes("gather")) return "\u2B07";
  if (l.includes("evaluate")) return "\u25A6";
  if (l.includes("delta")) return "\u0394";
  if (l.includes("final") || l.includes("respond")) return "\u25A3";
  return "\u2022";
}
function genericDescription(label) {
  const l = label.toLowerCase();
  if (l.startsWith("context")) return "Assembled this turn's context.";
  if (l.startsWith("iteration")) return "Started a ReAct iteration.";
  if (l.startsWith("llm turn")) return "Called the LLM to decide the next step.";
  if (l.startsWith("route")) return "Routed to the next step.";
  if (l.includes("run \xB7 start")) return "The run started.";
  if (l.includes("run \xB7 end")) return "The run finished.";
  return void 0;
}
function buildTimelineMoments({
  cursorPositions,
  commentarySeqs,
  log,
  humanizer,
  executionOrder
}) {
  const bySeq = /* @__PURE__ */ new Map();
  for (const e of log) bySeq.set(e.seq, e);
  return cursorPositions.map((cp, i) => {
    const seq = commentarySeqs[i];
    const entry = seq !== void 0 && seq >= 0 ? bySeq.get(seq) : void 0;
    const raw = entry ? humanizer(entry.event) : null;
    const prose = raw && !raw.trimStart().startsWith("[") ? raw : null;
    let title = cp.label;
    const toolMatch = prose ? /called the [`']?([\w.-]+)[`']? tool/i.exec(prose) : null;
    if (toolMatch) title = `Called ${toolMatch[1]}`;
    const description = prose ?? genericDescription(cp.label);
    let offsetMs = entry?.runOffsetMs;
    if (offsetMs === void 0) {
      offsetMs = executionOrder.find((e) => e.runtimeStageId === cp.runtimeStageId)?.timestampMs;
    }
    return {
      runtimeStageId: cp.runtimeStageId,
      title,
      ...description ? { description } : {},
      ...offsetMs !== void 0 ? { offsetMs } : {},
      icon: momentIcon(cp.label, cp.kind)
    };
  });
}

// src/react/hooks/useLensRecorder.ts
var import_react6 = require("react");
function useLensRecorder(recorder) {
  (0, import_react6.useSyncExternalStore)(
    (listener) => recorder.subscribe(listener),
    () => recorder.getVersion(),
    () => recorder.getVersion()
  );
  return recorder;
}

// src/react/hooks/useDrillPath.ts
var import_react7 = require("react");
function useDrillPath(initial = []) {
  const [drillPath, setDrillPath] = (0, import_react7.useState)(initial);
  const drillInto = (0, import_react7.useCallback)((subflowPath) => {
    setDrillPath(subflowPath);
  }, []);
  const drillBack = (0, import_react7.useCallback)(() => {
    setDrillPath((prev) => prev.length > 0 ? prev.slice(0, -1) : prev);
  }, []);
  const drillToRoot = (0, import_react7.useCallback)(() => {
    setDrillPath([]);
  }, []);
  const drillTo = (0, import_react7.useCallback)((path) => {
    setDrillPath(path);
  }, []);
  return { drillPath, drillInto, drillBack, drillToRoot, drillTo };
}

// src/react/hooks/useCommitSync.ts
var import_react8 = require("react");

// src/core/stores/splitLensStores.ts
function defaultSchedule(fn) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => fn());
    return;
  }
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
    return;
  }
  setTimeout(fn, 0);
}
function splitLensStores(recorder, options = {}) {
  const schedule = options.schedule ?? defaultSchedule;
  const readNodeCount = () => {
    try {
      const events = recorder.boundary.getEvents?.();
      if (events) return events.length;
      return recorder.getStepGraph().nodes.length;
    } catch {
      return 0;
    }
  };
  let specVersion = 0;
  let overlayVersion = 0;
  let lastNodeCount = readNodeCount();
  const specListeners = /* @__PURE__ */ new Set();
  const overlayListeners = /* @__PURE__ */ new Set();
  let disposed = false;
  let overlayPending = false;
  const fanOut = (set) => {
    for (const fn of set) {
      try {
        fn();
      } catch {
      }
    }
  };
  const flushOverlay = () => {
    overlayPending = false;
    if (disposed) return;
    overlayVersion++;
    fanOut(overlayListeners);
  };
  const onRecorderChange = () => {
    if (disposed) return;
    const count = readNodeCount();
    if (count !== lastNodeCount) {
      lastNodeCount = count;
      specVersion++;
      fanOut(specListeners);
    }
    if (!overlayPending) {
      overlayPending = true;
      schedule(flushOverlay);
    }
  };
  const unsubscribeRecorder = recorder.subscribe(onRecorderChange);
  const specStore = {
    subscribe(listener) {
      specListeners.add(listener);
      return () => {
        specListeners.delete(listener);
      };
    },
    getSnapshot() {
      return specVersion;
    }
  };
  const overlayStore = {
    subscribe(listener) {
      overlayListeners.add(listener);
      return () => {
        overlayListeners.delete(listener);
      };
    },
    getSnapshot() {
      return overlayVersion;
    }
  };
  return {
    specStore,
    overlayStore,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeRecorder();
      specListeners.clear();
      overlayListeners.clear();
    }
  };
}

// src/core/group/buildGroups.ts
function samePath(a, b) {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}
function buildGroups(boundaryIndex) {
  const all = boundaryIndex.overlapping(0, Number.MAX_SAFE_INTEGER);
  if (all.length === 0) return [];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (let i = 0; i < all.length; i++) {
    const entry = all[i];
    const label = entry.label;
    if (seen.has(label.runtimeStageId)) continue;
    seen.add(label.runtimeStageId);
    let parentGroupId;
    if (label.type === "subflow.entry") {
      const enclosing = boundaryIndex.enclosing(entry.startIdx);
      const parentPath = label.subflowPath.slice(0, -1);
      for (let j = enclosing.length - 1; j >= 0; j--) {
        const cand = enclosing[j].label;
        if (cand.runtimeStageId === label.runtimeStageId) continue;
        if (samePath(cand.subflowPath, parentPath)) {
          parentGroupId = cand.runtimeStageId;
          break;
        }
      }
      if (parentGroupId === void 0) {
        for (let j = enclosing.length - 1; j >= 0; j--) {
          const cand = enclosing[j].label;
          if (cand.runtimeStageId === label.runtimeStageId) continue;
          parentGroupId = cand.runtimeStageId;
          break;
        }
      }
    } else if (label.type === "composition.start") {
      const enclosing = boundaryIndex.enclosing(entry.startIdx);
      for (let j = enclosing.length - 1; j >= 0; j--) {
        const cand = enclosing[j].label;
        if (cand.runtimeStageId === label.runtimeStageId) continue;
        parentGroupId = cand.runtimeStageId;
        break;
      }
    }
    const isRoot = label.type === "run.entry";
    const name = label.subflowName ?? (label.type === "composition.start" ? label.compositionName : void 0) ?? (isRoot ? "Run" : label.runtimeStageId);
    const compositionKind = label.type === "composition.start" ? label.compositionKind : void 0;
    result.push({
      runtimeGroupId: label.runtimeStageId,
      name,
      parentGroupId,
      subflowPath: label.subflowPath,
      depth: label.depth,
      opensAtCommitIdx: entry.startIdx,
      closesAtCommitIdx: entry.endIdx,
      isRoot,
      ...compositionKind !== void 0 ? { compositionKind } : {},
      ...label.slotKind !== void 0 ? { slotKind: label.slotKind } : {},
      ...label.primitiveKind !== void 0 ? { primitiveKind: label.primitiveKind } : {}
    });
  }
  return result;
}

// src/core/group/groupForRuntimeStageId.ts
function pathOf(rid) {
  if (rid.length === 0) return [];
  const lastSlash = rid.lastIndexOf("/");
  if (lastSlash < 0) return [];
  return rid.slice(0, lastSlash).split("/");
}
function effectivePath(group) {
  return group.subflowPath[0] === "__root__" ? group.subflowPath.slice(1) : [...group.subflowPath];
}
function isPathPrefix(prefix, path) {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== path[i]) return false;
  }
  return true;
}
function ridMatchesGroup(rid, group) {
  return group.runtimeGroupId === rid;
}
function groupForRuntimeStageId(groups, rid) {
  if (rid.length === 0 || groups.length === 0) return void 0;
  for (const g of groups) {
    if (ridMatchesGroup(rid, g)) return g;
  }
  const path = pathOf(rid);
  if (path.length === 0) {
    return groups.find((g) => g.isRoot);
  }
  const sorted = groups.slice().sort((a, b) => b.depth - a.depth);
  for (const g of sorted) {
    if (g.isRoot) continue;
    const ep = effectivePath(g);
    if (ep.length === 0) continue;
    if (isPathPrefix(ep, path)) return g;
  }
  return groups.find((g) => g.isRoot);
}

// src/core/group/buildCommitSyncMap.ts
function buildCommitSyncMap(recorder) {
  const commitLog = recorder.getCommitLog();
  if (commitLog.length === 0) return [];
  const groups = buildGroups(recorder.boundary.boundaryIndex);
  const result = [];
  for (let i = 0; i < commitLog.length; i++) {
    const c = commitLog[i];
    const rid = c.runtimeStageId ?? "";
    const group = groupForRuntimeStageId(groups, rid);
    result.push({
      runtimeStageId: rid,
      commitIdx: i,
      runtimeGroupId: group?.runtimeGroupId ?? "",
      subflowPath: group?.subflowPath ?? [],
      depth: group?.depth ?? 0,
      label: labelFor(rid, group, c.stageId),
      overwriteKeys: c.overwriteKeys ?? []
    });
  }
  return result;
}
function labelFor(rid, group, stageId) {
  const leaf = stageId ?? lastSegmentOf(rid);
  if (group && !group.isRoot) return `${group.name} \xB7 ${leaf}`;
  return leaf;
}
function lastSegmentOf(rid) {
  if (rid.length === 0) return "";
  const lastSlash = rid.lastIndexOf("/");
  const segment = lastSlash < 0 ? rid : rid.slice(lastSlash + 1);
  const hashIdx = segment.lastIndexOf("#");
  return hashIdx < 0 ? segment : segment.slice(0, hashIdx);
}

// src/react/hooks/useCommitSync.ts
function useCommitSync(recorder, options) {
  const storesRef = (0, import_react8.useRef)(null);
  if (storesRef.current === null || storesRef.current.recorder !== recorder) {
    storesRef.current?.stores.dispose();
    storesRef.current = { recorder, stores: splitLensStores(recorder, options) };
  }
  const stores = storesRef.current.stores;
  (0, import_react8.useEffect)(() => {
    return () => {
      storesRef.current?.stores.dispose();
      storesRef.current = null;
    };
  }, []);
  const version = (0, import_react8.useSyncExternalStore)(
    stores.overlayStore.subscribe,
    stores.overlayStore.getSnapshot,
    stores.overlayStore.getSnapshot
  );
  const syncMap = (0, import_react8.useMemo)(() => {
    try {
      return buildCommitSyncMap(recorder);
    } catch {
      return [];
    }
  }, [recorder, version]);
  return syncMap;
}

// src/react/hooks/useCursorPositions.ts
var import_react9 = require("react");
var import_agentfootprint4 = require("agentfootprint");

// src/core/group/cursorPositionsAtDrill.ts
function rootGroup(groups) {
  return groups.find((g) => g.isRoot);
}
function currentGroup(groups, drillPath) {
  if (drillPath.length === 0) return rootGroup(groups);
  const innermost = drillPath[drillPath.length - 1];
  return groups.find((g) => g.runtimeGroupId === innermost);
}
function directChildren(groups, parent) {
  return groups.filter((g) => g.parentGroupId === parent.runtimeGroupId).sort((a, b) => a.opensAtCommitIdx - b.opensAtCommitIdx);
}
function emitsEndPosition(group) {
  return group.compositionKind === "Parallel" || group.compositionKind === "Loop";
}
function isHiddenAtTopLevel(group) {
  return group.slotKind !== void 0;
}
function parallelBranchIds(composition, groups) {
  const members = directChildren(groups, composition);
  const closeOf = (g) => g.closesAtCommitIdx ?? Number.MAX_SAFE_INTEGER;
  return members.filter(
    (k) => members.some(
      (o) => o !== k && o.opensAtCommitIdx <= closeOf(k) && k.opensAtCommitIdx <= closeOf(o)
    )
  ).map((g) => g.runtimeGroupId);
}
function structuralPositions(current, groups) {
  const out = [];
  emitMembers(directChildren(groups, current), groups, out, /* @__PURE__ */ new Set());
  return out;
}
function emitMembers(members, groups, out, visited) {
  const buffers = [];
  for (const m of members) {
    if (isHiddenAtTopLevel(m)) continue;
    const buf = [];
    appendGroupStops(m, groups, buf, visited);
    if (buf.length > 0) buffers.push(buf);
  }
  const totals = /* @__PURE__ */ new Map();
  for (const buf of buffers) totals.set(buf[0].label, (totals.get(buf[0].label) ?? 0) + 1);
  const seen = /* @__PURE__ */ new Map();
  for (const buf of buffers) {
    const label = buf[0].label;
    if ((totals.get(label) ?? 0) > 1) {
      const n = (seen.get(label) ?? 0) + 1;
      seen.set(label, n);
      buf[0] = { ...buf[0], label: `${label} ${n}` };
    }
    out.push(...buf);
  }
}
function appendGroupStops(g, groups, out, visited) {
  const startStop = (label) => ({
    runtimeStageId: g.runtimeGroupId,
    runtimeGroupId: g.runtimeGroupId,
    label,
    kind: "group-start",
    depth: g.depth,
    commitIdx: g.opensAtCommitIdx
  });
  const endStop = (label) => ({
    runtimeStageId: g.runtimeGroupId,
    runtimeGroupId: g.runtimeGroupId,
    label,
    kind: "group-end",
    depth: g.depth,
    commitIdx: g.closesAtCommitIdx
  });
  if (g.compositionKind === "Parallel") {
    const branchIds = parallelBranchIds(g, groups);
    out.push({ ...startStop(g.name), ...branchIds.length >= 2 ? { coActiveGroupIds: branchIds } : {} });
    if (g.closesAtCommitIdx !== void 0) out.push(endStop(`${g.name} \xB7 merged`));
    return;
  }
  if (g.compositionKind === "Sequence" || g.compositionKind === "Conditional" || g.compositionKind === "Loop") {
    out.push(startStop(g.name));
    if (!visited.has(g.runtimeGroupId)) {
      const nextVisited = new Set(visited);
      nextVisited.add(g.runtimeGroupId);
      emitMembers(directChildren(groups, g), groups, out, nextVisited);
    }
    if (g.compositionKind === "Loop" && g.closesAtCommitIdx !== void 0) out.push(endStop(`${g.name} \xB7 exit`));
    return;
  }
  out.push(startStop(g.name));
}
function milestonePositions(current, groups, commits, classify) {
  const raw = [];
  for (const child of directChildren(groups, current)) {
    const m = classify(child.runtimeGroupId);
    if (!m) continue;
    raw.push({
      runtimeStageId: child.runtimeGroupId,
      runtimeGroupId: child.runtimeGroupId,
      commitIdx: child.opensAtCommitIdx,
      depth: child.depth,
      kind: m.kind,
      label: m.label
    });
  }
  for (const c of commits) {
    if (c.runtimeGroupId !== current.runtimeGroupId) continue;
    if (stripExecIndex(c.runtimeStageId) === stripExecIndex(current.runtimeGroupId)) continue;
    const m = classify(c.runtimeStageId);
    if (!m) continue;
    raw.push({
      runtimeStageId: c.runtimeStageId,
      runtimeGroupId: current.runtimeGroupId,
      commitIdx: c.commitIdx,
      depth: current.depth + 1,
      kind: m.kind,
      label: m.label
    });
  }
  raw.sort((a, b) => a.commitIdx - b.commitIdx);
  const collapsed = [];
  for (let i = 0; i < raw.length; ) {
    if (raw[i].kind === "slot") {
      let j = i;
      while (j < raw.length && raw[j].kind === "slot") j++;
      const run = raw.slice(i, j);
      if (run.length >= 2) {
        const changedKeys = changedSlotKeys(run, groups, commits);
        const matched = run.filter((r) => {
          const k = slotInjectionKey(r.runtimeGroupId);
          return k !== null && changedKeys.has(k);
        });
        const changed = matched.length > 0 ? matched : run;
        const anchor = changed[0];
        collapsed.push({
          runtimeStageId: anchor.runtimeStageId,
          runtimeGroupId: anchor.runtimeGroupId,
          commitIdx: anchor.commitIdx,
          depth: anchor.depth,
          kind: "parallel",
          label: "Context",
          coActiveGroupIds: changed.map((r) => r.runtimeGroupId)
        });
      } else {
        collapsed.push(run[0]);
      }
      i = j;
    } else {
      collapsed.push(raw[i]);
      i++;
    }
  }
  const totals = /* @__PURE__ */ new Map();
  for (const r of collapsed) totals.set(r.label, (totals.get(r.label) ?? 0) + 1);
  const seen = /* @__PURE__ */ new Map();
  return collapsed.map((r) => {
    const n = (seen.get(r.label) ?? 0) + 1;
    seen.set(r.label, n);
    const label = (totals.get(r.label) ?? 0) > 1 ? `${r.label} ${n}` : r.label;
    return {
      runtimeStageId: r.runtimeStageId,
      runtimeGroupId: r.runtimeGroupId,
      label,
      kind: r.kind === "parallel" ? "parallel" : "commit",
      depth: r.depth,
      commitIdx: r.commitIdx,
      ...r.coActiveGroupIds && r.coActiveGroupIds.length > 0 ? { coActiveGroupIds: r.coActiveGroupIds } : {}
    };
  });
}
function slotInjectionKey(runtimeGroupId) {
  if (runtimeGroupId.includes("system-prompt")) return "systemPromptInjections";
  if (runtimeGroupId.includes("messages")) return "messagesInjections";
  if (runtimeGroupId.includes("tools")) return "toolsInjections";
  return null;
}
function changedSlotKeys(run, groups, commits) {
  const SLOT_KEYS = /* @__PURE__ */ new Set(["systemPromptInjections", "messagesInjections", "toolsInjections"]);
  let start = Infinity;
  let end = -Infinity;
  for (const r of run) {
    const g = groups.find((gg) => gg.runtimeGroupId === r.runtimeGroupId);
    start = Math.min(start, r.commitIdx, g?.opensAtCommitIdx ?? r.commitIdx);
    end = Math.max(end, g?.closesAtCommitIdx ?? r.commitIdx);
  }
  const MARGIN = 4;
  start -= MARGIN;
  end += MARGIN;
  const changed = /* @__PURE__ */ new Set();
  for (const c of commits) {
    if (c.commitIdx < start || c.commitIdx > end) continue;
    for (const k of c.overwriteKeys) if (SLOT_KEYS.has(k)) changed.add(k);
  }
  return changed;
}
function stripExecIndex(id) {
  const i = id.lastIndexOf("#");
  return i >= 0 ? id.slice(0, i) : id;
}
function subflowInternalPositions(current, executionOrder) {
  const prefix = `${stripExecIndex(current.runtimeGroupId)}/`;
  const boundaryIdx = executionOrder.findIndex(
    (e) => e.runtimeStageId === current.runtimeGroupId
  );
  if (boundaryIdx < 0) return [];
  const raw = [];
  for (let i = boundaryIdx + 1; i < executionOrder.length; i++) {
    const e = executionOrder[i];
    const stripped = stripExecIndex(e.runtimeStageId);
    if (!stripped.startsWith(prefix)) break;
    const rest = stripped.slice(prefix.length);
    if (rest.includes("/")) continue;
    const name = e.stageName ?? e.stageId ?? rest;
    const label = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    raw.push({ runtimeStageId: e.runtimeStageId, label });
  }
  const totals = /* @__PURE__ */ new Map();
  for (const r of raw) totals.set(r.label, (totals.get(r.label) ?? 0) + 1);
  const seen = /* @__PURE__ */ new Map();
  return raw.map((r) => {
    const n = (seen.get(r.label) ?? 0) + 1;
    seen.set(r.label, n);
    const label = (totals.get(r.label) ?? 0) > 1 ? `${r.label} ${n}` : r.label;
    return {
      runtimeStageId: r.runtimeStageId,
      runtimeGroupId: r.runtimeStageId,
      label,
      kind: "commit",
      depth: current.depth + 1,
      // No per-internal commit exists (subflow-scoped); anchor the data view to
      // the subflow's open commit so the details panel shows the subflow's state.
      commitIdx: current.opensAtCommitIdx
    };
  });
}
function cursorPositionsAtDrill(groups, commits, drillPath, milestoneFor2, executionOrder) {
  if (groups.length === 0) return [];
  const current = currentGroup(groups, drillPath);
  if (!current) return [];
  const positions = [];
  positions.push({
    runtimeStageId: current.runtimeGroupId,
    runtimeGroupId: current.runtimeGroupId,
    label: current.isRoot ? "Run \xB7 start" : `${current.name} \xB7 start`,
    kind: "group-start",
    depth: current.depth,
    commitIdx: current.opensAtCommitIdx
  });
  const middle = milestoneFor2 ? milestonePositions(current, groups, commits, milestoneFor2) : [];
  if (middle.length > 0) {
    positions.push(...middle);
  } else {
    const structural = structuralPositions(current, groups);
    if (structural.length > 0) {
      positions.push(...structural);
    } else if (drillPath.length > 0 && executionOrder && executionOrder.length > 0) {
      positions.push(...subflowInternalPositions(current, executionOrder));
    }
  }
  if ((current.isRoot || emitsEndPosition(current)) && current.closesAtCommitIdx !== void 0) {
    positions.push({
      runtimeStageId: current.runtimeGroupId,
      runtimeGroupId: current.runtimeGroupId,
      label: current.isRoot ? "Run \xB7 end" : `${current.name} \xB7 end`,
      kind: "group-end",
      depth: current.depth,
      commitIdx: current.closesAtCommitIdx
    });
  }
  return positions;
}

// src/react/hooks/useCursorPositions.ts
function useCursorPositions(recorder, drillPath, options) {
  const syncMap = useCommitSync(recorder, options);
  const overlayVersion = recorder.runtime.version();
  return (0, import_react9.useMemo)(() => {
    try {
      const groups = buildGroups(recorder.boundary.boundaryIndex);
      const overlay = recorder.runtime.getOverlay();
      return cursorPositionsAtDrill(groups, syncMap, drillPath, import_agentfootprint4.milestoneFor, overlay.executionOrder);
    } catch {
      return [];
    }
  }, [recorder, syncMap, drillPath, overlayVersion]);
}

// src/react/hooks/useToolChoice.ts
var import_react10 = require("react");
var EMPTY = {
  calls: [],
  summary: void 0,
  pending: false,
  error: void 0
};
function useToolChoice(source, revision) {
  const [state, setState] = (0, import_react10.useState)(EMPTY);
  const chain = (0, import_react10.useRef)(Promise.resolve());
  (0, import_react10.useEffect)(() => {
    if (!source) {
      setState((s) => s === EMPTY ? s : EMPTY);
      return;
    }
    let stale = false;
    setState((s) => s.pending ? s : { ...s, pending: true });
    chain.current = chain.current.then(async () => {
      if (stale) return;
      try {
        const calls = await source.getCalls();
        const summary = await source.getSummary();
        if (!stale) setState({ calls, summary, pending: false, error: void 0 });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!stale) {
          setState((s) => ({
            calls: s.calls,
            summary: s.summary,
            pending: false,
            error: message
          }));
        }
      }
    });
    return () => {
      stale = true;
    };
  }, [source, revision]);
  return state;
}

// src/react/hooks/useWindowedList.ts
var import_react11 = require("react");
function useWindowedList({
  count,
  rowHeight,
  threshold = 300,
  overscan = 12,
  initialViewportHeight = 400
}) {
  const [scrollTop, setScrollTop] = (0, import_react11.useState)(0);
  const [viewportHeight, setViewportHeight] = (0, import_react11.useState)(initialViewportHeight);
  const onScroll = (0, import_react11.useCallback)(
    (e) => {
      setScrollTop(e.currentTarget.scrollTop);
      setViewportHeight(e.currentTarget.clientHeight || initialViewportHeight);
    },
    [initialViewportHeight]
  );
  if (count <= threshold) {
    return { windowed: false, start: 0, end: count, topPad: 0, bottomPad: 0, onScroll };
  }
  const start = Math.max(0, Math.min(count, Math.floor(scrollTop / rowHeight) - overscan));
  const end = Math.max(
    start,
    Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  );
  return {
    windowed: true,
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (count - end) * rowHeight,
    onScroll
  };
}

// src/react/components/ToolChoicePanel.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var SKIP_LABELS = {
  "nothing-chosen": "model answered without invoking a tool \u2014 nothing to score",
  "chosen-not-offered": "chosen tool was not in the offered catalog (wiring anomaly)"
};
var ToolChoicePanel = ({
  calls,
  summary,
  cursorRuntimeStageId,
  cursorKind,
  pending = false,
  error,
  virtualizeThreshold = 300,
  rowHeight = 22
}) => {
  const call = selectToolChoiceCall(calls, cursorRuntimeStageId, cursorKind);
  const scores = call?.margin?.scores ?? [];
  const rowCount = scores.length > 0 ? scores.length : call?.offered.length ?? 0;
  const w = useWindowedList({
    count: rowCount,
    rowHeight,
    threshold: virtualizeThreshold
  });
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "div",
    {
      role: "region",
      "aria-label": "Tool choice",
      style: {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        fontSize: 12,
        fontFamily: T.fontSans,
        color: T.textPrimary
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
          "div",
          {
            style: {
              flex: "none",
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              padding: "5px 12px",
              borderBottom: `1px solid ${T.border}`,
              fontSize: 11
            },
            children: [
              summary ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
                  "span",
                  {
                    style: {
                      fontWeight: 600,
                      color: summary.flagged > 0 ? T.warning : T.textSecondary
                    },
                    children: [
                      summary.flagged > 0 ? "\u26A0 " : "",
                      summary.flagged,
                      " flagged"
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { color: T.textSecondary }, children: [
                  summary.scored,
                  " scored \xB7 ",
                  summary.llmCallsWithTools,
                  " calls offered tools"
                ] }),
                summary.flagged > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { color: T.textSecondary }, children: [
                  "(",
                  summary.narrow,
                  " narrow, ",
                  summary.proxyDisagreement,
                  " proxy-disagreement)"
                ] })
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { color: T.textSecondary, fontStyle: "italic" }, children: pending ? "scoring tool choices\u2026" : "no tool-choice data yet" }),
              pending && summary && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { color: T.textSecondary, fontStyle: "italic" }, children: "updating\u2026" })
            ]
          }
        ),
        error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
          "div",
          {
            style: {
              flex: "none",
              padding: "4px 12px",
              color: T.error,
              borderBottom: `1px solid ${T.border}`
            },
            children: [
              "Tool-choice read failed: ",
              error
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "div",
          {
            onScroll: w.onScroll,
            style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 12px 0" },
            children: call === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { color: T.textSecondary, fontStyle: "italic", padding: "4px 0" }, children: calls.length === 0 ? pending ? "Waiting for the first scored call\u2026" : "No LLM call offered tools in this run." : "No tool-offering LLM call at or before this cursor position." }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(CallHeader, { call }),
              scores.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { role: "list", "aria-label": "Offered tool scores", children: [
                w.topPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { height: w.topPad }, "aria-hidden": true }),
                scores.slice(w.start, w.end).map((s) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                  ScoreBar,
                  {
                    name: s.name,
                    score: s.score,
                    maxScore: scores[0].score,
                    chosen: call.chosen.includes(s.name),
                    topScored: call.margin.topScored === s.name,
                    rowHeight,
                    pinned: w.windowed
                  },
                  s.name
                )),
                w.bottomPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { height: w.bottomPad }, "aria-hidden": true })
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { role: "list", "aria-label": "Offered tools (not scored)", children: [
                w.topPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { height: w.topPad }, "aria-hidden": true }),
                call.offered.slice(w.start, w.end).map((t) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                  "div",
                  {
                    role: "listitem",
                    style: {
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      color: call.chosen.includes(t.name) ? T.textPrimary : T.textSecondary,
                      ...w.windowed ? { height: rowHeight, overflow: "hidden" } : { padding: "2px 0" }
                    },
                    children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { fontFamily: T.fontMono }, children: [
                      call.chosen.includes(t.name) ? "\u2713 " : "",
                      t.name
                    ] })
                  },
                  t.name
                )),
                w.bottomPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { height: w.bottomPad }, "aria-hidden": true })
              ] })
            ] })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "div",
          {
            style: {
              flex: "none",
              padding: "4px 12px 6px",
              fontSize: 10,
              color: T.textMuted,
              fontStyle: "italic",
              borderTop: `1px solid ${T.border}`
            },
            children: "Margins are embedding-geometry proxies (choice context \u2194 tool descriptions) \u2014 not model internals."
          }
        )
      ]
    }
  );
};
var CallHeader = ({ call }) => {
  const margin = call.margin;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        padding: "2px 0 6px"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { fontWeight: 600 }, children: [
          "Iteration ",
          call.iteration
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontFamily: T.fontMono, fontSize: 10, color: T.textSecondary }, children: call.runtimeStageId }),
        margin && margin.margin !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
          "span",
          {
            "aria-label": "margin",
            style: {
              fontFamily: T.fontMono,
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 8,
              border: `1px solid ${margin.flags.narrow ? T.warning : T.border}`,
              color: margin.flags.narrow ? T.warning : T.textSecondary
            },
            children: [
              "margin ",
              margin.margin.toFixed(3)
            ]
          }
        ),
        margin && margin.margin === void 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 10, color: T.textSecondary, fontStyle: "italic" }, children: "every offered tool was chosen \u2014 no competition to measure" }),
        margin?.flags.narrow && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(FlagBadge, { label: "\u26A0 NARROW" }),
        margin?.flags.proxyDisagreement && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(FlagBadge, { label: "\u26A0 PROXY-DISAGREEMENT" }),
        call.skipped !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 10, color: T.textSecondary, fontStyle: "italic" }, children: SKIP_LABELS[call.skipped] ?? call.skipped }),
        margin === void 0 && call.skipped === void 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { fontSize: 10, color: T.textSecondary, fontStyle: "italic" }, children: "not scored yet" })
      ]
    }
  );
};
var FlagBadge = ({ label }) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
  "span",
  {
    style: {
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.05em",
      padding: "1px 6px",
      borderRadius: 8,
      color: T.warning,
      border: `1px solid ${T.warning}`,
      background: `color-mix(in srgb, ${T.warning} 12%, transparent)`
    },
    children: label
  }
);
var ScoreBar = ({ name, score, maxScore, chosen, topScored, rowHeight, pinned }) => {
  const pct = maxScore > 0 ? Math.max(0.02, Math.max(0, score) / maxScore) * 100 : 2;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "div",
    {
      role: "listitem",
      "data-chosen": chosen,
      "data-top-scored": topScored,
      "aria-label": `${name}: score ${score.toFixed(3)}${chosen ? ", chosen" : ""}`,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        ...pinned ? { height: rowHeight, overflow: "hidden" } : { padding: "2px 0" }
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
          "span",
          {
            style: {
              flex: "none",
              width: 170,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: T.fontMono,
              fontSize: 11,
              fontWeight: chosen ? 700 : 400,
              color: chosen ? T.textPrimary : T.textSecondary
            },
            children: [
              chosen ? "\u2713 " : "",
              name
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { flex: 1, minWidth: 40, display: "flex", alignItems: "center" }, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "span",
          {
            "aria-hidden": true,
            style: {
              display: "inline-block",
              width: `${pct}%`,
              height: 8,
              borderRadius: 2,
              background: chosen ? T.primary : T.bgTertiary,
              ...topScored && !chosen ? { outline: `1px solid ${T.warning}` } : {}
            }
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "span",
          {
            style: {
              flex: "none",
              width: 44,
              textAlign: "right",
              fontFamily: T.fontMono,
              fontSize: 10,
              color: T.textSecondary
            },
            children: score.toFixed(3)
          }
        ),
        topScored && !chosen && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { flex: "none", fontSize: 9, color: T.warning }, children: "proxy top pick" })
      ]
    }
  );
};

// src/core/group/drillResolve.ts
var USER_NODE_ID = "__lens_user__";
var SYNTH_LLM_ID = "__lens_llm_call_synth__";
function resolveDrillChain(groups, nodeId) {
  if (!nodeId || nodeId === USER_NODE_ID) return null;
  const localId = nodeId.includes("/") ? nodeId.slice(nodeId.lastIndexOf("/") + 1) : nodeId;
  const matches = groups.filter((g) => {
    if (g.isRoot) return false;
    if (nodeId === SYNTH_LLM_ID) return g.primitiveKind === "LLMCall";
    const seg = g.subflowPath[g.subflowPath.length - 1];
    return seg === localId || seg === nodeId;
  });
  if (matches.length === 0) return null;
  const target = matches.reduce(
    (best, g) => g.depth < best.depth || g.depth === best.depth && g.opensAtCommitIdx < best.opensAtCommitIdx ? g : best
  );
  const byId = new Map(groups.map((g) => [g.runtimeGroupId, g]));
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let cur = target;
  while (cur && !cur.isRoot && !seen.has(cur.runtimeGroupId)) {
    seen.add(cur.runtimeGroupId);
    chain.unshift(cur.runtimeGroupId);
    cur = cur.parentGroupId ? byId.get(cur.parentGroupId) : void 0;
  }
  return chain.length > 0 ? chain : null;
}
function innerGroupSubflowPath(groups, drillPath) {
  if (drillPath.length === 0) return [];
  const inner = drillPath[drillPath.length - 1];
  const g = groups.find((gg) => gg.runtimeGroupId === inner);
  return g ? g.subflowPath : [];
}
function drillPathLabels(groups, drillPath) {
  const byId = new Map(groups.map((g) => [g.runtimeGroupId, g]));
  return drillPath.map((id) => byId.get(id)?.name ?? id);
}

// src/react/tailWindow.ts
var MAX_COMMENTARY_LINES = 500;
function tailWindow(items, max) {
  if (items.length <= max) return { hidden: 0, shown: items };
  return { hidden: items.length - max, shown: items.slice(items.length - max) };
}

// src/react/Lens.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
if (typeof document !== "undefined" && !document.querySelector("style[data-lens-keyframes]")) {
  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-lens-keyframes", "v2");
  styleEl.textContent = `@keyframes lens-blink { 50% { opacity: 0; } }`;
  document.head.appendChild(styleEl);
}
var Lens = ({
  recorder,
  runner,
  stepGraph,
  chart,
  view = "engineer",
  humanizer,
  appName,
  commentaryTemplates,
  toolChoice
}) => {
  useLensRecorder(recorder);
  const tree = recorder.selectRunTree();
  const log = recorder.selectEventLog();
  const summary = recorder.selectSummary();
  const toolChoiceData = useToolChoice(toolChoice, log.length);
  const effectiveChart = (0, import_react12.useMemo)(
    () => chart ?? (runner ? {
      graph: structureGraphFromRunner(
        runner
      ),
      layout: import_flowchart5.dagreTraceLayout,
      nodeTypes: LENS_NODE_TYPES
    } : void 0),
    [chart, runner]
  );
  const effectiveStepGraph = stepGraph ?? recorder.getStepGraph();
  const toolDescriptions = (0, import_react12.useMemo)(
    () => buildToolDescriptions(recorder),
    // log identity changes each event tick — the dep signals
    // re-aggregation when new events arrive.
    [recorder, log]
  );
  const mergedTemplates = (0, import_react12.useMemo)(
    () => commentaryTemplates ? {
      ...import_agentfootprint5.defaultCommentaryTemplates,
      ...commentaryTemplates
    } : import_agentfootprint5.defaultCommentaryTemplates,
    [commentaryTemplates]
  );
  const effectiveAppName = appName ?? "Chatbot";
  const liveStreamLine = (0, import_react12.useMemo)(
    () => computeLiveStreamLine(recorder, effectiveAppName, mergedTemplates),
    // log identity changes on every event tick — that's our re-render
    // signal even though we read recorder.liveState directly.
    [recorder, log, effectiveAppName, mergedTemplates]
  );
  const effectiveHumanizer = (0, import_react12.useMemo)(
    () => humanizer ?? makeTeachingHumanizer({
      ...appName !== void 0 ? { appName } : {},
      getToolDescription: (n) => toolDescriptions.get(n),
      ...commentaryTemplates !== void 0 ? { commentaryTemplates } : {}
    }),
    [humanizer, appName, toolDescriptions, commentaryTemplates]
  );
  const { drillPath, drillInto, drillTo } = useDrillPath();
  const syncMap = useCommitSync(recorder);
  const cursorPositions = useCursorPositions(recorder, drillPath);
  const stepCount = Math.max(1, cursorPositions.length);
  const maxStep = Math.max(0, stepCount - 1);
  const [focusStep, setFocusStep] = (0, import_react12.useState)(0);
  const cursorRuntimeStageId = cursorPositions[focusStep]?.runtimeStageId ?? "";
  const [autoAdvance, setAutoAdvance] = (0, import_react12.useState)(true);
  (0, import_react12.useEffect)(() => {
    if (autoAdvance) setFocusStep(maxStep);
  }, [maxStep, autoAdvance]);
  const handleFocusChange = (n) => {
    setFocusStep(n);
    setAutoAdvance(n >= maxStep);
  };
  const isLive = autoAdvance && focusStep >= maxStep;
  if (view === "user") return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(UserView, { tree, summary });
  if (view === "analyst")
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      AnalystView,
      {
        summary,
        log,
        humanizer: effectiveHumanizer,
        total: stepCount,
        focusSeq: focusStep,
        onFocusChange: handleFocusChange,
        isLive,
        liveStreamLine
      }
    );
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    EngineerView,
    {
      recorder,
      ...runner ? { runner } : {},
      ...effectiveChart ? { chart: effectiveChart } : {},
      stepGraph: effectiveStepGraph,
      summary,
      log,
      humanizer: effectiveHumanizer,
      appName: effectiveAppName,
      total: stepCount,
      focusStep,
      onFocusChange: handleFocusChange,
      isLive,
      liveStreamLine,
      drillPath,
      onDrillInto: drillInto,
      onDrillTo: drillTo,
      syncMap,
      cursorPositions,
      cursorRuntimeStageId,
      ...toolChoice ? { toolChoice: toolChoiceData } : {}
    }
  );
};
function computeLiveStreamLine(recorder, appName, templates) {
  if (!recorder.liveState.isLLMInFlight()) return null;
  const partial = recorder.liveState.getPartialLLM();
  if (partial.length === 0) {
    const tmpl2 = templates["stream.thinking"] ?? "";
    return (0, import_agentfootprint5.renderCommentary)(tmpl2, { appName });
  }
  const tmpl = templates["stream.token.partial"] ?? "";
  return (0, import_agentfootprint5.renderCommentary)(tmpl, { appName, partial });
}
function buildToolDescriptions(recorder) {
  return recorder.aggregate((m, entry) => {
    if (entry.event.type !== "agentfootprint.context.injected") return m;
    const p = entry.event.payload;
    if (p.source !== "registry" || p.slot !== "tools") return m;
    const name = p.sourceId;
    const summary = p.contentSummary;
    if (!name || !summary) return m;
    const prefix = `${name}: `;
    const desc = summary.startsWith(prefix) ? summary.slice(prefix.length) : summary;
    m.set(name, desc);
    return m;
  }, /* @__PURE__ */ new Map());
}
var EngineerView = ({
  recorder,
  runner,
  chart,
  stepGraph,
  summary,
  log,
  humanizer,
  appName,
  total,
  focusStep,
  onFocusChange,
  isLive,
  liveStreamLine,
  drillPath,
  onDrillInto,
  onDrillTo,
  syncMap,
  cursorPositions,
  cursorRuntimeStageId,
  toolChoice
}) => {
  void syncMap;
  const traceOverlay = (0, import_react12.useMemo)(
    () => recorder.runtime.getOverlay(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder, recorder.runtime.version()]
  );
  const selectedSpecNodeId = cursorRuntimeStageId ? cursorRuntimeStageId.split("#")[0] ?? "" : "";
  const drillInto = onDrillInto;
  const drillTo = onDrillTo;
  const groups = (0, import_react12.useMemo)(() => {
    try {
      return buildGroups(recorder.boundary.boundaryIndex);
    } catch {
      return [];
    }
  }, [recorder, log]);
  const hopsDrillPath = (0, import_react12.useMemo)(
    () => innerGroupSubflowPath(groups, drillPath),
    [groups, drillPath]
  );
  const hops = (0, import_react12.useMemo)(() => {
    if (!stepGraph) return [];
    const agentInstances = selectAgentInstances(stepGraph);
    return selectHops({ graph: stepGraph, drillPath: hopsDrillPath, agents: agentInstances });
  }, [stepGraph, hopsDrillPath]);
  const focusedHop = hops[focusStep];
  const focusedNode = focusedHop?.anchorStep ?? stepGraph?.nodes[focusStep];
  const focusedRuntimeStageId = focusedNode?.runtimeStageId;
  const { cursorFocusedNode, cursorRelatedNodes } = (0, import_react12.useMemo)(() => {
    if (!stepGraph || stepGraph.nodes.length === 0 || !cursorRuntimeStageId) {
      return {
        cursorFocusedNode: void 0,
        cursorRelatedNodes: []
      };
    }
    const cursorKind = cursorPositions[focusStep]?.kind;
    const base = cursorRuntimeStageId.split("#")[0];
    if (base === "__root__" && cursorKind === "group-start") {
      return {
        cursorFocusedNode: void 0,
        cursorRelatedNodes: []
      };
    }
    const exact = stepGraph.nodes.find(
      (n) => n.runtimeStageId === cursorRuntimeStageId
    );
    const related = stepGraph.nodes.filter((n) => {
      if (n === exact) return false;
      if (base === "__root__") {
        return true;
      }
      return n.subflowPath.includes(base);
    });
    return { cursorFocusedNode: exact, cursorRelatedNodes: related };
  }, [stepGraph, cursorRuntimeStageId, cursorPositions, focusStep]);
  const cursorInternalStage = (0, import_react12.useMemo)(() => {
    if (cursorFocusedNode || drillPath.length === 0 || !chart) return void 0;
    const node = chart.graph.nodes.find((n) => n.id === selectedSpecNodeId);
    const data = node?.data;
    if (!data || data.subflowOf === void 0) return void 0;
    const entry = traceOverlay.executionOrder.find((e) => e.runtimeStageId === cursorRuntimeStageId);
    return {
      name: data.label ?? entry?.stageName ?? selectedSpecNodeId,
      ...data.description !== void 0 ? { description: data.description } : {},
      ...entry && typeof entry.timestampMs === "number" ? { offsetMs: entry.timestampMs } : {}
    };
  }, [cursorFocusedNode, drillPath, chart, selectedSpecNodeId, traceOverlay, cursorRuntimeStageId]);
  const { runInput, runOutput } = (0, import_react12.useMemo)(() => {
    let input;
    let output;
    try {
      const events = recorder.boundary.getEvents?.() ?? [];
      for (const e of events) {
        const ev = e;
        if (ev?.type === "run.entry" && input === void 0) input = ev.payload;
        if (ev?.type === "run.exit") output = ev.payload;
      }
    } catch {
    }
    return { runInput: input, runOutput: output };
  }, [recorder, log]);
  const rootPhase = cursorRuntimeStageId.startsWith("__root__") ? cursorPositions[focusStep]?.kind === "group-end" ? "end" : "start" : void 0;
  const runError = summary.error;
  const coActiveStageIds = (0, import_react12.useMemo)(() => {
    const ids = cursorPositions[focusStep]?.coActiveGroupIds;
    if (!ids || ids.length === 0) return void 0;
    return new Set(ids.map((id) => id.split("#")[0]));
  }, [cursorPositions, focusStep]);
  const stepToEventSeq = (0, import_react12.useMemo)(() => {
    if (!stepGraph || hops.length === 0 || log.length === 0) return [];
    const firstSeq = log[0].seq;
    const seqs = [];
    let lastResolvedSeq = firstSeq;
    const anchorSide = (kind) => kind === "llm->user" || kind === "answers" ? "last" : "first";
    for (const hop of hops) {
      const id = hop.anchorStep?.runtimeStageId;
      let resolved = -1;
      if (id !== void 0) {
        const side = anchorSide(hop.kind);
        if (side === "first") {
          for (const e of log) {
            const stageId = e.event.meta?.runtimeStageId;
            if (stageId === id) {
              resolved = e.seq;
              break;
            }
          }
        } else {
          for (let i = log.length - 1; i >= 0; i--) {
            const stageId = log[i].event.meta?.runtimeStageId;
            if (stageId === id) {
              resolved = log[i].seq;
              break;
            }
          }
        }
      }
      if (resolved === -1) resolved = lastResolvedSeq;
      seqs.push(resolved);
      lastResolvedSeq = resolved;
    }
    return seqs;
  }, [stepGraph, hops, log]);
  const isPlumbingEvent = (0, import_react12.useCallback)((eventType) => {
    if (!eventType) return false;
    const stripped = eventType.startsWith("agentfootprint.") ? eventType.slice("agentfootprint.".length) : eventType;
    return stripped === "run.entry" || stripped === "run.exit" || stripped === "subflow.entry" || stripped === "subflow.exit" || stripped === "context.injected" || stripped === "context.slot_composed" || stripped === "stream.token" || stripped === "stream.thinking_delta";
  }, []);
  const commentarySeqs = (0, import_react12.useMemo)(() => {
    const seqs = new Array(cursorPositions.length).fill(-1);
    if (log.length === 0) return seqs;
    const matchesScope = (stageId, rid) => {
      if (!stageId) return false;
      const base = rid.split("#")[0];
      return stageId === rid || stageId === base || stageId.startsWith(`${base}/`);
    };
    let searchFrom = 0;
    let prevSeq = -1;
    for (let s = 0; s < cursorPositions.length; s++) {
      const cur = cursorPositions[s];
      const rid = cur.runtimeStageId;
      if (rid.startsWith("__root__")) {
        if (cur.kind === "group-end") {
          prevSeq = log[log.length - 1].seq;
          seqs[s] = prevSeq;
        } else {
          seqs[s] = -1;
        }
        continue;
      }
      let resolved = prevSeq;
      let foundIdx = -1;
      if (cur.kind === "group-end") {
        for (let i = log.length - 1; i >= searchFrom; i--) {
          const e = log[i];
          if (isPlumbingEvent(e.event?.type)) continue;
          if (matchesScope(e.event.meta?.runtimeStageId, rid)) {
            resolved = e.seq;
            foundIdx = i;
            break;
          }
        }
      } else {
        for (let i = searchFrom; i < log.length; i++) {
          const e = log[i];
          if (isPlumbingEvent(e.event?.type)) continue;
          if (matchesScope(e.event.meta?.runtimeStageId, rid)) {
            resolved = e.seq;
            foundIdx = i;
            break;
          }
        }
      }
      seqs[s] = resolved;
      prevSeq = resolved;
      if (foundIdx >= 0) searchFrom = foundIdx + 1;
    }
    return seqs;
  }, [cursorPositions, log, isPlumbingEvent]);
  const focusedSeq = (0, import_react12.useMemo)(() => {
    const v2 = commentarySeqs[focusStep];
    return v2 !== void 0 ? v2 : stepToEventSeq[focusStep] ?? -1;
  }, [commentarySeqs, focusStep, stepToEventSeq]);
  const timelineMoments = (0, import_react12.useMemo)(
    () => buildTimelineMoments({
      cursorPositions,
      commentarySeqs,
      log,
      humanizer,
      executionOrder: traceOverlay.executionOrder
    }),
    [cursorPositions, commentarySeqs, log, humanizer, traceOverlay]
  );
  const handleNodeSelect = (nodeId) => {
    if (!stepGraph) return;
    const hopIdx = hops.findIndex((h) => h.anchorStep?.id === nodeId);
    if (hopIdx >= 0) {
      onFocusChange(hopIdx);
      return;
    }
    const idx = stepGraph.nodes.findIndex((n) => n.id === nodeId);
    if (idx >= 0) onFocusChange(idx);
  };
  const [leftExpanded, setLeftExpanded] = (0, import_react12.useState)(true);
  const [rightExpanded, setRightExpanded] = (0, import_react12.useState)(true);
  const [bottomExpanded, setBottomExpanded] = (0, import_react12.useState)(false);
  const [toolChoiceExpanded, setToolChoiceExpanded] = (0, import_react12.useState)(false);
  const agentNodes = (0, import_react12.useMemo)(() => {
    const all = stepGraph?.nodes ?? [];
    return all.filter(
      (n) => n.kind === "subflow" && (n.primitiveKind === "Agent" || n.primitiveKind === "LLMCall")
    );
  }, [stepGraph]);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 0,
        height: "100%",
        minHeight: 0,
        overflow: "hidden"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { flex: 1, minWidth: 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SummaryCard, { summary }) }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            CopyForLLMButton,
            {
              recorder,
              ...stepGraph ? { stepGraph } : {},
              humanizer,
              appName,
              viewState: {
                focusStep,
                totalSteps: total,
                isLive,
                drillPath,
                mode: drillPath.length > 0 ? "drill-down" : "top-level",
                ...focusedNode ? {
                  currentStep: {
                    label: focusedNode.label,
                    kind: focusedNode.kind,
                    ...focusedNode.runtimeStageId ? { runtimeStageId: focusedNode.runtimeStageId } : {},
                    subflowPath: focusedNode.subflowPath,
                    ...focusedNode.iterationIndex !== void 0 ? { iterationIndex: focusedNode.iterationIndex } : {}
                  }
                } : {},
                ...focusedSeq >= 0 ? { focusedEventSeq: focusedSeq } : {}
              }
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          TimeTravel,
          {
            compact: true,
            total,
            focusSeq: focusStep,
            onFocusChange,
            isLive
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "div",
          {
            style: {
              flex: 1,
              minHeight: 0,
              display: "flex",
              overflow: "hidden"
            },
            children: [
              agentNodes.length >= 2 && (leftExpanded ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                  "div",
                  {
                    style: {
                      width: 200,
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                      borderRight: `1px solid ${T.border}`
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SidePanelHeader, { title: "Agents" }),
                      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                        AgentList,
                        {
                          nodes: agentNodes,
                          selectedId: focusedNode?.id,
                          onSelect: handleNodeSelect
                        }
                      ) })
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  VLinePill,
                  {
                    label: "Agents",
                    expanded: true,
                    side: "left",
                    onClick: () => setLeftExpanded(false)
                  }
                )
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                VLinePill,
                {
                  label: "Agents",
                  expanded: false,
                  side: "left",
                  onClick: () => setLeftExpanded(true)
                }
              )),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                "div",
                {
                  style: {
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden"
                  },
                  children: [
                    drillPath.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                      Breadcrumb,
                      {
                        path: drillPath,
                        labels: drillPathLabels(groups, drillPath),
                        onJumpTo: (i) => {
                          drillTo(drillPath.slice(0, i));
                          onFocusChange(0);
                        }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                      "div",
                      {
                        style: {
                          flex: 1,
                          minHeight: 0,
                          background: T.bgPrimary,
                          overflow: "hidden"
                        },
                        children: runner && chart ? (
                          // Single-pipeline renderer over the chart — `chart` here is the
                          // effectiveChart from <Lens> (consumer-supplied, or DERIVED from the
                          // runner). Node ids are the real runtime-stage ids, so the cursor
                          // overlay lights the executed path as the slider scrubs. Wrapped in
                          // an error boundary so a malformed chart never white-screens the
                          // whole monitor. See `memory/lens_v0_1_one_cursor_architecture.md`.
                          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(LensChartBoundary, { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                            LensFlow,
                            {
                              chart,
                              selectedRuntimeStageId: cursorRuntimeStageId,
                              selectedCursorKind: cursorPositions[focusStep]?.kind,
                              ...coActiveStageIds ? { coActiveStageIds } : {},
                              onNodeClick: (nodeId) => {
                                const chain = resolveDrillChain(groups, nodeId);
                                if (chain) {
                                  drillInto(chain);
                                  onFocusChange(0);
                                }
                              },
                              traceRuntimeOverlay: traceOverlay
                            }
                          ) })
                        ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { padding: 24, color: T.textMuted, fontSize: 12 }, children: [
                          "No runner attached \u2014 pass the agentfootprint Runner via",
                          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("code", { children: " <Lens runner={runner} />" }),
                          " to render the composition graph."
                        ] })
                      }
                    )
                  ]
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                VLinePill,
                {
                  label: "Details",
                  expanded: rightExpanded,
                  side: "right",
                  onClick: () => setRightExpanded((v2) => !v2)
                }
              ),
              rightExpanded && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "div",
                {
                  style: {
                    // The "WHAT HAPPENED" timeline rail. Wider than the old details
                    // pane (it now carries scrubber + commentary + details in one),
                    // but still flex-shrinks so the central flowchart keeps room.
                    flex: "0 1 430px",
                    minWidth: 300,
                    maxWidth: 480,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    borderLeft: `1px solid ${T.border}`
                  },
                  children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    WhatHappenedTimeline,
                    {
                      moments: timelineMoments,
                      focusStep,
                      onFocusChange,
                      ...cursorFocusedNode || cursorInternalStage || runInput !== void 0 || runOutput !== void 0 || runError !== void 0 ? {
                        // Pass the framed detail card ONLY when there's REAL structured
                        // detail (a focused stage, a drilled internal, or run I/O). A
                        // bare milestone (Iteration / Context) shows just its tight
                        // description line — no empty framed "Click a node" box.
                        detail: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                          NodeDetailPanel,
                          {
                            hideEmptyState: true,
                            ...cursorFocusedNode ? { node: cursorFocusedNode } : {},
                            relatedNodes: cursorRelatedNodes,
                            cursorRuntimeStageId,
                            ...rootPhase ? { rootPhase } : {},
                            ...runInput !== void 0 ? { runInput } : {},
                            ...runOutput !== void 0 ? { runOutput } : {},
                            ...runError !== void 0 ? { runError } : {},
                            ...cursorInternalStage ? { internalStage: cursorInternalStage } : {}
                          }
                        )
                      } : {}
                    }
                  )
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          HLinePill,
          {
            label: "Commentary",
            detail: `${log.length} moments`,
            expanded: bottomExpanded,
            onClick: () => setBottomExpanded((v2) => !v2)
          }
        ),
        bottomExpanded && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "div",
          {
            style: {
              height: 180,
              flexShrink: 0,
              borderTop: `1px solid ${T.border}`,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: T.bgElevated
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              Commentary,
              {
                log,
                humanizer,
                liveStreamLine,
                focusedSeq,
                cursorScopeBase: cursorRuntimeStageId ? cursorRuntimeStageId.split("#")[0] : void 0,
                ...cursorInternalStage ? {
                  syntheticCurrentLine: cursorInternalStage.description ? `${cursorInternalStage.name} \u2014 ${cursorInternalStage.description}` : cursorInternalStage.name
                } : {}
              }
            )
          }
        ),
        toolChoice && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            HLinePill,
            {
              label: "Tool choice",
              detail: toolChoice.summary ? `${toolChoice.summary.flagged} flagged \xB7 ${toolChoice.summary.scored} scored` : toolChoice.pending ? "scoring\u2026" : `${toolChoice.calls.length} calls`,
              expanded: toolChoiceExpanded,
              onClick: () => setToolChoiceExpanded((v2) => !v2)
            }
          ),
          toolChoiceExpanded && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "div",
            {
              style: {
                height: 200,
                flexShrink: 0,
                borderTop: `1px solid ${T.border}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                background: T.bgElevated
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                ToolChoicePanel,
                {
                  calls: toolChoice.calls,
                  ...toolChoice.summary ? { summary: toolChoice.summary } : {},
                  cursorRuntimeStageId,
                  ...cursorPositions[focusStep]?.kind ? { cursorKind: cursorPositions[focusStep].kind } : {},
                  pending: toolChoice.pending,
                  ...toolChoice.error !== void 0 ? { error: toolChoice.error } : {}
                }
              )
            }
          )
        ] })
      ]
    }
  );
};
var SyntheticNowLine = import_react12.default.forwardRef(
  function SyntheticNowLine2({ line }, ref) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "div",
      {
        ref,
        style: {
          padding: "3px 8px",
          borderBottom: `1px solid ${T.border}`,
          background: `color-mix(in srgb, ${T.warning} 20%, transparent)`,
          borderLeft: `3px solid ${T.warning}`,
          color: T.textPrimary,
          fontWeight: 500,
          lineHeight: 1.55
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "span",
            {
              style: {
                display: "inline-block",
                minWidth: 56,
                marginRight: 8,
                fontFamily: T.fontMono,
                fontSize: 10,
                color: T.warning
              },
              children: "now"
            }
          ),
          line
        ]
      }
    );
  }
);
var Commentary = ({ log, humanizer, focusedSeq, cursorScopeBase, liveStreamLine, syntheticCurrentLine }) => {
  const containerRef = (0, import_react12.useRef)(null);
  const firstFocusRef = (0, import_react12.useRef)(null);
  const syntheticRef = (0, import_react12.useRef)(null);
  (0, import_react12.useEffect)(() => {
    if (focusedSeq === void 0 || focusedSeq < 0 || !firstFocusRef.current)
      return;
    firstFocusRef.current.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  }, [focusedSeq]);
  (0, import_react12.useEffect)(() => {
    if (!syntheticCurrentLine || !syntheticRef.current) return;
    syntheticRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [syntheticCurrentLine]);
  const seqToIndex = (0, import_react12.useMemo)(() => {
    const m = /* @__PURE__ */ new Map();
    for (let i = 0; i < log.length; i++) m.set(log[i].seq, i);
    return m;
  }, [log]);
  let firstFocusAssigned = false;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "div",
    {
      ref: containerRef,
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "6px 12px",
        fontSize: 12,
        lineHeight: 1.6,
        fontFamily: T.fontSans
      },
      children: (() => {
        if (log.length === 0) {
          return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { color: T.textSecondary, fontStyle: "italic" }, children: "No moments yet \u2014 run a sample to see commentary." });
        }
        const cutoff = focusedSeq === void 0 || focusedSeq < 0 ? -1 : Math.max(0, seqToIndex.get(focusedSeq) ?? -1);
        if (cutoff < 0) {
          if (syntheticCurrentLine) {
            return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SyntheticNowLine, { ref: syntheticRef, line: syntheticCurrentLine });
          }
          return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { color: T.textSecondary, fontStyle: "italic" }, children: "Scrub the slider to walk through the run." });
        }
        const visible = log.slice(0, cutoff + 1);
        const { hidden, shown } = tailWindow(visible, MAX_COMMENTARY_LINES);
        const scopePrefix = cursorScopeBase && cursorScopeBase !== "__root__" ? `${cursorScopeBase}/` : void 0;
        const inScope = (entry) => {
          if (!scopePrefix) return true;
          const stageId = entry.event.meta?.runtimeStageId;
          if (!stageId) return false;
          return stageId === cursorScopeBase || stageId.startsWith(scopePrefix);
        };
        let prevLine = null;
        return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
          hidden > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
            "div",
            {
              style: {
                padding: "3px 8px",
                borderBottom: `1px solid ${T.border}`,
                color: T.textSecondary,
                fontStyle: "italic"
              },
              children: [
                "\u2026 ",
                hidden.toLocaleString(),
                " earlier moments hidden (showing the latest ",
                MAX_COMMENTARY_LINES,
                " up to the cursor \u2014 scrub back to bring them into the window)"
              ]
            }
          ),
          shown.map((entry, i) => {
            const line = humanizer(entry.event);
            if (line === null) return null;
            if (line === prevLine) return null;
            prevLine = line;
            const focused = focusedSeq !== void 0 && entry.seq === focusedSeq;
            const isLastFocused = focused && hidden + i === cutoff;
            const entryInScope = inScope(entry);
            const dimOutOfScope = !entryInScope && !focused;
            return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
              "div",
              {
                ref: isLastFocused ? firstFocusRef : void 0,
                style: {
                  padding: "3px 8px",
                  borderBottom: `1px solid ${T.border}`,
                  background: focused ? `color-mix(in srgb, ${T.warning} 20%, transparent)` : "transparent",
                  borderLeft: focused ? `3px solid ${T.warning}` : "3px solid transparent",
                  color: focused ? T.textPrimary : T.textSecondary,
                  fontWeight: focused ? 500 : 400,
                  opacity: dimOutOfScope ? 0.4 : 1,
                  lineHeight: 1.55,
                  transition: "background 0.2s ease, color 0.2s ease, opacity 0.2s ease"
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                    "span",
                    {
                      style: {
                        display: "inline-block",
                        minWidth: 56,
                        marginRight: 8,
                        fontFamily: T.fontMono,
                        fontSize: 10,
                        color: focused ? T.warning : T.border
                      },
                      children: [
                        "+",
                        Math.round(entry.runOffsetMs),
                        "ms"
                      ]
                    }
                  ),
                  line
                ]
              },
              entry.seq
            );
          }),
          syntheticCurrentLine && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SyntheticNowLine, { ref: syntheticRef, line: syntheticCurrentLine }),
          liveStreamLine !== null && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(LiveStreamLine, { line: liveStreamLine })
        ] });
      })()
    }
  );
};
var SidePanelHeader = ({ title }) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
  "div",
  {
    style: {
      padding: "8px 12px",
      borderBottom: `1px solid ${T.border}`,
      fontSize: 11,
      fontWeight: 600,
      color: T.textMuted,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      flex: "none",
      background: T.bgElevated
    },
    children: title
  }
);
var AgentList = ({ nodes, selectedId, onSelect }) => {
  if (nodes.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "div",
      {
        style: {
          padding: 12,
          fontSize: 11,
          color: T.textSecondary,
          fontStyle: "italic"
        },
        children: "No Agent or LLMCall instances in this run."
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { padding: 4, display: "flex", flexDirection: "column" }, children: nodes.map((n) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    AgentListRow,
    {
      node: n,
      selected: n.id === selectedId,
      onClick: () => onSelect(n.id)
    },
    n.id
  )) });
};
var AgentListRow = ({ node, selected, onClick }) => {
  const icon = node.primitiveKind === "Agent" ? "\u{1F916}" : node.primitiveKind === "LLMCall" ? "\u{1F4E1}" : "\u2699\uFE0F";
  const subtitle = node.primitiveKind === "Agent" ? "ReAct" : node.primitiveKind === "LLMCall" ? "one-shot" : node.primitiveKind ?? "runner";
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "button",
    {
      onClick,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        margin: "1px 0",
        border: "none",
        borderRadius: 4,
        background: selected ? `color-mix(in srgb, ${T.warning} 20%, transparent)` : "transparent",
        color: T.textPrimary,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: 11,
        width: "100%"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { "aria-hidden": true, style: { fontSize: 14 }, children: icon }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { style: { display: "flex", flexDirection: "column", minWidth: 0 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "span",
            {
              style: {
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis"
              },
              children: node.label
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "span",
            {
              style: {
                fontSize: 9,
                color: T.textSecondary,
                textTransform: "uppercase",
                letterSpacing: 0.4
              },
              children: subtitle
            }
          )
        ] })
      ]
    }
  );
};
var HLinePill = (0, import_react12.memo)(function HLinePill2({
  label,
  detail,
  expanded,
  onClick
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", alignItems: "center", flex: "none" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { flex: 1, height: 1, background: T.border } }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "button",
      {
        onClick,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 12px",
          margin: "4px 0",
          fontSize: 10,
          fontWeight: 600,
          fontFamily: "inherit",
          color: T.textMuted,
          background: T.bgElevated,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          cursor: "pointer",
          whiteSpace: "nowrap",
          letterSpacing: "0.04em",
          textTransform: "uppercase"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { fontSize: 7 }, children: expanded ? "\u25BC" : "\u25B6" }),
          label,
          detail && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { fontWeight: 400, opacity: 0.5, fontSize: 9 }, children: detail })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { flex: 1, height: 1, background: T.border } })
  ] });
});
var VLinePill = (0, import_react12.memo)(function VLinePill2({
  label,
  expanded,
  side = "right",
  onClick
}) {
  const arrow = side === "right" ? expanded ? "\u25B6" : "\u25C0" : expanded ? "\u25C0" : "\u25B6";
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flex: "none"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { flex: 1, width: 1, background: T.border } }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "button",
          {
            onClick,
            style: {
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "10px 4px",
              margin: "0 3px",
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "inherit",
              color: T.textMuted,
              background: T.bgElevated,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              cursor: "pointer",
              whiteSpace: "nowrap",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              writingMode: "vertical-lr"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { fontSize: 7, writingMode: "horizontal-tb" }, children: arrow }),
              label
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { flex: 1, width: 1, background: T.border } })
      ]
    }
  );
});
var Breadcrumb = ({ path, labels, onJumpTo }) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
  "div",
  {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 10px",
      fontSize: 12,
      color: T.textMuted,
      fontFamily: T.fontSans
    },
    children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "button",
        {
          onClick: () => onJumpTo(0),
          style: crumbButtonStyle(),
          title: "Top-level view",
          children: "\u25C0 Run"
        }
      ),
      path.map((segment, i) => {
        const label = (labels?.[i] ?? segment).replace(/^step-/, "");
        return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_react12.default.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { style: { opacity: 0.5 }, children: "/" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            "button",
            {
              onClick: () => onJumpTo(i + 1),
              style: crumbButtonStyle(i === path.length - 1),
              children: label
            }
          )
        ] }, segment);
      })
    ]
  }
);
function crumbButtonStyle(current = false) {
  return {
    background: current ? T.warning : "transparent",
    color: current ? "#fff" : T.textSecondary,
    border: `1px solid ${current ? T.warning : T.border}`,
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    lineHeight: 1.4
  };
}
var AnalystView = ({
  summary,
  log,
  humanizer,
  total,
  focusSeq,
  onFocusChange,
  isLive,
  liveStreamLine
}) => {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "grid", gap: 16 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SummaryCard, { summary }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      TimeTravel,
      {
        total,
        focusSeq,
        onFocusChange,
        isLive
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Card, { title: "Commentary", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { fontSize: 13, lineHeight: 1.6, fontFamily: T.fontSans }, children: [
      (() => {
        const { hidden, shown } = tailWindow(log, MAX_COMMENTARY_LINES);
        return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
          hidden > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
            "div",
            {
              style: {
                padding: "4px 0",
                borderBottom: `1px solid ${T.border}`,
                color: T.textSecondary,
                fontStyle: "italic"
              },
              children: [
                "\u2026 ",
                hidden.toLocaleString(),
                " earlier moments hidden (showing the latest ",
                MAX_COMMENTARY_LINES,
                ")"
              ]
            }
          ),
          shown.map((entry) => {
            const line = humanizer(entry.event);
            if (line === null) return null;
            return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
              "div",
              {
                style: {
                  padding: "4px 0",
                  borderBottom: `1px solid ${T.border}`
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { style: { opacity: 0.5, marginRight: 8 }, children: [
                    "+",
                    Math.round(entry.runOffsetMs),
                    "ms"
                  ] }),
                  line
                ]
              },
              entry.seq
            );
          })
        ] });
      })(),
      liveStreamLine !== null && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(LiveStreamLine, { line: liveStreamLine })
    ] }) })
  ] });
};
var CopyForLLMButton = ({ recorder, stepGraph, humanizer, appName, viewState }) => {
  const [copied, setCopied] = (0, import_react12.useState)(false);
  const handleCopy = async () => {
    const { buildLLMText: buildLLMText2 } = await Promise.resolve().then(() => (init_copyForLLM(), copyForLLM_exports));
    const text = buildLLMText2({
      recorder,
      ...stepGraph ? { stepGraph } : {},
      humanizer,
      appName,
      ...viewState ? { viewState } : {}
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2e3);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "button",
    {
      onClick: handleCopy,
      title: "Copy run as LLM-ready text \u2014 paste into Claude/ChatGPT to debug",
      "aria-label": "Copy run as LLM-ready text",
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        // Icon-only (the tooltip explains it) — the full "Copy for LLM" label
        // ate space the metrics row needed. Compact square button.
        padding: "6px 8px",
        marginRight: 6,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        color: copied ? "#fff" : T.textPrimary,
        background: copied ? T.warning : T.bgElevated,
        border: `1px solid ${copied ? T.warning : T.border}`,
        borderRadius: 6,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flex: "none",
        transition: "background 0.15s, color 0.15s, border-color 0.15s"
      },
      children: copied ? "\u2713" : "\u{1F4CB}"
    }
  );
};
var LiveStreamLine = ({ line }) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
  "div",
  {
    style: {
      padding: "4px 8px",
      marginTop: 4,
      borderRadius: 4,
      background: `color-mix(in srgb, ${T.warning} 12%, transparent)`,
      borderLeft: `3px solid ${T.warning}`,
      color: T.warning,
      fontStyle: "italic"
    },
    children: [
      line,
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "span",
        {
          style: {
            marginLeft: 4,
            opacity: 0.7,
            animation: "lens-blink 1s steps(2, start) infinite"
          },
          children: "\u258D"
        }
      )
    ]
  }
);
var UserView = ({ tree, summary }) => {
  const finalContent = extractFinalContent(tree);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "div",
    {
      style: {
        padding: 16,
        fontFamily: T.fontSans,
        display: "grid",
        gap: 12
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "div",
          {
            style: {
              fontSize: 11,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: 0.4
            },
            children: [
              summary.status,
              " \xB7 ",
              summary.iterationCount,
              " iterations \xB7",
              " ",
              summary.toolCallCount,
              " tool calls"
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "div",
          {
            style: {
              fontSize: 15,
              lineHeight: 1.6,
              padding: 12,
              background: T.bgElevated,
              borderRadius: 6,
              border: `1px solid ${T.border}`
            },
            children: finalContent ?? "Run in progress\u2026"
          }
        )
      ]
    }
  );
};
function extractFinalContent(node) {
  let last;
  const walk = (n) => {
    if (n.kind === "llm-call" && n.details?.kind === "llm-call") {
      last = n.details.llm.content;
    }
    for (const c of n.children) walk(c);
  };
  walk(node);
  return last;
}
var Card = ({
  title,
  children
}) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
  "div",
  {
    style: {
      border: `1px solid ${T.border}`,
      borderRadius: 6,
      fontFamily: T.fontSans
    },
    children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "div",
        {
          style: {
            padding: "8px 12px",
            borderBottom: `1px solid ${T.border}`,
            fontSize: 12,
            fontWeight: 500,
            color: T.textSecondary,
            textTransform: "uppercase",
            letterSpacing: 0.4
          },
          children: title
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { padding: 8 }, children })
    ]
  }
);

// src/react/Replay.tsx
var import_react13 = require("react");
var import_flowchart6 = require("footprint-explainable-ui/flowchart");
var import_jsx_runtime9 = require("react/jsx-runtime");
var Replay = ({
  trace,
  warnOnRawContent = true,
  showControls = true,
  showBackground = true
}) => {
  const chart = (0, import_react13.useMemo)(
    () => trace.structure === void 0 ? void 0 : {
      graph: structureGraphFromSpec(trace.structure),
      layout: import_flowchart6.dagreTraceLayout,
      nodeTypes: LENS_NODE_TYPES
    },
    [trace.structure]
  );
  if (chart === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "lens-replay lens-replay--no-structure", role: "status", children: [
      "This trace has no ",
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: "structure" }),
      " to replay \u2014 re-capture with",
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: " enable.localObservability()" }),
      "."
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "lens-replay", children: [
    warnOnRawContent && trace.redaction === "none" && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "lens-replay__warning", role: "status", children: "\u26A0 This trace contains raw, un-redacted content." }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      LensFlow,
      {
        chart,
        showControls,
        showBackground
      }
    )
  ] });
};

// src/react/RunTreeView.tsx
var import_react14 = require("react");
var import_jsx_runtime10 = require("react/jsx-runtime");
function defaultExpanded(node, depth) {
  return depth < 3 && node.children.length > 0;
}
function flattenVisible(root, baseDepth, overrides) {
  const rows = [];
  const walk = (node, depth, parentPath) => {
    const pathKey = parentPath === "" ? node.id : `${parentPath}/${node.id}`;
    const expanded = overrides.get(pathKey) ?? defaultExpanded(node, depth);
    rows.push({ node, depth, expanded, pathKey });
    if (expanded) for (const child of node.children) walk(child, depth + 1, pathKey);
  };
  walk(root, baseDepth, "");
  return rows;
}
var RunTreeView = ({
  node,
  onSelect,
  selectedId,
  depth = 0,
  virtualizeThreshold = 300,
  rowHeight = 26,
  maxHeight = 480
}) => {
  const [overrides, setOverrides] = (0, import_react14.useState)(/* @__PURE__ */ new Map());
  const rows = (0, import_react14.useMemo)(
    () => flattenVisible(node, depth, overrides),
    [node, depth, overrides]
  );
  const w = useWindowedList({
    count: rows.length,
    rowHeight,
    threshold: virtualizeThreshold
  });
  const toggle = (row) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(row.pathKey, !row.expanded);
      return next;
    });
  };
  const body = /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    w.topPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { height: w.topPad }, "aria-hidden": true }),
    rows.slice(w.start, w.end).map((row) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
      RunTreeRow,
      {
        row,
        selected: row.node.id === selectedId,
        ...w.windowed ? { fixedHeight: rowHeight } : {},
        onClick: () => {
          if (row.node.children.length > 0) toggle(row);
          onSelect?.(row.node);
        },
        clickable: row.node.children.length > 0 || onSelect !== void 0
      },
      row.pathKey
    )),
    w.bottomPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { height: w.bottomPad }, "aria-hidden": true })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { fontFamily: T.fontMono, fontSize: 13, lineHeight: 1.5 }, children: w.windowed ? (
    // Windowing needs a scroll container with a bounded height —
    // engaged only past the threshold, where an unbounded tree
    // wouldn't be usable anyway.
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { style: { maxHeight, overflowY: "auto" }, onScroll: w.onScroll, children: body })
  ) : body });
};
var RunTreeRow = ({ row, selected, clickable, onClick, fixedHeight }) => {
  const { node, depth, expanded } = row;
  const hasChildren = node.children.length > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
    "div",
    {
      onClick,
      style: {
        cursor: clickable ? "pointer" : "default",
        background: selected ? T.bgTertiary : "transparent",
        borderLeft: selected ? `3px solid ${T.primary}` : "3px solid transparent",
        // Longhands only — the original mixed `paddingLeft: depth * 16`
        // with a later `padding` SHORTHAND, which silently reset the
        // indent to 6px (and React warns on shorthand/longhand mixes).
        paddingTop: 2,
        paddingRight: 4,
        paddingBottom: 2,
        paddingLeft: depth * 16 + 6,
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        ...fixedHeight !== void 0 ? {
          height: fixedHeight,
          boxSizing: "border-box",
          overflow: "hidden",
          whiteSpace: "nowrap"
        } : {}
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { opacity: 0.5, width: 12, display: "inline-block" }, children: hasChildren ? expanded ? "\u25BE" : "\u25B8" : "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: kindGlyph(node.kind) }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { style: { fontWeight: node.kind === "run" ? 600 : 400 }, children: node.label }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
          "span",
          {
            style: {
              marginLeft: "auto",
              opacity: 0.6,
              fontSize: 11
            },
            children: [
              statusGlyph(node.status),
              node.durationMs !== void 0 ? `  ${formatMs2(node.durationMs)}` : ""
            ]
          }
        )
      ]
    }
  );
};
function kindGlyph(kind) {
  switch (kind) {
    case "run":
      return "\u25B6";
    case "composition":
      return "\u22C8";
    case "iteration":
      return "\u21BB";
    case "llm-call":
      return "\u{1F15B}";
    case "tool-call":
      return "\u{1F6E0}";
    case "fork-branch":
      return "\u22D4";
    case "decision-branch":
      return "\u21B3";
    case "pause":
      return "\u23F8";
  }
}
function statusGlyph(status) {
  switch (status) {
    case "running":
      return "\u2026";
    case "ok":
      return "\u2713";
    case "err":
      return "\u2717";
    case "paused":
      return "\u23F8";
    case "budget_exhausted":
      return "\u26A0";
  }
}
function formatMs2(ms) {
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  return `${(ms / 1e3).toFixed(2)}s`;
}

// src/react/EventStream.tsx
var import_react15 = require("react");
var import_jsx_runtime11 = require("react/jsx-runtime");
var EventStream = ({
  log,
  humanizer = defaultHumanizer,
  domainFilter,
  onSelect,
  droppedCount = 0,
  virtualizeThreshold = 300,
  rowHeight = 24
}) => {
  const filtered = (0, import_react15.useMemo)(() => {
    if (!domainFilter || domainFilter.length === 0) return log;
    return log.filter(
      (entry) => domainFilter.some((prefix) => entry.event.type.startsWith(prefix))
    );
  }, [log, domainFilter]);
  const w = useWindowedList({
    count: filtered.length,
    rowHeight,
    threshold: virtualizeThreshold
  });
  const windowedRowStyle = w.windowed ? { height: rowHeight, boxSizing: "border-box", overflow: "hidden" } : {};
  const windowedCellStyle = w.windowed ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : {};
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
    "div",
    {
      onScroll: w.onScroll,
      style: {
        fontFamily: T.fontMono,
        fontSize: 12,
        lineHeight: 1.4,
        maxHeight: 400,
        overflowY: "auto"
      },
      children: [
        droppedCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
          "div",
          {
            style: {
              padding: "4px 6px",
              color: T.warning,
              borderBottom: `1px solid ${T.border}`
            },
            children: [
              "\u26A0 ",
              droppedCount.toLocaleString(),
              " earliest events evicted (LensRecorder maxEvents cap) \u2014 stream starts at the oldest retained event."
            ]
          }
        ),
        filtered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { opacity: 0.5, padding: 8 }, children: "No events yet." }) : /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
          w.topPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { height: w.topPad }, "aria-hidden": true }),
          filtered.slice(w.start, w.end).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
            "div",
            {
              onClick: () => onSelect?.(entry),
              style: {
                display: "grid",
                gridTemplateColumns: "60px 200px 1fr",
                gap: 8,
                padding: "2px 6px",
                cursor: onSelect ? "pointer" : "default",
                borderBottom: `1px solid ${T.border}`,
                ...windowedRowStyle
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { style: { opacity: 0.5, ...windowedCellStyle }, children: [
                  "+",
                  Math.round(entry.runOffsetMs),
                  "ms"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { color: T.textSecondary, ...windowedCellStyle }, children: shortType(entry.event.type) }),
                /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: windowedCellStyle, children: humanizer(entry.event) ?? "" })
              ]
            },
            entry.seq
          )),
          w.bottomPad > 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { style: { height: w.bottomPad }, "aria-hidden": true })
        ] })
      ]
    }
  );
};
function shortType(type) {
  return type.replace(/^agentfootprint\./, "");
}

// src/react/SkillGraphFlow.tsx
var import_react16 = __toESM(require("react"), 1);
var import_react17 = require("@xyflow/react");
var import_style2 = require("@xyflow/react/dist/style.css");

// src/react/skillGraphFlowLayout.ts
var import_dagre2 = __toESM(require("dagre"), 1);
var SKILL_GRAPH_START_ID = "__start__";
var SIZES = {
  start: { width: 104, height: 40 },
  predicate: { width: 188, height: 96 },
  skill: { width: 192, height: 56 }
};
function sizeFor(kind) {
  return SIZES[kind];
}
function layoutSkillGraph(graph, opts = {}) {
  const showStart = opts.showStart ?? true;
  const g = new import_dagre2.default.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "TB",
    ranksep: opts.rankSep ?? 64,
    nodesep: opts.nodeSep ?? 40,
    marginx: 8,
    marginy: 8
  });
  g.setDefaultEdgeLabel(() => ({}));
  const usesStart = showStart && graph.edges.some((e) => e.from === null);
  if (usesStart) g.setNode(SKILL_GRAPH_START_ID, { ...SIZES.start });
  for (const n of graph.nodes) g.setNode(n.id, { ...SIZES[n.kind] });
  const flowEdges = [];
  let i = 0;
  for (const e of graph.edges) {
    if (e.from === null && !usesStart) continue;
    const source = e.from === null ? SKILL_GRAPH_START_ID : e.from;
    if (!g.hasNode(source) || !g.hasNode(e.to)) continue;
    const id = `sge${i++}:${source}->${e.to}`;
    g.setEdge(source, e.to, {}, id);
    flowEdges.push({
      id,
      source,
      target: e.to,
      label: e.label,
      dashed: e.kind === "model"
    });
  }
  import_dagre2.default.layout(g);
  const toFlow = (id, kind, label) => {
    const p = g.node(id);
    return {
      id,
      kind,
      label,
      x: p.x - p.width / 2,
      // dagre centers; xyflow positions by top-left
      y: p.y - p.height / 2,
      width: p.width,
      height: p.height
    };
  };
  const nodes = [];
  if (usesStart) nodes.push(toFlow(SKILL_GRAPH_START_ID, "start", "\u25B6 start"));
  for (const n of graph.nodes) nodes.push(toFlow(n.id, n.kind, n.label ?? n.id));
  return { nodes, edges: flowEdges };
}
function routingPathTo(graph, nodeId) {
  const labelById = new Map(graph.nodes.map((n) => [n.id, n.label ?? n.id]));
  const incoming = /* @__PURE__ */ new Map();
  for (const e of graph.edges) incoming.set(e.to, { from: e.from, branch: e.label });
  const steps = [];
  const seen = /* @__PURE__ */ new Set([nodeId]);
  let cur = nodeId;
  while (cur) {
    const edge = incoming.get(cur);
    if (!edge || edge.from === null) break;
    if (seen.has(edge.from)) break;
    seen.add(edge.from);
    steps.push({
      predicate: labelById.get(edge.from) ?? edge.from,
      branch: edge.branch ?? ""
    });
    cur = edge.from;
  }
  return steps.reverse();
}

// src/react/SkillGraphFlow.tsx
var import_jsx_runtime12 = require("react/jsx-runtime");
var HANDLE_STYLE = {
  opacity: 0,
  width: 1,
  height: 1,
  border: "none",
  background: "transparent",
  pointerEvents: "none"
};
var StartNode = ({ data }) => {
  const d = data;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "div",
    {
      style: {
        ...sizeFor("start"),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        background: T.bgTertiary,
        color: T.textSecondary,
        border: `1px solid ${T.border}`,
        fontFamily: T.fontSans,
        fontSize: 12,
        fontWeight: 600,
        boxSizing: "border-box"
      },
      children: [
        d.label,
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.Handle, { type: "source", position: import_react17.Position.Bottom, style: HANDLE_STYLE, isConnectable: false })
      ]
    }
  );
};
var SkillBoxNode = ({ data }) => {
  const d = data;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "div",
    {
      style: {
        ...sizeFor("skill"),
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        borderRadius: 10,
        background: T.bgSecondary,
        color: T.textPrimary,
        border: `${d.isSelected ? 2 : 1}px solid ${d.isSelected ? T.srcSkill : T.border}`,
        boxShadow: d.isSelected ? `0 0 0 3px ${T.srcSkill}33` : "none",
        fontFamily: T.fontSans,
        fontSize: 13,
        fontWeight: 600,
        boxSizing: "border-box",
        cursor: "pointer"
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.Handle, { type: "target", position: import_react17.Position.Top, style: HANDLE_STYLE, isConnectable: false }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "span",
          {
            "aria-hidden": true,
            style: {
              flex: "0 0 auto",
              width: 8,
              height: 8,
              borderRadius: 2,
              background: T.srcSkill
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "span",
          {
            style: {
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: d.label
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.Handle, { type: "source", position: import_react17.Position.Bottom, style: HANDLE_STYLE, isConnectable: false })
      ]
    }
  );
};
var PredicateNode = ({ data }) => {
  const d = data;
  const { width, height } = sizeFor("predicate");
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { width, height, position: "relative", cursor: "pointer" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.Handle, { type: "target", position: import_react17.Position.Top, style: HANDLE_STYLE, isConnectable: false }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      "div",
      {
        style: {
          position: "absolute",
          inset: 0,
          background: T.bgSecondary,
          border: `${d.isSelected ? 2 : 1}px solid ${d.isSelected ? T.edgeDecision : T.border}`,
          boxShadow: d.isSelected ? `0 0 0 3px ${T.edgeDecision}33` : "none",
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      "div",
      {
        style: {
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 32px",
          textAlign: "center",
          color: T.textPrimary,
          fontFamily: T.fontSans,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.2,
          boxSizing: "border-box"
        },
        children: d.label
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.Handle, { type: "source", position: import_react17.Position.Bottom, style: HANDLE_STYLE, isConnectable: false })
  ] });
};
var NODE_TYPES = {
  sgStart: StartNode,
  sgPredicate: PredicateNode,
  sgSkill: SkillBoxNode
};
function RoutingPath({ steps }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { marginTop: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { fontSize: 11, color: T.textMuted, marginBottom: 6 }, children: "REACHED WHEN" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      "div",
      {
        style: {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6
        },
        children: steps.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_react16.default.Fragment, { children: [
          i > 0 && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: { color: T.textMuted }, children: "\u2192" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { style: { fontSize: 12, color: T.textSecondary }, children: [
            s.predicate,
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { style: { color: s.branch === "yes" ? T.srcSkill : T.textMuted }, children: s.branch })
          ] })
        ] }, `${s.predicate}-${i}`))
      }
    )
  ] });
}
function DetailPanel({
  node,
  detail,
  routingPath,
  width
}) {
  const panel = {
    width,
    flex: `0 0 ${width}px`,
    borderLeft: `1px solid ${T.border}`,
    background: T.bgPrimary,
    color: T.textPrimary,
    fontFamily: T.fontSans,
    padding: 16,
    overflow: "auto",
    boxSizing: "border-box"
  };
  if (!node) {
    return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("aside", { style: panel, "data-testid": "skill-graph-detail", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { style: { color: T.textMuted, fontSize: 13, margin: 0 }, children: "Click a node to inspect it. Diamonds are decision predicates; boxes are skills that load just-in-time when their path is chosen." }) });
  }
  const isPredicate = node.kind === "predicate";
  const accent = isPredicate ? T.edgeDecision : T.srcSkill;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("aside", { style: panel, "data-testid": "skill-graph-detail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "span",
          {
            style: {
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: accent
            },
            children: isPredicate ? "\u25C7 Decision" : "\u25A2 Skill"
          }
        )
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { style: { margin: "0 0 12px", fontSize: 16 }, children: detail?.title ?? node.label ?? node.id }),
    isPredicate && !detail && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { style: { color: T.textSecondary, fontSize: 13, margin: 0 }, children: [
      "Routes to its ",
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: "yes" }),
      " / ",
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: "no" }),
      " subtree based on this predicate, evaluated every iteration."
    ] }),
    detail?.description && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { style: { color: T.textSecondary, fontSize: 13, margin: "0 0 12px" }, children: detail.description }),
    routingPath.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RoutingPath, { steps: routingPath }),
    detail?.meta?.map((row) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { fontSize: 12, marginBottom: 6 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { style: { color: T.textMuted }, children: [
        row.label,
        ": "
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { style: { color: T.textSecondary }, children: row.value })
    ] }, row.label)),
    detail?.tools && detail.tools.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { marginTop: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { style: { fontSize: 11, color: T.textMuted, marginBottom: 6 }, children: [
        "UNLOCKS ",
        detail.tools.length,
        " TOOL",
        detail.tools.length === 1 ? "" : "S"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: detail.tools.map((tool) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
        "span",
        {
          style: {
            fontFamily: T.fontMono,
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 6,
            background: T.bgTertiary,
            color: T.textSecondary
          },
          children: tool
        },
        tool
      )) })
    ] }),
    detail?.body && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      "pre",
      {
        style: {
          marginTop: 12,
          padding: 10,
          borderRadius: 8,
          background: T.bgSecondary,
          color: T.textSecondary,
          fontFamily: T.fontMono,
          fontSize: 11.5,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "auto"
        },
        children: detail.body
      }
    )
  ] });
}
var SkillGraphFlow = ({
  graph,
  detailFor,
  selectedId: selectedIdProp,
  defaultSelectedId = null,
  onSelectNode,
  showStart = true,
  hideDetailPanel = false,
  defaultPanelWidth = 320,
  height = "100%",
  className,
  style
}) => {
  const isControlled = selectedIdProp !== void 0;
  const [internalSelected, setInternalSelected] = (0, import_react16.useState)(defaultSelectedId);
  const selectedId = isControlled ? selectedIdProp : internalSelected;
  const select = (0, import_react16.useCallback)(
    (id) => {
      if (!isControlled) setInternalSelected(id);
      onSelectNode?.(id);
    },
    [isControlled, onSelectNode]
  );
  const containerRef = (0, import_react16.useRef)(null);
  const [panelWidth, setPanelWidth] = (0, import_react16.useState)(defaultPanelWidth);
  const [dragging, setDragging] = (0, import_react16.useState)(false);
  const startResize = (0, import_react16.useCallback)((e) => {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = rect.right - ev.clientX;
      const max = Math.max(240, rect.width - 240);
      setPanelWidth(Math.min(max, Math.max(220, next)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  const { rfNodes, rfEdges } = (0, import_react16.useMemo)(() => {
    const laid = layoutSkillGraph(graph, { showStart });
    const rfNodes2 = laid.nodes.map((n) => ({
      id: n.id,
      type: n.kind === "start" ? "sgStart" : n.kind === "predicate" ? "sgPredicate" : "sgSkill",
      position: { x: n.x, y: n.y },
      width: n.width,
      height: n.height,
      draggable: false,
      selectable: n.kind !== "start",
      data: {
        label: n.label,
        isSelected: n.id === selectedId
      }
    }));
    const rfEdges2 = laid.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      style: {
        stroke: T.edgeDefault,
        strokeWidth: 1.5,
        strokeDasharray: e.dashed ? "5 4" : void 0
      },
      labelStyle: { fill: T.textMuted, fontFamily: T.fontSans, fontSize: 11 },
      labelBgStyle: { fill: T.bgPrimary, fillOpacity: 0.85 },
      markerEnd: {
        type: import_react17.MarkerType.ArrowClosed,
        color: T.edgeDefault,
        width: 16,
        height: 16
      }
    }));
    return { rfNodes: rfNodes2, rfEdges: rfEdges2 };
  }, [graph, showStart, selectedId]);
  const selectedNode = (0, import_react16.useMemo)(
    () => selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null,
    [graph.nodes, selectedId]
  );
  const detail = selectedNode && detailFor ? detailFor(selectedNode) : void 0;
  const routingPath = (0, import_react16.useMemo)(
    () => selectedNode ? routingPathTo(graph, selectedNode.id) : [],
    [graph, selectedNode]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "div",
    {
      ref: containerRef,
      className,
      style: {
        display: "flex",
        height,
        width: "100%",
        background: T.bgPrimary,
        // While dragging, suppress text selection + let the divider own the cursor.
        userSelect: dragging ? "none" : void 0,
        cursor: dragging ? "col-resize" : void 0,
        ...style
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { flex: 1, minWidth: 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.ReactFlowProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
          import_react17.ReactFlow,
          {
            nodes: rfNodes,
            edges: rfEdges,
            nodeTypes: NODE_TYPES,
            onNodeClick: (_, node) => select(node.id),
            onPaneClick: () => select(null),
            nodesDraggable: false,
            nodesConnectable: false,
            elementsSelectable: true,
            fitView: true,
            fitViewOptions: { padding: 0.2 },
            minZoom: 0.1,
            maxZoom: 1.5,
            proOptions: { hideAttribution: true },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.Background, { color: T.border, gap: 20 }),
              /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_react17.Controls, { showInteractive: false })
            ]
          }
        ) }) }),
        !hideDetailPanel && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
            "div",
            {
              role: "separator",
              "aria-orientation": "vertical",
              "data-testid": "skill-graph-resizer",
              onMouseDown: startResize,
              title: "Drag to resize",
              style: {
                flex: "0 0 6px",
                cursor: "col-resize",
                background: dragging ? T.srcSkill : T.border,
                transition: dragging ? void 0 : "background 120ms"
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
            DetailPanel,
            {
              node: selectedNode,
              detail,
              routingPath,
              width: panelWidth
            }
          )
        ] })
      ]
    }
  );
};

// src/react/hooks/useStepFocus.ts
var import_react18 = require("react");
function useStepFocus(max) {
  const [focus, setFocus] = (0, import_react18.useState)(Math.max(0, max));
  const prevMax = (0, import_react18.useRef)(max);
  (0, import_react18.useEffect)(() => {
    const wasLiveBefore = focus >= prevMax.current;
    if (wasLiveBefore) setFocus(max);
    prevMax.current = max;
  }, [max]);
  return {
    focus,
    isLive: focus >= max,
    setFocus
  };
}

// src/react/hooks/useStepView.ts
var import_react19 = require("react");
function useStepView(graph, log, focusIndex, drillPath) {
  return (0, import_react19.useMemo)(
    () => selectStepView({ graph, log, focusIndex, drillPath }),
    [graph, log, focusIndex, drillPath]
  );
}

// src/react/hooks/useCommentarySlider.ts
var import_react20 = require("react");
var import_react21 = require("react");
function useCommentarySlider(recorder, initialMode = "commentary") {
  const version = (0, import_react21.useSyncExternalStore)(
    (listener) => recorder.subscribe(listener),
    () => recorder.getVersion(),
    () => recorder.getVersion()
  );
  const [commitIdx, setCommitIdxRaw] = (0, import_react20.useState)(0);
  const [mode, setMode] = (0, import_react20.useState)(initialMode);
  const [drill, setDrill] = (0, import_react20.useState)(void 0);
  const ranges = (0, import_react20.useMemo)(
    () => selectCommentaryRanges(recorder.boundary),
    // version captured at render time — re-derives on every notify.
    [recorder, version]
  );
  const totalCommits = (0, import_react20.useMemo)(() => {
    const live = recorder.getCommitCount();
    if (live > 0) return live;
    if (ranges.length === 0) return 0;
    let max = 0;
    for (const r of ranges) {
      if (r.endIdx !== void 0 && r.endIdx > max) max = r.endIdx;
      else if (r.startIdx > max) max = r.startIdx;
    }
    return max + 1;
  }, [recorder, ranges, version]);
  const snapPoints = (0, import_react20.useMemo)(() => {
    if (mode === "commit") return [];
    return ranges.map((r) => r.startIdx);
  }, [mode, ranges]);
  const setCommitIdx = (0, import_react20.useCallback)(
    (idx) => {
      if (!Number.isFinite(idx)) return;
      const max = Math.max(0, totalCommits - 1);
      const low = drill ? Math.max(0, drill.startIdx) : 0;
      const high = drill ? Math.min(max, drill.endIdx ?? max) : max;
      const clamped = Math.min(Math.max(idx, low), high);
      setCommitIdxRaw(clamped);
    },
    [totalCommits, drill]
  );
  const drillInto = (0, import_react20.useCallback)(
    (range) => {
      if (!Number.isFinite(range.startIdx) || range.startIdx < 0) return;
      if (range.endIdx !== void 0 && !Number.isFinite(range.endIdx)) return;
      const rid = range.label.runtimeStageId;
      if (!rid) return;
      const snapshot = {
        startIdx: range.startIdx,
        endIdx: range.endIdx,
        runtimeStageId: rid
      };
      setDrill(snapshot);
      setMode("commit");
      const max = Math.max(0, totalCommits - 1);
      const high = Math.min(max, snapshot.endIdx ?? max);
      const clamped = Math.min(Math.max(snapshot.startIdx, 0), high);
      setCommitIdxRaw(clamped);
    },
    [totalCommits]
  );
  (0, import_react20.useEffect)(() => {
    if (!drill) return;
    const inRange = commitIdx >= drill.startIdx && (drill.endIdx === void 0 || commitIdx <= drill.endIdx);
    if (!inRange) setDrill(void 0);
  }, [commitIdx, drill]);
  const active = (0, import_react20.useMemo)(
    () => selectCommentaryAt(recorder.boundary, commitIdx),
    [recorder, commitIdx, version]
  );
  const drillRange = (0, import_react20.useMemo)(() => {
    if (!drill) return void 0;
    return ranges.find(
      (r) => r.label.runtimeStageId === drill.runtimeStageId
    );
  }, [drill, ranges]);
  return {
    commitIdx,
    mode,
    totalCommits,
    snapPoints,
    active,
    ranges,
    setCommitIdx,
    setMode,
    drillInto,
    drillRange
  };
}

// src/react/hooks/useLensRenderGraph.ts
var import_react22 = require("react");
function useLensRenderGraph(runner, options = {}) {
  return (0, import_react22.useMemo)(() => {
    const output = runner.getUIGroupWith(lensGroupTranslator);
    if (output === void 0) {
      throw new Error(
        "useLensRenderGraph: runner.getUIGroupWith(lensGroupTranslator) returned undefined. The runner does not expose a translatable UI group shape \u2014 verify the runner is one of agentfootprint's composition kinds (Parallel / Sequence / Loop / Conditional / Agent / LLMCall)."
      );
    }
    assertLensGroupOutput(output);
    const laidOut = layoutLensGraph(output, options);
    return { ...laidOut, rootNodeId: output.rootNodeId };
  }, [
    runner,
    options.direction,
    options.rankSep,
    options.nodeSep,
    options.edgeSep,
    options.sizeOverride,
    options.withUserFrame
  ]);
}
function assertLensGroupOutput(value) {
  if (typeof value !== "object" || value === null || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || typeof value.rootNodeId !== "string") {
    throw new TypeError(
      "useLensRenderGraph: runner.getUIGroupWith(lensGroupTranslator) returned a value that is not a LensGroupOutput { nodes, edges, rootNodeId }. A custom translator wired into one of the runner's inner compositions returned the wrong shape."
    );
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BASELINE_SOURCES,
  ChangeNotifier,
  DEFAULT_MAX_EVENTS,
  EventStream,
  LENS_NODE_TYPES,
  Lens,
  LensChartBoundary,
  LensFlow,
  LensRecorder,
  LensSnapshotRecorder,
  Replay,
  RunTreeView,
  SKILL_GRAPH_START_ID,
  SkillGraphFlow,
  SummaryCard,
  TimeTravel,
  ToolChoicePanel,
  buildLLMText,
  buildSpecTreeFromBoundary,
  buildStepGraphFromSnapshot,
  defaultHumanizer,
  defaultSize,
  humanizeWith,
  isContextEngineering,
  layoutLensGraph,
  layoutSkillGraph,
  lensGroupTranslator,
  lensRecorder,
  lensSnapshotRecorder,
  makeChildNodeId,
  makeEdge,
  makeRootNodeId,
  mergeOutputs,
  pinUnderParent,
  routingPathTo,
  selectAgentInstances,
  selectCommentaryAt,
  selectCommentaryRanges,
  selectContextEngineeringInjections,
  selectEdges,
  selectFocusDetail,
  selectHops,
  selectStepAgentName,
  selectStepView,
  selectToolChoiceCall,
  selectTouched,
  stepEdgeLabel,
  stepToStageEndpoints,
  structureGraphFromRunner,
  structureGraphFromSpec,
  teachingHumanizer,
  toReactFlow,
  translateAgent,
  translateConditional,
  translateLLMCall,
  translateLoop,
  translateParallel,
  translateSequence,
  useCommentarySlider,
  useDrillPath,
  useLensRecorder,
  useLensRenderGraph,
  useStepFocus,
  useStepView,
  useToolChoice,
  useWindowedList
});
//# sourceMappingURL=index.cjs.map