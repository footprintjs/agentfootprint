---
name: treeOfThoughts — N thinkers → judge
group: patterns
guide: ../../docs/guides/patterns.md#treeofthoughts--n-parallel-thinkers--judge
defaultInput: How should we evaluate this design?
---

# treeOfThoughts — N parallel thinkers → judge

> **Like:** a brainstorm — three people propose, one picks the best.

Fan out N parallel attempts (typically same prompt + temperature variance), concatenate them as labeled candidates, hand to a judge runner that picks or synthesizes the best.

## When to use

- One-shot answers are often in the **wrong direction** entirely (multiple reasonable paths exist) → ToT generates alternatives, judge picks best.
- The merge step is a **pure function** (labeled concat) — only the thinkers + judge are LLM calls. Cost is `branches × thinker + 1 × judge`.

## Provider slots

Two: `thinker` (used for all N branches) and `judge`. Caps at 10 branches.

## Honesty

The shipped factory is N-parallel-then-judge — closer to *Self-Consistency* (Wang et al. 2022) than full *Tree of Thoughts* (Yao et al. 2023, NeurIPS). Real ToT does **tree search** over thought states (BFS/DFS with backtracking).

## Related

- **[docs/guides/patterns.md](../../docs/guides/patterns.md#treeofthoughts--n-parallel-thinkers--judge)** — full pattern reference.
- **[Parallel concept](../concepts/05-parallel.md)** — what `treeOfThoughts` is built on.
