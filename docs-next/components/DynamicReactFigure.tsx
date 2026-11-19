import { quickStartDemoPath } from '@/components/AgentFlowchart';
import { Diagram } from '@/components/Diagram';
import evidence from '@/lib/dynamic-react-figure.json';
import { SITE, asset } from '@/lib/site';

export const dynamicReactViews = {
  run: {
    id: 'dynamic-react',
    title: 'Dynamic ReAct mock run',
    guide: '/docs/build/dynamic-react/#try-it-live',
    launch: 'Run the interactive Dynamic ReAct demo',
    fallback: 'See the recorded Dynamic ReAct run in the guide',
  },
  subflows: {
    id: 'dynamic-react-subflows',
    title: 'Dynamic ReAct raw subflows',
    guide: '/docs/build/dynamic-react/#how-every-iteration-actually-works',
    launch: 'Explore the raw LLM-call subflows',
    fallback: 'See the context slot diagram in the guide',
  },
} as const;

function RecordingSource() {
  return (
    <>
      Recorded from a mock run with {evidence.cohort.join(', ')} from AgentFootprint commit{' '}
      <a href={`${SITE.repo}/commit/${evidence.commit}`}><code>{evidence.commit.slice(0, 12)}</code></a>.
    </>
  );
}

function DynamicReactLaunch({ view }: { view: keyof typeof dynamicReactViews }) {
  const { id, launch } = dynamicReactViews[view];
  const version = evidence.agentFootprintVersion;
  const query = new URLSearchParams({ view: id, agentfootprint: version });
  return <p><a href={asset(`${quickStartDemoPath}?${query}#${id}`)}>{launch}</a> (AgentFootprint {version})</p>;
}

export function DynamicReactRecording() {
  const { result, tools, reminder } = evidence.recording;
  return (
    <>
      <DynamicReactLaunch view="run" />
      <figure>
        <table>
          <thead>
            <tr><th scope="col">Iteration</th><th scope="col">Tool</th><th scope="col">Recorded result</th></tr>
          </thead>
          <tbody>
            {tools.map(({ iteration, name, result: toolResult }) => (
              <tr key={iteration}><td>{iteration}</td><td><code>{name}</code></td><td>{toolResult}</td></tr>
            ))}
          </tbody>
        </table>
        <p>The <code>post-pii</code> reminder reached the <code>{reminder.slot}</code> slot on iteration {reminder.iteration}.</p>
        <p><strong>Final mock answer</strong> “{result}”</p>
        <figcaption><RecordingSource /></figcaption>
      </figure>
    </>
  );
}

export function DynamicReactSubflowsFigure() {
  const { asset: name, width, height } = evidence.figure;
  return (
    <>
      <Diagram
        name={name}
        alt="Raw LLM-call subflow. Injection Engine leads to Context, which fans out to System Prompt, Messages and Tools in parallel. The branches rejoin before CallLLM."
        width={width}
        height={height}
        caption={<RecordingSource />}
      />
      <DynamicReactLaunch view="subflows" />
    </>
  );
}
