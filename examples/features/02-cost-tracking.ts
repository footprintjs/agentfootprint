/**
 * 08 — Cost tracking: pricingTable + costBudget.
 *
 * Supply a `PricingTable` adapter to `LLMCall` or `Agent`. After every
 * LLM response, a typed `agentfootprint.cost.tick` event fires with
 * per-call and cumulative USD. When `costBudget` is also set, a
 * one-shot `cost.limit_hit` fires the FIRST time cumulative crosses
 * the budget.
 *
 * A bare number WARNS and the run carries on — consumers decide what to do.
 * Since 8.14.0 `costBudget: { usd, onExceed: 'halt' }` makes it STOP instead,
 * at the next iteration boundary (never mid-call), and `agent.stoppedEarly()`
 * says so afterwards. Both halves are shown below.
 *
 * Run:  npx tsx examples/08-cost-tracking.ts
 */

import { Agent, type PricingTable } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/02-cost-tracking',
  title: 'Cost tracking — pricingTable + costBudget',
  group: 'features',
  description: 'Add a PricingTable adapter to get cost.tick after every LLM call; add costBudget to get a one-shot cost.limit_hit on threshold crossing.',
  defaultInput: 'do the thing',
  providerSlots: ['default'],
  tags: ['feature', 'cost', 'budget', 'pricing'],
};


export async function run(input: string, provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Flat-rate pricing for demo. Real pricing tables look up by model + kind.
  const pricing: PricingTable = {
    name: 'demo-pricing',
    pricePerToken: (_model, kind) => {
      if (kind === 'input') return 0.00001; // $0.01 / 1k input
      if (kind === 'output') return 0.00003; // $0.03 / 1k output
      return 0;
    },
  };

  // #region cost-tracking
  // 'feature' kind drives the smart tool-call flow. Cost ticks fire
  // automatically off the per-iteration usage MockProvider estimates
  // (chars/4) — sufficient to demo the budget crossing.
  const agent = Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'demo-sonnet',
    pricingTable: pricing,
    costBudget: 0.0001, // trip the warning
  })
    .system('')
    .tool({
      schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
      execute: () => 'ok',
    })
    .build();

  agent.on('agentfootprint.cost.tick', (e) => {
    const p = e.payload;
    console.log(
      `[tick] +$${p.estimatedUsd.toFixed(6)} — cumulative $${p.cumulative.estimatedUsd.toFixed(6)}`,
    );
  });
  // #endregion cost-tracking
  agent.on('agentfootprint.cost.limit_hit', (e) => {
    // `action` is the honest word for what happened NEXT: 'warn' under a bare
    // number (the run carried on), 'abort' under `onExceed: 'halt'`.
    console.log(`⚠  budget ${e.payload.limit} crossed — actual ${e.payload.actual} (${e.payload.action})`);
  });

  const out = await agent.run({ message: 'do the thing' });
  console.log('\nResult:', out);
  // A warn-only budget never cuts a turn short, so this stays undefined.
  console.log('stoppedEarly:', agent.stoppedEarly() ?? 'no — the run finished on its own');

  // #region cost-halt
  // The same budget, made a STOP. Halting ends the loop at the next iteration
  // boundary — the same boundary maxIterations uses — so the call that crossed
  // the budget still completes, is still billed and is still recorded. What
  // halting decides is that there will not be another one.
  const halting = Agent.create({
    provider: provider ?? exampleProvider('feature'),
    model: 'demo-sonnet',
    pricingTable: pricing,
    costBudget: { usd: 0.00001, onExceed: 'halt' }, // crossed on the FIRST call
  })
    .system('')
    .tool({
      schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
      execute: () => 'ok',
    })
    .build();

  const halted = await halting.run({ message: 'do the thing' });
  const cut = halting.stoppedEarly();
  if (cut) {
    // `AgentOutput` is a bare string, so the reason cannot ride the answer. It
    // rides committed state instead, where it is provable after the run rather
    // than only observable by whoever happened to be subscribed.
    console.log(
      `\nhalted at iteration ${cut.iteration} (${cut.reason}); ` +
        `${cut.pendingToolCalls} tool call(s) never ran; ` +
        `answer was ${cut.answerWasEmpty ? 'EMPTY' : 'partial but real'}`,
    );
  } else {
    console.log('\nthis run finished before the budget was crossed:', halted);
  }
  // #endregion cost-halt

  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
