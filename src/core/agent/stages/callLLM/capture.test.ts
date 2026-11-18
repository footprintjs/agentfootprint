import { describe, expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { MockProvider } from '../../../../adapters/llm/MockProvider.js';
import { defineTool } from '../../../../tools/tools.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';

function agent() {
  return Agent.create({ provider: new MockProvider({ reply: 'done' }), model: 'mock' })
    .system('Standing rule: preserve this complete body.')
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Look up one declared item.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute: () => 'found',
      }),
    )
    .build();
}

describe('recording-only context frames', () => {
  it('does not opt wildcard sinks into additional content', async () => {
    const runner = agent();
    const events: AgentfootprintEvent[] = [];
    runner.on('*', (event) => events.push(event));
    await runner.run({ message: 'hello' });
    expect(
      events.filter((event) => event.type === ('agentfootprint.context.recorded' as string)),
    ).toHaveLength(0);
  });

  it('serves private content before native recorder delivery', async () => {
    const runner = Agent.create({
      provider: new MockProvider({ reply: 'done' }),
      model: 'mock',
      redact: { keys: ['rawContent', 'inputSchema'] },
    })
      .system('PRIVATE-RULE')
      .tool(
        defineTool({
          name: 'lookup',
          description: 'lookup',
          inputSchema: { type: 'object', properties: { PRIVATE_FIELD: { type: 'string' } } },
          execute: () => 'ok',
        }),
      )
      .build();
    const emitted: unknown[] = [];
    runner.attach({
      id: 'native-capture-proof',
      onEmit(event) {
        if (event.name === 'agentfootprint.context.recorded') emitted.push(event.payload);
      },
    });
    runner.on('agentfootprint.context.recorded', () => undefined);
    await runner.run({ message: 'hello' });
    expect(emitted).toHaveLength(1);
    expect(JSON.stringify(emitted)).not.toContain('PRIVATE-RULE');
    expect(JSON.stringify(emitted)).not.toContain('PRIVATE_FIELD');
  });

  it('captures actual complete pieces and schemas only for an explicit subscriber', async () => {
    const runner = agent();
    const events: AgentfootprintEvent[] = [];
    const off = runner.on('agentfootprint.context.recorded', (event) => events.push(event));
    await runner.run({ message: 'hello' });
    off();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'agentfootprint.context.recorded',
      payload: {
        iteration: 1,
        pieces: expect.arrayContaining([
          expect.objectContaining({
            source: 'base',
            rawContent: 'Standing rule: preserve this complete body.',
          }),
          expect.objectContaining({
            source: 'registry',
            schema: expect.objectContaining({
              name: 'lookup',
              inputSchema: expect.objectContaining({ required: ['id'] }),
            }),
          }),
        ]),
      },
      meta: expect.objectContaining({
        runId: expect.any(String),
        runtimeStageId: expect.any(String),
      }),
    });
    await runner.run({ message: 'second' });
    expect(events).toHaveLength(1);
  });
});
