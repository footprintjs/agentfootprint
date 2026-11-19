import { Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TracedFlow, type ThemeMode, type TraceGraph } from 'footprint-explainable-ui/flowchart';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import weatherRun from './generated/weather-run.json';
import './style.css';

// JSON preserves the branded stage IDs as strings. The recorder owns this generated data.
const graph = weatherRun.graph as TraceGraph;
const groupIds = graph.nodes
  .map(({ id }) => id)
  .filter((id) => graph.nodes.some(({ data }) => data.subflowOf === id));

function QuickStartWeatherTrace() {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [grouped, setGrouped] = useState(true);

  return (
    <main data-theme={theme}>
      <article>
        <a href="../../docs/getting-started/quick-start/#the-run-as-a-flowchart">
          ← Back to Quick Start
        </a>
        <header>
          <h1>Quick Start weather trace</h1>
          <p>
            {weatherRun.input} <strong>{weatherRun.result}</strong>
          </p>
          <p className="cohort">
            Recorded from commit{' '}
            <a
              href={`https://github.com/footprintjs/agentfootprint/commit/${weatherRun.provenance.commit}`}
            >
              <code>{weatherRun.provenance.commit.slice(0, 12)}</code>
            </a>{' '}
            with {weatherRun.provenance.cohort.join(', ')}.
          </p>
        </header>
        <div className="controls">
          <button type="button" aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>
            Show grouped subflows
          </button>
          <button
            type="button"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            Dark theme
          </button>
        </div>
        <p id="chart-help">
          {grouped
            ? 'Turn off grouped subflows to open a subflow on its own.'
            : 'Select a subflow to open it. Use the breadcrumb to return.'}
        </p>
        <section
          className="chart"
          aria-label="Mock weather agent flowchart"
          aria-describedby="chart-help"
        >
          <TracedFlow
            key={String(grouped)}
            graph={graph}
            groupedSubflows={grouped ? groupIds : undefined}
            theme={theme}
          >
            <Controls showInteractive={false} />
          </TracedFlow>
        </section>
      </article>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<QuickStartWeatherTrace />);
