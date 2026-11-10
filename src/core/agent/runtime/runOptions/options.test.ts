import { describe, expect, it } from 'vitest';
import { Agent, type AgentRunOptions } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

describe('public Agent run options', () => {
  it('forwards declared correlation, session and identity with explicit trace precedence', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
    let configured: unknown;
    agent.on('agentfootprint.agent.run_configured', (event) => {
      configured = event;
    });
    const options: AgentRunOptions = {
      correlationId: 'declared-correlation',
      traceId: 'explicit-trace',
      env: { traceId: 'native-fallback' },
      sessionId: 'declared-session',
      identity: {
        principal: 'declared-principal',
        tenant: 'declared-tenant',
        conversationId: 'declared-conversation',
      },
    };
    expect(await agent.run({ message: 'hello' }, options)).toBe('ok');
    expect(configured).toMatchObject({
      meta: {
        correlationId: 'declared-correlation',
        traceId: 'explicit-trace',
        sessionId: 'declared-session',
        principal: 'declared-principal',
        tenant: 'declared-tenant',
      },
    });
  });

  it('uses the native trace fallback without inventing correlation or session fields', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
    let configured: unknown;
    agent.on('agentfootprint.agent.run_configured', (event) => {
      configured = event;
    });
    await agent.run({ message: 'hello' }, { env: { traceId: 'native-fallback' } });
    expect(configured).toMatchObject({ meta: { traceId: 'native-fallback' } });
    expect(configured).not.toHaveProperty('meta.correlationId');
    expect(configured).not.toHaveProperty('meta.sessionId');
  });
});
