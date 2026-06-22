import {
  BASELINE_SOURCES,
  ChangeNotifier,
  DEFAULT_MAX_EVENTS,
  LensRecorder,
  LensSnapshotRecorder,
  buildSpecTreeFromBoundary,
  buildStepGraphFromSnapshot,
  defaultHumanizer,
  defaultSize,
  humanizeWith,
  isContextEngineering,
  layoutLensGraph,
  lensGroupTranslator,
  lensRecorder,
  lensSnapshotRecorder,
  makeChildNodeId,
  makeEdge,
  makeRootNodeId,
  makeTeachingHumanizer,
  mergeOutputs,
  pinUnderParent,
  selectCommentaryAt,
  selectCommentaryRanges,
  selectContextEngineeringInjections,
  selectEdges,
  selectFocusDetail,
  selectHops,
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
  translateSequence
} from "./chunk-ZJKD43L7.js";
import {
  buildLLMText,
  selectAgentInstances,
  selectStepAgentName
} from "./chunk-KQOLJKKM.js";

// src/react/Lens.tsx
import React5, { memo, useCallback as useCallback3, useEffect as useEffect5, useMemo as useMemo4, useRef as useRef4, useState as useState4 } from "react";
import {
  defaultCommentaryTemplates,
  renderCommentary
} from "agentfootprint";
import { dagreTraceLayout } from "footprint-explainable-ui/flowchart";

// src/react/lensNodeTypes.ts
import { SlotPillNode, GroupContainerNode } from "footprint-explainable-ui/flowchart";
var LENS_NODE_TYPES = {
  slotPill: SlotPillNode,
  groupContainer: GroupContainerNode
};

// src/react/LensChartBoundary.tsx
import React from "react";
import { jsxs } from "react/jsx-runtime";
var LensChartBoundary = class extends React.Component {
  constructor() {
    super(...arguments);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? /* @__PURE__ */ jsxs("div", { style: { padding: 24, color: "#b45309", fontSize: 12, lineHeight: 1.5 }, children: [
        "The composition chart couldn\u2019t render (",
        this.state.error.message,
        "). The rest of the monitor (timeline, commentary, details) is unaffected."
      ] });
    }
    return this.props.children;
  }
};

