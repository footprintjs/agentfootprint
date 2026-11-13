import { describe, expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

describe('typed output through the public runner', () => {
  it('refuses unconfigured parsing through both doors', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
    expect(() => agent.parseOutput('{}')).toThrow(/has no outputSchema/);
    await expect(agent.parseOutputAsync('{}')).rejects.toThrow(/has no outputSchema/);
  });

  it('returns the value the declared parser accepted', async () => {
    const seen: unknown[] = [];
    const agent = Agent.create({ provider: mock({ reply: '{"value":7}' }), model: 'mock' })
      .outputSchema({
        parse(value: unknown) {
          seen.push(value);
          return { accepted: value };
        },
      })
      .build();
    await expect(agent.runTyped('answer')).resolves.toEqual({ accepted: { value: 7 } });
    expect(seen).toContainEqual({ value: 7 });
    await expect(agent.parseOutputAsync('not JSON')).rejects.toMatchObject({
      name: 'OutputSchemaError',
      rawOutput: 'not JSON',
    });
  });
});
