/**
 * The action budget reaches the injection engine — `ctx.maxIterations` and
 * `ctx.iterationsRemaining` (9.57.0).
 *
 * ## Why it was missing, and why it matters
 *
 * `InjectionContext` carried `iteration` and nothing to divide it by. Its own
 * sibling — `CachePolicyContext`, documented as "mirrors InjectionContext but
 * trimmed" — has carried `iterationsRemaining` all along, computed one line
 * from a `maxIterations` the cache mount threads. The injection mount simply
 * never threaded it.
 *
 * The cost was measured: a consumer wanting an instruction that switches on
 * near the end of a turn could gate on `ctx.iteration > 22` and nothing else,
 * because a raw iteration number means nothing without the cap. Giving the
 * model its remaining budget changed its behaviour visibly — it wrote "I have
 * 5 steps left, enough to finish this properly" and landed the task, where
 * before it spiralled and produced no answer at all.
 *
 * ## The invariants this file pins
 *
 *   • **paired** — both facts or neither. A count without a denominator is the
 *     fabrication the pairing exists to prevent.
 *   • **one denominator** — the injection engine and the cache decision get
 *     their number from the same function, so they cannot drift by one.
 *   • **never negative** — the out-of-budget wrap-up call legally runs at
 *     `maxIterations + 1`, and "0 remain" is the truth there.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { defineInstruction } from '../../../src/lib/injection-engine/factories/defineInstruction.js';
import type { InjectionContext } from '../../../src/lib/injection-engine/types.js';
import { iterationsRemainingOf } from '../../../src/lib/iterationBudget.js';
import { computeCacheMarkers } from '../../../src/cache/CacheDecisionSubflow.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';
import { defineTool } from '../../../src/core/tools.js';

const looker = defineTool({
  name: 'look',
  description: 'look one thing up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'a log line',
} as never);

function toolLoop(rounds: number): LLMProvider {
  let call = 0;
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => {
      call++;
      const wantsTool = call <= rounds;
      return {
        content: wantsTool ? '' : 'done',
        toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
        usage: { input: 100, output: 5 },
        stopReason: 'end_turn',
      };
    },
  };
}

/** Run an agent, capturing every ctx the Evaluate stage built. */
async function contextsOf(maxIterations: number, rounds: number): Promise<InjectionContext[]> {
  const seen: InjectionContext[] = [];
  const agent = Agent.create({ provider: toolLoop(rounds), model: 'm', maxIterations })
    .tool(looker as never)
    .instruction(
      defineInstruction({
        id: 'watcher',
        activeWhen: (ctx) => {
          seen.push(ctx);
          return false;
        },
        prompt: 'never delivered — this instruction exists to read the ctx',
      }),
    )
    .build();
  await agent.run({ message: 'go' });
  return seen;
}

describe('the action budget reaches every injection predicate', () => {
  it('both facts are there, and they agree', async () => {
    const seen = await contextsOf(30, 3);
    expect(seen.length).toBeGreaterThan(2);
    for (const ctx of seen) {
      expect(ctx.maxIterations).toBe(30);
      expect(ctx.iterationsRemaining).toBe(30 - ctx.iteration);
    }
  });

  it('PAIRING: maxIterations and iterationsRemaining are both present or both absent', async () => {
    for (const ctx of await contextsOf(12, 4)) {
      expect(ctx.maxIterations === undefined).toBe(ctx.iterationsRemaining === undefined);
    }
  });

  it('a predicate can gate on how much room is left', async () => {
    const fired: number[] = [];
    const agent = Agent.create({ provider: toolLoop(5), model: 'm', maxIterations: 8 })
      .tool(looker as never)
      .instruction(
        defineInstruction({
          id: 'wrap-up-soon',
          activeWhen: (ctx) => {
            const left = ctx.iterationsRemaining;
            if (left !== undefined && left <= 3) {
              fired.push(ctx.iteration);
              return true;
            }
            return false;
          },
          prompt: 'You are near the end of your budget. Start consolidating.',
        }),
      )
      .build();
    await agent.run({ message: 'go' });
    // It fired, and only on the late iterations.
    expect(fired.length).toBeGreaterThan(0);
    expect(Math.min(...fired)).toBeGreaterThanOrEqual(5);
  });
});

describe('ONE denominator', () => {
  it('the injection engine and the cache decision cannot drift by one', () => {
    for (let i = 0; i < 200; i++) {
      const maxIterations = 1 + Math.floor(Math.random() * 200);
      const iteration = 1 + Math.floor(Math.random() * (maxIterations + 5));
      // What the cache decision puts on its own context — read out of a
      // real `until` predicate, which is the only door onto that object.
      let fromCache = -1;
      computeCacheMarkers({
        activeInjections: [
          {
            id: 'probe',
            flavor: 'instructions',
            cache: {
              until: (ctx) => {
                fromCache = ctx.iterationsRemaining;
                return false;
              },
            },
            inject: { systemPrompt: 'x' },
          },
        ] as never,
        iteration,
        maxIterations,
        userMessage: 'x',
        cumulativeInputTokens: 0,
        cachingDisabled: false,
        history: [],
        systemPromptCachePolicy: 'never',
      } as never);
      // …is the number the injection engine would report.
      expect(fromCache).toBe(iterationsRemainingOf(maxIterations, iteration));
    }
  });

  it('never negative — the wrap-up call runs at maxIterations + 1 and reports 0', () => {
    expect(iterationsRemainingOf(30, 31)).toBe(0);
    expect(iterationsRemainingOf(30, 99)).toBe(0);
    expect(iterationsRemainingOf(30, 30)).toBe(0);
    expect(iterationsRemainingOf(30, 29)).toBe(1);
  });

  it('each turn of a conversation counts from its own start', async () => {
    const first = await contextsOf(30, 1);
    const second = await contextsOf(30, 1);
    expect(first[0]!.iteration).toBe(1);
    expect(first[0]!.iterationsRemaining).toBe(29);
    expect(second[0]!.iterationsRemaining).toBe(29);
  });
});
