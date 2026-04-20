---
name: reflexion — solve → critique → improve
group: patterns
guide: ../../docs/guides/patterns.md#reflexion--solve--critique--improve
defaultInput: Explain monads in plain English.
---

# reflexion — solve → critique → improve

> **Like:** writing a first draft, then handing it to an editor.

Three-stage self-review pass. A solver drafts an answer, a critic lists weaknesses, an improver integrates the critique. A single pass catches a surprising number of reasoning / code / plan errors.

## When to use

- One-shot answers that are usually in the right direction but have errors you can describe → reflexion finds and fixes them.
- Cheap critic + cheap improver while keeping a strong solver = often a win.

## Provider slots

Three: `solver`, `critic`, `improver`. The playground UI renders three pickers.

## Honesty

The shipped factory is **one critique pass** — closer to *Self-Refine* (Madaan et al. 2023) than full *Reflexion* (Shinn et al. 2023, NeurIPS). Real Reflexion has long-term reflection memory and a quality-gated loop. To approximate the loop, wrap the runner returned by `reflexion()` with `Conditional`.

## Related

- **[docs/guides/patterns.md](../../docs/guides/patterns.md#reflexion--solve--critique--improve)** — full pattern reference.
- **[Conditional concept](../concepts/06-conditional.md)** — for the loop wrapper.
