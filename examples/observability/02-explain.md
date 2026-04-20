---
name: ExplainRecorder — grounding evidence
group: observability
guide: ../../docs/guides/recorders.md#explainrecorder
defaultInput: Check order ORD-1003
---

# ExplainRecorder — grounding evidence

The differentiator. `ExplainRecorder` collects **per-iteration grounding evidence** during traversal: what context the LLM had, what tools it chose to call, what those tools returned, what the LLM claimed. An evaluator can then verify each claim against its sources without re-running the agent.

This is what `obs.explain()` returns under the hood.

## Why it matters

Most observability stacks log events. `ExplainRecorder` produces **evidence** — a connected per-iteration shape where every LLM claim can be traced back to the tool result that supports it. The shipping README pitches this as the differentiator vs other agent frameworks.

## When to use

- Hallucination detection — compare `report.claims` against `report.sources`.
- Audit trails for regulated domains (finance, healthcare).
- Building a follow-up LLM that explains "why did the agent say X" using the structured evidence.

## What you'll see

After an agent looks up an order and answers:

```
{
  iterations: 2,
  sources:    1,   // 1 tool result
  decisions:  1,   // 1 tool call
  claims:     1,   // 1 LLM response
  summary:    'Looked up ORD-1003; reported shipped status with $299 total.',
  firstSource: { toolName: 'lookup_order', args: { orderId: 'ORD-1003' }, result: '{...}' },
  firstClaim:  'Your order ORD-1003 has shipped. Total: $299.',
}
```

## Key API

- `new ExplainRecorder()` — direct construction; or use `agentObservability().explain()` for the bundled version.
- `recorder.explain()` returns `{ iterations, sources, claims, decisions, context, summary }`.
- Each `iteration` carries `runtimeStageId` for cross-referencing with the commit log.

## Related

- [recorders guide](../../docs/guides/recorders.md#explainrecorder) — full structure of the per-iteration data.
- [01-recorders](./01-recorders.md) — the bundled `agentObservability()`.
