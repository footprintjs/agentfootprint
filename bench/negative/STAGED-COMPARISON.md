# Sequential free comparison after the #208 review correction

The completed [results report](kind-subject-followup.md) and [aggregate JSON](staged-kind-subject-results.json) record the staged outcomes and build provenance.

The earlier [evidence-owned report](evidence-owned-followup.md) and its aggregate are
superseded. They used a renderer that could turn a requested absence into a positive
complete-list statement and could ignore a conflicting model subject. Their original
files and private v1/v2/v3 outputs are retained as historical evidence.

This runner evaluates three stages against the same original candidates and saved native
records:

1. The unchanged PR 207 built renderer and original application parser.
2. Corrected requested-kind verification, retaining the old exact-subject rule.
3. The same kind verification, adding bounded normalized subject containment.

Both corrected stages call the same runtime renderer with the same trust and admission
guards. Their fifth argument selects `kind-only` or `evidence-owned`. The runner never
rewrites `kind`, `about`, handles, tool results or fixture declarations. It changes no
original parser exclusions. Each stage reports the first blocking reason; resolving one
may expose the next, so mismatch counts cannot simply be added to establishment counts.

Build both checkouts, then run from the corrected checkout:

```sh
node node_modules/vitest/vitest.mjs run test/bench/negative/staged-comparison.test.ts --maxWorkers=2
node bench/negative/staged-comparison.mjs /private/original-run /private/new-staged-output /path/to/pr207-checkout /path/to/corrected-checkout
```

The output parent must exist. The output directory must be new, outside the original run
and outside any Git checkout. The script creates it with mode `0700` and writes its files
with mode `0600`. It makes no network, model or tool calls.

The historical baseline is pinned to 784 trials, 621 admitted answers, 120 schema failures,
43 no-answer trials, 84 zero-claim answers, 540 claim slots and 20 established baseline slots.
Drift refuses the comparison. A current schema accepting more fields cannot re-admit old
answers. Empty claim lists are counted separately, never as established negative answers.

The unchanged historical admission verifies the registered tuple, selected saved reply,
execution identity, actual arguments, host context and chronology. Both corrected stages
receive the exact frozen native record and original candidate; any mutation or changed
check-row count/order refuses the comparison. The trust predicate is exactly saved
`call.trustedContext === true && record.ledgerComplete`. No late read is reconstructed or
added to evidence.

Outputs are `analysis.private.json` (candidate-level stage results and transitions),
`aggregate.json` and `aggregate.md` (counts only). Aggregates separate stages, first-reason
transitions, model/cell/arm groups, no-claim answers and complete requests rendered as
absence. A narrower absence does not establish the requested completeness proposition.
An explicitly complete zero-row search can still satisfy a `complete` request when its
recorded completeness and all other guards pass. The separate warning applies to a
partial absence fallback whose requested completeness remains unestablished.
The manifest and every raw artifact are hashed before and after; complete built JavaScript
trees, dependency locks and all analysis scripts have recorded digests.

These are counterfactual checker results. No new statement is delivered and no correction
is generated. They do not measure factual accuracy, usefulness, semantic repetition, or
truth outside the recorded scope. Private questions, case IDs and tool/entity names stay
out of public aggregates. No paid rerun or fixture rewrite is implied.
