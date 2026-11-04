import { expect, it } from 'vitest';
import { Agent, defineTool, requestInput } from '../index.js';
import { memorySessions, standingAgent } from './index.js';
import { inProcessHost } from '../../test/hosting/testHost.js';
import type { LLMProvider } from '../provider-contract/types.js';

it.each(['shared', 'factory'] as const)(
  'a refused hosted answer creates no instance question guard: %s',
  async (shape) => {
    const question = 'ALICE-PRIVATE: Which year?';
    let tools = 0;
    const provider: LLMProvider = {
      name: 'scripted',
      async complete(request) {
        const latest = [...request.messages]
          .reverse()
          .find((message) => message.role === 'user')?.content;
        return latest === 'collect'
          ? {
              content: '',
              toolCalls: [{ id: 'collect-year', name: 'collect', args: {} }],
              usage: { input: 1, output: 1 },
            }
          : { content: `reply:${String(latest)}`, toolCalls: [], usage: { input: 1, output: 1 } };
      },
    };
    const build = () =>
      Agent.create({ provider, model: 'test' })
        .tool(
          defineTool({
            name: 'collect',
            description: 'collect a year',
            inputSchema: { type: 'object', properties: {} },
            execute: () => {
              tools++;
              return requestInput({
                id: 'year',
                question,
                fields: [{ id: 'year', type: 'number', required: true }],
              });
            },
          }),
        )
        .build();
    const sessions = memorySessions(),
      host = inProcessHost();
    const options = shape === 'shared' ? { agent: build() } : { agentFactory: build };
    const handle = await standingAgent({ ...options, sessions, host });
    try {
      const asked = await host.deliver({ sessionId: 'alice', input: 'collect' });
      const requestId = asked.awaiting?.awaitingInput?.requestId;
      expect(requestId).toBeTypeOf('string');
      const abort = new AbortController();
      abort.abort();
      const refused = await host.deliver({
        sessionId: 'alice',
        input: '',
        signal: abort.signal,
        decision: { requestId, values: { year: 2026 } },
      });
      expect(refused.error).toBeDefined();
      expect(refused.error).not.toContain(question);
      const bob = await host.deliver({ sessionId: 'bob', input: 'hello from Bob' });
      expect(bob.error).toBeUndefined();
      expect(bob.output).toBe('reply:hello from Bob');
      expect(JSON.stringify(bob)).not.toContain(question);
      const cancelled = await host.deliver({
        sessionId: 'alice',
        input: '',
        decision: { requestId, cancel: true },
      });
      expect(cancelled.error).toBeUndefined();
      expect(cancelled.output).toBe('Input request cancelled.');
      for (const sessionId of ['alice', 'bob']) {
        const next = await host.deliver({ sessionId, input: 'next message' });
        expect(next.error).toBeUndefined();
        expect(next.output).toBe('reply:next message');
        expect(JSON.stringify(next)).not.toContain(question);
      }
      expect(tools).toBe(1);
    } finally {
      await handle.close();
    }
  },
);
