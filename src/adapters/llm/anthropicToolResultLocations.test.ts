import { expect, it } from 'vitest';
import type { LLMMessage } from '../../provider-contract/types.js';
import { toAnthropicMessages } from './anthropicMessageProjection.js';
import { buildMessagesBody, type AnthropicToolResultBlock } from './anthropicMessagesWire.js';
import { findAnthropicToolResultLocations } from './anthropicToolResultLocations.js';

const first: LLMMessage = { role: 'tool', toolCallId: 'c1', content: '12 mm' };
const second: LLMMessage = { ...first };

it('observes exact sibling bodies even when their wire message and bytes match', () => {
  const outerIndices: number[] = [];
  const sourceByBlock = new Map<AnthropicToolResultBlock, LLMMessage>();
  const messages = toAnthropicMessages([first, second], outerIndices, (source, block) => {
    sourceByBlock.set(block, source);
  });

  expect(outerIndices).toEqual([0, 0]);
  const blocks = messages[0].content as AnthropicToolResultBlock[];
  expect(blocks[0]).toEqual(blocks[1]);
  expect(blocks[0]).not.toBe(blocks[1]);
  expect(sourceByBlock.size).toBe(2);
  expect(sourceByBlock.get(blocks[0])).toBe(first);
  expect(sourceByBlock.get(blocks[1])).toBe(second);
  const locations = findAnthropicToolResultLocations(messages, sourceByBlock, 3);
  expect(locations).toEqual([
    { source: first, messageIndex: 0, blockIndex: 0, blockNumber: 1, body: '12 mm' },
    { source: second, messageIndex: 0, blockIndex: 1, blockNumber: 2, body: '12 mm' },
  ]);
  expect(locations?.[0].source).toBe(first);
  expect(locations?.[1].source).toBe(second);
});

it('locates only the surviving occurrence after grouping and inserting before recovery text', () => {
  const recovery: LLMMessage = {
    role: 'tool',
    toolCallId: 'c1',
    content: 'Tool input was rejected',
    toolArgumentsFailure: { reason: 'invalid-json' },
  };
  const sourceByBlock = new Map<AnthropicToolResultBlock, LLMMessage>();
  const body = buildMessagesBody(
    {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Report the measurement.' }, recovery, second],
      cacheMarkers: [{ field: 'messages', boundaryIndex: 2, ttl: 'short', reason: 'test' }],
    },
    {
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      maxTokensDefault: 1024,
      thinkingMode: () => 'none',
      observeToolResult: (source, block) => sourceByBlock.set(block, source),
    },
  );

  expect(body.messages[1].content).toMatchObject([
    { type: 'tool_result', content: '12 mm' },
    { type: 'text', text: 'Tool input was rejected', cache_control: { type: 'ephemeral' } },
  ]);
  const locations = findAnthropicToolResultLocations(body.messages, sourceByBlock, 4);
  expect(locations).toEqual([
    { source: second, messageIndex: 1, blockIndex: 0, blockNumber: 1, body: '12 mm' },
  ]);
  expect(locations?.[0].source).toBe(second);
});

it('omits identical copies and discards an ambiguous or incomplete scan', () => {
  const sourceByBlock = new Map<AnthropicToolResultBlock, LLMMessage>();
  const messages = toAnthropicMessages([first], undefined, (source, block) => {
    sourceByBlock.set(block, source);
  });
  const [block] = sourceByBlock.keys();

  expect(
    findAnthropicToolResultLocations([{ role: 'user', content: [{ ...block }] }], sourceByBlock, 2),
  ).toEqual([]);
  expect(
    findAnthropicToolResultLocations([{ role: 'user', content: [block, block] }], sourceByBlock, 3),
  ).toBeUndefined();
  expect(
    findAnthropicToolResultLocations(
      [...messages, { role: 'user', content: 'still unchecked' }],
      sourceByBlock,
      2,
    ),
  ).toBeUndefined();
});
