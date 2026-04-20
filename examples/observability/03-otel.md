---
name: Cost + Token + Turn recorders
group: observability
guide: ../../docs/guides/recorders.md
defaultInput: What is footprintjs?
---

# Cost + Token + Turn recorders

The OTel-style metrics bundle. Three recorders combined: `CostRecorder` (USD per-call from a pricing table), `TokenRecorder` (per-LLM-call usage), `TurnRecorder` (turn lifecycle). In production, these values typically become OTel span attributes via `OTelRecorder`.

## When to use

- Dashboard metrics — total cost, cumulative tokens, turn count.
- Alerting on cost or rate budgets.
- Pre-step before exporting to OTel/Datadog/CloudWatch (see runtime-feature notes in `recorders.md`).

## What you'll see

```
{
  turns:     1,
  llmCalls:  2,
  totalCost: 0,
}
```

(0 cost because the example uses `mock()` — swap in `anthropic(...)` and the cost recorder bills per token using its pricing table.)

## Key API

- `new CostRecorder({ pricingTable: { 'model-id': { input, output } } })`.
- `new TokenRecorder()`.
- `new TurnRecorder()`.
- All three attach via `.recorder(...)` independently or via `agentObservability()` bundle.

## Cost note

`CostRecorder` skips models not in its pricing table (returns $0, no error). Keep the table updated when you adopt a new model.

## Related

- [recorders guide](../../docs/guides/recorders.md) — every recorder.
- [01-recorders](./01-recorders.md) — bundled version (`agentObservability()`).
