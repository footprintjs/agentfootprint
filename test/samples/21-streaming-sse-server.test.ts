/**
 * Sample 21: Streaming — SSE Server Integration
 *
 * Shows how to wire AgentStreamEvent to a Server-Sent Events endpoint.
 * The SSEFormatter converts each event to the SSE wire format.
 *
 * In production, this goes in an Express/Fastify/Next.js handler:
 *   res.write(SSEFormatter.format(event))
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent, defineTool, mock } from '../../src/test-barrel';
import { SSEFormatter } from '../../src/stream.barrel';
import type { AgentStreamEvent } from '../../src/stream.barrel';
import type { ToolCall, LLMResponse } from '../../src/test-barrel';

// ── Simulated SSE Response ──────────────────────────────────

class MockSSEResponse {
  chunks: string[] = [];
  write(chunk: string) { this.chunks.push(chunk); }
}

// ── Tests ────────────────────────────────────────────────────

describe('Sample 21: Streaming SSE Server', () => {
  it('SSEFormatter produces valid SSE wire format', () => {
    const event: AgentStreamEvent = { type: 'token', content: 'Hello' };
    const sse = SSEFormatter.format(event);

    // SSE format: "event: <type>\ndata: <json>\n\n"
    expect(sse).toBe('event: token\ndata: {"type":"token","content":"Hello"}\n\n');
  });

  it('full agent run produces SSE stream', async () => {
    const res = new MockSSEResponse();
    const searchTool = defineTool({
      id: 'search',
      description: 'Search',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      handler: async ({ q }) => ({ content: `Results for ${q}` }),
    });

    const tc: ToolCall = { id: 'tc-1', name: 'search', arguments: { q: 'test' } };
    const provider = mock([
      { content: '', toolCalls: [tc] },
      { content: 'Here are the results.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Search assistant.')
      .tool(searchTool)
      .build();

    await agent.run('Search for test', {
      onEvent: (event) => res.write(SSEFormatter.format(event)),
    });

    // Should have SSE chunks for turn_start, llm_start, llm_end, tool_start, tool_end, turn_end
    expect(res.chunks.length).toBeGreaterThanOrEqual(6);

    // Every chunk is valid SSE format
    for (const chunk of res.chunks) {
      expect(chunk).toMatch(/^event: \w+\ndata: \{.*\}\n\n$/s);
    }

    // First chunk is turn_start
    expect(res.chunks[0]).toContain('event: turn_start');

    // Last chunk is turn_end
    expect(res.chunks[res.chunks.length - 1]).toContain('event: turn_end');

    // Has tool lifecycle events
    expect(res.chunks.some((c) => c.includes('event: tool_start'))).toBe(true);
    expect(res.chunks.some((c) => c.includes('event: tool_end'))).toBe(true);
  });

  it('SSEFormatter.formatAll batches multiple events', () => {
    const events: AgentStreamEvent[] = [
      { type: 'turn_start', userMessage: 'hi' },
      { type: 'token', content: 'Hello' },
      { type: 'turn_end', content: 'Hello', iterations: 0 },
    ];
    const batch = SSEFormatter.formatAll(events);
    expect(batch.split('event:').length - 1).toBe(3);
  });
});
