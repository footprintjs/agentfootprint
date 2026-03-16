import { describe, expect, it } from 'vitest';

import {
  textBlock,
  imageBlock,
  base64Image,
  urlImage,
  toolUseBlock,
  toolResultBlock,
  toolCallToBlock,
  blockToToolCall,
  getTextContent,
  contentLength,
  hasToolUseBlocks,
  getToolUseBlocks,
  userMessage,
  assistantMessage,
  toolResultMessage,
  systemMessage,
  hasToolCalls,
} from '../../src';

import type {
  ContentBlock,
  TextBlock,
  ImageBlock,
  ToolUseBlock,
  ToolResultBlock,
  MessageContent,
  StreamCallback,
  StreamChunk,
  UserMessage,
  AssistantMessage,
  LLMCallOptions,
} from '../../src';

// ── ContentBlock Factories ──────────────────────────────────

describe('ContentBlock factories', () => {
  it('textBlock creates a text content block', () => {
    const block = textBlock('Hello world');
    expect(block.type).toBe('text');
    expect(block.text).toBe('Hello world');
  });

  it('imageBlock creates an image block with source', () => {
    const block = imageBlock({ type: 'url', url: 'https://example.com/img.png' });
    expect(block.type).toBe('image');
    expect(block.source.type).toBe('url');
    if (block.source.type === 'url') {
      expect(block.source.url).toBe('https://example.com/img.png');
    }
  });

  it('base64Image is a shorthand for base64 image blocks', () => {
    const block = base64Image('image/png', 'iVBOR...');
    expect(block.type).toBe('image');
    expect(block.source.type).toBe('base64');
    if (block.source.type === 'base64') {
      expect(block.source.mediaType).toBe('image/png');
      expect(block.source.data).toBe('iVBOR...');
    }
  });

  it('urlImage is a shorthand for URL image blocks', () => {
    const block = urlImage('https://example.com/photo.jpg');
    expect(block.type).toBe('image');
    expect(block.source.type).toBe('url');
  });

  it('toolUseBlock creates a tool use block', () => {
    const block = toolUseBlock('call-1', 'search', { query: 'test' });
    expect(block.type).toBe('tool_use');
    expect(block.id).toBe('call-1');
    expect(block.name).toBe('search');
    expect(block.input).toEqual({ query: 'test' });
  });

  it('toolResultBlock creates a tool result block', () => {
    const block = toolResultBlock('call-1', 'found 3 results');
    expect(block.type).toBe('tool_result');
    expect(block.toolUseId).toBe('call-1');
    expect(block.content).toBe('found 3 results');
    expect(block.isError).toBeUndefined();
  });

  it('toolResultBlock supports error flag', () => {
    const block = toolResultBlock('call-1', 'timeout', true);
    expect(block.isError).toBe(true);
  });

  it('toolResultBlock supports nested ContentBlock[] content', () => {
    const block = toolResultBlock('call-1', [textBlock('result'), urlImage('https://img.png')]);
    expect(Array.isArray(block.content)).toBe(true);
    expect((block.content as ContentBlock[]).length).toBe(2);
  });
});

// ── Content Helpers ─────────────────────────────────────────

describe('getTextContent', () => {
  it('returns string content as-is', () => {
    expect(getTextContent('hello')).toBe('hello');
  });

  it('concatenates text blocks from ContentBlock[]', () => {
    const blocks: ContentBlock[] = [textBlock('Hello '), textBlock('world')];
    expect(getTextContent(blocks)).toBe('Hello world');
  });

  it('ignores non-text blocks', () => {
    const blocks: ContentBlock[] = [
      textBlock('Answer: '),
      urlImage('https://chart.png'),
      textBlock('42'),
    ];
    expect(getTextContent(blocks)).toBe('Answer: 42');
  });

  it('returns empty string for empty ContentBlock[]', () => {
    expect(getTextContent([])).toBe('');
  });

  it('returns empty string for blocks with no text', () => {
    const blocks: ContentBlock[] = [urlImage('https://img.png')];
    expect(getTextContent(blocks)).toBe('');
  });
});

describe('contentLength', () => {
  it('returns string length for string content', () => {
    expect(contentLength('hello')).toBe(5);
  });

  it('returns concatenated text length for ContentBlock[]', () => {
    const blocks: ContentBlock[] = [textBlock('abc'), textBlock('de')];
    expect(contentLength(blocks)).toBe(5);
  });
});

describe('hasToolUseBlocks', () => {
  it('returns false for string content', () => {
    expect(hasToolUseBlocks('hello')).toBe(false);
  });

  it('returns true when content contains tool_use blocks', () => {
    const blocks: ContentBlock[] = [
      textBlock('thinking...'),
      toolUseBlock('call-1', 'search', { q: 'test' }),
    ];
    expect(hasToolUseBlocks(blocks)).toBe(true);
  });

  it('returns false when content has no tool_use blocks', () => {
    const blocks: ContentBlock[] = [textBlock('just text')];
    expect(hasToolUseBlocks(blocks)).toBe(false);
  });
});

describe('getToolUseBlocks', () => {
  it('returns empty array for string content', () => {
    expect(getToolUseBlocks('hello')).toEqual([]);
  });

  it('extracts only tool_use blocks', () => {
    const blocks: ContentBlock[] = [
      textBlock('Let me search'),
      toolUseBlock('call-1', 'search', { q: 'test' }),
      toolUseBlock('call-2', 'read', { path: '/foo' }),
    ];
    const result = getToolUseBlocks(blocks);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('search');
    expect(result[1].name).toBe('read');
  });
});

// ── Backward Compatibility ──────────────────────────────────

