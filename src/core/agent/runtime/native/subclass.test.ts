import { expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

const voice = { appName: 'application', commentaryTemplates: {}, thinkingTemplates: {} };
const options = () => ({ provider: mock({ reply: 'ok' }), model: 'mock' });

class RuntimeApplication extends Agent {
  runtime(): string {
    return 'application status';
  }
}

class ContextApplication extends Agent {
  readonly agentContext = 'application context';
}

it('preserves an existing application runtime method while executing a native turn', async () => {
  const agent: Agent = new RuntimeApplication(options(), '', [], voice);
  try {
    expect((agent as RuntimeApplication).runtime()).toBe('application status');
    await expect(agent.run('hello')).resolves.toBe('ok');
    expect(agent.getLastSnapshot()).toBeDefined();
    expect((agent as RuntimeApplication).runtime()).toBe('application status');
  } finally {
    await agent.shutdown({ stop: true });
  }
});

it('preserves an existing application context field without using it as private runner state', async () => {
  const agent: Agent = new ContextApplication(options(), '', [], voice);
  try {
    expect((agent as ContextApplication).agentContext).toBe('application context');
    await expect(agent.run('hello')).resolves.toBe('ok');
    expect(agent.getLastSnapshot()).toBeDefined();
    expect((agent as ContextApplication).agentContext).toBe('application context');
  } finally {
    await agent.shutdown({ stop: true });
  }
});
