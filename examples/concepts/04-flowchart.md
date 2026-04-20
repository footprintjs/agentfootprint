---
name: FlowChart — sequential pipeline
group: concepts
guide: ../../docs/guides/concepts.md#flowchart
defaultInput: I was overcharged $50 on my bill.
---

# FlowChart — sequential pipeline

> **Like:** an assembly line — each station does one thing, output of one feeds the next.

Compose multiple runners into a sequential pipeline. Each runner sees the previous one's output as its input.

## When to use

- "Research, then write" pipelines where order matters.
- Approval flows where each step gates the next.
- Any time you want to **decompose** a complex task into small, independently-testable runners.

## What you'll see in the trace

Each stage appears as a labeled subflow:

```
Entered FlowChart.
  ├─ Entered classify (subflow). → "Category: billing"
  ├─ Entered analyze  (subflow). → "Analysis: Customer needs refund."
  └─ Entered respond  (subflow). → "Dear customer, we have processed your refund of $50."
```

The shared `agentObservability()` recorder accumulates token + cost stats **across all stages** — one bill for the whole pipeline.

## Key API

- `FlowChart.create()` — empty pipeline builder.
- `.agent(id, name, runner, options?)` — append a runner. `options` supports `inputMapper`/`outputMapper` for non-trivial data flow.

## Failure modes

- Any stage throws → entire pipeline fails (no partial-success). Wrap individual runners with `withRetry`/`withFallback` if upstream stages must survive downstream failures.
- Latency = sum of all stages — sequential, no parallelism. Use **[Parallel](./05-parallel.md)** when stages are independent.

## Related concepts

- **[Parallel](./05-parallel.md)** — fan-out instead of sequential.
- **[Conditional](./06-conditional.md)** — branch instead of always-all-stages.
- **[Patterns: planExecute](../patterns/02-plan-execute.md)** — a named two-stage FlowChart pattern.
