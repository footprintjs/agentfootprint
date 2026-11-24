import { expect, it } from 'vitest';
import { toOpenAIMessages } from './toOpenAIMessages.js';

it('projects the prompt, authored text and one tool round trip in wire order', () => {
  const content = 'line one\nline two';
  const messages = toOpenAIMessages(
    [
      { role: 'user', content, ephemeral: true },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call', name: 'read', args: { key: 1 } }],
      },
      { role: 'tool', content: 'found', toolCallId: 'call' },
    ],
    'prompt',
    true,
  );
  expect(messages).toEqual([
    { role: 'developer', content: 'prompt' },
    { role: 'user', content },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call', type: 'function', function: { name: 'read', arguments: '{"key":1}' } },
      ],
    },
    { role: 'tool', content: 'found', tool_call_id: 'call' },
  ]);
});
