# footprint-explainable-ui

<p>
  <a href="https://www.npmjs.com/package/footprint-explainable-ui"><img src="https://img.shields.io/npm/v/footprint-explainable-ui.svg?style=flat" alt="npm version"></a>
  <!-- coverage-badge --><img src="https://img.shields.io/badge/coverage-66%25-yellow.svg" alt="coverage: 66%"><!-- /coverage-badge -->
  <a href="https://github.com/footprintjs/explainable-ui/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://footprintjs.github.io/footprint-demo/"><img src="https://img.shields.io/badge/Live_Demo-View_App-10b981?style=flat" alt="Live Demo"></a>
  <a href="https://footprintjs.github.io/footprint-playground/"><img src="https://img.shields.io/badge/Playground-Try_it-6366f1?style=flat" alt="Playground"></a>
</p>

Themeable React components for visualizing [footprintjs](https://github.com/footprintjs/footPrint) pipeline execution — time-travel debugging, flowchart overlays, subflow drill-down, and collapsible detail panels.

## Install

```bash
npm install footprint-explainable-ui
```

**Peer dependencies:** `react >= 18`, `react-dom >= 18`

For flowchart components, also install:

```bash
npm install @xyflow/react
```

## Entry Points

| Import path | What it provides |
|---|---|
| `footprint-explainable-ui` | Core components, themes, adapters |
| `footprint-explainable-ui/flowchart` | Flowchart visualization (requires `@xyflow/react`) |

## Quick Start

### 1. Convert execution data to snapshots

```typescript
import { FlowChartExecutor } from "footprintjs";
import { toVisualizationSnapshots } from "footprint-explainable-ui";

const executor = new FlowChartExecutor(chart);
await executor.run({ input: data });

const snapshots = toVisualizationSnapshots(
  executor.getSnapshot(),
  executor.getNarrativeEntries(), // optional — enables rich narrative
);
```

### 2. Render with the all-in-one shell

```tsx
import { ExplainableShell } from "footprint-explainable-ui";
import { TracedFlowchartView } from "footprint-explainable-ui/flowchart";

function DebugView({ snapshots, spec, narrative, narrativeEntries }) {
  return (
    <ExplainableShell
      snapshots={snapshots}
      spec={spec}
      narrative={narrative}
      narrativeEntries={narrativeEntries}
      title="My Pipeline"
      panelLabels={{ topology: "What Ran", details: "What Happened", timeline: "How Long" }}
      renderFlowchart={({ spec, snapshots, selectedIndex, onNodeClick }) => (
        <TracedFlowchartView
          spec={spec}
          snapshots={snapshots}
          snapshotIndex={selectedIndex}
          onNodeClick={onNodeClick}
        />
      )}
    />
  );
}
```

This gives you:
- **Flowchart** (center) — execution path overlay, click subflow nodes to drill-down
- **Topology panel** (left) — subflow tree navigator, collapsible via VLinePill handle
- **Details panel** (right) — Memory state + Narrative tabs, collapsible
- **Timeline** (bottom) — Gantt-style stage durations, collapsible
- **Time-travel slider** — scrub through execution steps
- **Breadcrumbs** — navigate back from subflow drill-down
- **Mobile responsive** — auto-stacks vertically below 640px

### 3. Or compose individual components

```tsx
import {
  TimeTravelControls,
  MemoryInspector,
  ScopeDiff,
  GanttTimeline,
  NarrativeTrace,
} from "footprint-explainable-ui";

function MyDebugger({ snapshots }) {
  const [idx, setIdx] = useState(0);
  const current = snapshots[idx];
  const previous = idx > 0 ? snapshots[idx - 1] : null;

  return (
    <>
      <TimeTravelControls
        snapshots={snapshots}
        selectedIndex={idx}
        onIndexChange={setIdx}
      />
      <MemoryInspector snapshots={snapshots} selectedIndex={idx} />
      <ScopeDiff
        previous={previous?.memory ?? null}
        current={current.memory}
        hideUnchanged
      />
      <NarrativeTrace narrative={snapshots.map(s => s.narrative)} />
      <GanttTimeline snapshots={snapshots} selectedIndex={idx} onSelect={setIdx} />
    </>
  );
}
```

---

## ExplainableShell

The all-in-one orchestrator. Handles time-travel, subflow drill-down, memory/narrative panels, and responsive layout.

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `snapshots` | `StageSnapshot[]` | required | Visualization snapshots |
| `spec` | `SpecNode \| null` | — | Pipeline spec (enables flowchart + subflow tree) |
| `title` | `string` | `"Flowchart"` | Breadcrumb root label |
| `narrative` | `string[]` | — | Flat narrative lines |
| `narrativeEntries` | `NarrativeEntry[]` | — | Structured narrative (rich rendering) |
| `panelLabels` | `PanelLabels` | `{ topology: "Topology", details: "Details", timeline: "Timeline" }` | Customize collapsible pill labels |
| `defaultExpanded` | `DefaultExpanded` | `{ details: true }` | Which panels start open |
| `tabs` | `ShellTab[]` | `["result", "explainable"]` | Visible tabs |
| `renderFlowchart` | `(props) => ReactNode` | — | Flowchart renderer (pass `TracedFlowchartView`) |
| `resultData` | `Record<string, unknown>` | — | Final output data for Result tab |
| `size` | `"compact" \| "default" \| "detailed"` | `"default"` | Size variant |
| `unstyled` | `boolean` | `false` | Strip styles, render `data-fp` attributes |

### Panel Labels

Customize the text on collapsible pill buttons. Semantic keys — not tied to position:

```tsx
<ExplainableShell
  panelLabels={{
    topology: "What Ran",      // left panel (subflow tree)
    details: "What Happened",  // right panel (memory/narrative)
    timeline: "How Long",      // bottom panel (Gantt)
  }}
/>
```

### Default Expanded

Control which panels start open. Desktop default: details panel open (flowchart + memory = the library's unique value). For mobile, pass all `false`:

```tsx
// Desktop (default) — memory panel open
<ExplainableShell snapshots={...} spec={...} />

// Mobile — all collapsed, flowchart fills screen
<ExplainableShell
  snapshots={...}
  defaultExpanded={{ details: false }}
/>

// Everything open
<ExplainableShell
  snapshots={...}
  defaultExpanded={{ topology: true, details: true, timeline: true }}
/>
```

### Responsive Layout

The shell auto-detects container width via `ResizeObserver`:

- **Desktop (≥640px):** 3-column layout — SubflowTree | Flowchart | Memory/Narrative. Side panels collapse to VLinePill handles.
- **Mobile (<640px):** Stacked vertical — Flowchart (350px) → collapsible HLinePill sections. All panels auto-collapse on narrow.

### Collapsible Panel UX

All panels use the **line + pill** pattern:
- **Collapsed:** Thin divider line with a centered pill button (label + arrow)
- **Expanded:** Full content with a pill handle on the closing edge
- **VLinePill** (left/right panels): Vertical line with centered vertical pill. `side` prop controls arrow direction.
- **HLinePill** (bottom timeline): Horizontal line with centered pill.

---

## Flowchart Visualization

Import from `footprint-explainable-ui/flowchart`:

### TracedFlowchartView (recommended)

Self-contained flowchart renderer. Handles overlay computation, auto-fitView on resize.

```tsx
import { TracedFlowchartView } from "footprint-explainable-ui/flowchart";

<div style={{ height: 400 }}>
  <TracedFlowchartView
    spec={spec}
    snapshots={snapshots}
    snapshotIndex={idx}
    onNodeClick={(nodeId) => handleClick(nodeId)}
  />
</div>
```

Without `snapshots`, renders a plain static flowchart. With `snapshots`, shows the execution trace path with Google Maps-style glow.

**Auto-fitView:** The flowchart automatically calls `fitView()` when its container resizes (e.g. panel expand/collapse).

### Manual control with specToReactFlow

```tsx
import { specToReactFlow, StageNode, type ExecutionOverlay } from "footprint-explainable-ui/flowchart";
import { ReactFlow } from "@xyflow/react";

const overlay: ExecutionOverlay = {
  doneStages: new Set(["LoadOrder", "ProcessPayment"]),
  activeStage: "ShipOrder",
  executedStages: new Set(["LoadOrder", "ProcessPayment", "ShipOrder"]),
  executionOrder: ["LoadOrder", "ProcessPayment", "ShipOrder"],
};

const { nodes, edges } = specToReactFlow(spec, overlay);

<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={{ stage: StageNode }}
  fitView
/>
```

---

## Theming

### CSS Variables (recommended)

Consumer controls theme via `--fp-*` CSS custom properties. Components use `var(--fp-*, fallback)`:

```css
:root {
  --fp-color-primary: #7c6cf0;
  --fp-bg-primary: #1e1a2e;
  --fp-bg-secondary: #2a2540;
  --fp-bg-tertiary: #3a3455;
  --fp-text-primary: #f0e6d6;
  --fp-text-secondary: #b0a898;
  --fp-text-muted: #6b6b80;
  --fp-border: #3a3455;
  --fp-radius: 8px;
  --fp-font-sans: 'Inter', system-ui, sans-serif;
  --fp-font-mono: 'JetBrains Mono', monospace;
}
```

### ThemeProvider

```tsx
import { FootprintTheme, warmDark } from "footprint-explainable-ui";

<FootprintTheme tokens={warmDark}>
  <MyApp />
</FootprintTheme>
```

### Built-in Presets

| Preset | Description |
|---|---|
| `coolDark` | Default — indigo/slate dark theme |
| `warmDark` | Charcoal-purple with warm text |
| `warmLight` | Cream/peach light theme |
| `coolLight` | Light indigo theme |

---

## Components Reference

### Core Components

| Component | Description |
|---|---|
| `ExplainableShell` | All-in-one orchestrator with collapsible panels and responsive layout |
| `TimeTravelControls` | Play/pause, prev/next, scrubber timeline |
| `MemoryPanel` | Memory state + scope diff (composite right-panel view) |
| `NarrativePanel` | Narrative trace with progressive reveal |
| `StoryNarrative` | Rich rendering of structured `NarrativeEntry[]` |
| `NarrativeTrace` | Collapsible stage groups with progressive reveal |
| `NarrativeLog` | Simple timeline-style execution log |
| `ScopeDiff` | Side-by-side scope changes (added/changed/removed) |
| `ResultPanel` | Final pipeline output + console logs |
| `MemoryInspector` | Accumulated memory state viewer |
| `GanttTimeline` | Horizontal duration timeline (collapsible) |
| `SnapshotPanel` | All-in-one inspector (scrubber + memory + narrative + Gantt) |

### Flowchart Components (`footprint-explainable-ui/flowchart`)

| Export | Description |
|---|---|
| `TracedFlowchartView` | Self-contained flowchart with trace overlay and auto-fitView |
| `FlowchartView` | Lower-level ReactFlow wrapper |
| `StageNode` | Custom node with state-aware coloring, step badges, pulse rings |
| `specToReactFlow` | Convert pipeline spec → ReactFlow nodes/edges with overlay |
| `SubflowBreadcrumb` | Breadcrumb bar for subflow drill-down |
| `SubflowTree` | Tree view of all subflows (used in shell's left panel) |

### Adapters

| Export | Description |
|---|---|
| `toVisualizationSnapshots` | Convert `FlowChartExecutor.getSnapshot()` → `StageSnapshot[]` |
| `subflowResultToSnapshots` | Convert subflow result → `StageSnapshot[]` |
| `createSnapshots` | Build `StageSnapshot[]` from simple arrays (testing/custom data) |

### Types

| Export | Description |
|---|---|
| `PanelLabels` | `{ topology?, details?, timeline? }` — pill label customization |
| `DefaultExpanded` | `{ topology?, details?, timeline? }` — initial panel state |
| `StageSnapshot` | Core snapshot type for all components |
| `NarrativeEntry` | Structured narrative entry with type/depth/stageName |

---

## Size Variants

All components accept a `size` prop: `"compact"`, `"default"`, or `"detailed"`.

```tsx
<GanttTimeline snapshots={snapshots} size="compact" />
<MemoryInspector snapshots={snapshots} size="detailed" />
```

## Unstyled Mode

Strip all built-in styles for full CSS control. Components render semantic `data-fp` attributes:

```tsx
<NarrativeTrace narrative={lines} unstyled className="my-narrative" />
```

```css
[data-fp="narrative-header"] { font-weight: bold; }
[data-fp="narrative-step"] { padding-left: 2rem; }
```

---

## License

MIT
