---
name: Conditional — deterministic triage
group: concepts
guide: ../../docs/guides/concepts.md#conditional
defaultInput: I want a refund for order #42
---

# Conditional — deterministic triage

> **Like:** a triage nurse — look at the request, route to the right specialist.

`if/else` between runners. Predicates run in `.when()` order, first match wins; no match runs `.otherwise()`. The decision is **deterministic** — no LLM in the routing step.

## When to use

- Static classification — refunds → refund agent, everything else → general support.
- When the routing rule is a regex / keyword / size check — no need to spend an LLM call to decide.
- As a top-level dispatcher in front of more expensive runners.

## What you'll see in the trace

The narrative shows which branch was chosen and why:

```
Entered Conditional[triage].
  decided 'refund' — predicate 0 matched
  Entered Refund Specialist (subflow).
    → "Refund initiated. Confirmation #R-00123."
Entered Finalize.
```

`decide()` evidence is captured on the FlowRecorder event so you can audit "why did we take this branch" later.

## Key API

- `Conditional.create({ name? })` — builder.
- `.when(predicate, runner)` — predicate is `(input, state) => boolean`.
- `.otherwise(runner)` — required default branch.

## Difference from `Agent.route()`

- `Conditional` is **top-level** — pick one runner, return its result.
- `Agent.route()` branches **inside** a ReAct loop — based on what the agent's LLM said this turn.

## Failure modes

- All predicates miss AND no `.otherwise()` → build error.
- Predicate throws → silent miss (intentional fail-open). Enable dev mode (`enableDevMode()`) to surface warnings on suspicious predicates.

## Related concepts

- **[Swarm](./07-swarm.md)** — same routing intent but driven by an LLM orchestrator.
- **[runtime-features/custom-route](../runtime-features/custom-route/01-custom-route.md)** — branching inside an Agent loop.
