import { expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
  '%s keeps one native chart across fresh turns',
  async (reactMode) => {
    const agent = Agent.create({ provider: mock({ reply: 'answer' }), model: 'mock', reactMode })
      .system('A declared prompt.')
      .build();
    const chart = agent.getSpec();
    await expect(agent.run('one')).resolves.toBe('answer');
    expect(agent.getSpec()).toBe(chart);
    await expect(agent.run('two')).resolves.toBe('answer');
    expect(agent.getSpec()).toBe(chart);
    expect(agent.getLastSnapshot()).toBeDefined();
  },
);
