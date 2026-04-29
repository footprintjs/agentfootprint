---
name: Conditional — predicate routing
group: core-flow
guide: ../../README.md#core-flow
defaultInput: Site is DOWN help!
---

# Conditional — predicate routing

`Conditional` picks exactly one runner based on predicate order.
First matching `.when(id, predicate, runner)` wins. `.otherwise(id, runner)`
is mandatory — every Conditional must declare a fallback.

## When to use

- **Triage** — urgent vs normal, paid vs free tier, known language vs
  unknown.
- **Pattern gating** — route tool-heavy queries to an Agent, simple
  questions to a single LLMCall.
- **A/B selector** — consumer predicate chooses which variant to run.

## Key API

```ts
const triage = Conditional.create()
  .when('urgent', (i) => /urgent|down/i.test(i.message), urgentAgent)
  .when('billing', (i) => /bill|invoice/i.test(i.message), billingAgent)
  .otherwise('general', generalAgent)
  .build();
```

## What it emits

- `composition.enter / exit` with `kind: 'Conditional'`
- `composition.route_decided` — with `chosen`, `rationale`, and a
  human-readable explanation ("predicate for 'urgent' returned true")

## Related

- **[Sequence](./01-sequence.md)** — common pattern: `Sequence(classifier → Conditional(response))`
- **[Swarm pattern](../patterns/06-swarm.md)** — uses Conditional inside Loop for handoff
