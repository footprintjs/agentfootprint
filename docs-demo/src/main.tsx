import { Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TracedFlow, type TraceGraph } from 'footprint-explainable-ui/flowchart';
import { useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DemoFrame,
  RecordingCohort,
  type DemoFrameContent,
  type PublishedDemoViewProps,
} from './DemoFrame';
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

const lazyViews = {
  'dynamic-react': {
    title: 'Dynamic ReAct live demo',
    guideTitle: 'Dynamic ReAct',
    guideHref: '../../docs/build/dynamic-react/#try-it-live',
    fallback: 'The guide has the recorded run.',
    load: () => import('./DynamicReactRun'),
  },
  'dynamic-react-subflows': {
    title: 'Dynamic ReAct subflows',
    guideTitle: 'Dynamic ReAct',
    guideHref: '../../docs/build/dynamic-react/#how-every-iteration-actually-works',
    fallback: 'The guide has the recorded diagram.',
    load: () => import('./DynamicReactSubflows'),
  },
  'offline-replay': {
    title: 'Offline replay',
    guideTitle: 'Replay a saved run',
    guideHref: '../../docs/debug/offline-replay/#replay-trace--the-chart-only-subset',
    fallback: 'The guide has the recorded diagram and the saved Trace.',
    load: () => import('./OfflineReplay'),
  },
  'how-to-build-lens': {
    title: 'See it in Lens',
    guideTitle: 'How to Build',
    guideHref: '../../how-to-build/#debug',
    fallback: 'How to Build has the sample code.',
    load: () => import('./HowToBuildLens'),
  },
};

const root = createRoot(document.getElementById('root')!);
const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const version = params.get('agentfootprint');
const skillView =
  view === 'skill-graph-quickstart' || view === 'skills-explained' ? skillViews[view] : undefined;
const lazyView =
  view && Object.hasOwn(lazyViews, view) ? lazyViews[view as keyof typeof lazyViews] : undefined;

if (skillView) {
  document.title = `${skillView.title} · AgentFootprint`;

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
} else if (view && lazyView) {
  const { guideHref, guideTitle, fallback, load, title } = lazyView;
  // All generated views and the live SDK use the same locked app cohort.
  const { provenance } = weatherRun;
  document.title = `${title} · AgentFootprint`;

  const renderLazyView = (View?: ComponentType<PublishedDemoViewProps>, error?: string) => {
    root.render(
      <DemoFrame>
        {(frame) => (
          <>
            <a href={guideHref}>← Back to {guideTitle}</a>
            <header id={view}>
              <h1>{title}</h1>
            </header>
            {View ? (
              <View {...frame} provenance={provenance} />
            ) : (
              <p>{error ? `${error} ${fallback}` : 'Loading the interactive viewer…'}</p>
            )}
          </>
        )}
      </DemoFrame>,
    );
  };

  if (version !== null && !provenance.cohort.includes(`agentfootprint@${version}`)) {
    renderLazyView(undefined, 'The interactive viewer is unavailable for this version.');
  } else {
    renderLazyView();
    load().then(
      ({ default: View }) => renderLazyView(View),
      () => renderLazyView(undefined, 'The interactive viewer is unavailable.'),
    );
  }
} else {
  root.render(<DemoFrame>{(frame) => <QuickStartWeatherTrace {...frame} />}</DemoFrame>);
}
