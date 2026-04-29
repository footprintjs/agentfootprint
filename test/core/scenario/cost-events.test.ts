/**
 * Cost events — 7-pattern tests for LLMCall + Agent.
 *
 * When a runner is configured with a `pricingTable` (PricingTable port),
 * every LLM response drives a typed `agentfootprint.cost.tick` with
 * per-call tokens/USD + cumulative run totals. When `costBudget` is also
 * set, the FIRST crossing emits one-shot `agentfootprint.cost.limit_hit`
 * with `action: 'warn'`. Zero overhead when `pricingTable` is omitted.
 *
 * 7 patterns: Unit · Scenario · Integration · Property · Security ·
 * Performance · ROI.
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMResponse, PricingTable } from '../../../src/adapters/types.js';

function scripted(...r: LLMResponse[]): LLMProvider {
  let i = 0;
  return { name: 'mock', complete: async () => r[Math.min(i++, r.length - 1)] };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
  usage = { input: 100, output: 50 },
): LLMResponse {
  return {
    content,
    toolCalls,
    usage,
    stopReason: toolCalls.length ? 'tool_use' : 'stop',
  };
}

function flatPricing(inputUsd: number, outputUsd: number): PricingTable {
  return {
    name: 'flat',
    pricePerToken: (_model, kind) => {
      if (kind === 'input') return inputUsd;
      if (kind === 'output') return outputUsd;
      return 0;
    },
  };
}

// ── 1. Unit — no pricing table = no events ─────────────────────────

describe('cost — unit (opt-in)', () => {
  it('zero cost events when pricingTable is omitted', async () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    let ticks = 0;
    let limits = 0;
    llm.on('agentfootprint.cost.tick', () => ticks++);
    llm.on('agentfootprint.cost.limit_hit', () => limits++);

    await llm.run({ message: 'hi' });
    expect(ticks).toBe(0);
    expect(limits).toBe(0);
  });
});

// ── 2. Scenario — happy-path tick + cumulative + limit_hit ─────────

describe('cost — scenario (LLMCall)', () => {
  it('emits one cost.tick per LLM response with correct usd + cumulative', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => ({
        content: 'ok',
        toolCalls: [],
        usage: { input: 100, output: 50 },
        stopReason: 'stop',
      }),
    };
    const llm = LLMCall.create({
      provider,
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003), // $0.01/1k in, $0.03/1k out
    })
      .system('')
      .build();

    const ticks: { estimatedUsd: number; cumulative: { estimatedUsd: number } }[] = [];
    llm.on('agentfootprint.cost.tick', (e) =>
      ticks.push({
        estimatedUsd: e.payload.estimatedUsd,
        cumulative: { estimatedUsd: e.payload.cumulative.estimatedUsd },
      }),
    );

    await llm.run({ message: 'hi' });
    expect(ticks).toHaveLength(1);
    // per-call USD = 0.00001 * 100 + 0.00003 * 50 = 0.001 + 0.0015 = 0.0025
    expect(ticks[0].estimatedUsd).toBeCloseTo(0.0025, 6);
    expect(ticks[0].cumulative.estimatedUsd).toBeCloseTo(0.0025, 6);
  });

  it('cumulative resets per run (budget is per-run, not lifetime)', async () => {
    // LLMCall makes exactly one LLM call per run(). With a flat-rate pricing
    // of $0.00001/input + $0.00003/output and usage 1000/1000 per call,
    // each run's cumulative = 0.04. A budget of 0.05 is never crossed —
    // each run's cumulative resets to fresh.
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => ({
        content: 'big',
        toolCalls: [],
        usage: { input: 1000, output: 1000 },
        stopReason: 'stop',
      }),
    };
    const llm = LLMCall.create({
      provider,
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
      costBudget: 0.05, // 1 call per run = 0.04 < 0.05
    })
      .system('')
      .build();

    const limits: unknown[] = [];
    llm.on('agentfootprint.cost.limit_hit', (e) => limits.push(e.payload));

    await llm.run({ message: 'r1' });
    await llm.run({ message: 'r2' });
    await llm.run({ message: 'r3' });
    // Each run's cumulative = 0.04 < 0.05 → no limit_hit.
    expect(limits).toHaveLength(0);
  });
});

describe('cost — scenario (Agent multi-iteration)', () => {
  it('emits one cost.tick per ReAct iteration with growing cumulative', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'noop', args: {} }], { input: 100, output: 50 }),
        resp('', [{ id: 't2', name: 'noop', args: {} }], { input: 200, output: 75 }),
        resp('final', [], { input: 300, output: 100 }),
      ),
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const ticks: { perCall: number; cumulative: number }[] = [];
    agent.on('agentfootprint.cost.tick', (e) =>
      ticks.push({
        perCall: e.payload.estimatedUsd,
        cumulative: e.payload.cumulative.estimatedUsd,
      }),
    );

    await agent.run({ message: 'go' });
    expect(ticks).toHaveLength(3);
    // cumulative strictly monotone-increasing
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].cumulative).toBeGreaterThan(ticks[i - 1].cumulative);
    }
  });

  it('Agent cost.limit_hit fires once when cumulative crosses costBudget mid-run', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'noop', args: {} }], { input: 1000, output: 1000 }), // $0.04
        resp('', [{ id: 't2', name: 'noop', args: {} }], { input: 1000, output: 1000 }), // +$0.04 = $0.08
        resp('done', [], { input: 100, output: 50 }),
      ),
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
      costBudget: 0.05,
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const limits: unknown[] = [];
    agent.on('agentfootprint.cost.limit_hit', (e) => limits.push(e.payload));

    await agent.run({ message: 'go' });
    expect(limits).toHaveLength(1); // only the FIRST crossing emits
    expect((limits[0] as { limit: number }).limit).toBe(0.05);
    expect((limits[0] as { action: string }).action).toBe('warn');
  });
});

// ── 3. Integration — tick payload shape ────────────────────────────

describe('cost — integration', () => {
  it('cost.tick payload has per-call AND cumulative breakdowns', async () => {
    const agent = Agent.create({
      provider: scripted(resp('done', [], { input: 500, output: 200 })),
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    })
      .system('')
      .build();

    let payload: Record<string, unknown> | undefined;
    agent.on('agentfootprint.cost.tick', (e) => {
      payload = e.payload as unknown as Record<string, unknown>;
    });
    await agent.run({ message: 'go' });

    expect(payload).toBeDefined();
    expect(payload!.tokensInput).toBe(500);
    expect(payload!.tokensOutput).toBe(200);
    expect(payload!.estimatedUsd).toBeCloseTo(0.011, 6);
    expect(payload!.cumulative).toEqual({
      tokensInput: 500,
      tokensOutput: 200,
      estimatedUsd: expect.any(Number),
    });
  });
});

// ── 4. Property — cumulative monotone & resets per run ──────────────

describe('cost — property', () => {
  it('cumulative.estimatedUsd is monotone non-decreasing across iterations', async () => {
    const agent = Agent.create({
      provider: scripted(
        resp('', [{ id: 'a', name: 'noop', args: {} }], { input: 10, output: 20 }),
        resp('', [{ id: 'b', name: 'noop', args: {} }], { input: 30, output: 40 }),
        resp('final', [], { input: 50, output: 60 }),
      ),
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const cumUsd: number[] = [];
    agent.on('agentfootprint.cost.tick', (e) => cumUsd.push(e.payload.cumulative.estimatedUsd));
    await agent.run({ message: 'go' });
    for (let i = 1; i < cumUsd.length; i++) {
      expect(cumUsd[i]).toBeGreaterThanOrEqual(cumUsd[i - 1]);
    }
  });

  it('cumulative resets to zero on each fresh run()', async () => {
    const agent = Agent.create({
      provider: () => resp('done', [], { input: 10, output: 5 }),
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    } as never)
      .system('')
      .build();
    void agent; // syntax placeholder — corrected below
    // Simpler: re-create provider per test
    const a2 = Agent.create({
      provider: {
        name: 'mock',
        complete: async () => resp('done', [], { input: 10, output: 5 }),
      },
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    })
      .system('')
      .build();

    const cumPerRun: number[] = [];
    let lastCum = 0;
    a2.on('agentfootprint.cost.tick', (e) => {
      lastCum = e.payload.cumulative.estimatedUsd;
    });

    for (let r = 0; r < 3; r++) {
      lastCum = -1;
      await a2.run({ message: `r${r}` });
      cumPerRun.push(lastCum);
    }
    // Each run: exactly 1 LLM call → cumulative equals per-call USD → identical across runs.
    for (let i = 1; i < cumPerRun.length; i++) {
      expect(cumPerRun[i]).toBeCloseTo(cumPerRun[0], 8);
    }
  });
});

// ── 5. Security — malformed pricing adapter handled gracefully ──────

describe('cost — security', () => {
  it('pricing adapter returning NaN produces NaN usd but does NOT crash', async () => {
    const brokenPricing: PricingTable = {
      name: 'broken',
      pricePerToken: () => Number.NaN,
    };
    const agent = Agent.create({
      provider: scripted(resp('done', [], { input: 10, output: 5 })),
      model: 'mock',
      pricingTable: brokenPricing,
    })
      .system('')
      .build();

    const ticks: number[] = [];
    agent.on('agentfootprint.cost.tick', (e) => ticks.push(e.payload.estimatedUsd));
    await agent.run({ message: 'go' });
    expect(ticks).toHaveLength(1);
    expect(Number.isNaN(ticks[0])).toBe(true);
  });

  it('cost.limit_hit never emits when costBudget is undefined', async () => {
    const agent = Agent.create({
      provider: scripted(resp('done', [], { input: 1_000_000, output: 1_000_000 })),
      model: 'mock',
      pricingTable: flatPricing(1, 1), // huge prices
      // no costBudget
    })
      .system('')
      .build();

    let limits = 0;
    agent.on('agentfootprint.cost.limit_hit', () => limits++);
    await agent.run({ message: 'go' });
    expect(limits).toBe(0);
  });
});

// ── 6. Performance — negligible overhead ────────────────────────────

describe('cost — performance', () => {
  it('adding a pricingTable adds negligible overhead to a single run', async () => {
    const baseLlm = LLMCall.create({
      provider: new MockProvider({ reply: 'ok' }),
      model: 'mock',
    })
      .system('')
      .build();
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) await baseLlm.run({ message: 'x' });
    const baseMs = performance.now() - t0;

    const pricedLlm = LLMCall.create({
      provider: new MockProvider({ reply: 'ok' }),
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    })
      .system('')
      .build();
    const t1 = performance.now();
    for (let i = 0; i < 30; i++) await pricedLlm.run({ message: 'x' });
    const withMs = performance.now() - t1;

    // Loose ceiling — cost accounting is ~constant-time per call
    expect(withMs).toBeLessThan(Math.max(baseMs * 3, 200));
  });
});

// ── 7. ROI — reused across many runs ────────────────────────────────

describe('cost — ROI', () => {
  it('20 sequential runs each produce exactly 1 tick with a fresh cumulative', async () => {
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async () => resp('done', [], { input: 10, output: 5 }),
      },
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    })
      .system('')
      .build();

    const ticksPerRun: number[] = [];
    let runTicks = 0;
    agent.on('agentfootprint.cost.tick', () => runTicks++);

    for (let i = 0; i < 20; i++) {
      runTicks = 0;
      await agent.run({ message: `r${i}` });
      ticksPerRun.push(runTicks);
    }

    expect(ticksPerRun.every((c) => c === 1)).toBe(true);
  });

  it('listener subscriptions do not accumulate across runs', async () => {
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async () => resp('done', [], { input: 10, output: 5 }),
      },
      model: 'mock',
      pricingTable: flatPricing(0.00001, 0.00003),
    })
      .system('')
      .build();

    const handler = vi.fn();
    agent.on('agentfootprint.cost.tick', handler);
    for (let i = 0; i < 5; i++) await agent.run({ message: `r${i}` });
    expect(handler).toHaveBeenCalledTimes(5);
  });
});