// src/react/LensFlow.tsx
import { useMemo } from "react";
import { Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  TracedFlow
} from "footprint-explainable-ui/flowchart";
import { jsx, jsxs as jsxs2 } from "react/jsx-runtime";
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
  const scrubIndex = useMemo(() => {
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
  const mergedNodeTypes = useMemo(
    () => nodeTypes ? { ...chart.nodeTypes ?? {}, ...nodeTypes } : chart.nodeTypes,
    [nodeTypes, chart.nodeTypes]
  );
  return /* @__PURE__ */ jsxs2(
    TracedFlow,
    {
      graph: chart.graph,
      layout: chart.layout,
      ...traceRuntimeOverlay && { overlay: traceRuntimeOverlay },
      ...scrubIndex !== void 0 && { scrubIndex },
      ...onNodeClick && { onNodeClick },
      ...coActiveStageIds && coActiveStageIds.size > 0 && { coActiveStageIds },
      ...mergedNodeTypes && { nodeTypes: mergedNodeTypes },
      children: [
        showBackground && /* @__PURE__ */ jsx(Background, {}),
        showControls && /* @__PURE__ */ jsx(Controls, {})
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
import { jsx as jsx2, jsxs as jsxs3 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsx2(
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
      children: items.map(({ label, value, color }) => /* @__PURE__ */ jsxs3("div", { style: { minWidth: 0 }, children: [
        /* @__PURE__ */ jsx2("div", { style: { fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }, children: label }),
        /* @__PURE__ */ jsx2("div", { style: { fontSize: 14, fontWeight: color ? 700 : 500, color: color ?? T.textPrimary, whiteSpace: "nowrap" }, children: value })
      ] }, label))
    }
  );
};

// src/react/TimeTravel.tsx
import { useEffect } from "react";
import { jsx as jsx3, jsxs as jsxs4 } from "react/jsx-runtime";
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
  useEffect(() => {
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
  return /* @__PURE__ */ jsxs4(
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
        /* @__PURE__ */ jsx3(
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
        /* @__PURE__ */ jsx3(
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
        /* @__PURE__ */ jsx3(
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
        compact ? /* @__PURE__ */ jsx3("div", { style: { flex: 1 } }) : /* @__PURE__ */ jsx3("div", { style: { flex: 1, position: "relative", display: "flex", alignItems: "center" }, children: /* @__PURE__ */ jsx3(
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
        /* @__PURE__ */ jsx3(
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
import { Fragment, jsx as jsx4, jsxs as jsxs5 } from "react/jsx-runtime";
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
    return /* @__PURE__ */ jsxs5("div", { style: panelStyle, children: [
      /* @__PURE__ */ jsxs5("div", { style: headerStyle, children: [
        /* @__PURE__ */ jsxs5("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
          /* @__PURE__ */ jsx4("span", { style: titleStyle, children: internalStage.name }),
          /* @__PURE__ */ jsx4("span", { style: pillStyle, children: "stage" })
        ] }),
        onClose && /* @__PURE__ */ jsx4("button", { onClick: onClose, style: closeButtonStyle, "aria-label": "Close detail panel", title: "Close", children: "\xD7" })
      ] }),
      /* @__PURE__ */ jsxs5("div", { style: bodyStyle, children: [
        internalStage.description && /* @__PURE__ */ jsxs5("div", { style: sectionStyle, children: [
          /* @__PURE__ */ jsx4("div", { style: { ...sectionLabelStyle, padding: "6px 8px" }, children: "What this stage does" }),
          /* @__PURE__ */ jsx4("div", { style: { padding: 8, fontSize: 12, color: T.textPrimary, lineHeight: 1.5 }, children: internalStage.description })
        ] }),
        typeof internalStage.offsetMs === "number" && /* @__PURE__ */ jsxs5("div", { style: { fontSize: 11, color: T.textSecondary, padding: "0 2px" }, children: [
          "ran at +",
          Math.round(internalStage.offsetMs),
          "ms"
        ] }),
        /* @__PURE__ */ jsx4("div", { style: { fontSize: 11, color: T.textSecondary, fontStyle: "italic", padding: "4px 2px", lineHeight: 1.5 }, children: "This stage runs inside the subflow's own scope, so its detailed inputs/outputs aren't recorded at the parent level yet." })
      ] })
    ] });
  }
  if (!node) {
    const isRoot = cursorRuntimeStageId?.startsWith("__root__") ?? false;
    const hasRelated = !!relatedNodes && relatedNodes.length > 0;
    const showRunError = isRoot && rootPhase === "end" && runError !== void 0;
    const showRunIO = isRoot && (rootPhase === "start" && runInput !== void 0 || rootPhase === "end" && runOutput !== void 0);
    if (showRunError || showRunIO || hasRelated) {
      return /* @__PURE__ */ jsxs5("div", { style: panelStyle, children: [
        /* @__PURE__ */ jsxs5("div", { style: headerStyle, children: [
          /* @__PURE__ */ jsxs5("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
            /* @__PURE__ */ jsx4("span", { style: titleStyle, children: isRoot ? "Run" : "Scope" }),
            /* @__PURE__ */ jsx4("span", { style: { ...pillStyle, ...showRunError ? { background: T.error } : {} }, children: showRunError ? "failed" : rootPhase === "start" ? "input" : rootPhase === "end" ? "output" : isRoot ? "overview" : "in scope" })
          ] }),
          onClose && /* @__PURE__ */ jsx4(
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
        /* @__PURE__ */ jsxs5("div", { style: bodyStyle, children: [
          showRunError && /* @__PURE__ */ jsxs5("div", { style: { ...sectionStyle, borderColor: T.error }, children: [
            /* @__PURE__ */ jsx4("div", { style: { ...sectionLabelStyle, padding: "4px 8px", color: T.error }, children: "\u26D4 Run failed" }),
            /* @__PURE__ */ jsx4("pre", { style: { ...preStyle, color: T.error }, children: runError })
          ] }),
          rootPhase === "start" && runInput !== void 0 && /* @__PURE__ */ jsx4(PayloadSection, { label: "You sent", payload: runInput, emptyHint: "(no input recorded)" }),
          !showRunError && rootPhase === "end" && runOutput !== void 0 && /* @__PURE__ */ jsx4(PayloadSection, { label: "Final answer", payload: runOutput, emptyHint: "(no output recorded)" }),
          hasRelated && /* @__PURE__ */ jsx4(RelatedStepsSection, { nodes: relatedNodes })
        ] })
      ] });
    }
    if (hideEmptyState) return null;
    return /* @__PURE__ */ jsx4("div", { style: emptyPanelStyle, children: /* @__PURE__ */ jsx4("div", { style: emptyHintStyle, children: isRoot ? "Scrub past Run \xB7 start to inspect a stage" : "Click a node to inspect" }) });
  }
  const isSubflow = node.kind === "subflow";
  const isTopologyHelper = node.kind === "fork-branch" || node.kind === "decision-branch";
  return /* @__PURE__ */ jsxs5("div", { style: panelStyle, children: [
    /* @__PURE__ */ jsxs5("div", { style: headerStyle, children: [
      /* @__PURE__ */ jsxs5("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
        /* @__PURE__ */ jsx4("span", { style: titleStyle, children: node.label }),
        node.primitiveKind && /* @__PURE__ */ jsx4("span", { style: pillStyle, children: node.primitiveKind })
      ] }),
      onClose && /* @__PURE__ */ jsx4(
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
    /* @__PURE__ */ jsx4(IdentityStrip, { node }),
    /* @__PURE__ */ jsxs5("div", { style: bodyStyle, children: [
      isSubflow && /* @__PURE__ */ jsxs5(Fragment, { children: [
        /* @__PURE__ */ jsx4(
          PayloadSection,
          {
            label: inputLabelFor(node),
            payload: node.entryPayload,
            emptyHint: "(no input recorded for this step)"
          }
        ),
        /* @__PURE__ */ jsx4(
          PayloadSection,
          {
            label: outputLabelFor(node),
            payload: node.exitPayload,
            emptyHint: node.entryPayload && !node.exitPayload ? "In progress \u2014 this step has not finished yet." : "(no output recorded for this step)"
          }
        )
      ] }),
      isTopologyHelper && /* @__PURE__ */ jsxs5("div", { style: topologyNoteStyle, children: [
        "This is a ",
        node.kind === "fork-branch" ? "parallel branch" : "decision branch",
        " ",
        "marker \u2014 composition shape only. Boundary payloads attach to the subflow that the branch runs (if any), not to this marker itself."
      ] }),
      !isSubflow && !isTopologyHelper && /* @__PURE__ */ jsx4(ReActStepBody, { node }),
      relatedNodes && relatedNodes.length > 0 && /* @__PURE__ */ jsx4(RelatedStepsSection, { nodes: relatedNodes })
    ] })
  ] });
};
var RelatedStepsSection = ({ nodes }) => {
  const renderable = nodes.filter(
    (n) => n.kind !== "fork-branch" && n.kind !== "decision-branch"
  );
  if (renderable.length === 0) return null;
  return /* @__PURE__ */ jsxs5("div", { style: { marginTop: 4 }, children: [
    /* @__PURE__ */ jsx4("div", { style: { ...sectionLabelStyle, marginBottom: 6, padding: "0 2px" }, children: "All steps in this scope" }),
    /* @__PURE__ */ jsx4("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: renderable.map((n) => /* @__PURE__ */ jsx4(RelatedStepCard, { node: n }, n.id)) })
  ] });
};
var RelatedStepCard = ({ node }) => {
  const title = node.label && node.label !== node.kind ? `${node.kind} \xB7 ${node.label}` : node.kind;
  const duration = typeof node.startOffsetMs === "number" && typeof node.endOffsetMs === "number" ? node.endOffsetMs - node.startOffsetMs : void 0;
  const rows = [];
  if (node.llmModel) rows.push(["model", node.llmModel]);
  if (node.tokens) rows.push(["tokens", `in ${node.tokens.in} \xB7 out ${node.tokens.out}`]);
  if (node.toolName) rows.push(["tool", node.toolName]);
  if (node.slotUpdated) rows.push(["updated slot", node.slotUpdated]);
  if (duration !== void 0 && duration > 0) {
    rows.push(["duration", `${Math.round(duration)}ms`]);
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
  return /* @__PURE__ */ jsxs5("div", { style: sectionStyle, children: [
    /* @__PURE__ */ jsx4("div", { style: sectionHeaderStyle, children: /* @__PURE__ */ jsx4("span", { style: { ...sectionLabelStyle, textTransform: "none" }, children: title }) }),
    rows.length > 0 && /* @__PURE__ */ jsx4("div", { style: { display: "grid", gap: 4, fontSize: 12, padding: 8 }, children: rows.map(([label, value]) => /* @__PURE__ */ jsx4(Field, { label, children: value }, label)) }),
    payloads.map((p) => /* @__PURE__ */ jsxs5("div", { style: { borderTop: `1px solid ${T.border}` }, children: [
      /* @__PURE__ */ jsx4("div", { style: { ...sectionLabelStyle, padding: "4px 8px" }, children: p.label }),
      /* @__PURE__ */ jsx4("pre", { style: preStyle, children: prettyPrint(p.value) })
    ] }, p.label)),
    !hasContent && /* @__PURE__ */ jsx4("div", { style: emptyHintStyle, children: "(no data recorded for this step)" })
  ] });
};
var IdentityStrip = ({ node }) => {
  if (typeof node.iterationIndex !== "number" && node.subflowPath.length <= 1) {
    return null;
  }
  return /* @__PURE__ */ jsxs5("div", { style: identityStripStyle, children: [
    typeof node.iterationIndex === "number" && /* @__PURE__ */ jsx4(IdentityField, { label: "iteration", value: `#${node.iterationIndex}` }),
    node.subflowPath.length > 1 && /* @__PURE__ */ jsx4(
      IdentityField,
      {
        label: "under",
        value: node.subflowPath.slice(1, -1).join(" / ") || "(top level)"
      }
    )
  ] });
};
var IdentityField = ({ label, value }) => /* @__PURE__ */ jsxs5("div", { style: { display: "flex", alignItems: "baseline", gap: 6 }, children: [
  /* @__PURE__ */ jsx4("span", { style: identityLabelStyle, children: label }),
  /* @__PURE__ */ jsx4("span", { style: identityValueStyle, children: value })
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
  return /* @__PURE__ */ jsxs5("div", { style: sectionStyle, children: [
    /* @__PURE__ */ jsx4("div", { style: sectionHeaderStyle, children: /* @__PURE__ */ jsx4("span", { style: sectionLabelStyle, children: label }) }),
    hasPayload ? /* @__PURE__ */ jsx4("pre", { style: preStyle, children: prettyPrint(payload) }) : /* @__PURE__ */ jsx4("div", { style: emptyHintStyle, children: emptyHint })
  ] });
};
var ReActStepBody = ({ node }) => {
  const duration = typeof node.startOffsetMs === "number" && typeof node.endOffsetMs === "number" ? node.endOffsetMs - node.startOffsetMs : void 0;
  const rows = [];
  if (node.tokens) rows.push(["tokens", `in ${node.tokens.in} \xB7 out ${node.tokens.out}`]);
  if (node.toolName) rows.push(["tool", node.toolName]);
  if (node.llmModel) rows.push(["model", node.llmModel]);
  if (node.slotUpdated) rows.push(["what landed in", node.slotUpdated]);
  if (duration !== void 0 && duration > 0) rows.push(["duration", `${Math.round(duration)}ms`]);
  const ioSections = ioSectionsFor(node);
  return /* @__PURE__ */ jsxs5(Fragment, { children: [
    /* @__PURE__ */ jsxs5("div", { style: sectionStyle, children: [
      rows.length > 0 && /* @__PURE__ */ jsx4("div", { style: { display: "grid", gap: 4, fontSize: 12, padding: 8 }, children: rows.map(([label, value]) => /* @__PURE__ */ jsx4(Field, { label, children: value }, label)) }),
      (() => {
        const engineered = (node.injections ?? []).filter(
          (inj) => !BASELINE_SOURCES2.has(inj.source)
        );
        if (engineered.length === 0) return null;
        return /* @__PURE__ */ jsxs5("div", { style: { padding: "0 8px 8px" }, children: [
          /* @__PURE__ */ jsx4("div", { style: sectionLabelStyle, children: "Context engineering" }),
          /* @__PURE__ */ jsx4("ul", { style: { margin: "4px 0 0", paddingLeft: 14, fontSize: 11, color: T.textSecondary }, children: engineered.map((inj, i) => /* @__PURE__ */ jsxs5("li", { style: { padding: "2px 0" }, children: [
            /* @__PURE__ */ jsxs5("code", { style: { fontSize: 11 }, children: [
              "[",
              inj.slot,
              "] ",
              inj.source,
              inj.sourceId ? `:${inj.sourceId}` : ""
            ] }),
            inj.contentSummary && /* @__PURE__ */ jsxs5("span", { style: { opacity: 0.7, marginLeft: 6 }, children: [
              "\xB7 ",
              inj.contentSummary
            ] })
          ] }, i)) })
        ] });
      })()
    ] }),
    ioSections.map((s) => /* @__PURE__ */ jsx4(PayloadSection, { label: s.label, payload: s.payload, emptyHint: "(none)" }, s.label))
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
var Field = ({ label, children }) => /* @__PURE__ */ jsxs5("div", { style: { display: "flex", gap: 8 }, children: [
  /* @__PURE__ */ jsx4("span", { style: { color: T.textSecondary, fontVariant: "small-caps", minWidth: 80 }, children: label }),
  /* @__PURE__ */ jsx4("span", { style: { color: T.textPrimary }, children })
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
import { useEffect as useEffect2, useRef } from "react";
import { jsx as jsx5, jsxs as jsxs6 } from "react/jsx-runtime";
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
  const focusedRef = useRef(null);
  useEffect2(() => {
    const el = focusedRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusStep]);
  if (moments.length === 0) {
    return /* @__PURE__ */ jsx5("div", { style: emptyStyle, children: "No moments yet \u2014 run a sample to see what happened." });
  }
  return /* @__PURE__ */ jsxs6("div", { style: wrapStyle, children: [
    /* @__PURE__ */ jsxs6("div", { style: headerStyle2, children: [
      /* @__PURE__ */ jsx5("span", { style: headerTitleStyle, children: "What happened" }),
      /* @__PURE__ */ jsxs6("span", { style: headerCountStyle, children: [
        "moment ",
        Math.min(focusStep + 1, moments.length),
        " / ",
        moments.length,
        " \xB7 drag any dot to scrub"
      ] })
    ] }),
    /* @__PURE__ */ jsx5("div", { style: listStyle, role: "listbox", "aria-label": "Run timeline", children: moments.map((m, i) => {
      const focused = i === focusStep;
      const done = i < focusStep;
      return /* @__PURE__ */ jsxs6("div", { ref: focused ? focusedRef : void 0, children: [
        /* @__PURE__ */ jsxs6(
          "button",
          {
            type: "button",
            role: "option",
            "aria-selected": focused,
            onClick: () => onFocusChange(i),
            style: { ...rowStyle, ...focused ? rowFocusedStyle : null },
            children: [
              /* @__PURE__ */ jsx5("span", { style: timeStyle, children: fmtOffset(m.offsetMs) }),
              /* @__PURE__ */ jsxs6("span", { style: railStyle, children: [
                i > 0 && /* @__PURE__ */ jsx5(
                  "span",
                  {
                    style: {
                      ...spineStyle,
                      background: done || focused ? T.success : T.border
                    }
                  }
                ),
                /* @__PURE__ */ jsx5(
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
              /* @__PURE__ */ jsx5("span", { style: iconStyle, children: m.icon }),
              /* @__PURE__ */ jsx5(
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
        focused && m.description && /* @__PURE__ */ jsx5("div", { style: descLineStyle, children: m.description }),
        focused && detail && /* @__PURE__ */ jsx5("div", { style: detailCardStyle, children: detail })
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
import { useSyncExternalStore } from "react";
function useLensRecorder(recorder) {
  useSyncExternalStore(
    (listener) => recorder.subscribe(listener),
    () => recorder.getVersion(),
    () => recorder.getVersion()
  );
  return recorder;
}

// src/react/hooks/useDrillPath.ts
import { useCallback, useState } from "react";
function useDrillPath(initial = []) {
  const [drillPath, setDrillPath] = useState(initial);
  const drillInto = useCallback((subflowPath) => {
    setDrillPath(subflowPath);
  }, []);
  const drillBack = useCallback(() => {
    setDrillPath((prev) => prev.length > 0 ? prev.slice(0, -1) : prev);
  }, []);
  const drillToRoot = useCallback(() => {
    setDrillPath([]);
  }, []);
  const drillTo = useCallback((path) => {
    setDrillPath(path);
  }, []);
  return { drillPath, drillInto, drillBack, drillToRoot, drillTo };
}

// src/react/hooks/useCommitSync.ts
import { useEffect as useEffect3, useMemo as useMemo2, useRef as useRef2, useSyncExternalStore as useSyncExternalStore2 } from "react";

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
  const storesRef = useRef2(null);
  if (storesRef.current === null || storesRef.current.recorder !== recorder) {
    storesRef.current?.stores.dispose();
    storesRef.current = { recorder, stores: splitLensStores(recorder, options) };
  }
  const stores = storesRef.current.stores;
  useEffect3(() => {
    return () => {
      storesRef.current?.stores.dispose();
      storesRef.current = null;
    };
  }, []);
  const version = useSyncExternalStore2(
    stores.overlayStore.subscribe,
    stores.overlayStore.getSnapshot,
    stores.overlayStore.getSnapshot
  );
  const syncMap = useMemo2(() => {
    try {
      return buildCommitSyncMap(recorder);
    } catch {
      return [];
    }
  }, [recorder, version]);
  return syncMap;
}

// src/react/hooks/useCursorPositions.ts
import { useMemo as useMemo3 } from "react";
import { milestoneFor } from "agentfootprint";

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
  return useMemo3(() => {
    try {
      const groups = buildGroups(recorder.boundary.boundaryIndex);
      const overlay = recorder.runtime.getOverlay();
      return cursorPositionsAtDrill(groups, syncMap, drillPath, milestoneFor, overlay.executionOrder);
    } catch {
      return [];
    }
  }, [recorder, syncMap, drillPath, overlayVersion]);
}

// src/react/hooks/useToolChoice.ts
import { useEffect as useEffect4, useRef as useRef3, useState as useState2 } from "react";
var EMPTY = {
  calls: [],
  summary: void 0,
  pending: false,
  error: void 0
};
function useToolChoice(source, revision) {
  const [state, setState] = useState2(EMPTY);
  const chain = useRef3(Promise.resolve());
  useEffect4(() => {
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
import { useCallback as useCallback2, useState as useState3 } from "react";
function useWindowedList({
  count,
  rowHeight,
  threshold = 300,
  overscan = 12,
  initialViewportHeight = 400
}) {
  const [scrollTop, setScrollTop] = useState3(0);
  const [viewportHeight, setViewportHeight] = useState3(initialViewportHeight);
  const onScroll = useCallback2(
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
import { Fragment as Fragment2, jsx as jsx6, jsxs as jsxs7 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs7(
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
        /* @__PURE__ */ jsxs7(
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
              summary ? /* @__PURE__ */ jsxs7(Fragment2, { children: [
                /* @__PURE__ */ jsxs7(
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
                /* @__PURE__ */ jsxs7("span", { style: { color: T.textSecondary }, children: [
                  summary.scored,
                  " scored \xB7 ",
                  summary.llmCallsWithTools,
                  " calls offered tools"
                ] }),
                summary.flagged > 0 && /* @__PURE__ */ jsxs7("span", { style: { color: T.textSecondary }, children: [
                  "(",
                  summary.narrow,
                  " narrow, ",
                  summary.proxyDisagreement,
                  " proxy-disagreement)"
                ] })
              ] }) : /* @__PURE__ */ jsx6("span", { style: { color: T.textSecondary, fontStyle: "italic" }, children: pending ? "scoring tool choices\u2026" : "no tool-choice data yet" }),
              pending && summary && /* @__PURE__ */ jsx6("span", { style: { color: T.textSecondary, fontStyle: "italic" }, children: "updating\u2026" })
            ]
          }
        ),
        error !== void 0 && /* @__PURE__ */ jsxs7(
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
        /* @__PURE__ */ jsx6(
          "div",
          {
            onScroll: w.onScroll,
            style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 12px 0" },
            children: call === void 0 ? /* @__PURE__ */ jsx6("div", { style: { color: T.textSecondary, fontStyle: "italic", padding: "4px 0" }, children: calls.length === 0 ? pending ? "Waiting for the first scored call\u2026" : "No LLM call offered tools in this run." : "No tool-offering LLM call at or before this cursor position." }) : /* @__PURE__ */ jsxs7(Fragment2, { children: [
              /* @__PURE__ */ jsx6(CallHeader, { call }),
              scores.length > 0 ? /* @__PURE__ */ jsxs7("div", { role: "list", "aria-label": "Offered tool scores", children: [
                w.topPad > 0 && /* @__PURE__ */ jsx6("div", { style: { height: w.topPad }, "aria-hidden": true }),
                scores.slice(w.start, w.end).map((s) => /* @__PURE__ */ jsx6(
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
                w.bottomPad > 0 && /* @__PURE__ */ jsx6("div", { style: { height: w.bottomPad }, "aria-hidden": true })
              ] }) : /* @__PURE__ */ jsxs7("div", { role: "list", "aria-label": "Offered tools (not scored)", children: [
                w.topPad > 0 && /* @__PURE__ */ jsx6("div", { style: { height: w.topPad }, "aria-hidden": true }),
                call.offered.slice(w.start, w.end).map((t) => /* @__PURE__ */ jsx6(
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
                    children: /* @__PURE__ */ jsxs7("span", { style: { fontFamily: T.fontMono }, children: [
                      call.chosen.includes(t.name) ? "\u2713 " : "",
                      t.name
                    ] })
                  },
                  t.name
                )),
                w.bottomPad > 0 && /* @__PURE__ */ jsx6("div", { style: { height: w.bottomPad }, "aria-hidden": true })
              ] })
            ] })
          }
        ),
        /* @__PURE__ */ jsx6(
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
  return /* @__PURE__ */ jsxs7(
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
        /* @__PURE__ */ jsxs7("span", { style: { fontWeight: 600 }, children: [
          "Iteration ",
          call.iteration
        ] }),
        /* @__PURE__ */ jsx6("span", { style: { fontFamily: T.fontMono, fontSize: 10, color: T.textSecondary }, children: call.runtimeStageId }),
        margin && margin.margin !== void 0 && /* @__PURE__ */ jsxs7(
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
        margin && margin.margin === void 0 && /* @__PURE__ */ jsx6("span", { style: { fontSize: 10, color: T.textSecondary, fontStyle: "italic" }, children: "every offered tool was chosen \u2014 no competition to measure" }),
        margin?.flags.narrow && /* @__PURE__ */ jsx6(FlagBadge, { label: "\u26A0 NARROW" }),
        margin?.flags.proxyDisagreement && /* @__PURE__ */ jsx6(FlagBadge, { label: "\u26A0 PROXY-DISAGREEMENT" }),
        call.skipped !== void 0 && /* @__PURE__ */ jsx6("span", { style: { fontSize: 10, color: T.textSecondary, fontStyle: "italic" }, children: SKIP_LABELS[call.skipped] ?? call.skipped }),
        margin === void 0 && call.skipped === void 0 && /* @__PURE__ */ jsx6("span", { style: { fontSize: 10, color: T.textSecondary, fontStyle: "italic" }, children: "not scored yet" })
      ]
    }
  );
};
var FlagBadge = ({ label }) => /* @__PURE__ */ jsx6(
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
  return /* @__PURE__ */ jsxs7(
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
        /* @__PURE__ */ jsxs7(
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
        /* @__PURE__ */ jsx6("span", { style: { flex: 1, minWidth: 40, display: "flex", alignItems: "center" }, children: /* @__PURE__ */ jsx6(
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
        /* @__PURE__ */ jsx6(
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
        topScored && !chosen && /* @__PURE__ */ jsx6("span", { style: { flex: "none", fontSize: 9, color: T.warning }, children: "proxy top pick" })
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
import { Fragment as Fragment3, jsx as jsx7, jsxs as jsxs8 } from "react/jsx-runtime";
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
  const effectiveChart = useMemo4(
    () => chart ?? (runner ? {
      graph: structureGraphFromRunner(
        runner
      ),
      layout: dagreTraceLayout,
      nodeTypes: LENS_NODE_TYPES
    } : void 0),
    [chart, runner]
  );
  const effectiveStepGraph = stepGraph ?? recorder.getStepGraph();
  const toolDescriptions = useMemo4(
    () => buildToolDescriptions(recorder),
    // log identity changes each event tick — the dep signals
    // re-aggregation when new events arrive.
    [recorder, log]
  );
  const mergedTemplates = useMemo4(
    () => commentaryTemplates ? {
      ...defaultCommentaryTemplates,
      ...commentaryTemplates
    } : defaultCommentaryTemplates,
    [commentaryTemplates]
  );
  const effectiveAppName = appName ?? "Chatbot";
  const liveStreamLine = useMemo4(
    () => computeLiveStreamLine(recorder, effectiveAppName, mergedTemplates),
    // log identity changes on every event tick — that's our re-render
    // signal even though we read recorder.liveState directly.
    [recorder, log, effectiveAppName, mergedTemplates]
  );
  const effectiveHumanizer = useMemo4(
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
  const [focusStep, setFocusStep] = useState4(0);
  const cursorRuntimeStageId = cursorPositions[focusStep]?.runtimeStageId ?? "";
  const [autoAdvance, setAutoAdvance] = useState4(true);
  useEffect5(() => {
    if (autoAdvance) setFocusStep(maxStep);
  }, [maxStep, autoAdvance]);
  const handleFocusChange = (n) => {
    setFocusStep(n);
    setAutoAdvance(n >= maxStep);
  };
  const isLive = autoAdvance && focusStep >= maxStep;
  if (view === "user") return /* @__PURE__ */ jsx7(UserView, { tree, summary });
  if (view === "analyst")
    return /* @__PURE__ */ jsx7(
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
  return /* @__PURE__ */ jsx7(
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
    return renderCommentary(tmpl2, { appName });
  }
  const tmpl = templates["stream.token.partial"] ?? "";
  return renderCommentary(tmpl, { appName, partial });
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
  const traceOverlay = useMemo4(
    () => recorder.runtime.getOverlay(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder, recorder.runtime.version()]
  );
  const selectedSpecNodeId = cursorRuntimeStageId ? cursorRuntimeStageId.split("#")[0] ?? "" : "";
  const drillInto = onDrillInto;
  const drillTo = onDrillTo;
  const groups = useMemo4(() => {
    try {
      return buildGroups(recorder.boundary.boundaryIndex);
    } catch {
      return [];
    }
  }, [recorder, log]);
  const hopsDrillPath = useMemo4(
    () => innerGroupSubflowPath(groups, drillPath),
    [groups, drillPath]
  );
  const hops = useMemo4(() => {
    if (!stepGraph) return [];
    const agentInstances = selectAgentInstances(stepGraph);
    return selectHops({ graph: stepGraph, drillPath: hopsDrillPath, agents: agentInstances });
  }, [stepGraph, hopsDrillPath]);
  const focusedHop = hops[focusStep];
  const focusedNode = focusedHop?.anchorStep ?? stepGraph?.nodes[focusStep];
  const focusedRuntimeStageId = focusedNode?.runtimeStageId;
  const { cursorFocusedNode, cursorRelatedNodes } = useMemo4(() => {
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
  const cursorInternalStage = useMemo4(() => {
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
  const { runInput, runOutput } = useMemo4(() => {
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
  const coActiveStageIds = useMemo4(() => {
    const ids = cursorPositions[focusStep]?.coActiveGroupIds;
    if (!ids || ids.length === 0) return void 0;
    return new Set(ids.map((id) => id.split("#")[0]));
  }, [cursorPositions, focusStep]);
  const stepToEventSeq = useMemo4(() => {
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
  const isPlumbingEvent = useCallback3((eventType) => {
    if (!eventType) return false;
    const stripped = eventType.startsWith("agentfootprint.") ? eventType.slice("agentfootprint.".length) : eventType;
    return stripped === "run.entry" || stripped === "run.exit" || stripped === "subflow.entry" || stripped === "subflow.exit" || stripped === "context.injected" || stripped === "context.slot_composed" || stripped === "stream.token" || stripped === "stream.thinking_delta";
  }, []);
  const commentarySeqs = useMemo4(() => {
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
  const focusedSeq = useMemo4(() => {
    const v2 = commentarySeqs[focusStep];
    return v2 !== void 0 ? v2 : stepToEventSeq[focusStep] ?? -1;
  }, [commentarySeqs, focusStep, stepToEventSeq]);
  const timelineMoments = useMemo4(
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
  const [leftExpanded, setLeftExpanded] = useState4(true);
  const [rightExpanded, setRightExpanded] = useState4(true);
  const [bottomExpanded, setBottomExpanded] = useState4(false);
  const [toolChoiceExpanded, setToolChoiceExpanded] = useState4(false);
  const agentNodes = useMemo4(() => {
    const all = stepGraph?.nodes ?? [];
    return all.filter(
      (n) => n.kind === "subflow" && (n.primitiveKind === "Agent" || n.primitiveKind === "LLMCall")
    );
  }, [stepGraph]);
  return /* @__PURE__ */ jsxs8(
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
        /* @__PURE__ */ jsxs8("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ jsx7("div", { style: { flex: 1, minWidth: 0 }, children: /* @__PURE__ */ jsx7(SummaryCard, { summary }) }),
          /* @__PURE__ */ jsx7(
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
        /* @__PURE__ */ jsx7(
          TimeTravel,
          {
            compact: true,
            total,
            focusSeq: focusStep,
            onFocusChange,
            isLive
          }
        ),
        /* @__PURE__ */ jsxs8(
          "div",
          {
            style: {
              flex: 1,
              minHeight: 0,
              display: "flex",
              overflow: "hidden"
            },
            children: [
              agentNodes.length >= 2 && (leftExpanded ? /* @__PURE__ */ jsxs8(Fragment3, { children: [
                /* @__PURE__ */ jsxs8(
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
                      /* @__PURE__ */ jsx7(SidePanelHeader, { title: "Agents" }),
                      /* @__PURE__ */ jsx7("div", { style: { flex: 1, minHeight: 0, overflowY: "auto" }, children: /* @__PURE__ */ jsx7(
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
                /* @__PURE__ */ jsx7(
                  VLinePill,
                  {
                    label: "Agents",
                    expanded: true,
                    side: "left",
                    onClick: () => setLeftExpanded(false)
                  }
                )
              ] }) : /* @__PURE__ */ jsx7(
                VLinePill,
                {
                  label: "Agents",
                  expanded: false,
                  side: "left",
                  onClick: () => setLeftExpanded(true)
                }
              )),
              /* @__PURE__ */ jsxs8(
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
                    drillPath.length > 0 && /* @__PURE__ */ jsx7(
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
                    /* @__PURE__ */ jsx7(
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
                          /* @__PURE__ */ jsx7(LensChartBoundary, { children: /* @__PURE__ */ jsx7(
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
                        ) : /* @__PURE__ */ jsxs8("div", { style: { padding: 24, color: T.textMuted, fontSize: 12 }, children: [
                          "No runner attached \u2014 pass the agentfootprint Runner via",
                          /* @__PURE__ */ jsx7("code", { children: " <Lens runner={runner} />" }),
                          " to render the composition graph."
                        ] })
                      }
                    )
                  ]
                }
              ),
              /* @__PURE__ */ jsx7(
                VLinePill,
                {
                  label: "Details",
                  expanded: rightExpanded,
                  side: "right",
                  onClick: () => setRightExpanded((v2) => !v2)
                }
              ),
              rightExpanded && /* @__PURE__ */ jsx7(
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
                  children: /* @__PURE__ */ jsx7(
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
                        detail: /* @__PURE__ */ jsx7(
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
        /* @__PURE__ */ jsx7(
          HLinePill,
          {
            label: "Commentary",
            detail: `${log.length} moments`,
            expanded: bottomExpanded,
            onClick: () => setBottomExpanded((v2) => !v2)
          }
        ),
        bottomExpanded && /* @__PURE__ */ jsx7(
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
            children: /* @__PURE__ */ jsx7(
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
        toolChoice && /* @__PURE__ */ jsxs8(Fragment3, { children: [
          /* @__PURE__ */ jsx7(
            HLinePill,
            {
              label: "Tool choice",
              detail: toolChoice.summary ? `${toolChoice.summary.flagged} flagged \xB7 ${toolChoice.summary.scored} scored` : toolChoice.pending ? "scoring\u2026" : `${toolChoice.calls.length} calls`,
              expanded: toolChoiceExpanded,
              onClick: () => setToolChoiceExpanded((v2) => !v2)
            }
          ),
          toolChoiceExpanded && /* @__PURE__ */ jsx7(
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
              children: /* @__PURE__ */ jsx7(
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
var SyntheticNowLine = React5.forwardRef(
  function SyntheticNowLine2({ line }, ref) {
    return /* @__PURE__ */ jsxs8(
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
          /* @__PURE__ */ jsx7(
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
  const containerRef = useRef4(null);
  const firstFocusRef = useRef4(null);
  const syntheticRef = useRef4(null);
  useEffect5(() => {
    if (focusedSeq === void 0 || focusedSeq < 0 || !firstFocusRef.current)
      return;
    firstFocusRef.current.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  }, [focusedSeq]);
  useEffect5(() => {
    if (!syntheticCurrentLine || !syntheticRef.current) return;
    syntheticRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [syntheticCurrentLine]);
  const seqToIndex = useMemo4(() => {
    const m = /* @__PURE__ */ new Map();
    for (let i = 0; i < log.length; i++) m.set(log[i].seq, i);
    return m;
  }, [log]);
  let firstFocusAssigned = false;
  return /* @__PURE__ */ jsx7(
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
          return /* @__PURE__ */ jsx7("div", { style: { color: T.textSecondary, fontStyle: "italic" }, children: "No moments yet \u2014 run a sample to see commentary." });
        }
        const cutoff = focusedSeq === void 0 || focusedSeq < 0 ? -1 : Math.max(0, seqToIndex.get(focusedSeq) ?? -1);
        if (cutoff < 0) {
          if (syntheticCurrentLine) {
            return /* @__PURE__ */ jsx7(SyntheticNowLine, { ref: syntheticRef, line: syntheticCurrentLine });
          }
          return /* @__PURE__ */ jsx7("div", { style: { color: T.textSecondary, fontStyle: "italic" }, children: "Scrub the slider to walk through the run." });
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
        return /* @__PURE__ */ jsxs8(Fragment3, { children: [
          hidden > 0 && /* @__PURE__ */ jsxs8(
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
            return /* @__PURE__ */ jsxs8(
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
                  /* @__PURE__ */ jsxs8(
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
          syntheticCurrentLine && /* @__PURE__ */ jsx7(SyntheticNowLine, { ref: syntheticRef, line: syntheticCurrentLine }),
          liveStreamLine !== null && /* @__PURE__ */ jsx7(LiveStreamLine, { line: liveStreamLine })
        ] });
      })()
    }
  );
};
var SidePanelHeader = ({ title }) => /* @__PURE__ */ jsx7(
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
    return /* @__PURE__ */ jsx7(
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
  return /* @__PURE__ */ jsx7("div", { style: { padding: 4, display: "flex", flexDirection: "column" }, children: nodes.map((n) => /* @__PURE__ */ jsx7(
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
  return /* @__PURE__ */ jsxs8(
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
        /* @__PURE__ */ jsx7("span", { "aria-hidden": true, style: { fontSize: 14 }, children: icon }),
        /* @__PURE__ */ jsxs8("span", { style: { display: "flex", flexDirection: "column", minWidth: 0 }, children: [
          /* @__PURE__ */ jsx7(
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
          /* @__PURE__ */ jsx7(
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
var HLinePill = memo(function HLinePill2({
  label,
  detail,
  expanded,
  onClick
}) {
  return /* @__PURE__ */ jsxs8("div", { style: { display: "flex", alignItems: "center", flex: "none" }, children: [
    /* @__PURE__ */ jsx7("div", { style: { flex: 1, height: 1, background: T.border } }),
    /* @__PURE__ */ jsxs8(
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
          /* @__PURE__ */ jsx7("span", { style: { fontSize: 7 }, children: expanded ? "\u25BC" : "\u25B6" }),
          label,
          detail && /* @__PURE__ */ jsx7("span", { style: { fontWeight: 400, opacity: 0.5, fontSize: 9 }, children: detail })
        ]
      }
    ),
    /* @__PURE__ */ jsx7("div", { style: { flex: 1, height: 1, background: T.border } })
  ] });
});
var VLinePill = memo(function VLinePill2({
  label,
  expanded,
  side = "right",
  onClick
}) {
  const arrow = side === "right" ? expanded ? "\u25B6" : "\u25C0" : expanded ? "\u25C0" : "\u25B6";
  return /* @__PURE__ */ jsxs8(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flex: "none"
      },
      children: [
        /* @__PURE__ */ jsx7("div", { style: { flex: 1, width: 1, background: T.border } }),
        /* @__PURE__ */ jsxs8(
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
              /* @__PURE__ */ jsx7("span", { style: { fontSize: 7, writingMode: "horizontal-tb" }, children: arrow }),
              label
            ]
          }
        ),
        /* @__PURE__ */ jsx7("div", { style: { flex: 1, width: 1, background: T.border } })
      ]
    }
  );
});
var Breadcrumb = ({ path, labels, onJumpTo }) => /* @__PURE__ */ jsxs8(
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
      /* @__PURE__ */ jsx7(
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
        return /* @__PURE__ */ jsxs8(React5.Fragment, { children: [
          /* @__PURE__ */ jsx7("span", { style: { opacity: 0.5 }, children: "/" }),
          /* @__PURE__ */ jsx7(
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
  return /* @__PURE__ */ jsxs8("div", { style: { display: "grid", gap: 16 }, children: [
    /* @__PURE__ */ jsx7(SummaryCard, { summary }),
    /* @__PURE__ */ jsx7(
      TimeTravel,
      {
        total,
        focusSeq,
        onFocusChange,
        isLive
      }
    ),
    /* @__PURE__ */ jsx7(Card, { title: "Commentary", children: /* @__PURE__ */ jsxs8("div", { style: { fontSize: 13, lineHeight: 1.6, fontFamily: T.fontSans }, children: [
      (() => {
        const { hidden, shown } = tailWindow(log, MAX_COMMENTARY_LINES);
        return /* @__PURE__ */ jsxs8(Fragment3, { children: [
          hidden > 0 && /* @__PURE__ */ jsxs8(
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
            return /* @__PURE__ */ jsxs8(
              "div",
              {
                style: {
                  padding: "4px 0",
                  borderBottom: `1px solid ${T.border}`
                },
                children: [
                  /* @__PURE__ */ jsxs8("span", { style: { opacity: 0.5, marginRight: 8 }, children: [
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
      liveStreamLine !== null && /* @__PURE__ */ jsx7(LiveStreamLine, { line: liveStreamLine })
    ] }) })
  ] });
};
var CopyForLLMButton = ({ recorder, stepGraph, humanizer, appName, viewState }) => {
  const [copied, setCopied] = useState4(false);
  const handleCopy = async () => {
    const { buildLLMText: buildLLMText2 } = await import("./copyForLLM-RI3N2LM6.js");
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
  return /* @__PURE__ */ jsx7(
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
var LiveStreamLine = ({ line }) => /* @__PURE__ */ jsxs8(
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
      /* @__PURE__ */ jsx7(
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
  return /* @__PURE__ */ jsxs8(
    "div",
    {
      style: {
        padding: 16,
        fontFamily: T.fontSans,
        display: "grid",
        gap: 12
      },
      children: [
        /* @__PURE__ */ jsxs8(
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
        /* @__PURE__ */ jsx7(
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
}) => /* @__PURE__ */ jsxs8(
  "div",
  {
    style: {
      border: `1px solid ${T.border}`,
      borderRadius: 6,
      fontFamily: T.fontSans
    },
    children: [
      /* @__PURE__ */ jsx7(
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
      /* @__PURE__ */ jsx7("div", { style: { padding: 8 }, children })
    ]
  }
);

// src/react/Replay.tsx
import { useMemo as useMemo5 } from "react";
import { dagreTraceLayout as dagreTraceLayout2 } from "footprint-explainable-ui/flowchart";
import { jsx as jsx8, jsxs as jsxs9 } from "react/jsx-runtime";
var Replay = ({
  trace,
  warnOnRawContent = true,
  showControls = true,
  showBackground = true
}) => {
  const chart = useMemo5(
    () => trace.structure === void 0 ? void 0 : {
      graph: structureGraphFromSpec(trace.structure),
      layout: dagreTraceLayout2,
      nodeTypes: LENS_NODE_TYPES
    },
    [trace.structure]
  );
  if (chart === void 0) {
    return /* @__PURE__ */ jsxs9("div", { className: "lens-replay lens-replay--no-structure", role: "status", children: [
      "This trace has no ",
      /* @__PURE__ */ jsx8("code", { children: "structure" }),
      " to replay \u2014 re-capture with",
      /* @__PURE__ */ jsx8("code", { children: " enable.localObservability()" }),
      "."
    ] });
  }
  return /* @__PURE__ */ jsxs9("div", { className: "lens-replay", children: [
    warnOnRawContent && trace.redaction === "none" && /* @__PURE__ */ jsx8("div", { className: "lens-replay__warning", role: "status", children: "\u26A0 This trace contains raw, un-redacted content." }),
    /* @__PURE__ */ jsx8(
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
import { useMemo as useMemo6, useState as useState5 } from "react";
import { Fragment as Fragment4, jsx as jsx9, jsxs as jsxs10 } from "react/jsx-runtime";
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
  const [overrides, setOverrides] = useState5(/* @__PURE__ */ new Map());
  const rows = useMemo6(
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
  const body = /* @__PURE__ */ jsxs10(Fragment4, { children: [
    w.topPad > 0 && /* @__PURE__ */ jsx9("div", { style: { height: w.topPad }, "aria-hidden": true }),
    rows.slice(w.start, w.end).map((row) => /* @__PURE__ */ jsx9(
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
    w.bottomPad > 0 && /* @__PURE__ */ jsx9("div", { style: { height: w.bottomPad }, "aria-hidden": true })
  ] });
  return /* @__PURE__ */ jsx9("div", { style: { fontFamily: T.fontMono, fontSize: 13, lineHeight: 1.5 }, children: w.windowed ? (
    // Windowing needs a scroll container with a bounded height —
    // engaged only past the threshold, where an unbounded tree
    // wouldn't be usable anyway.
    /* @__PURE__ */ jsx9("div", { style: { maxHeight, overflowY: "auto" }, onScroll: w.onScroll, children: body })
  ) : body });
};
var RunTreeRow = ({ row, selected, clickable, onClick, fixedHeight }) => {
  const { node, depth, expanded } = row;
  const hasChildren = node.children.length > 0;
  return /* @__PURE__ */ jsxs10(
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
        /* @__PURE__ */ jsx9("span", { style: { opacity: 0.5, width: 12, display: "inline-block" }, children: hasChildren ? expanded ? "\u25BE" : "\u25B8" : "\xB7" }),
        /* @__PURE__ */ jsx9("span", { children: kindGlyph(node.kind) }),
        /* @__PURE__ */ jsx9("span", { style: { fontWeight: node.kind === "run" ? 600 : 400 }, children: node.label }),
        /* @__PURE__ */ jsxs10(
          "span",
          {
            style: {
              marginLeft: "auto",
              opacity: 0.6,
              fontSize: 11
            },
            children: [
              statusGlyph(node.status),
              node.durationMs !== void 0 ? `  ${formatMs(node.durationMs)}` : ""
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
function formatMs(ms) {
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  return `${(ms / 1e3).toFixed(2)}s`;
}

// src/react/EventStream.tsx
import { useMemo as useMemo7 } from "react";
import { Fragment as Fragment5, jsx as jsx10, jsxs as jsxs11 } from "react/jsx-runtime";
var EventStream = ({
  log,
  humanizer = defaultHumanizer,
  domainFilter,
  onSelect,
  droppedCount = 0,
  virtualizeThreshold = 300,
  rowHeight = 24
}) => {
  const filtered = useMemo7(() => {
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
  return /* @__PURE__ */ jsxs11(
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
        droppedCount > 0 && /* @__PURE__ */ jsxs11(
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
        filtered.length === 0 ? /* @__PURE__ */ jsx10("div", { style: { opacity: 0.5, padding: 8 }, children: "No events yet." }) : /* @__PURE__ */ jsxs11(Fragment5, { children: [
          w.topPad > 0 && /* @__PURE__ */ jsx10("div", { style: { height: w.topPad }, "aria-hidden": true }),
          filtered.slice(w.start, w.end).map((entry) => /* @__PURE__ */ jsxs11(
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
                /* @__PURE__ */ jsxs11("span", { style: { opacity: 0.5, ...windowedCellStyle }, children: [
                  "+",
                  Math.round(entry.runOffsetMs),
                  "ms"
                ] }),
                /* @__PURE__ */ jsx10("span", { style: { color: T.textSecondary, ...windowedCellStyle }, children: shortType(entry.event.type) }),
                /* @__PURE__ */ jsx10("span", { style: windowedCellStyle, children: humanizer(entry.event) ?? "" })
              ]
            },
            entry.seq
          )),
          w.bottomPad > 0 && /* @__PURE__ */ jsx10("div", { style: { height: w.bottomPad }, "aria-hidden": true })
        ] })
      ]
    }
  );
};
function shortType(type) {
  return type.replace(/^agentfootprint\./, "");
}

// src/react/SkillGraphFlow.tsx
import React9, { useCallback as useCallback4, useMemo as useMemo8, useRef as useRef5, useState as useState6 } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background as Background2,
  Controls as Controls2,
  Handle,
  Position,
  MarkerType
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// src/react/skillGraphFlowLayout.ts
import dagre from "dagre";
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
  const g = new dagre.graphlib.Graph({ multigraph: true });
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
  dagre.layout(g);
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
import { Fragment as Fragment6, jsx as jsx11, jsxs as jsxs12 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsxs12(
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
        /* @__PURE__ */ jsx11(Handle, { type: "source", position: Position.Bottom, style: HANDLE_STYLE, isConnectable: false })
      ]
    }
  );
};
var SkillBoxNode = ({ data }) => {
  const d = data;
  return /* @__PURE__ */ jsxs12(
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
        /* @__PURE__ */ jsx11(Handle, { type: "target", position: Position.Top, style: HANDLE_STYLE, isConnectable: false }),
        /* @__PURE__ */ jsx11(
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
        /* @__PURE__ */ jsx11(
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
        /* @__PURE__ */ jsx11(Handle, { type: "source", position: Position.Bottom, style: HANDLE_STYLE, isConnectable: false })
      ]
    }
  );
};
var PredicateNode = ({ data }) => {
  const d = data;
  const { width, height } = sizeFor("predicate");
  return /* @__PURE__ */ jsxs12("div", { style: { width, height, position: "relative", cursor: "pointer" }, children: [
    /* @__PURE__ */ jsx11(Handle, { type: "target", position: Position.Top, style: HANDLE_STYLE, isConnectable: false }),
    /* @__PURE__ */ jsx11(
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
    /* @__PURE__ */ jsx11(
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
    /* @__PURE__ */ jsx11(Handle, { type: "source", position: Position.Bottom, style: HANDLE_STYLE, isConnectable: false })
  ] });
};
var NODE_TYPES = {
  sgStart: StartNode,
  sgPredicate: PredicateNode,
  sgSkill: SkillBoxNode
};
function RoutingPath({ steps }) {
  return /* @__PURE__ */ jsxs12("div", { style: { marginTop: 12 }, children: [
    /* @__PURE__ */ jsx11("div", { style: { fontSize: 11, color: T.textMuted, marginBottom: 6 }, children: "REACHED WHEN" }),
    /* @__PURE__ */ jsx11(
      "div",
      {
        style: {
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6
        },
        children: steps.map((s, i) => /* @__PURE__ */ jsxs12(React9.Fragment, { children: [
          i > 0 && /* @__PURE__ */ jsx11("span", { style: { color: T.textMuted }, children: "\u2192" }),
          /* @__PURE__ */ jsxs12("span", { style: { fontSize: 12, color: T.textSecondary }, children: [
            s.predicate,
            " ",
            /* @__PURE__ */ jsx11("strong", { style: { color: s.branch === "yes" ? T.srcSkill : T.textMuted }, children: s.branch })
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
    return /* @__PURE__ */ jsx11("aside", { style: panel, "data-testid": "skill-graph-detail", children: /* @__PURE__ */ jsx11("p", { style: { color: T.textMuted, fontSize: 13, margin: 0 }, children: "Click a node to inspect it. Diamonds are decision predicates; boxes are skills that load just-in-time when their path is chosen." }) });
  }
  const isPredicate = node.kind === "predicate";
  const accent = isPredicate ? T.edgeDecision : T.srcSkill;
  return /* @__PURE__ */ jsxs12("aside", { style: panel, "data-testid": "skill-graph-detail", children: [
    /* @__PURE__ */ jsx11(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4
        },
        children: /* @__PURE__ */ jsx11(
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
    /* @__PURE__ */ jsx11("h3", { style: { margin: "0 0 12px", fontSize: 16 }, children: detail?.title ?? node.label ?? node.id }),
    isPredicate && !detail && /* @__PURE__ */ jsxs12("p", { style: { color: T.textSecondary, fontSize: 13, margin: 0 }, children: [
      "Routes to its ",
      /* @__PURE__ */ jsx11("strong", { children: "yes" }),
      " / ",
      /* @__PURE__ */ jsx11("strong", { children: "no" }),
      " subtree based on this predicate, evaluated every iteration."
    ] }),
    detail?.description && /* @__PURE__ */ jsx11("p", { style: { color: T.textSecondary, fontSize: 13, margin: "0 0 12px" }, children: detail.description }),
    routingPath.length > 0 && /* @__PURE__ */ jsx11(RoutingPath, { steps: routingPath }),
    detail?.meta?.map((row) => /* @__PURE__ */ jsxs12("div", { style: { fontSize: 12, marginBottom: 6 }, children: [
      /* @__PURE__ */ jsxs12("span", { style: { color: T.textMuted }, children: [
        row.label,
        ": "
      ] }),
      /* @__PURE__ */ jsx11("span", { style: { color: T.textSecondary }, children: row.value })
    ] }, row.label)),
    detail?.tools && detail.tools.length > 0 && /* @__PURE__ */ jsxs12("div", { style: { marginTop: 12 }, children: [
      /* @__PURE__ */ jsxs12("div", { style: { fontSize: 11, color: T.textMuted, marginBottom: 6 }, children: [
        "UNLOCKS ",
        detail.tools.length,
        " TOOL",
        detail.tools.length === 1 ? "" : "S"
      ] }),
      /* @__PURE__ */ jsx11("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: detail.tools.map((tool) => /* @__PURE__ */ jsx11(
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
    detail?.body && /* @__PURE__ */ jsx11(
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
  const [internalSelected, setInternalSelected] = useState6(defaultSelectedId);
  const selectedId = isControlled ? selectedIdProp : internalSelected;
  const select = useCallback4(
    (id) => {
      if (!isControlled) setInternalSelected(id);
      onSelectNode?.(id);
    },
    [isControlled, onSelectNode]
  );
  const containerRef = useRef5(null);
  const [panelWidth, setPanelWidth] = useState6(defaultPanelWidth);
  const [dragging, setDragging] = useState6(false);
  const startResize = useCallback4((e) => {
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
  const { rfNodes, rfEdges } = useMemo8(() => {
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
        type: MarkerType.ArrowClosed,
        color: T.edgeDefault,
        width: 16,
        height: 16
      }
    }));
    return { rfNodes: rfNodes2, rfEdges: rfEdges2 };
  }, [graph, showStart, selectedId]);
  const selectedNode = useMemo8(
    () => selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null,
    [graph.nodes, selectedId]
  );
  const detail = selectedNode && detailFor ? detailFor(selectedNode) : void 0;
  const routingPath = useMemo8(
    () => selectedNode ? routingPathTo(graph, selectedNode.id) : [],
    [graph, selectedNode]
  );
  return /* @__PURE__ */ jsxs12(
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
        /* @__PURE__ */ jsx11("div", { style: { flex: 1, minWidth: 0 }, children: /* @__PURE__ */ jsx11(ReactFlowProvider, { children: /* @__PURE__ */ jsxs12(
          ReactFlow,
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
              /* @__PURE__ */ jsx11(Background2, { color: T.border, gap: 20 }),
              /* @__PURE__ */ jsx11(Controls2, { showInteractive: false })
            ]
          }
        ) }) }),
        !hideDetailPanel && /* @__PURE__ */ jsxs12(Fragment6, { children: [
          /* @__PURE__ */ jsx11(
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
          /* @__PURE__ */ jsx11(
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
import { useEffect as useEffect6, useRef as useRef6, useState as useState7 } from "react";
function useStepFocus(max) {
  const [focus, setFocus] = useState7(Math.max(0, max));
  const prevMax = useRef6(max);
  useEffect6(() => {
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
import { useMemo as useMemo9 } from "react";
function useStepView(graph, log, focusIndex, drillPath) {
  return useMemo9(
    () => selectStepView({ graph, log, focusIndex, drillPath }),
    [graph, log, focusIndex, drillPath]
  );
}

// src/react/hooks/useCommentarySlider.ts
import { useCallback as useCallback5, useEffect as useEffect7, useMemo as useMemo10, useState as useState8 } from "react";
import { useSyncExternalStore as useSyncExternalStore3 } from "react";
function useCommentarySlider(recorder, initialMode = "commentary") {
  const version = useSyncExternalStore3(
    (listener) => recorder.subscribe(listener),
    () => recorder.getVersion(),
    () => recorder.getVersion()
  );
  const [commitIdx, setCommitIdxRaw] = useState8(0);
  const [mode, setMode] = useState8(initialMode);
  const [drill, setDrill] = useState8(void 0);
  const ranges = useMemo10(
    () => selectCommentaryRanges(recorder.boundary),
    // version captured at render time — re-derives on every notify.
    [recorder, version]
  );
  const totalCommits = useMemo10(() => {
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
  const snapPoints = useMemo10(() => {
    if (mode === "commit") return [];
    return ranges.map((r) => r.startIdx);
  }, [mode, ranges]);
  const setCommitIdx = useCallback5(
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
  const drillInto = useCallback5(
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
  useEffect7(() => {
    if (!drill) return;
    const inRange = commitIdx >= drill.startIdx && (drill.endIdx === void 0 || commitIdx <= drill.endIdx);
    if (!inRange) setDrill(void 0);
  }, [commitIdx, drill]);
  const active = useMemo10(
    () => selectCommentaryAt(recorder.boundary, commitIdx),
    [recorder, commitIdx, version]
  );
  const drillRange = useMemo10(() => {
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
import { useMemo as useMemo11 } from "react";
function useLensRenderGraph(runner, options = {}) {
  return useMemo11(() => {
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
export {
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
};
//# sourceMappingURL=index.js.map