describe('backward compatibility', () => {
  it('string content still works on UserMessage', () => {
    const msg = userMessage('hello');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
    // String content works directly — no migration needed for existing code
    expect(typeof msg.content).toBe('string');
  });

  it('string content still works on AssistantMessage', () => {
    const msg = assistantMessage('response text');
    expect(msg.content).toBe('response text');
  });

  it('SystemMessage content is always string', () => {
    const msg = systemMessage('You are helpful');
    // SystemMessage.content is `string`, not MessageContent
    expect(typeof msg.content).toBe('string');
  });

  it('hasToolCalls works unchanged with string content', () => {
    const msg = assistantMessage('done', [{ id: 'c1', name: 'tool', arguments: {} }]);
    expect(hasToolCalls(msg)).toBe(true);
  });

  it('UserMessage accepts ContentBlock[] content', () => {
    const msg: UserMessage = {
      role: 'user',
      content: [textBlock('Describe this image'), urlImage('https://photo.jpg')],
    };
    expect(msg.role).toBe('user');
    expect(Array.isArray(msg.content)).toBe(true);
    expect(getTextContent(msg.content)).toBe('Describe this image');
  });

  it('AssistantMessage accepts ContentBlock[] content', () => {
    const msg: AssistantMessage = {
      role: 'assistant',
      content: [textBlock('Here is the result'), toolUseBlock('c1', 'calc', { expr: '2+2' })],
    };
    expect(Array.isArray(msg.content)).toBe(true);
    expect(getTextContent(msg.content)).toBe('Here is the result');
  });
});

// ── StreamCallback Type ─────────────────────────────────────

describe('StreamCallback typing', () => {
  it('StreamCallback is callable with StreamChunk', () => {
    const chunks: StreamChunk[] = [];
    const callback: StreamCallback = (chunk) => {
      chunks.push(chunk);
    };

    callback({ type: 'text', text: 'Hello' });
    callback({ type: 'tool_use_start', toolUseId: 'c1', toolName: 'search' });
    callback({ type: 'tool_use_input', partialInput: '{"q":' });
    callback({ type: 'done' });

    expect(chunks.length).toBe(4);
    expect(chunks[0].type).toBe('text');
    expect(chunks[0].text).toBe('Hello');
    expect(chunks[3].type).toBe('done');
  });

  it('LLMCallOptions accepts streamCallback', () => {
    const collected: string[] = [];
    const options: LLMCallOptions = {
      maxTokens: 1000,
      streamCallback: (chunk) => {
        if (chunk.text) collected.push(chunk.text);
      },
    };

    // Simulate provider calling the callback
    options.streamCallback!({ type: 'text', text: 'token1' });
    options.streamCallback!({ type: 'text', text: 'token2' });
    options.streamCallback!({ type: 'done' });

    expect(collected).toEqual(['token1', 'token2']);
  });
});

// ── ToolCall ↔ ToolUseBlock Conversion ──────────────────────

describe('toolCallToBlock / blockToToolCall', () => {
  it('converts ToolCall to ToolUseBlock', () => {
    const call = { id: 'c1', name: 'search', arguments: { query: 'test' } };
    const block = toolCallToBlock(call);
    expect(block.type).toBe('tool_use');
    expect(block.id).toBe('c1');
    expect(block.name).toBe('search');
    expect(block.input).toEqual({ query: 'test' });
  });

  it('converts ToolUseBlock to ToolCall', () => {
    const block = toolUseBlock('c1', 'search', { query: 'test' });
    const call = blockToToolCall(block);
    expect(call.id).toBe('c1');
    expect(call.name).toBe('search');
    expect(call.arguments).toEqual({ query: 'test' });
  });

  it('round-trips without data loss', () => {
    const original = { id: 'c1', name: 'calc', arguments: { expr: '2+2', precision: 3 } };
    const roundTripped = blockToToolCall(toolCallToBlock(original));
    expect(roundTripped).toEqual(original);
  });
});

// ── Message Factory Overloads ───────────────────────────────

describe('message factories accept MessageContent', () => {
  it('userMessage accepts ContentBlock[]', () => {
    const msg = userMessage([textBlock('Look at this'), urlImage('https://img.png')]);
    expect(msg.role).toBe('user');
    expect(Array.isArray(msg.content)).toBe(true);
    expect(getTextContent(msg.content)).toBe('Look at this');
  });

  it('assistantMessage accepts ContentBlock[]', () => {
    const msg = assistantMessage([textBlock('Here you go'), toolUseBlock('c1', 'search', {})]);
    expect(msg.role).toBe('assistant');
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it('toolResultMessage accepts ContentBlock[]', () => {
    const msg = toolResultMessage([textBlock('Result'), urlImage('https://chart.png')], 'c1');
    expect(msg.role).toBe('tool');
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it('all factories still accept plain strings', () => {
    expect(userMessage('hello').content).toBe('hello');
    expect(assistantMessage('hi').content).toBe('hi');
    expect(toolResultMessage('result', 'c1').content).toBe('result');
  });
});

// ── Discriminated Union ─────────────────────────────────────

describe('ContentBlock discriminated union', () => {
  it('type field enables exhaustive narrowing', () => {
    const blocks: ContentBlock[] = [
      textBlock('hi'),
      urlImage('https://img.png'),
      toolUseBlock('c1', 'search', {}),
      toolResultBlock('c1', 'found'),
    ];

    const types = blocks.map((block) => {
      switch (block.type) {
        case 'text':
          return `text:${block.text}`;
        case 'image':
          return `image:${block.source.type}`;
        case 'tool_use':
          return `tool_use:${block.name}`;
        case 'tool_result':
          return `tool_result:${block.toolUseId}`;
      }
    });

    expect(types).toEqual(['text:hi', 'image:url', 'tool_use:search', 'tool_result:c1']);
  });
});
