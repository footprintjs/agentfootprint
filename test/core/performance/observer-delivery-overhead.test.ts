/**
 * Performance — observer delivery tier (RFC-001 Block 10).
 *
 * Budgets in REFERENCE UNITS (same convention as run-latency.test.ts — a unit
 * of fixed CPU work timed in this process at this moment, so a busy runner
 * stretches the ceiling instead of failing the test):
 *   - DEFAULT ('inline', nobody opted in): byte-identical attach path, no
 *     deferred tier allocated — a 5-iteration run stays inside the same
 *     budget the pre-Block-10 suite enforced.
 *   - 'deferred' with no listeners: capture cost is bounded (≈ µs/event) —
 *     the same run must not blow the budget either.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';
import { expectWithinReferenceUnits, measureAsync } from '../../helpers/perf.js';

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

const BUDGET_UNITS = 1000; // 5-iteration ceiling from run-latency.test.ts

function fiveIterationAgent(observerDelivery?: 'deferred') {
  const responses: LLMResponse[] = [];
  for (let i = 0; i < 4; i++) {
    responses.push(resp('', [{ id: `t${i}`, name: 'noop', args: {} }]));
  }
  responses.push(resp('final'));
  return Agent.create({
    provider: scripted(...responses),
    model: 'mock',
    maxIterations: 10,
    ...(observerDelivery !== undefined && { observerDelivery }),
  })
    .system('')
    .tool({
      schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
      execute: () => 'ok',
    })
    .build();
}

describe('performance — observer delivery (RFC-001 Block 10)', () => {
  it(
    'default (inline, no opt-in): 5-iteration run stays within the historical budget',
    { timeout: 30_000, retry: 2 },
    async () => {
      const agent = fiveIterationAgent();
      const ms = await measureAsync(async () => {
        await agent.run({ message: 'go' });
      });
      await expectWithinReferenceUnits(
        ms,
        BUDGET_UNITS,
        'the default inline path must not cost more than the historical 5-iteration budget',
      );
      // No deferred tier allocated — the zero-cost discipline.
      expect(agent.getLastSnapshot()?.observerStats).toBeUndefined();
    },
  );

  it(
    "observerDelivery: 'deferred' (no listeners): capture overhead stays within the same budget",
    { timeout: 30_000, retry: 2 },
    async () => {
      const agent = fiveIterationAgent('deferred');
      const ms = await measureAsync(async () => {
        await agent.run({ message: 'go' });
      });
      await expectWithinReferenceUnits(
        ms,
        BUDGET_UNITS,
        'deferred capture with no listeners must stay inside the same budget',
      );
      // Tier allocated, nothing lost, nothing left behind.
      const stats = agent.getLastSnapshot()?.observerStats;
      expect(stats?.drops).toBe(0);
      expect(stats?.depth).toBe(0);
      expect(stats?.terminalStranded).toBe(0);
    },
  );
});
