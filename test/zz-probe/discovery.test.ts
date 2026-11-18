// Probe (not committed): does a .reliability() rule see a discovery failure?
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { ToolProvider } from '../../src/tool-providers/index.js';

describe('tool-discovery: reliability vs discovery failure', () => {
  it('a postDecide retry rule matching the discovery error', async () => {
    let calls = 0;
    const provider: ToolProvider = {
      id: 'hub',
      async list() {
        calls += 1;
        if (calls === 1) throw new Error('hub unreachable');
        return [defineTool({ name: 'a', description: 'a', inputSchema: { type: 'object' }, execute: async () => 'ok' })];
      },
    };
    let ruleCalls = 0;
    let failedEvents = 0;
    const agent = Agent.create({ provider: mock({ respond: () => ({ content: 'done', toolCalls: [] }) }), model: 'mock' })
      .system('s')
      .toolProvider(provider)
      .reliability({
        postDecide: [
          {
            when: (s) => {
              ruleCalls += 1;
              return s.error?.message?.includes('hub unreachable') === true && s.attempt < 3;
            },
            then: 'retry',
            kind: 'discovery-transient',
          },
        ],
      })
      .build();
    agent.on('agentfootprint.tools.discovery_failed', () => {
      failedEvents += 1;
    });
    let outcome: string;
    try {
      const r = await agent.run({ message: 'go' });
      outcome = `resolved:${String(r).slice(0, 40)}`;
    } catch (e) {
      outcome = `rejected:${(e as Error).message}`;
    }
    console.log('PROBE-009', outcome, 'listCalls=', calls, 'ruleCalls=', ruleCalls, 'discovery_failed=', failedEvents);
    expect(outcome).toBe('rejected:hub unreachable');
    expect(ruleCalls).toBe(0);
  });
});

// The page's corrected sample, verbatim.
function withRetry(inner: ToolProvider, attempts = 3): ToolProvider {
  return {
    id: inner.id,
    async list(ctx) {
      let lastError: unknown;
      for (let i = 0; i < attempts; i++) {
        ctx.signal?.throwIfAborted();
        try {
          return await inner.list(ctx);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError; // still loud: discovery_failed fires and the run rejects
    },
  };
}

describe('tool-discovery: the withRetry sample', () => {
  const run = async (failFirst: number) => {
    let calls = 0;
    const hub: ToolProvider = {
      id: 'hub',
      async list() {
        calls += 1;
        if (calls <= failFirst) throw new Error('hub unreachable');
        return [defineTool({ name: 'a', description: 'a', inputSchema: { type: 'object' }, execute: async () => 'ok' })];
      },
    };
    let failed = 0;
    const agent = Agent.create({ provider: mock({ respond: () => ({ content: 'done', toolCalls: [] }) }), model: 'mock' })
      .system('s')
      .toolProvider(withRetry(hub))
      .build();
    agent.on('agentfootprint.tools.discovery_failed', () => {
      failed += 1;
    });
    try {
      const r = await agent.run({ message: 'go' });
      return { outcome: `resolved:${String(r)}`, calls, failed };
    } catch (e) {
      return { outcome: `rejected:${(e as Error).message}`, calls, failed };
    }
  };
  it('two transient failures: run resolves, no discovery_failed', async () => {
    const r = await run(2);
    expect(r.outcome).toBe('resolved:done');
    expect(r.failed).toBe(0);
  });
  it('hub down for good: one discovery_failed, run rejects', async () => {
    const r = await run(99);
    expect(r).toEqual({ outcome: 'rejected:hub unreachable', calls: 3, failed: 1 });
  });
});
