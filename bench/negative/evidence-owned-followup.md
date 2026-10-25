# Evidence-owned negative statements: free comparison

> **Superseded after the #208 review correction.** This historical comparison used an over-establishing renderer: it could change an absence request into a complete-list statement and ignore a conflicting model subject. Its counts are not the current result. The original aggregate and private v1/v2/v3 analyses remain intact. See the [sequential corrected comparison](STAGED-COMPARISON.md).

The new runtime establishes a scoped statement for **381 of the same 540 admitted claim slots**, compared with 20 under the PR 207 renderer. **159 remain unestablished.** These are counterfactual checker outcomes, not accuracy scores or proof of the model's original propositions. No model, tool, correction or live agent ran during this comparison; ratings remain stopped.

The [comparison runner](COMPARE-EVIDENCE-OWNED.md) feeds each renderer the same original candidate and saved native record. The new renderer derives the statement's kind and subject from that evidence. Model `kind` and `about` values are advisory; the runner neither rewrites them nor uses fuzzy subject matching. The [aggregate JSON](evidence-owned-results.json) records every code transition by model, cell and arm. Historical reports and all original bank, registration and recording files remain unchanged.

## Fixed admission and denominator

| Original outcome                      | Answers |
| ------------------------------------- | ------: |
| Total trials retained                 |     784 |
| Pass the unchanged application schema |     621 |
| Still fail that schema                |     120 |
| No terminal answer                    |      43 |
| Admitted answers with zero claims     |      84 |
| Admitted answers with claims          |     537 |

Those 537 nonempty answers contain 540 claim slots. The new pointer-only application contract is **not** used to re-admit any of the 120 old schema failures. No stopped trial is repaired, and zero claims does not count as establishment. The original schema-failure reason counts are retained in the aggregate JSON.

There are **378 answers whose nonempty claim lists now all establish**, containing 381 established slots. The difference is three answers with two established slots each. Neither number measures complete-answer correctness, unique verified facts, or successful original delivery.

## What changed

| Original checker code → new checker code      | Claim slots |
| --------------------------------------------- | ----------: |
| `kind-mismatch` → `established`               |         291 |
| `about-mismatch` → `established`              |          67 |
| `search-incomplete` → `established`           |           3 |
| `established` → `established`                 |          20 |
| `kind-mismatch` → `contradicted-by-rows`      |          20 |
| `kind-mismatch` → `superseded-by-write`       |          20 |
| `search-incomplete` → `search-incomplete`     |          50 |
| `citation-unresolved` → `citation-unresolved` |          30 |
| `stale-turn` → `stale-turn`                   |          27 |
| `superseded-by-write` → `superseded-by-write` |          12 |

Removing model label authority exposes the next evidence restriction: 20 previously mismatched slots now fail because of positive rows, and 20 because a write superseded the read. All 20 previously established slots remain established. The remaining 159 comprise 50 incomplete searches, 30 unresolved citations, 27 earlier-turn citations, 20 contradictions and 32 write supersessions.

The three `search-incomplete` → `established` transitions require a semantic qualification. Each original slot asked for `complete` over a partial declared-absence result. The new runtime instead produces a narrower `none` statement from that same result. Each statement retains the partial-result gap and the tool's missing-coverage notes. Each answer also has another slot citing the same read, so it now contains duplicate scoped-none statements. **This does not establish the original whole-source completeness proposition.** No model text became evidence, no missing partition was filled, and no semantic deduplication or repetition score was computed.

## Breakdown by original experiment cell

All cells are replayed under the same typed `withhold` checker configuration. Observe and near-match cells did not acquire that delivery policy retroactively.

| Model      | Cell | Arm        | Trials | Claim slots | PR 207 established | New established | Still unestablished |
| ---------- | ---- | ---------- | -----: | ----------: | -----------------: | --------------: | ------------------: |
| Haiku 4.5  | main | observe    |    240 |         150 |                  0 |             110 |                  40 |
| Haiku 4.5  | main | enforce    |    240 |         190 |                  0 |             120 |                  70 |
| Sonnet 4.6 | main | observe    |     72 |          53 |                  7 |              47 |                   6 |
| Sonnet 4.6 | main | enforce    |     72 |          61 |                  3 |              49 |                  12 |
| Haiku 4.5  | long | enforce    |     40 |          36 |                  0 |               5 |                  31 |
| Haiku 4.5  | near | near-count |     60 |          30 |                  0 |              30 |                   0 |
| Haiku 4.5  | near | near-list  |     60 |          20 |                 10 |              20 |                   0 |

The exact saved models are `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`. Fifty-seven answers still request a correction counterfactually; none was generated. This comparison does not rerun the prose observer or change its earlier heuristic results. It does not validate the summary, semantic repetition, usefulness or truth outside recorded scope.

## Evidence integrity and reproduction

The baseline is PR 207 at `eee555c0`; the compared runtime source is `2e86a415`. The final comparison uses statement version 6. All **785 manifest/raw files** have identical hashes before and after, and the earlier private comparisons remain separately preserved. Historical admission verifies the saved reply, run/turn identity, dispatched execution, host binding and evidence chronology. The trust callback is exactly saved `call.trustedContext === true && record.ledgerComplete`. No end-of-turn evidence from after the selected answer is admitted.

| Provenance                                   | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Original manifest                            | `2726bc57609d7e2e1189247730b13db2487b2f880ef1e1f90752957e0165631d` |
| Baseline built JavaScript tree (1,017 files) | `3a4c1e740e28ff9d74a9939e928f80cae341e17b0349df44ee19ef389d1593cf` |
| Compared built JavaScript tree (1,018 files) | `83de3ec0d4ecadfbf87f68acfafa58c14185fa507dd9e19358ba29ccdb6e0434` |

Dependency-lock and analysis-script hashes are in the aggregate JSON. Detailed candidate-level results stay private. Follow [COMPARE-EVIDENCE-OWNED.md](COMPARE-EVIDENCE-OWNED.md) with both built checkouts and a new private output directory to reproduce the comparison.

The separate [paired synthetic fixture test](../../test/bench/negative/declared-absence-counterpart.test.ts) exercises actual native capture: a local search profile plus explicit `absent()` establishes; the identical profile returning raw `[]` mints no citable absence and stays unknown. Its three tests and the six comparator tests pass. This newly authored counterpart neither changes the frozen undeclared-empty control nor upgrades any historical record or oracle.

This work incurred **$0 in new model calls**. It authorizes no full rerun, ratings, merge or release.
