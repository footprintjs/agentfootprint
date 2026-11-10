import { describe, expect, it, vi } from 'vitest';
import { Agent, inMemoryArtifacts } from '../../../index.js';
import type { ArtifactStore } from '../../../artifacts/types.js';
import { mock } from '../../../llm-providers.js';
import { memorySessions } from '../../memorySessions.js';
import { standingAgent } from '../../standingAgent.js';
import { inProcessHost } from '../../../../test/hosting/testHost.js';

describe('artifact bindings and lane ownership', () => {
  it('holds a live instance during a read without building a lane, then revokes on eviction', async () => {
    const inner = inMemoryArtifacts();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const store: ArtifactStore = {
      ...inner,
      get: async (scope, ref) => {
        started();
        await gate;
        return inner.get(scope, ref);
      },
    };
    const made: Agent[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = Agent.create({
          provider: mock({ reply: 'ok' }),
          model: 'test',
          artifacts: store,
        }).build();
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
      maxActiveSessions: 1,
      artifactOpsPerSession: 1,
    });
    try {
      await host.deliver({ input: 'first', sessionId: 'first' });
      const shut = vi.spyOn(made[0]!, 'shutdown');
      const binding = await handle.artifactsForRequest({ sessionId: 'first' });
      if (!binding.bound) throw new Error('expected artifacts');
      const meta = await binding.artifacts.put({
        kind: 'note',
        mediaType: 'text/plain',
        data: 'held',
      });
      const reading = binding.artifacts.get(meta.ref);
      await entered;
      expect(made).toHaveLength(1);
      await expect(binding.artifacts.head(meta.ref)).rejects.toMatchObject({
        code: 'ERR_ARTIFACT_OPS_BUSY',
      });
      await host.deliver({ input: 'second', sessionId: 'second' });
      expect(made).toHaveLength(2);
      expect(shut).not.toHaveBeenCalled();
      release();
      await reading;
      await host.deliver({ input: 'third', sessionId: 'third' });
      expect(shut).toHaveBeenCalled();
      await expect(binding.artifacts.get(meta.ref)).rejects.toMatchObject({
        code: 'ERR_REQUEST_ARTIFACTS_REVOKED',
      });
    } finally {
      release();
      await handle.close();
    }
  });
});
