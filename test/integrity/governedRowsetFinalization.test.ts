import type { AgentfootprintEvent } from '../../src/events.js';
import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/providers.js';
import * as finalization from '../../src/core/agent/resultRowsets/finalization.js';
import { readGovernedRowset } from '../../src/core/agent/resultRowsets/read.js';

const declaration = {
  key: 'root',
  columns: { amount: 'number' as const },
  source: { kind: 'inline' as const, path: [] },
};

describe('native finalization cannot silently become a green no-op', () => {
  it('a disconnected successful-result hook fails before tool_end or a follow-up model request', async () => {
    const realFactory = finalization.nativeResultFinalizer;
    const disconnect = vi
      .spyOn(finalization, 'nativeResultFinalizer')
      .mockImplementation((...args) => {
        const real = realFactory(...args);
        // Fault injection removes the call, not the native admission/return facts
        // or final delivery assertion. No findings/dispositions are fabricated.
        return real === undefined ? undefined : Object.assign(async () => undefined, real);
      });
    try {
      let modelCalls = 0,
        executions = 0;
      const events: AgentfootprintEvent[] = [];
      const tool = defineTool({
        name: 'source',
        description: 'Read synthetic rows.',
        resultRowsets: [declaration],
        execute: () => {
          executions++;
          return [{ amount: 'bad' }];
        },
      });
      const agent = Agent.create({
        model: 'mock',
        checkColumnTypes: 'enforce',
        integrityPosture: 'dev',
        provider: mock({
          respond: () => {
            if (++modelCalls > 1) return 'A hook never ran.';
            return { toolCalls: [{ id: 'source', name: 'source', args: {} }] };
          },
        }),
      })
        .tool(tool)
        .build();
      agent.on('*', (event) => events.push(event));
      await expect(agent.run({ message: 'Read.' })).rejects.toThrow(
        /Declared rowset finalization was not reached/,
      );
      expect(executions).toBe(1);
      expect(modelCalls).toBe(1);
      expect(events.filter((event) => event.type === 'agentfootprint.stream.tool_end')).toEqual([]);
      expect(
        events.filter((event) => event.type === 'agentfootprint.tools.rowset_checked'),
      ).toEqual([]);
    } finally {
      disconnect.mockRestore();
    }
  });

  it('the final new reader never invokes outer marker or path accessors', async () => {
    let invoked = 0;
    for (const key of ['effects', 'af_absent', 'rows']) {
      const value = Object.defineProperty({ ordinary: [] }, key, {
        enumerable: true,
        get: () => {
          invoked++;
          return key === 'effects' ? [] : true;
        },
      });
      const result = await readGovernedRowset(
        { ...declaration, source: { kind: 'inline', path: ['rows'] } },
        value,
        undefined,
        undefined,
        () => true,
      );
      expect(result).toEqual({ available: false, reason: 'unsupported-shape' });
    }
    expect(invoked).toBe(0);
  });

  it('an actual Agent refuses a column-cell getter without calling it', async () => {
    let invoked = 0,
      served = '';
    const row = Object.defineProperty({}, 'amount', {
      enumerable: true,
      get: () => {
        invoked++;
        return 0;
      },
    });
    const tool = defineTool({
      name: 'source',
      description: 'Read synthetic row.',
      resultRowsets: [declaration],
      execute: () => [row],
    });
    const agent = Agent.create({
      model: 'mock',
      checkColumnTypes: 'enforce',
      integrityPosture: 'dev',
      provider: mock({
        respond: (request) => {
          const last = request.messages.at(-1);
          if (last?.role === 'tool') {
            served = last.content;
            return 'Done.';
          }
          return { toolCalls: [{ id: 'getter', name: 'source', args: {} }] };
        },
      }),
    })
      .tool(tool)
      .build();
    await agent.run({ message: 'Read.' });
    expect(invoked).toBe(0);
    expect(served).toMatch(/^Result rejected:/);
  });
});
