// #region code
import { useMemo } from 'react';
import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { Lens, lensRecorder } from 'agentfootprint-lens';

export function App() {
  const { agent, recorder } = useMemo(() => {
    const agent = Agent.create({ provider: mock({ reply: 'Hi!' }), model: 'mock' }).build();
    const recorder = lensRecorder();
    recorder.observe(agent);
    return { agent, recorder };
  }, []);

  return (
    <>
      <button onClick={() => agent.run({ message: 'Hello!' })}>Run</button>
      <Lens recorder={recorder} runner={agent} />
    </>
  );
}
// #endregion code
