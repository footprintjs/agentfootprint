/**
 * Inputs for the Anthropic Messages wire byte-identity pin
 * (BrowserAnthropic.sharedWire.byte-identity.test.ts): one request that drives
 * every branch of the body builder, one SSE script that drives every branch of
 * the stream assembly, and one complete() reply.
 */
import type { LLMRequest } from '../../../src/adapters/types.js';

export const REQ: LLMRequest = {
  model: 'anthropic',
  systemPrompt: 'be brief',
  maxTokens: 50,
  // 1 — the only temperature a thinking request may carry.
  temperature: 1,
  stop: ['X'],
  // Above maxTokens, so the max_tokens bump still fires.
  thinking: { budget: 1100 },
  toolChoice: { name: 't' },
  cacheMarkers: [
    { field: 'system', boundaryIndex: 0, ttl: 'short' },
    { field: 'messages', boundaryIndex: 3, ttl: 'long' },
    { field: 'tools', boundaryIndex: 0, ttl: 'short' },
  ],
  tools: [
    {
      name: 't',
      description: 'd',
      inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
    },
  ],
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: 'calling',
      toolCalls: [
        { id: 'c1', name: 't', args: { a: '1' } },
        { id: 'c2', name: 't', args: {} },
      ],
      thinkingBlocks: [
        { type: 'thinking', content: 'hm', signature: 'sig' } as never,
        { type: 'redacted_thinking', signature: 'r' } as never,
      ],
    },
    { role: 'tool', content: 'r1', toolCallId: 'c1' },
    { role: 'tool', content: 'r2', toolCallId: 'c2' },
    { role: 'assistant', content: '' },
    { role: 'user', content: 'more' },
  ],
} as never;

export const SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":7,"output_tokens":1,"cache_read_input_tokens":3}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"th"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"S"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"lo"}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"t1","name":"t","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\\"x\\"}"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":2}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"t2","name":"t","input":{}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{bad"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":3}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join('');
export const MSG = {
  id: 'm',
  model: 'x',
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'a' },
    { type: 'text', text: 'ok' },
    { type: 'tool_use', id: 'u', name: 't', input: { a: 1 } },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 5 },
};

export function rec(bodies: string[], stream: boolean) {
  return (async (_u: unknown, init: RequestInit) => {
    bodies.push(String(init.body));
    if (stream) return new Response(SSE, { status: 200 });
    return new Response(JSON.stringify(MSG), { status: 200 });
  }) as never;
}
