/**
 * Swarm pattern — 5 scenario tests.
 * Origin: OpenAI Swarm (2024). Specialist routing — each agent has a
 * narrow role; an LLM or consumer-supplied router decides hand-offs.
 */

import { describe, it, expect } from 'vitest';
import { swarm } from '../../../src/patterns/Swarm.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function tagged(tag: string): LLMProvider {
  return {
    name: tag,
    complete: async (req): Promise<LLMResponse> => {
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      return {
        content: `${tag}(${last?.content ?? ''})`,
        toolCalls: [],
        usage: { input: 10, output: 5 },
        stopReason: 'stop',
      };
    },
  };
}

describe('Swarm', () => {
  it('routes to the chosen agent based on the router return value', async () => {
    const billing = LLMCall.create({ provider: tagged('billing'), model: 'm' })
      .system('')
      .build();
    const tech = LLMCall.create({ provider: tagged('tech'), model: 'm' })
      .system('')
      .build();

    const runner = swarm({
      agents: [
        { id: 'billing', runner: billing },
        { id: 'tech', runner: tech },
      ],
      route: (input) => {
        if (input.message.includes('bill')) return 'billing';
        if (input.message.includes('error')) return 'tech';
        return undefined;
      },
    });

    const out = await runner.run({ message: 'I got a bill' });
    expect(out).toMatch(/billing/);
  });

  it('hands off across agents in a Loop until route returns undefined', async () => {
    // A tiny 2-agent swarm where each agent's response triggers a
    // handoff once, then emits a halt marker.
    let turn = 0;
    const agentA = LLMCall.create({
      provider: {
        name: 'A',
        complete: async (): Promise<LLMResponse> => ({
          content: `A-turn-${++turn}`,
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'stop',
        }),
      },
      model: 'm',
    })
      .system('')
      .build();
    const agentB = LLMCall.create({
      provider: {
        name: 'B',
        complete: async (): Promise<LLMResponse> => ({
          content: 'B-done',
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'stop',
        }),
      },
      model: 'm',
    })
      .system('')
      .build();

    const runner = swarm({
      agents: [
        { id: 'A', runner: agentA },
        { id: 'B', runner: agentB },
      ],
      route: (input) => {
        // First turn: start at A. Then hand off to B. Then halt.
        if (input.message.startsWith('A-turn')) return 'B';
        if (input.message === 'B-done') return undefined;
        return 'A';
      },
    });

    let handoffs = 0;
    runner.on('agentfootprint.composition.iteration_start', () => handoffs++);
    const out = await runner.run({ message: 'start' });
    expect(out).toBe('B-done');
    expect(handoffs).toBeGreaterThanOrEqual(2); // at least A → B, then halt iter
  });

  it('rejects an agent roster smaller than 2', () => {
    expect(() =>
      swarm({
        agents: [
          {
            id: 'only',
            runner: LLMCall.create({ provider: new MockProvider(), model: 'm' }).system('').build(),
          },
        ],
        route: () => 'only',
      }),
    ).toThrow(/must have >= 2 agents/);
  });

  it('rejects agent id "done" (reserved for halt branch)', () => {
    const r = LLMCall.create({ provider: new MockProvider(), model: 'm' }).system('').build();
    expect(() =>
      swarm({
        agents: [
          { id: 'done', runner: r },
          { id: 'a', runner: r },
        ],
        route: () => 'a',
      }),
    ).toThrow(/"done" is reserved/);
  });

  it('maxHandoffs bounds runaway routing', async () => {
    const a = LLMCall.create({ provider: tagged('A'), model: 'm' })
      .system('')
      .build();
    const b = LLMCall.create({ provider: tagged('B'), model: 'm' })
      .system('')
      .build();

    // Route ping-pongs between A and B forever.
    let flip = true;
    const runner = swarm({
      agents: [
        { id: 'A', runner: a },
        { id: 'B', runner: b },
      ],
      route: () => {
        flip = !flip;
        return flip ? 'A' : 'B';
      },
      maxHandoffs: 4,
    });

    let iterations = 0;
    runner.on('agentfootprint.composition.iteration_start', () => iterations++);
    await runner.run({ message: 'start' });
    // Loop budget caps handoffs at 4 even though routing would continue forever.
    expect(iterations).toBe(4);
  });
});
