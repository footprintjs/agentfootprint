import { expect, it } from 'vitest';
import { Agent } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';
import type { LLMRequest } from '../../../../provider-contract/types.js';

it('a new turn seeds only its own message while followUp carries the accepted conversation', async () => {
  const requests: string[][] = [];
  const inner = mock({ replies: ['first answer', 'second answer', 'continued answer'] });
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete(request: LLMRequest) {
        requests.push(
          request.messages
            .filter((message) => message.role === 'user')
            .map((message) => message.content),
        );
        return inner.complete(request);
      },
    },
    model: 'mock',
  }).build();
  await expect(agent.run('first question')).resolves.toBe('first answer');
  await expect(agent.run('second question')).resolves.toBe('second answer');
  await expect(agent.followUp('continue the second')).resolves.toBe('continued answer');
  expect(requests).toEqual([
    ['first question'],
    ['second question'],
    ['second question', 'continue the second'],
  ]);
});
