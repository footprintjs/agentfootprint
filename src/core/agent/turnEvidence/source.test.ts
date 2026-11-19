import { expect, it } from 'vitest';
import { Agent } from '../../Agent.js';
import { mock } from '../../../llm-providers.js';
import { recordRun } from '../../../recorders/observability/recordRun.js';
import { recordedTurn } from './source.js';
import { readTurnEvidenceVerdict } from './verdict.js';

it('uses the named terminal leg even when the same agent has served a second turn', async () => {
  const agent = Agent.create({
    provider: mock({ replies: ['First answer.', 'Second answer.'] }),
    model: 'mock',
  }).build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'First turn.' });
    const first = recorder.toRecording();
    const terminal = first.events.find((event) => event.type === 'agentfootprint.agent.turn_end');
    if (!terminal) throw new Error('The first turn must have a terminal event.');
    const runId = terminal.meta.runId;
    expect(recordedTurn(first, runId)?.snapshot).toBe(first.snapshot);

    await agent.run({ message: 'Second turn.' });
    const second = recorder.toRecording();
    const selected = recordedTurn(second, runId);
    expect(selected?.terminal).toEqual(terminal);
    expect(selected?.snapshot).toBeUndefined();
    const throughTerminal = first.events.slice(0, first.events.indexOf(terminal) + 1);
    expect(selected?.events).toEqual(throughTerminal.filter((event) => event.meta.runId === runId));
    expect(recordedTurn(second, 'missing-turn')).toBeUndefined();
  } finally {
    recorder.stop();
  }
});

it('uses the final served verdict from a live run and the saved copy', async () => {
  const agent = Agent.create({
    provider: mock({ reply: 'There are 3742 devices.' }),
    model: 'mock',
  })
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'What did you find?' });
    const recording = recorder.toRecording();
    const terminal = recording.events.find(
      (event) => event.type === 'agentfootprint.agent.turn_end',
    );
    if (!terminal) throw new Error('The run must have a terminal event.');
    const result = readTurnEvidenceVerdict(recording, terminal.meta.runId);
    expect(result).toMatchObject({
      status: 'unsupported',
      items: [{ value: '3742', shape: expect.any(String) }],
    });
    const saved = JSON.parse(JSON.stringify(recording));
    expect(readTurnEvidenceVerdict(saved, terminal.meta.runId)).toEqual(result);
  } finally {
    recorder.stop();
  }
});

it('leaves the verdict unreadable when the agent keeps the event out', async () => {
  const agent = Agent.create({
    provider: mock({ reply: 'There are 3742 devices.' }),
    model: 'mock',
    redact: { emitPatterns: [/agent\.evidence_checked$/] },
  })
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'What did you find?' });
    const recording = recorder.toRecording();
    const terminal = recording.events.find(
      (event) => event.type === 'agentfootprint.agent.turn_end',
    );
    if (!terminal) throw new Error('The run must have a terminal event.');
    expect(readTurnEvidenceVerdict(recording, terminal.meta.runId)).toEqual({
      status: 'not-checked',
    });
  } finally {
    recorder.stop();
  }
});

it('reads a corrected answer rather than the verdict on its draft', async () => {
  const agent = Agent.create({
    provider: mock({ replies: ['There are 3742 devices.', 'The check is complete.'] }),
    model: 'mock',
  })
    .namesAndNumbersFromEvidence({ posture: 'guard' })
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'What did you find?' });
    const recording = recorder.toRecording();
    const terminal = recording.events.find(
      (event) => event.type === 'agentfootprint.agent.turn_end',
    );
    if (!terminal) throw new Error('The run must have a terminal event.');
    const checks = recording.events.flatMap((event) =>
      event.type === 'agentfootprint.agent.evidence_checked' ? [event.payload.action] : [],
    );
    expect(checks).toEqual(['revision-asked', 'grounded']);
    expect(readTurnEvidenceVerdict(recording, terminal.meta.runId)).toEqual({ status: 'clean' });
  } finally {
    recorder.stop();
  }
});
