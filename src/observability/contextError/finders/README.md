**Fold** — six pluggable finders that fold a finished run's context pieces into
a ranked answer, each carrying its own evidence grade.

## What it reads / what it writes
- Reads the recorded run; the causal finders additionally RE-RUN the consumer's
  agent to test a counterfactual.
- Writes nothing into the original run. Rankings are fresh values.

## The one law here
Say what the answer is worth. `rankSuspects` is instant and free and says when
it cannot confidently pick; `removeAndRetry` is expensive and causal. Neither
may be spelled as the other.

## Files
- `types.ts` — the `Finder` contract and its grades.
- `rankSuspects.ts` — embedding-influence ranking (guessed).
- `removeAndRetry.ts`, `shrinkToCause.ts`, `testManyCombos.ts` — counterfactual
  finders (proven).
- `traceSteps.ts` — the step-level finder.
- `compareFinders.ts` — run several on one case, side by side.
- `index.ts`.
