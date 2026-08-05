/**
 * Performance tests — primitive run latency.
 *
 * The budget is expressed in REFERENCE UNITS, not milliseconds: a unit of
 * fixed CPU work timed in this same process moments before the assertion (see
 * test/helpers/perf.ts). A busy runner makes the unit bigger and the ceiling
 * bigger with it, so what is left is the thing we actually care about —
 * accidental O(n²) scope walks, unbounded recorder fan-out, synchronous
 * blocking in the hot path. Those cost orders of magnitude, not jitter.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';
import { expectWithinReferenceUnits, expectWithinTimes, measureAsync } from '../../helpers/perf.js';

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

// Shared ceiling, in reference units (≈1ms each on a quiet machine, more on
// a busy one). A regression of the kind this guards against costs hundreds of
// units; ordinary noise costs a handful.
const BUDGET_UNITS = 500;

describe('performance — single LLMCall run', () => {
  it(
    'costs no more than the shared budget for a no-op mock provider',
    { timeout: 30_000, retry: 2 },
    async () => {
      const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
        .system('')
        .build();

      await expectWithinReferenceUnits(
        async () => {
          await llm.run({ message: 'hi' });
        },
        BUDGET_UNITS,
        'a no-op LLMCall run must stay cheap',
      );
    },
  );
});

describe('performance — single Agent run (no tools)', () => {
  it(
    'costs no more than the shared budget with one LLM turn',
    { timeout: 30_000, retry: 2 },
    async () => {
      const agent = Agent.create({
        provider: new MockProvider({ reply: 'done' }),
        model: 'mock',
      })
        .system('')
        .build();

      await expectWithinReferenceUnits(
        async () => {
          await agent.run({ message: 'hi' });
        },
        BUDGET_UNITS,
        'a one-turn Agent run must stay cheap',
      );
    },
  );
});

describe('performance — Agent with ReAct iterations', () => {
  it(
    '5-iteration run costs no more than twice the single-run budget',
    { timeout: 30_000, retry: 2 },
    async () => {
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

      const ms = await measureAsync(async () => {
        await agent.run({ message: 'go' });
      });

      await expectWithinReferenceUnits(
        ms,
        BUDGET_UNITS * 2,
        'five ReAct iterations must not cost more than twice a single run',
      );
    },
  );
});

describe('performance — event dispatch overhead is bounded', () => {
  it(
    'attaching 10 listeners does not slow a single run by >2x baseline',
    { timeout: 30_000, retry: 2 },
    async () => {
      // Baseline: no listeners.
      const baseLlm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
        .system('')
        .build();

      // With 10 listeners.
      const inst = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
        .system('')
        .build();
      for (let i = 0; i < 10; i++) {
        inst.on('agentfootprint.stream.llm_start', () => {});
        inst.on('agentfootprint.stream.llm_end', () => {});
      }
      // Comparative on purpose: the SAME twenty runs with and without
      // listeners, sampled alternately on this machine, so load cancels. 4× is
      // the headroom for dispatch bookkeeping; an O(n²) fan-out over listeners
      // would land far beyond it.
      await expectWithinTimes({
        baseline: async () => {
          for (let i = 0; i < 8; i++) await baseLlm.run({ message: 'x' });
        },
        subject: async () => {
          for (let i = 0; i < 8; i++) await inst.run({ message: 'x' });
        },
        times: 4,
        why: '10 listeners must not multiply run cost',
      });
    },
  );
});
