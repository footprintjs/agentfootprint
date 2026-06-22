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

// src/core/copyForLLM.ts
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
var LIBRARY_INTERNAL_FIELDS = /* @__PURE__ */ new Set([
  "systemPromptInjections",
  "messagesInjections",
  "toolsInjections",
  "cumTokensInput",
  "cumTokensOutput",
  "cumEstimatedUsd",
  "costBudgetHit",
  "iteration"
]);
function compactBoundaryPayload(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (LIBRARY_INTERNAL_FIELDS.has(k)) continue;
    out[k] = v;
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

export {
  selectAgentInstances,
  selectStepAgentName,
  buildLLMText
};
//# sourceMappingURL=chunk-EYEBTJYP.js.map