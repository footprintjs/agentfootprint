---
name: Tree of Thoughts (Yao et al., 2023)
group: v2-patterns
guide: ../../README.md#patterns
defaultInput: "Solve: find path."
---

# Tree of Thoughts (Yao et al., 2023)

Beam-search reasoning: at each depth level, generate K candidate
thoughts in parallel, score each, keep the top `beamWidth` survivors,
and expand again. Returns the best thought at the deepest level.

**Paper:** [arXiv:2305.10601](https://arxiv.org/abs/2305.10601)

## Built from

```
Loop(depth × Parallel(K × LLMCall)).merge(score + prune-to-beamWidth)
```

Each iteration's merged output becomes the next iteration's input,
so successors see the surviving frontier.

## Key API

```ts
tot({
  provider, model,
  thoughtPrompt: 'Propose the next step.',
  depth: 3,
  branchingFactor: 5,
  beamWidth: 2,
  score: (thought) => scoreHeuristic(thought),
  temperature: 0.7,
});
```

## Variants

- **Greedy** (`beamWidth: 1`) — fast, sometimes misses good paths.
- **Wide beam** (`beamWidth: K`) — closer to BFS; higher cost.
- **DFS / backtracking** — NOT shipped in this variant (would need
  runtime-variable Parallel).

## Tradeoffs

- **LLM calls = depth × branchingFactor** per run. Can get expensive
  quickly.
- **Scorer matters most.** A weak scorer means beam-search pruning
  throws away useful paths. The paper suggests self-evaluation via
  the same LLM ("rate this thought 1-10").
