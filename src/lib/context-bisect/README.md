**Fold** — what may be claimed about WHY a run went wrong: ranked suspects
derived from the trace's causal DAG, with the claim tier spelled out on every
type.

## What it reads / what it writes
- Reads a recorded run: the commit log, the slice, and (for the causal tier) the
  consumer's own runner.
- Writes nothing into a run. Note the one thing the role name hides:
  `rerun.ts` and `ablation.ts` RE-EXECUTE the consumer's runner to produce a
  counterfactual, so one arm of this fold drives a new walk.

## The one law here
The claim tier travels with the number. Embedding scores are proxies; only
ablation verdicts are causal; slice completeness is bounded by what tracking
recorded, and says so.

## Files
- `localize.ts`, `bisect.ts`, `rankSuspects` callers — the ranked suspect set.
- `ablation.ts`, `rerun.ts`, `restoration.ts` — the counterfactual arms.
- `missingContext.ts` — context that was available and never reached the model.
- `trajectory.ts`, `loop-recall.ts`, `walk-to-root.ts` — per-loop framing.
- `variable-recall.ts`, `sliceToBacktrackTrace.ts`, `toBacktrackTrace.ts`,
  `variableToBacktrackTrace.ts` — serializations for a viewer.
- `cost.ts`, `llmEdgeWeigher.ts`, `types.ts`, `index.ts`.
- `arms/` — substitution counterfactuals, kept separate on purpose.
