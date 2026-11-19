import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { recordRun } from '../../../src/doors/observe.js';

describe('live Context shape capture', () => {
  it('shares the recorded history descriptions with a saved run and isolates view options', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'Ready.' }), model: 'mock' }).build();
    expect(agent.getLastSnapshot()).toBeUndefined();
    const recorder = recordRun(agent);
    try {
      await agent.run({ message: 'Describe the sample.' });
      const live = agent.getLastSnapshot()!;
      expect(live.contextShapes?.changes.flatMap(([, entries]) => entries)).toContainEqual([
        ['history'],
        'array',
        1,
      ]);
      expect(recorder.toRecording().snapshot).toMatchObject({ contextShapes: live.contextShapes });
      const selected = { contextShapes: { paths: [['history', '0']] } };
      expect(
        agent.getSnapshot(selected)?.contextShapes?.changes.flatMap(([, entries]) => entries),
      ).toContainEqual([['history', '0'], 'object']);
      expect(agent.getLastSnapshot({ contextShapes: false })).not.toHaveProperty('contextShapes');
      expect(agent.getLastSnapshot()?.contextShapes).toEqual(live.contextShapes);
    } finally {
      recorder.stop();
    }
  });
});
