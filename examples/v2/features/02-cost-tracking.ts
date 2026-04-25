/**
 * 08 — Cost tracking: pricingTable + costBudget.
 *
 * Supply a `PricingTable` adapter to `LLMCall` or `Agent`. After every
 * LLM response, a typed `agentfootprint.cost.tick` event fires with
 * per-call and cumulative USD. When `costBudget` is also set, a
 * one-shot `cost.limit_hit` fires the FIRST time cumulative crosses
 * the budget. The library never auto-aborts — consumers decide.
 *
 * Run:  npx tsx examples/v2/08-cost-tracking.ts
 */

import { Agent, type LLMProvider, type PricingTable } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'v2/features/02-cost-tracking',
  title: 'Cost tracking — pricingTable + costBudget',
  group: 'v2-features',
  description: 'Add a PricingTable adapter to get cost.tick after every LLM call; add costBudget to get a one-shot cost.limit_hit on threshold crossing.',
  defaultInput: 'do the thing',
  providerSlots: ['default'],
  tags: ['v2', 'feature', 'cost', 'budget', 'pricing'],
};


export async function run(input: string, _provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Flat-rate pricing for demo. Real pricing tables look up by model + kind.
  const pricing: PricingTable = {
    name: 'demo-pricing',
    pricePerToken: (_model, kind) => {
      if (kind === 'input') return 0.00001; // $0.01 / 1k input
      if (kind === 'output') return 0.00003; // $0.03 / 1k output
      return 0;
    },
  };

  const provider: LLMProvider = {
    name: 'mock',
    complete: async (req) => {
      const hadTool = req.messages.some((m) => m.role === 'tool');
      if (hadTool) {
        return {
          content: 'Done.',
          toolCalls: [],
          usage: { input: 150, output: 20 },
          stopReason: 'stop',
        };
      }
      return {
        content: 'thinking',
        toolCalls: [{ id: 't', name: 'noop', args: {} }],
        usage: { input: 100, output: 10 },
        stopReason: 'tool_use',
      };
    },
  };

  const agent = Agent.create({
    provider,
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
  agent.on('agentfootprint.cost.limit_hit', (e) => {
    console.log(`⚠  budget ${e.payload.limit} crossed — actual ${e.payload.actual} (${e.payload.action})`);
  });

  const out = await agent.run({ message: 'do the thing' });
  console.log('\nResult:', out);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
