# Free comparison on fixed admitted claims

> **Historical, superseded runner.** The #208 review found that its compared renderer over-established. Preserve the old results; use [STAGED-COMPARISON.md](STAGED-COMPARISON.md) for the corrected kind-only, then kind-and-subject comparison.

This comparison leaves the historical `reparse*` files and results intact. It uses the
old application parser and baseline admission, then compares the old runtime renderer
with the new default renderer on the **same original candidate and native record**.
The runner does not rewrite `kind`, match `about` by containment, add evidence, run tools,
call models, request corrections, or change the future fixture bank.

Build both checkouts first, then run from the new checkout:

```sh
node node_modules/vitest/vitest.mjs run test/bench/negative/compare-evidence-owned.test.ts --maxWorkers=2
node bench/negative/compare-evidence-owned.mjs /private/original-run /private/new-comparison /path/to/baseline-checkout /path/to/new-checkout
```

The last argument defaults to this checkout. The output parent must exist, and the output
directory must be new, outside the original run, and outside Git. Files are private by
default (`0700` directory, `0600` files). No original file is overwritten.

The original comparison is pinned to 784 trials, 621 schema-admitted answers, 120 schema
failures, 43 no-answer trials, 84 zero-claim answers, 540 claims and 20 baseline established
claims. A different baseline refuses before writing the report. The new runtime's schema
migration does not admit extra old answers into this fixed-denominator comparison.

The historical admission checks the registered tuple, actual final turn, saved wire reply,
result identity, executed arguments, host identity and evidence chronology. Every saved
native dispatch must precede the chosen answer. Records and candidates are frozen; any
mutation or change in the number/order of check rows refuses the comparison. The current
renderer receives the saved app tool names and the same trusted-context predicate.

Outputs are `analysis.private.json` (candidate-level evidence and transitions), `aggregate.json`
and `aggregate.md` (counts only). The report includes code transitions for each model/cell/arm,
separates zero claims from establishment, and preserves schema-failure reason counts. Original
manifest/raw bytes are hashed before and after. Both complete built local JavaScript trees,
dependency locks, historical replay files and new comparison scripts have recorded hashes.

These are **counterfactual checker outcomes**. No new library statement was actually delivered,
no correction was generated, and no factual accuracy, usefulness or semantic-repetition score
is claimed. A different verdict may reveal the next checker restriction; an exploratory
reviewer's establishment count is not treated as the expected result. Future fixture changes
must be versioned separately and cannot affect these original records.
