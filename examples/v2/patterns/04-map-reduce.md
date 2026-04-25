---
name: MapReduce — split → summarize shards → combine
group: v2-patterns
guide: ../../README.md#patterns
defaultInput: |
  Paragraph 1: intro about cats.

  Paragraph 2: habits of cats.

  Paragraph 3: cats vs dogs.
---

# MapReduce

Classic long-document summarization: split the input into a fixed
number of shards, run N identical LLMCalls in parallel (one per
shard), then combine the outputs via a reducer function or an LLM.

**Origin:** Dean & Ghemawat, 2004 — applied to LLM context-window
constraints.

## Built from

```
Sequence(
  Split → Parallel(shardCount × LLMCall).reduce
)
```

Each branch is wrapped with a `ShardBranchRunner` that extracts its
index from a packed message — the consumer never sees this plumbing.

## Key API

```ts
mapReduce({
  provider, model,
  mapPrompt: 'Summarize this paragraph in one sentence.',
  shardCount: 3,
  split: (input, n) => input.split('\n\n').slice(0, n),
  reduce: {
    kind: 'fn',
    fn: (results) => Object.values(results).join('\n'),
  },
});
```

## Limitations

- **Fixed shard count.** Variable shard count would need a
  `DynamicParallel` primitive (not yet shipped).
- **Splitter must return `shardCount` strings.** Pad with `''` yourself
  if your data doesn't divide evenly.

## Tradeoffs

- **Shard size matters.** Too small = noisy summaries; too large =
  context window pressure.
- **Reducer choice.** `fn` is fast + deterministic; `llm` is smarter
  but costs another round trip.
