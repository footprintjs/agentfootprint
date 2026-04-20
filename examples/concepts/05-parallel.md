---
name: Parallel — fan-out and merge
group: concepts
guide: ../../docs/guides/concepts.md#parallel
defaultInput: Build an internal LLM proxy with rate-limiting.
---

# Parallel — fan-out and merge

> **Like:** asking three colleagues the same question, then combining their answers.

Run N runners concurrently, then merge their results — either via an LLM merge call (`mergeWithLLM`) or via a custom pure function (`merge(fn)`). Capped at 10 branches as a safety guard.

## When to use

- **Multi-perspective review** — ethics + cost + technical reviewers all look at the same proposal in parallel.
- **Multi-source retrieval** — query 3 different knowledge bases simultaneously, then synthesize.
- Any time the work is naturally parallelizable and the merge step is cheaper than serializing.

## What you'll see in the trace

Three branches fire simultaneously, then a merge:

```
Entered Parallel.
  ├─ [parallel] Entered ethics  (subflow). → "minimal PII risk..."
  ├─ [parallel] Entered cost    (subflow). → "~$200/month..."
  └─ [parallel] Entered tech    (subflow). → "2-week estimate..."
Entered Merge. → LLM synthesis call
Entered Finalize.
```

`result.branches` carries each branch's `{ id, status, content, error? }` — so failed branches are visible.

## Key API

- `Parallel.create({ provider, name? })` — builder.
- `.agent(id, runner, description)` — add a parallel branch.
- `.mergeWithLLM(prompt)` — reduce via an LLM call (one extra LLM round-trip).
- `.merge(fn)` — reduce via a pure function (no LLM cost; deterministic).

## Failure modes

- One branch throws → surfaces as `{ status: 'rejected', error }`; the LLM merge still runs over the remaining branches.
- Cost scales with N — at 5 parallel branches you pay 5× the work + 1 merge call.
- Cap at 10 branches by default.

## Related concepts

- **[FlowChart](./04-flowchart.md)** — sequential alternative.
- **[Patterns: treeOfThoughts](../patterns/04-tree-of-thoughts.md)** — N parallel thinkers + judge, built on Parallel.
- **[Patterns: mapReduce](../patterns/05-map-reduce.md)** — pre-bound mappers, also built on Parallel.
