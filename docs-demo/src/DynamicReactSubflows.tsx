import { Controls } from '@xyflow/react';
import { TracedFlow, type TraceGraph } from 'footprint-explainable-ui/flowchart';
import { useState } from 'react';
import { RecordingCohort, type DemoFrameContent } from './DemoFrame';
import dynamicReact from './generated/dynamic-react.json';
import { keyboardSubflowMount } from './subflowKeyboard';

// The generator owns the raw graph. Its branded stage IDs serialize as strings.
const graph = dynamicReact.graph as TraceGraph;
const llmCallId = graph.nodes.find(
  ({ id }) => id === 'sf-llm-call' || id.endsWith('/sf-llm-call'),
)?.id;
const subflowMounts = new Set(graph.nodes.map(({ data }) => data.subflowOf));

export default function DynamicReactSubflows({ theme, themeToggle }: DemoFrameContent) {
  const [subflowId, setSubflowId] = useState<string | null>(llmCallId ?? null);

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
        onKeyDownCapture={(event) => {
          const id = keyboardSubflowMount(event, subflowMounts);
          if (id) setSubflowId(id);
        }}
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
