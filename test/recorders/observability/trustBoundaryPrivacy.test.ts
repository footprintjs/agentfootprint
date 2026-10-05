import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { mock } from '../../../src/doors/providers.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { UnsupportedPrivacyModeError } from '../../../src/recorders/observability/recordingEnvelope.js';

describe('trust boundary privacy is not a whole-recording promise', () => {
  it('lean boundary detail leaves ordinary event payloads in the recording', async () => {
    const canary = 'PRIVATE_EVENT_TAIL_CANARY';
    const agent = Agent.create({ provider: mock({ reply: canary }), model: 'mock' }).build();
    const capture = recordRun(agent, { boundaryDetail: 'lean' });
    try {
      await agent.run({ message: canary });
      const recording = capture.toRecording();
      expect(JSON.stringify(recording.events)).toContain(canary);
      const snapshot = recording.snapshot as { recorders: { name: string; data: unknown }[] };
      const boundary = snapshot.recorders.find((row) => row.name === 'BoundaryEvents');
      expect(boundary).toBeDefined();
      expect(JSON.stringify(boundary)).not.toContain(canary);
    } finally {
      capture.stop();
    }
  });

  it('the refused privacy mode names the channels that still need protection', () => {
    const error = new UnsupportedPrivacyModeError('redacted');
    expect(error.message).toContain('BoundaryEvents');
    expect(error.message).toContain('event tail and engine state can still contain raw content');
    expect(error.message).not.toContain('captures no payloads in the first place');
  });
});
