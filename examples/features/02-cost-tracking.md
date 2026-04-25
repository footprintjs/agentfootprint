---
name: Cost tracking — pricingTable + costBudget
group: v2-features
guide: ../../README.md#features
defaultInput: do the thing
---

# Cost tracking — pricingTable + costBudget

Supply a `PricingTable` adapter to `LLMCall` or `Agent` to get typed
cost events:

- `cost.tick` — after every LLM response, with per-call tokens/USD +
  run-cumulative totals
- `cost.limit_hit` — ONCE when cumulative USD first crosses `costBudget`
  (`action: 'warn'`, library never auto-aborts)

Zero overhead when `pricingTable` is omitted.

## When to use

- **Per-run cost logging** — store the final `cumulative.estimatedUsd`
  against the customer/session.
- **Budget guardrails** — watch `cost.limit_hit` to redirect to a
  cheaper model or surface a UI warning.
- **Cost heatmaps** — accumulate `cost.tick` events across runs for
  which flows are expensive.

## Key API

```ts
const pricing: PricingTable = {
  name: 'anthropic',
  pricePerToken: (model, kind) => {
    // look up from your pricing sheet
    return /* USD per token */;
  },
};

const agent = Agent.create({ provider, model, pricingTable: pricing, costBudget: 1.00 })
  .system('…').build();

agent.on('agentfootprint.cost.tick', (e) => console.log(e.payload.cumulative.estimatedUsd));
agent.on('agentfootprint.cost.limit_hit', (e) => alert(`over budget: $${e.payload.actual}`));
```

## Scoping

- **Cumulative resets per run.** Budget is per-run, not lifetime. Track
  lifetime yourself by accumulating `cumulative.estimatedUsd` on every
  `turn_end` / `run_end`.
- **Fires once per crossing.** `cost.limit_hit` does NOT re-fire if
  cumulative drops below and then back above (it can't — cumulative is
  monotone).

## Related

- **[Observability](./04-observability.md)** — `.enable.logging` pipes
  cost events alongside stream events for debugging.
