---
name: Reflection / Self-Refine (Madaan et al., 2023)
group: patterns
guide: ../../README.md#patterns
defaultInput: Write a poem about night.
---

# Reflection / Self-Refine (Madaan et al., 2023)

Iterative refinement: propose → critique → revise. The loop exits when
the critic emits a stop marker (default `DONE`) or when the iteration
budget is exhausted.

**Paper:** [arXiv:2303.17651](https://arxiv.org/abs/2303.17651)

## Built from

```
Loop(Sequence(Propose → Critique)).until(critic-emits-DONE)
```

## Key API

```ts
reflection({
  provider, model,
  proposerPrompt: 'Write or revise a short poem about night.',
  criticPrompt: 'Critique the poem. When good enough include "DONE".',
  maxIterations: 5,
  untilCritiqueContains: 'DONE',
});
```

## Tradeoffs

- **Proposer vs critic** — cheapest when both share a provider+model,
  but you can pass different system prompts to bias each persona.
- **Stop marker** — free-form; pick something unlikely to appear in
  natural critique text.
- **Budget** — always set `maxIterations`; without it the default is 3.
