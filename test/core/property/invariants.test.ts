/**
 * Property tests — primitive-level invariants that must hold across every run.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function resp(
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

describe('property — Agent turn_start count == turn_end count', () => {
  it.each([0, 1, 2, 3])(
    'runs with %d tool calls still produce exactly 1 turn_start + 1 turn_end',
    async (nTools) => {
      const responses: LLMResponse[] = [];
      for (let i = 0; i < nTools; i++) {
        responses.push(resp('', [{ id: `t${i}`, name: 'noop', args: {} }]));
      }
      responses.push(resp('done'));

      const agent = Agent.create({
        provider: scripted(...responses),
        model: 'mock',
        maxIterations: 10,
      })
        .system('')
        .tool({
          schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
          execute: () => 'ok',
        })
        .build();

      let starts = 0;
      let ends = 0;
      agent.on('agentfootprint.agent.turn_start', () => starts++);
      agent.on('agentfootprint.agent.turn_end', () => ends++);

      await agent.run({ message: 'go' });
      expect(starts).toBe(1);
      expect(ends).toBe(1);
    },
  );
});

describe('property — iteration indices are monotonic (1, 2, 3, …)', () => {
  it('iteration_start events emit with strictly increasing iterIndex', async () => {
    // Force N iterations by scripting N tool-call responses then one final
    const N = 4;
    const responses: LLMResponse[] = [];
    for (let i = 0; i < N - 1; i++) {
      responses.push(resp('', [{ id: `t${i}`, name: 'noop', args: {} }]));
    }
    responses.push(resp('final'));

    const agent = Agent.create({
      provider: scripted(...responses),
      model: 'mock',
      maxIterations: 10,
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const iters: number[] = [];
    agent.on('agentfootprint.agent.iteration_start', (e) => iters.push(e.payload.iterIndex));

    await agent.run({ message: 'go' });
    expect(iters).toEqual([1, 2, 3, 4]);
  });
});

describe('property — route_decided fires exactly once per iteration', () => {
  it('N iterations yield N route_decided events', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'noop', args: {} }]),
        resp('', [{ id: 't2', name: 'noop', args: {} }]),
        resp('final'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    let routes = 0;
    agent.on('agentfootprint.agent.route_decided', () => routes++);
    await agent.run({ message: 'go' });
    expect(routes).toBe(3); // 2 tool-calls + 1 final
  });
});

describe('property — llm_start count matches iteration count', () => {
  it('each iteration produces exactly one llm_start + one llm_end', async () => {
    const agent = Agent.create({
      provider: scripted(resp('', [{ id: 't', name: 'noop', args: {} }]), resp('answer')),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    let starts = 0;
    let ends = 0;
    agent.on('agentfootprint.stream.llm_start', () => starts++);
    agent.on('agentfootprint.stream.llm_end', () => ends++);
    await agent.run({ message: 'go' });
    expect(starts).toBe(2);
    expect(ends).toBe(2);
  });
});

describe('property — LLMCall emits exactly 1 llm_start + 1 llm_end per run', () => {
  it.each([1, 5, 20])('%d runs yield N-matched event pairs', async (N) => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    let starts = 0;
    let ends = 0;
    llm.on('agentfootprint.stream.llm_start', () => starts++);
    llm.on('agentfootprint.stream.llm_end', () => ends++);

    for (let i = 0; i < N; i++) {
      await llm.run({ message: `call ${i}` });
    }
    expect(starts).toBe(N);
    expect(ends).toBe(N);
  });
});

describe('property — each tool_start has a matching tool_end', () => {
  it('tool_start count == tool_end count across varying tool-call fanout', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [
          { id: 't1', name: 'noop', args: {} },
          { id: 't2', name: 'noop', args: {} },
          { id: 't3', name: 'noop', args: {} },
        ]),
        resp('done'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    let starts = 0;
    let ends = 0;
    agent.on('agentfootprint.stream.tool_start', () => starts++);
    agent.on('agentfootprint.stream.tool_end', () => ends++);
    await agent.run({ message: 'go' });
    expect(starts).toBe(3);
    expect(ends).toBe(3);
  });
});
