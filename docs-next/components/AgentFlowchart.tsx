import { Diagram } from './Diagram';
import provenance from '@/lib/quick-start-flowchart.json';
import { SITE, asset } from '@/lib/site';

export const quickStartDemoPath = '/demo/quick-start/';
export const quickStartFlowchartPath = '/docs/getting-started/quick-start/#the-run-as-a-flowchart';

export function WeatherRunDiagram() {
  return (
    <Diagram
      name="quick-start-flowchart"
      alt="Mock weather agent flowchart. The LLM uses system, messages and tools slots, calls the weather tool, then loops back and produces a final answer."
      width={provenance.width}
      height={provenance.height}
      caption={
        <>
          Recorded with {provenance.cohort.join(', ')} from AgentFootprint commit{' '}
          <a href={`${SITE.repo}/commit/${provenance.commit}`}>
            <code>{provenance.commit.slice(0, 12)}</code>
          </a>
          .
        </>
      }
    />
  );
}

export function AgentFlowchart() {
  return (
    <>
      <WeatherRunDiagram />
      <p>
        <a href={asset(quickStartDemoPath)}>Zoom and drill into the interactive weather trace</a>
      </p>
    </>
  );
}
