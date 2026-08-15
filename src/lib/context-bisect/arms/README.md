# `arms/` — strategy comparison (substitution counterfactuals)

`context-bisect` could already ask **"did removing this cause the bad answer?"**
It could not ask **"does scorer A answer differently from scorer B?"** — and
those are different operations, not one operation with a different argument.

## Ablation is removal. This is substitution.

Removing a tool leaves an agent that is strictly *smaller*. "Removing" a
retrieval strategy leaves nothing coherent: no retrieval at all, or the library
default, are two different experiments and neither is what *topK vs re-rank*
means. So `AblationSpec` did not grow a fifth arm. Three concrete costs decided
it, each a place where a shared union would have produced a confident verdict
for an incoherent comparison:

| consumer of `AblationSpec` | what a `'strategy'` arm would have done |
|---|---|
| `bisectCulprits` | ddmin searches SUBSETS of removals. It would have returned "minimal culprit set = {scorer swap}" — an arm is an alternative configuration, not a culprit. |
| `rerunWithoutSources` | reports its specs under a field literally named `removed`. |
| `applyAblations` | returns filtered `{tools, injections, memoryEntries}`. A substitution is not a filter of those. |

What IS shared is the statistics: `AblationRunStats`, `similarityStats`,
`costStatsFrom`, `resolveSamples`, `probeFlipped`, `defaultOutcomeComparator`.
Nothing in `ablation.ts`, `bisect.ts`, `rerun.ts` or `cost.ts` changed.

An arm may still *contain* removals (`StrategyArm.ablations`), applied by the
unchanged `applyAblations` through `applyArm`. Composition, not union.

## The library declares and verifies; it cannot apply

For a removal the library performs the intervention. For a substitution it
cannot — construction is the consumer's code. What it can do is check: 9.41.0's
`agentfootprint.agent.run_configured` names the strategies a run used, and
`ArmFacets` is deliberately that same vocabulary. Hand each run's manifest back
through `ArmRunResult.manifest` and an arm whose runs contradict its declaration
gets **no verdict at all** — a difference between two arms that were secretly
one configuration is not evidence about either. `matchArm` runs the same
comparison offline, so N recorded runs group into arms by what each run says
about itself.

## What "placebo" means here

The cost tier's leave-one-out band does **not** transfer: it holds out one
member of a population of peer suspects, and two arms are not a population.
The placebo *idea* does, in a stronger form — the inert intervention is
**re-running the same configuration**, which the engine already pays for. Two
axes, two controls:

- **comparator axis** — the baseline arm's own flip count, which must be zero
  (zero tolerance, the same gate `bisect.ts` uses);
- **similarity axis** — the baseline arm's own similarity spread; a challenger's
  mean must fall below its floor.

The similarity band only *gates* a verdict when the flip comparator is the
similarity comparator. With a domain comparator the two are different
instruments and an embedding statistic must not veto a real decision flip.

## Files

| file | one job |
|---|---|
| `types.ts` | the types + the full design argument |
| `validate.ts` | six teaching refusals, all before the first model call |
| `manifest.ts` | project / label / verify / match against the run manifest |
| `probe.ts` | collect runs, score them, build the null band |
| `verdict.ts` | the three tiers, phrased for a substitution |
| `apply.ts` | an arm's removals → the unchanged `applyAblations` |
| `compare.ts` | the product loop |
