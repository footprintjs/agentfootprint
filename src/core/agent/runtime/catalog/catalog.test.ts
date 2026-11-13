import { expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';
import { defineTool } from '../../../../tools/tools.js';

it('refuses a tool whose artifact arguments cannot resolve before any model call', () => {
  let calls = 0;
  const provider = mock({
    respond: () => {
      calls++;
      return 'unused';
    },
  });
  expect(() =>
    Agent.create({ provider, model: 'mock' })
      .tool(
        defineTool({
          name: 'read_rows',
          description: 'Read declared rows.',
          inputSchema: { type: 'object' },
          wants: { rows: 'dataset/rows' },
          execute: () => 'unused',
        }),
      )
      .build(),
  ).toThrow(/read_rows.*declares artifact arguments/);
  expect(calls).toBe(0);
});

it('judges a composed tool only after the complete static catalog exists', () => {
  const entry = (name: string, composedOf?: readonly string[]) =>
    defineTool({
      name,
      description: 'Local catalog fixture.',
      inputSchema: { type: 'object' },
      ...(composedOf !== undefined && { composedOf }),
      execute: () => 'ok',
    });
  const build = () => Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' });
  expect(() =>
    build()
      .tool(entry('composed', ['missing']))
      .build(),
  ).toThrow(/composedOf.*missing/);
  expect(() =>
    build()
      .tool(entry('composed', ['ingredient']))
      .tool(entry('ingredient'))
      .build(),
  ).not.toThrow();
});
