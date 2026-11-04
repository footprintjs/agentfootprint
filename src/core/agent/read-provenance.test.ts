import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../index.js';
import { mock } from '../../providers.js';

it.each([
  ['static', false],
  ['provider', false],
  ['static', true],
  ['provider', true],
] as const)(
  '%s batches with inputs=%s do not invent carrier/ask provenance',
  async (shape, inputs) => {
    const tool = defineTool({
      name: 'a',
      description: 'A',
      inputSchema: { type: 'object' },
      execute: () => 'ok',
    });
    let builder = Agent.create({
      provider: mock({ replies: [{ toolCalls: [{ id: 'c', name: 'a', args: {} }] }, 'done'] }),
      model: 'mock',
      writeProvenance: 'reads-prefix',
    });
    builder =
      shape === 'static'
        ? builder.tool(tool)
        : builder.toolProvider({ id: 'catalog', list: () => [tool] });
    if (inputs) builder = builder.inputsLayer();
    const agent = builder.build();
    await agent.run('go');
    const trace = (agent.getLastSnapshot()?.commitLog ?? []).flatMap((row) => row.trace ?? []);
    const keys = trace.flatMap((row) => row.readKeys ?? []);
    expect(keys.filter((key) => key === 'servedToolParties' || key === 'argumentAsk')).toEqual([]);
  },
);
