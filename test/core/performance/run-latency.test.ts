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

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMResponse } from '../../../src/provider-contract/types.js';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
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

describe('LLMCall event dispatch work', () => {
  it.each([
    [1, 0],
    [8, 0],
    [1, 1],
    [8, 1],
    [1, 10],
    [8, 10],
  ])(
    'dispatches once per event over %i runs with %i listeners per event',
    async (runs, listenerCount) => {
      const provider = new MockProvider({ reply: 'ok' });
      const complete = vi.spyOn(provider, 'complete');
      const llm = LLMCall.create({ provider, model: 'mock' }).system('').build();
      const eventTypes = [
        'agentfootprint.stream.llm_start',
        'agentfootprint.stream.llm_end',
      ] as const;
      const listeners = eventTypes.map((type) =>
        Array.from({ length: listenerCount }, () => {
          const listener = vi.fn();
          llm.on(type, listener);
          return listener;
        }),
      );

      // Count real entries to the dispatcher, independently of listener delivery.
      const dispatch = vi.spyOn(EventDispatcher.prototype, 'dispatch');
      const dispatchServed = vi.spyOn(EventDispatcher.prototype, 'dispatchServed');
      try {
        for (let run = 0; run < runs; run++) {
          expect(await llm.run({ message: 'x' })).toBe('ok');
        }

        expect(complete).toHaveBeenCalledTimes(runs);
        const dispatched = [...dispatch.mock.calls, ...dispatchServed.mock.calls];
        for (const [index, type] of eventTypes.entries()) {
          const entries = dispatched.filter(([event]) => event.type === type);
          expect(entries, type).toHaveLength(listenerCount === 0 ? 0 : runs);
          for (const listener of listeners[index]) {
            expect(listener, type).toHaveBeenCalledTimes(runs);
          }
        }
      } finally {
        dispatch.mockRestore();
        dispatchServed.mockRestore();
      }
    },
  );
});
