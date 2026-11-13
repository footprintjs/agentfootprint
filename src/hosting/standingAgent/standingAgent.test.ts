import { describe, expect, it, vi } from 'vitest';
import { Agent, inMemoryArtifacts } from '../../index.js';
import { mock } from '../../llm-providers.js';
import { memorySessions } from '../memorySessions.js';
import { standingAgent } from '../standingAgent.js';
import { inProcessHost } from '../../../test/hosting/testHost.js';

describe('standing agent facade lifecycle', () => {
  it('stops a lazy artifact reader created after the host started', async () => {
    const made: Agent[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = Agent.create({
          provider: mock({ reply: 'ok' }),
          model: 'test',
          artifacts: inMemoryArtifacts(),
        }).build();
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
    });
    const binding = await handle.artifactsForRequest({ sessionId: 'no-turn' });
    expect(binding.bound).toBe(true);
    expect(made).toHaveLength(1);
    const stop = vi.spyOn(made[0]!, 'shutdown');
    await handle.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith({ stop: true });
  });
});
