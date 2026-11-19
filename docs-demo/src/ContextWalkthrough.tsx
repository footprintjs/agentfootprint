import { ContextView, CONTEXT_MILESTONE_AXIS } from 'agentfootprint-lens/context';
import {
  foldCommitIdxOf,
  lensCursorFrom,
  observeRecording,
  tagAxisPositions,
  type Recording,
} from 'agentfootprint-lens/core';
import { useState } from 'react';
import { answerSteps } from '../../docs-next/components/context-story/story';
import { RecordingCohort, type DemoFrameContent } from './DemoFrame';
import data from './generated/context-walkthrough.json';
import './context-walkthrough.css';

// Lens reads the same saved snapshot and recorded events for every selected stop.
const recording = data.recording as Recording;
const observed = observeRecording(recording);
const runner = observed.runner ?? recording.snapshot;
const events = observed.recorder.getEntries();
const positions = tagAxisPositions(recording.snapshot, CONTEXT_MILESTONE_AXIS, []);
const stops: Readonly<Record<string, number | undefined>> = data.stops;
const steps = answerSteps.map(({ id, label, title }) => {
  const stop = stops[id];
  if (stop === undefined || !positions[stop]) {
    throw new Error(`The recorded context has no stop for ${id}.`);
  }
  return { id, label, title, stop };
});

export default function ContextWalkthrough({ themeToggle }: DemoFrameContent) {
  const [stepId, setStepId] = useState(() => new URLSearchParams(location.search).get('step'));
  const step = steps.find(({ id }) => id === stepId) ?? steps[0];
  const before = positions[step.stop - 1];

  function selectStep(id: string) {
    setStepId(id);
    const url = new URL(location.href);
    url.searchParams.set('step', id);
    history.replaceState(history.state, '', url);
  }

  return (
    <>
      <p>This inspector reads a saved mock run.</p>
      <RecordingCohort provenance={data.provenance} />
      <div className="controls context-walkthrough-controls">
        <label htmlFor="context-answer-step">Answer step</label>
        <select
          id="context-answer-step"
          value={step.id}
          onChange={(event) => selectStep(event.target.value)}
        >
          {steps.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {themeToggle}
      </div>
      <section className="context-walkthrough-panel" aria-label="Recorded context">
        <h2 aria-live="polite">{step.title}</h2>
        <ContextView
          runner={runner}
          cursor={lensCursorFrom(positions, step.stop, () => undefined)}
          previous={
            before && {
              runtimeStageId: before.runtimeStageId,
              commitIdx: foldCommitIdxOf(before),
            }
          }
          events={events}
        />
      </section>
    </>
  );
}
