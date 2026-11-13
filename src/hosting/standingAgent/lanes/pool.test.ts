import { describe, expect, it } from 'vitest';
import { Agent } from '../../../core/Agent.js';
import { mock } from '../../../llm-providers.js';
import { memorySessions } from '../../memorySessions.js';
import { readConfiguration } from '../configuration/read.js';
import { createLanePool } from './pool.js';
import { laneKeyOf } from './keys.js';

describe('lane ownership', () => {
  it('keeps anonymous keys disjoint from every client spelling', () => {
    for (const id of ['', 'anonymous', '#shared', 'session:x'])
      expect(laneKeyOf(id)).not.toBe(laneKeyOf(undefined));
  });
  it('never evicts queued or running turn work and reuses one lane-less reader', async () => {
    const made: Agent[] = [];
    const config = readConfiguration({
      agentFactory: () => {
        const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'test' }).build();
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host: {
        name: 'test',
        capabilities: [],
        serve: async () => ({ close: async () => undefined }),
      },
      maxActiveSessions: 1,
    });
    const lanes = createLanePool({ ...config, isClosing: () => false });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = lanes.laneFor('first');
    const work = lanes.serialize(first, 'session:first', () => gate);
    try {
      // Admission protects the lane even before its queued microtask starts.
      lanes.laneFor('second');
      expect(lanes.pool.get(laneKeyOf('first'))).toBe(first);
      await Promise.resolve();
      lanes.laneFor('third');
      expect(lanes.pool.get(laneKeyOf('first'))).toBe(first);
      const size = lanes.pool.size;
      const reader = lanes.redeemerFor('never-ran');
      expect(reader?.lane).toBeUndefined();
      expect(lanes.redeemerFor('another')?.agent).toBe(reader?.agent);
      expect(lanes.pool.size).toBe(size);
    } finally {
      release();
      await work;
      for (const lane of lanes.pool.values()) lane.detach();
      await Promise.all(made.map((agent) => agent.shutdown({ stop: true })));
    }
  });
});
