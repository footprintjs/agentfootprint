---
name: agentObservability() — one-call bundle
group: observability
guide: ../../docs/guides/recorders.md
defaultInput: What is the answer?
---

# agentObservability() — one-call bundle

The 80% observability case in one call. `agentObservability()` bundles `TokenRecorder + ToolUsageRecorder + CostRecorder + ExplainRecorder` and exposes them via four query methods: `.tokens()`, `.tools()`, `.cost()`, `.explain()`.

## When to use

- Default observability for any new agent — start here, swap to individual recorders only if you need finer control.
- Dashboards / health checks where you want all four metrics in one shot.
- Wiring observability into the playground or a debugging UI.

## What you'll see

After one agent run that calls `lookup` once and produces a final answer:

```
{
  tokens:  { totalCalls: 2, totalInputTokens: ..., totalOutputTokens: ..., calls: [...] },
  tools:   { totalCalls: 1, byTool: { lookup: { calls: 1, errors: 0, ... } } },
  cost:    0,        // mock provider has no cost
  explain: { iterations: [...], sources: [...], claims: [...], decisions: [...], summary: '...' },
}
```

## Key API

- `agentObservability()` — returns a `CompositeRecorder` with the 4 query methods.
- `.recorder(obs)` on any builder.
- All 4 sub-recorders also available individually for direct access.

## Related

- [recorders guide](../../docs/guides/recorders.md) — every recorder type, when to pick one over the bundle.
- [02-explain](./02-explain.md) — drill into the grounding evidence side.
- [03-otel](./03-otel.md) — Cost + Token + Turn for OTel-style metrics.
