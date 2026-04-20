---
name: planExecute — planner → executor
group: patterns
guide: ../../docs/guides/patterns.md#planexecute--planner--executor
defaultInput: Write a launch announcement for our new feature.
---

# planExecute — planner → executor

> **Like:** writing the outline before writing the essay.

Two runners chained sequentially. The planner takes the request and produces a plan; the executor carries that plan out.

## When to use

- Cheap planner + capable executor (e.g. `haiku` plans, `sonnet` executes) — saves tokens.
- Plan visible in the narrative **before** any tool fires — reviewers can gate execution.
- Tasks with structure that benefits from upfront decomposition.

## Provider slots (multi-provider example)

This example exposes **two** provider slots: `planner` and `executor`. The playground UI renders one picker per slot.

## Background

Related to *Plan-and-Solve* (Wang et al. 2023, ACL), *ReWOO* (Xu et al. 2023), and HuggingGPT (Shen et al. 2023). Shipped factory is the simplest two-stage form — no plan validation, no replanning.

## Related

- **[docs/guides/patterns.md](../../docs/guides/patterns.md#planexecute--planner--executor)** — full pattern reference.
- **[FlowChart concept](../concepts/04-flowchart.md)** — what `planExecute` is built on.
