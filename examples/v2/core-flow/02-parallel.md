---
name: Parallel — fan-out + merge (strict / tolerant)
group: v2-core-flow
guide: ../../README.md#core-flow
defaultInput: Can we ship feature X?
---

# Parallel — fan-out + merge

`Parallel` fans out to N branches concurrently, then merges their
outputs. Two modes:

- **Strict** (default via `.mergeWithFn` / `.mergeWithLLM`) — any branch
  failure rejects the whole composition with an aggregated error.
- **Tolerant** (`.mergeOutcomesWithFn`) — the merge fn receives the full
  `{ ok | error }` outcomes map and decides how to handle partial failure.

## When to use

- **Review committee** — N specialist agents vote on a decision.
- **Multiple retrievals** — query N knowledge sources, combine.
- **A/B sampling** — generate N variants, pick the best (combine with
  `selfConsistency` for majority voting).

## Key API

```ts
// Strict: loud failures
Parallel.create()
  .branch('a', runnerA)
  .branch('b', runnerB)
  .mergeWithFn((results) => `${results.a} | ${results.b}`)
  .build();

// Tolerant: handle partial failure
Parallel.create()
  .branch('a', runnerA)
  .branch('b', runnerB)
  .mergeOutcomesWithFn((outcomes) =>
    Object.entries(outcomes)
      .map(([id, o]) => o.ok ? `${id}: ${o.value}` : `${id}: ERR`)
      .join('\n'),
  )
  .build();
```

## What it emits

- `composition.enter / exit` with `kind: 'Parallel'`
- `composition.fork_start` — with the full branch id + name list
- `composition.merge_end` — with `strategy: 'fn' | 'llm'` and `mergedBranchCount`
- Every branch's events propagate up via the scope emit channel

## Related

- **[SelfConsistency pattern](../patterns/01-self-consistency.md)** —
  built on Parallel with a majority-vote merge
- **[Loop](./04-loop.md)** — iterate Parallel over N levels (Tree of Thoughts)
