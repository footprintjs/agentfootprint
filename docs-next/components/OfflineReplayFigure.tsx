import { Diagram } from '@/components/Diagram';
import evidence from '@/lib/offline-replay-figure.json';
import { replayDemoHref, replayDemoVersion } from '@/lib/replay-demo';
import { SITE, asset } from '@/lib/site';

export function OfflineReplayFigure() {
  const { figure, meta } = evidence;
  return (
    <>
      <Diagram
        name={figure.asset}
        width={figure.width}
        height={figure.height}
        alt="Flowchart rebuilt from the saved mock weather run. The LLM uses the system prompt, messages, and tools, calls the weather tool, then loops back to produce the answer."
        caption={
          <>
            Rebuilt from a saved Trace with {meta.events} events and <code>{meta.redaction}</code> redaction.
            The mock run used {evidence.cohort.join(', ')} from AgentFootprint commit{' '}
            <a href={`${SITE.repo}/commit/${evidence.commit}`}><code>{evidence.commit.slice(0, 12)}</code></a>.
          </>
        }
      />
      <p><a href={replayDemoHref('replay')}>Explore the saved replay</a> (AgentFootprint {replayDemoVersion})</p>
      <p><a href={asset('/assets/offline-replay-trace.json')} download>Download the redacted Trace</a></p>
    </>
  );
}
