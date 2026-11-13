import { expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { defineTool } from '../../../../tools/tools.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

it('serves the completed catalog and static prompt to the first request', async () => {
  let offered: string[] = [];
  let system = '';
  const provider = mock({
    respond(request) {
      offered = request.tools?.map((tool) => tool.name) ?? [];
      system = request.systemPrompt ?? '';
      return 'answer';
    },
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .system('Declared system prompt.')
    .tool(
      defineTool({
        name: 'declared_tool',
        description: 'Local offer.',
        inputSchema: { type: 'object' },
        execute: () => 'ok',
      }),
    )
    .build();
  await expect(agent.run('question')).resolves.toBe('answer');
  expect(offered).toContain('declared_tool');
  expect(system).toContain('Declared system prompt.');
});
