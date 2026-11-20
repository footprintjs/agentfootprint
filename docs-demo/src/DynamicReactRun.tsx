import { Agent, defineTool } from 'agentfootprint';
import { defineFact, defineInstruction, defineSkill, defineSteering } from 'agentfootprint/context';
import { mock } from 'agentfootprint/providers';
import { Lens, LensRecorder } from 'agentfootprint-lens';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { buildDynamicReactAgent, dynamicReactInput } from '../shared/dynamicReactDemo';
import { RecordingCohort, type PublishedDemoViewProps } from './DemoFrame';
import './dynamic-react.css';

interface RunCapture {
  number: number;
  controller: AbortController;
  recorder: LensRecorder;
  running: boolean;
}

const sdk = { Agent, defineTool, mock, defineFact, defineInstruction, defineSkill, defineSteering };

export default function DynamicReactRun({
  theme,
  themeToggle,
  provenance,
}: PublishedDemoViewProps) {
  const [message, setMessage] = useState(dynamicReactInput);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [capture, setCapture] = useState<{
    number: number;
    agent: ReturnType<typeof buildDynamicReactAgent>;
    recorder: LensRecorder;
  } | null>(null);
  const active = useRef<RunCapture | null>(null);

  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current?.recorder.detach();
    },
    [],
  );

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const previous = active.current;
    if (previous?.running || !message.trim()) return;
    previous?.recorder.detach();

    const controller = new AbortController();
    const recorder = new LensRecorder();
    const number = (previous?.number ?? 0) + 1;
    const current = { number, controller, recorder, running: true };
    active.current = current;
    setCapture(null);
    setAnswer(null);
    setFailed(false);
    setRunning(true);

    try {
      const agent = buildDynamicReactAgent(sdk);
      recorder.observe(agent);
      setCapture({ number, agent, recorder });

      const { signal } = controller;
      const result = await agent.run({ message }, { signal, env: { signal } });
      if (!signal.aborted) {
        if (typeof result === 'string') setAnswer(result);
        else setFailed(true);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      current.running = false;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  return (
    <>
      <RecordingCohort provenance={provenance} />
      <p id="dynamic-react-help">
        Edit the message to see what <code>redact_pii</code> receives. The mock model runs a
        scripted refund in your browser.
      </p>
      <form className="dynamic-react-form" onSubmit={run}>
        <label htmlFor="dynamic-react-message">Message</label>
        <div className="controls">
          <input
            id="dynamic-react-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            disabled={running}
            required
            aria-describedby="dynamic-react-help"
          />
          <button type="submit" disabled={running || !message.trim()}>
            {running ? 'Running…' : 'Run'}
          </button>
          {themeToggle}
        </div>
      </form>
      <div role="status">
        {answer !== null && (
          <p className="dynamic-react-answer">
            <strong>Answer</strong> {answer}
          </p>
        )}
      </div>
      {failed && <p role="alert">The mock run did not finish. Run the demo again to retry.</p>}
      {capture && (
        <section className="chart dynamic-react-capture" aria-label="Run capture">
          <Lens
            key={capture.number}
            recorder={capture.recorder}
            runner={capture.agent}
            theme={{ mode: theme }}
            view="engineer"
          />
        </section>
      )}
    </>
  );
}
