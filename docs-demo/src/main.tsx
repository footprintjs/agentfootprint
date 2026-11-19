import { Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TracedFlow, type TraceGraph } from 'footprint-explainable-ui/flowchart';
import { useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoFrame, RecordingCohort, type DemoFrameContent } from './DemoFrame';
import type { SkillGraphDemo, SkillGraphViewProps } from './SkillGraphTryItInner';
import weatherRun from './generated/weather-run.json';
import './style.css';

// JSON preserves the branded stage IDs as strings. The recorder owns this generated data.
const graph = weatherRun.graph as TraceGraph;
const groupIds = graph.nodes
  .map(({ id }) => id)
  .filter((id) => graph.nodes.some(({ data }) => data.subflowOf === id));

function QuickStartWeatherTrace({ theme, themeToggle }: DemoFrameContent) {
  const [grouped, setGrouped] = useState(true);

  return (
    <>
      <a href="../../docs/getting-started/quick-start/#the-run-as-a-flowchart">
        ← Back to Quick Start
      </a>
      <header>
        <h1>Quick Start weather trace</h1>
        <p>
          {weatherRun.input} <strong>{weatherRun.result}</strong>
        </p>
        <RecordingCohort provenance={weatherRun.provenance} />
      </header>
      <div className="controls">
        <button type="button" aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>
          Show grouped subflows
        </button>
        {themeToggle}
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
    </>
  );
}

const skillViews = {
  'skill-graph-quickstart': {
    demo: 'quickstart',
    title: 'Skill graph quickstart',
    guideTitle: 'Skill graph quickstart',
    guideHref: '../../docs/build/skill-graph-quickstart/#you-can-see-it',
  },
  'skills-explained': {
    demo: 'support',
    title: 'Support skill graph',
    guideTitle: 'Skills explained',
    guideHref: '../../docs/build/skills-explained/#routing-between-skills--the-skill-graph',
  },
} as const satisfies Record<
  string,
  { demo: SkillGraphDemo; title: string; guideTitle: string; guideHref: string }
>;

const root = createRoot(document.getElementById('root')!);
const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const skillView =
  view === 'skill-graph-quickstart' || view === 'skills-explained' ? skillViews[view] : undefined;

if (skillView) {
  document.title = `${skillView.title} · AgentFootprint`;
  const version = params.get('agentfootprint');

  const renderSkillView = (View?: ComponentType<SkillGraphViewProps>) => {
    root.render(
      <DemoFrame>
        {({ themeToggle }) => (
          <>
            <a href={skillView.guideHref}>← Back to {skillView.guideTitle}</a>
            <header>
              <h1>{skillView.title}</h1>
            </header>
            {View ? (
              <View demo={skillView.demo} themeToggle={themeToggle} version={version} />
            ) : (
              <p>The interactive viewer is unavailable. The guide has the recorded diagram.</p>
            )}
          </>
        )}
      </DemoFrame>,
    );
  };

  import('./SkillGraphTryItInner').then(
    ({ default: View }) => renderSkillView(View),
    () => renderSkillView(),
  );
} else {
  root.render(<DemoFrame>{(frame) => <QuickStartWeatherTrace {...frame} />}</DemoFrame>);
}
