---
name: Sequence — linear pipeline
group: core-flow
guide: ../../README.md#core-flow
defaultInput: my invoice has an error
---

# Sequence — linear pipeline

`Sequence` chains runners: step A → step B → step C. Each step's string
output becomes the next step's `{ message }` input. Use `.pipeVia(fn)`
to customize the transformation between two specific steps.

## When to use

- **Classify → route → respond** — the textbook triage flow.
- **Planner → executor** — first step produces a plan, second step executes.
- **Pre-process → LLM → post-process** — validation, LLM call, extraction.

## Key API

```ts
const pipeline = Sequence.create()
  .step('classify', classifier)
  .pipeVia((label) => ({ message: `Intent: ${label}` }))
  .step('respond', responder)
  .build();
```

- `.step(id, runner)` — adds a step; duplicate ids throw at build time
- `.pipeVia(fn)` — transforms the prev step's string into the next step's input; single-use (consumed by the next `.step()`)

## What it emits

- `composition.enter / exit` with `kind: 'Sequence'`
- Every event from every inner step (LLMCall / Agent / nested compositions)

## Related

- **[Parallel](./02-parallel.md)** — fan-out alternative
- **[Conditional](./03-conditional.md)** — branching after a classify step
