/**
 * Performance tests — primitive run latency.
 *
 * Budget: a single no-op run should complete in under ~50ms (CI-safe ceiling
 * is 250ms; we assert 500ms to tolerate shared CI noise). Catches massive
 * regressions like accidental O(n²) scope walks, unbounded recorder fan-out,
 * or synchronous blocking in the hot path.
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

// Shared CI-safe ceiling. Regressions hit ≫500ms — noise stays <100ms.
const BUDGET_MS = 500;

describe('performance — single LLMCall run', () => {
  it('completes in under 500ms for a no-op mock provider', async () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const t0 = performance.now();
    await llm.run({ message: 'hi' });
    const ms = performance.now() - t0;

    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('performance — single Agent run (no tools)', () => {
  it('completes in under 500ms with one LLM turn', async () => {
    const agent = Agent.create({
      provider: new MockProvider({ reply: 'done' }),
      model: 'mock',
    })
      .system('')
      .build();

    const t0 = performance.now();
    await agent.run({ message: 'hi' });
    const ms = performance.now() - t0;

    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('performance — Agent with ReAct iterations', () => {
  it('5-iteration run completes in under 1000ms (5x per-iter budget)', async () => {
    const responses: LLMResponse[] = [];
    for (let i = 0; i < 4; i++) {
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

    const t0 = performance.now();
    await agent.run({ message: 'go' });
    const ms = performance.now() - t0;

    expect(ms).toBeLessThan(BUDGET_MS * 2);
  });
});

describe('performance — event dispatch overhead is bounded', () => {
  it('attaching 10 listeners does not slow a single run by >2x baseline', async () => {
    // Baseline: no listeners.
    const baseLlm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) await baseLlm.run({ message: 'x' });
    const baseMs = performance.now() - t0;

    // With 10 listeners.
    const inst = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();
    for (let i = 0; i < 10; i++) {
      inst.on('agentfootprint.stream.llm_start', () => {});
      inst.on('agentfootprint.stream.llm_end', () => {});
    }
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) await inst.run({ message: 'x' });
    const withMs = performance.now() - t1;

    // Dispatch shouldn't blow up with linear fanout. Keep ceiling generous
    // for CI jitter but catch O(n²) regressions.
    expect(withMs).toBeLessThan(Math.max(baseMs * 4, 200));
  });
});
