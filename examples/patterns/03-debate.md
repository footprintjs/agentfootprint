---
name: Multi-Agent Debate (Du et al., 2023)
group: patterns
guide: ../../README.md#patterns
defaultInput: Should we ship feature X?
---

# Multi-Agent Debate (Du et al., 2023)

A proposer and a critic alternate over N rounds, each seeing the prior
exchange. After N rounds, a judge renders the verdict.

**Paper:** [arXiv:2305.14325](https://arxiv.org/abs/2305.14325)

## Built from

```
Sequence(
  Loop(rounds × Sequence(Proposer → Critic))
  → Judge
)
```

## Key API

```ts
debate({
  provider, model,
  proposerPrompt: 'Argue FOR the proposal.',
  criticPrompt: 'Argue AGAINST the proposal.',
  judgePrompt: 'You are an impartial judge. Render the verdict.',
  rounds: 2,
});
```

## Tradeoffs

- **Rounds vs latency** — each round is 2 LLM calls. Judge adds 1 more.
  `rounds: 2` = 5 LLM calls minimum.
- **Personas** — stronger persona prompts make the debate more useful;
  weak personas converge too quickly.
