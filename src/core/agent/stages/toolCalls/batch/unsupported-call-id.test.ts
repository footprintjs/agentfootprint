// Reconstructed from Claude's n2-carrier-edge description; original probe not shared.
import { expect, it } from 'vitest';
import { Agent, askHuman, defineTool } from '../../../../../index.js';
import type { LLMRequest, LLMResponse } from '../../../../../provider-contract/types.js';

for (const door of ['plain', 'check-in'] as const) {
  it.each([
    ['object', {}],
    ['nested JSON object', { nested: ['id', 7] }],
    ['array', []],
  ])(`${door} refuses a %s call ID before any sibling effect or question`, async (_shape, id) => {
    const requests: LLMRequest[] = [];
    const effects: string[] = [];
    const starts: unknown[] = [];
    const questions: unknown[] = [];
    const agent = Agent.create({
      provider: {
        name: 'scripted',
        complete: async (request: LLMRequest): Promise<LLMResponse> => {
          requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
          return requests.length === 1
            ? {
                content: '',
                toolCalls: [
                  { id: 'valid-sibling', name: 'sibling', args: {} },
                  { id, name: 'target', args: {} },
                ] as never,
                usage: { input: 1, output: 1 },
              }
            : { content: 'corrected', toolCalls: [], usage: { input: 1, output: 1 } };
        },
      },
      model: 'mock',
    })
      .tools([
        defineTool({
          name: 'sibling',
          description: 'Sibling',
          inputSchema: { type: 'object' },
          execute: () => {
            effects.push('sibling');
            return 'ran';
          },
        }),
        defineTool({
          name: 'target',
          description: 'Target',
          inputSchema: { type: 'object' },
          ...(door === 'check-in' && { checkIn: 'always' as const }),
          execute: () => {
            effects.push('target');
            return door === 'plain' ? askHuman({ question: 'Continue?' }) : 'ran';
          },
        }),
      ])
      .build();
    agent.on('agentfootprint.stream.tool_start', (event) => starts.push(event));
    agent.on('agentfootprint.checkin.request', (event) => questions.push(event));
    try {
      await expect(agent.run('go')).resolves.toBe('corrected');
      expect(effects).toEqual([]);
      expect(starts).toEqual([]);
      expect(questions).toEqual([]);
      expect(requests).toHaveLength(2);
      const messages = requests[1]!.messages;
      expect(
        messages.some((message) => message.role === 'tool' || (message.toolCalls?.length ?? 0) > 0),
      ).toBe(false);
      expect(messages.some((message) => message.content.startsWith('[Tool batch refusal'))).toBe(
        true,
      );
      await expect(agent.abandonPause()).resolves.toBeUndefined();
      await expect(agent.run('next')).resolves.toBe('corrected');
      expect(effects).toEqual([]);
    } finally {
      await agent.shutdown();
    }
  });
}
