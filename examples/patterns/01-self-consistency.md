---
name: SelfConsistency (Wang et al., 2022)
group: v2-patterns
guide: ../../README.md#patterns
defaultInput: What is the answer?
---

# SelfConsistency (Wang et al., 2022)

Sample N answers in parallel with higher temperature, then vote for
the majority. When a consumer extractor is supplied, vote on the
extracted string (e.g., the final numeric answer) rather than the
full chain-of-thought.

**Paper:** [arXiv:2203.11171](https://arxiv.org/abs/2203.11171)

## Built from

```
Parallel(N × LLMCall).mergeWithFn(majority-vote)
```

## Key API

```ts
selfConsistency({
  provider, model,
  systemPrompt: 'Solve. End with "Answer: <number>".',
  samples: 5,
  temperature: 0.8,
  extract: (r) => r.match(/Answer:\s*(.+)/)?.[1] ?? r,
});
```

## Tradeoffs

- **Samples vs cost** — every sample is a full LLM round trip; paper
  recommends 5-40.
- **Temperature matters** — low temperature reduces diversity, negating
  the whole point.
- **Extractor choice** — without one, you vote on the whole CoT and
  ties are the rule.
