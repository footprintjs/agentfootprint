// #region code
import { Agent } from 'agentfootprint';
import { Lens, lensRecorder } from 'agentfootprint-lens';
import { mock } from 'agentfootprint/providers';
import { useEffect, useState } from 'react';

function createCapture() {
  const agent = Agent.create({ provider: mock({ reply: 'Hi!' }), model: 'mock' }).build();
  const recorder = lensRecorder();
  recorder.observe(agent);
  return { agent, recorder };
}

export function DebugLensSample({ theme = 'light' }: { theme?: 'light' | 'dark' }) {
  const [capture, setCapture] = useState<ReturnType<typeof createCapture>>();
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState('');

  useEffect(() => () => { capture?.recorder.detach(); }, [capture]);

  async function run() {
    const next = createCapture();
    setCapture(next);
    setRunning(true);
    setAnswer('');
    try {
      const reply = await next.agent.run({ message: 'Hello!' });
      setAnswer(typeof reply === 'string' ? reply : 'The mock run paused.');
    } catch {
      setAnswer('The mock run failed. Try running it again.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <button type="button" onClick={run} disabled={running}>{running ? 'Running…' : 'Run'}</button>
      <p role="status" aria-label="Mock answer">{answer}</p>
      {capture && (
        <section className="chart" aria-label="Lens run capture">
          <Lens recorder={capture.recorder} runner={capture.agent} theme={{ mode: theme }} />
        </section>
      )}
    </>
  );
}
// #endregion code
