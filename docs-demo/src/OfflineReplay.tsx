import { Controls } from '@xyflow/react';
import { TracedFlow, type TraceGraph } from 'footprint-explainable-ui/flowchart';
import { useState } from 'react';
import { RecordingCohort, type DemoFrameContent } from './DemoFrame';
import replay from './generated/offline-replay.json';
import { keyboardSubflowMount } from './subflowKeyboard';

// The build projects this graph from the persisted Trace's structure.
const graph = replay.graph as TraceGraph;
const subflowMounts = new Set(
  graph.nodes.map(({ data }) => data.subflowOf).filter((id) => id !== undefined),
);
const groupedSubflows = [...subflowMounts];

export default function OfflineReplay({ theme, themeToggle }: DemoFrameContent) {
  const [grouped, setGrouped] = useState(true);
  const [subflowId, setSubflowId] = useState<string | null>(null);

  function toggleGrouping() {
    setGrouped(!grouped);
    setSubflowId(null);
  }

  return (
    <>
      <p>{replay.meta.title}. No agent rerun.</p>
      <p>
        {replay.meta.input} <strong>{replay.meta.result}</strong>
      </p>
      <p>
        {replay.meta.events} events · redaction: {replay.meta.redaction}
      </p>
      <RecordingCohort provenance={replay.provenance} />
      <div className="controls">
        <button type="button" aria-pressed={grouped} onClick={toggleGrouping}>
          Show grouped subflows
        </button>
        {themeToggle}
      </div>
      <p id="chart-help">
        {grouped
          ? 'Turn off grouped subflows to open a subflow on its own.'
          : 'Select a subflow or focus it and press Enter. Use the breadcrumb to return.'}
      </p>
      <section
        className="chart"
        aria-label="Offline replay flowchart"
        aria-describedby="chart-help"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (grouped) return;
          const id = keyboardSubflowMount(event, subflowMounts);
          if (id) setSubflowId(id);
        }}
      >
        <TracedFlow
          key={String(grouped)}
          graph={graph}
          groupedSubflows={grouped ? groupedSubflows : undefined}
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
