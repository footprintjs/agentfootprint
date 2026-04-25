---
name: Loop — iteration with mandatory budget
group: v2-core-flow
guide: ../../README.md#core-flow
defaultInput: initial idea
---

# Loop — iteration with mandatory budget

`Loop` iterates a body runner. At least one budget axis must fire:

- `.times(n)` — iteration count (default 10, hard ceiling 500)
- `.forAtMost(ms)` — wall-clock limit
- `.until(guard)` — semantic exit predicate

Whichever trips first wins. Consumer can combine them (e.g., "up to 5
times OR until the critic says DONE").

## When to use

- **Refine / retry** — polish a draft, retry on failure, progressively
  narrow a search.
- **ReAct-style agent loops** — but prefer `Agent` which already does
  this; use `Loop` for non-ReAct iteration shapes.
- **Repeat until converged** — simulation, optimization.

## Key API

```ts
Loop.create()
  .repeat(body)
  .times(5)
  .forAtMost(30_000)
  .until(({ iteration, latestOutput, startMs }) => latestOutput.includes('DONE'))
  .build();
```

## What it emits

- `composition.enter / exit`
- `composition.iteration_start / iteration_exit` per iteration; the exit
  event carries `reason: 'body_complete' | 'budget' | 'guard_false' | 'break'`

## Related

- **[Reflection pattern](../patterns/02-reflection.md)** — Loop over a
  Sequence(Propose → Critique) body
- **[ToT pattern](../patterns/05-tot.md)** — Loop over a Parallel(N
  thoughts) body with beam-search pruning
