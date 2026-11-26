import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { defineTool } from '../../src/tools/tools.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';

describe('intervention evidence belongs to the accepted response, never an earlier turn', () => {
  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: an ordinary response clears the former masked carrier`, async () => {
      const agent = Agent.create({
        model: 'mock',
        reactMode,
        provider: mock({
          replies: [
            {
              content: '',
              stopReason: 'tool_use',
              intervention: { outcome: 'masked', code: 'guardrail_intervened', filters: [] },
              toolCalls: [{ id: 't1', name: 'lookup', args: {} }],
            },
            'plain final response',
          ],
        }),
      })
        .tool(
          defineTool({
            name: 'lookup',
            description: 'lookup',
            inputSchema: { type: 'object', properties: {} },
            execute: () => 'found',
          }),
        )
        .build();
      await expect(agent.run('hello')).resolves.toBe('plain final response');
      expect(agent.getLastSnapshot()?.sharedState.providerIntervention).toEqual([]);
    });
  }
});
