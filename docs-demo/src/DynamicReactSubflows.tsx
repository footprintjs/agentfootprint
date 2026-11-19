import { Controls } from '@xyflow/react';
import { TracedFlow, type TraceGraph } from 'footprint-explainable-ui/flowchart';
import { useState, type KeyboardEvent } from 'react';
import { RecordingCohort } from './DemoFrame';
import type { DynamicReactViewProps } from './DynamicReactRun';
import dynamicReact from './generated/dynamic-react.json';

// The generator owns the raw graph. Its branded stage IDs serialize as strings.
const graph = dynamicReact.graph as TraceGraph;
const llmCallId = graph.nodes.find(
  ({ id }) => id === 'sf-llm-call' || id.endsWith('/sf-llm-call'),
)?.id;
const subflowMounts = new Set(graph.nodes.map(({ data }) => data.subflowOf));

export default function DynamicReactSubflows({ theme, themeToggle }: DynamicReactViewProps) {
  const [subflowId, setSubflowId] = useState<string | null>(llmCallId ?? null);

  function openSubflowFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const node = event.target;
    if (!(node instanceof HTMLElement) || !node.matches('.react-flow__node')) return;
    const id = node.dataset.id;
    if (!id || !subflowMounts.has(id)) return;

    // React Flow selects the node on these keys. Open the mount as a click would.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setSubflowId(id);
  }

  return (
    <>
      <RecordingCohort provenance={dynamicReact.provenance} />
      <div className="controls">{themeToggle}</div>
      <p id="chart-help">
        FootprintJS runs the three context slots in parallel. Select a subflow or focus it and press
        Enter to see its stages. Use the breadcrumb to return.
      </p>
      <section
        className="chart"
        aria-label="Raw LLM-call subflows"
        aria-describedby="chart-help"
        tabIndex={-1}
        onKeyDownCapture={openSubflowFromKeyboard}
      >
        <TracedFlow
          graph={graph}
          currentSubflowId={subflowId}
          onSubflowChange={setSubflowId}
          theme={theme}
        >
          <Controls showInteractive={false} />
        </TracedFlow>
      </section>
    </>
  );
}
