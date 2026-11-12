import { describe, expect, it } from 'vitest';
import { Agent } from '../../../core/Agent.js';
import { mock } from '../../../llm-providers.js';
import { hostedTurnOf } from './port.js';

describe('hosted turn port', () => {
  it('refuses a replaced run method instead of calling it', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'test' }).build();
    const original = agent.run;
    try {
      agent.run = async () => 'replacement';
      expect(() => hostedTurnOf(agent)).toThrow('replaced');
    } finally {
      agent.run = original;
      await agent.shutdown({ stop: true });
    }
  });
});
