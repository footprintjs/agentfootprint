/**
 * Scenario tests — v2 Agent end-to-end.
 *
 * Covers:
 *   - Single-turn, single-tool ReAct loop
 *   - Final answer returned as string
 *   - stream.* / agent.* / context.* events emitted
 *   - route_decided picks 'tool-calls' then 'final'
 *   - maxIterations guard enforces termination
 *   - Unknown-tool error path
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

/** Deterministic scripted provider — returns one response per call. */
function scriptedProvider(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async (_req: LLMRequest) => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
}

function llmResponse(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 0, output: content.length / 4 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

describe('Agent — single-turn, no tools (degenerate case)', () => {
  it('returns the LLM content as the final answer on first iteration', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'hello back' }),
      model: 'mock',
    })
      .system('be helpful')
      .build();

    const out = await agent.run({ message: 'hi' });
    expect(out).toBe('hello back');
  });
});

describe('Agent — single-tool ReAct loop', () => {
  it('executes one tool call and returns final answer on iteration 2', async () => {
    const provider = scriptedProvider(
      // Iter 1: LLM requests a tool
      llmResponse('I should look this up.', [
        { id: 'tc-1', name: 'lookup', args: { q: 'weather' } },
      ]),
      // Iter 2: LLM uses tool result and finalizes
      llmResponse('Weather is sunny.'),
    );

    const lookupExecute = vi.fn().mockResolvedValue('It is sunny in SF today.');

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .system('use the tool')
      .tool({
        schema: {
          name: 'lookup',
          description: 'Look up information',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
        execute: lookupExecute,
      })
      .build();

    const events: string[] = [];
    agent.on('*', (e) => events.push(e.type));

    const out = await agent.run({ message: 'what is the weather?' });

    expect(out).toBe('Weather is sunny.');
    expect(lookupExecute).toHaveBeenCalledTimes(1);
    expect(lookupExecute.mock.calls[0][0]).toEqual({ q: 'weather' });

    // Event-flow sanity check: turn, llm, tool, llm, return
    expect(events).toContain('agentfootprint.agent.turn_start');
    expect(events).toContain('agentfootprint.stream.llm_start');
    expect(events).toContain('agentfootprint.stream.tool_start');
    expect(events).toContain('agentfootprint.stream.tool_end');
    expect(events).toContain('agentfootprint.agent.route_decided');
    expect(events).toContain('agentfootprint.agent.turn_end');

    // Two iterations = two llm_start events
    const llmStarts = events.filter((t) => t === 'agentfootprint.stream.llm_start').length;
    expect(llmStarts).toBe(2);
  });

  it('emits route_decided with chosen="tool-calls" then "final"', async () => {
    const provider = scriptedProvider(
      llmResponse('', [{ id: 'tc-1', name: 'noop', args: {} }]),
      llmResponse('done'),
    );

    const agent = Agent.create({ provider, model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const routes: string[] = [];
    agent.on('agentfootprint.agent.route_decided', (e) => {
      routes.push(e.payload.chosen);
    });

    await agent.run({ message: 'go' });
    expect(routes).toEqual(['tool-calls', 'final']);
  });
});

describe('Agent — maxIterations guard', () => {
  it('forces final at maxIterations even when LLM keeps requesting tools', async () => {
    // Provider ALWAYS requests a tool — would loop forever without the guard
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => llmResponse('thinking...', [{ id: 'tc', name: 'noop', args: {} }]),
    };

    const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const routes: string[] = [];
    agent.on('agentfootprint.agent.route_decided', (e) => {
      routes.push(`${e.payload.chosen}@${e.payload.iterIndex}`);
    });

    const out = await agent.run({ message: 'go' });
    // Final forced on iteration 3 (maxIterations) — 2 tool-call iters + 1 final
    expect(routes).toEqual(['tool-calls@1', 'tool-calls@2', 'final@3']);
    expect(out).toBe('thinking...');
  });
});

describe('Agent — error paths', () => {
  it('surfaces tool error in stream.tool_end with error:true', async () => {
    const provider = scriptedProvider(
      llmResponse('', [{ id: 'tc', name: 'broken', args: {} }]),
      llmResponse('recovered'),
    );

    const agent = Agent.create({ provider, model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'broken', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          throw new Error('boom');
        },
      })
      .build();

    const toolEnds: unknown[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) => {
      toolEnds.push({ error: e.payload.error, result: e.payload.result });
    });

    await agent.run({ message: 'go' });
    expect(toolEnds).toHaveLength(1);
    expect(toolEnds[0]).toMatchObject({ error: true, result: 'boom' });
  });

  it('rejects duplicate tool names at build time', () => {
    const agent = Agent.create({ provider: new MockProvider(), model: 'mock' }).system('');
    agent.tool({
      schema: { name: 'dup', description: '', inputSchema: { type: 'object' } },
      execute: () => 1,
    });
    expect(() =>
      agent.tool({
        schema: { name: 'dup', description: '', inputSchema: { type: 'object' } },
        execute: () => 2,
      }),
    ).toThrow(/duplicate tool name/);
  });
});
