**Mixed** — the extracted tool-call units, grouped by their existing jobs.
Walker: credential dispatch and batch-state updates in `decorators/` and `batch/`.
Lens: the refusal and settlement sentences in `helpers/` and `batch/`.
Fold: paused-batch and producer-corpus projections in `batch/` and `evidence/`.

# Tool-call stage modules

`../toolCalls.ts` remains the stage entry and exports the same handler and helpers.
It holds the dependency contract and execute/resume closure while these modules
own the existing top-level units:

- `helpers/`: refusal sentences, mounted-cursor reading, ID deduplication and
  process-wide period-warning state.
- `decorators/reportingCredentials.ts`: credential failure reporting.
- `batch/`: paused-call argument recovery, batch projections and settlement.
- `evidence/`: producer-corpus projection and the lazily loaded landed judge.

The stage imports these modules; they depend on existing lower-level owners.
Both warning sets and their reset share one module instance. The result judge
loads only after its existing admission guard. The execute/resume closure and
its lazy imports stay in the stage. Further closure extraction belongs to the
next restructuring step.
