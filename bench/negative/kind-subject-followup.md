# Corrected kind verification, then subject matching

The sequential free comparison establishes **20 → 170 → 378 of the same 540 claim slots**: unchanged PR 207, corrected kind verification with exact subject matching, then corrected kind verification with normalized subject containment. **162 slots remain unestablished.** These are scoped checker outcomes, not factual-accuracy or usefulness scores. No new model, tool, correction or live delivery ran.

This report supersedes the earlier [evidence-owned comparison](evidence-owned-followup.md), whose renderer could over-establish by replacing the requested claim or ignoring a conflicting subject. Its report, aggregate and private v1/v2/v3 analyses remain historical artifacts. The new [aggregate JSON](staged-kind-subject-results.json) and [reproduction instructions](STAGED-COMPARISON.md) are separate files.

## Fixed admission and evidence

All **784 original trials** remain: 621 pass the unchanged application schema, 120 still fail it, and 43 have no terminal answer. Of the admitted answers, 84 contain zero claims and 537 contain 540 claim slots. Empty lists are not establishment. No schema failure or stopped trial was repaired or dropped, and no fixture or oracle changed.

The historical admission runs once per trial. Both corrected stages receive the same original candidate and frozen native record, with the same trusted-context predicate and runtime evidence guards. Neither stage rewrites the model's `kind`, `about` or references. The only interpretation difference between the corrected stages is exact subject matching versus bounded normalized containment. Returned subjects come from the recorded public population values, never the model's label.

| Stage                             | Established slots | Unestablished slots | Nonempty answers whose whole claim list establishes |
| --------------------------------- | ----------------: | ------------------: | --------------------------------------------------: |
| PR 207 baseline                   |                20 |                 520 |                                                  20 |
| Corrected kind; exact subject     |               170 |                 370 |                                                 169 |
| Corrected kind; contained subject |               378 |                 162 |                                                 375 |

The final 378 established slots include one established slot in each of three mixed answers whose other completeness claim remains unestablished. Those three answers are withheld under the replay's typed `withhold` policy. Thus 378 slots must not be described as 378 successful answers.

## Step 1: verify the requested kind

The model still selects `none`, `not-found` or `complete`. The library normalizes only the absence family when admitted evidence explicitly supports absence. A negative request over positive rows fails; it cannot become a complete-list success. An explicit `complete` request keeps its completeness checks.

| First blocked reason in PR 207 → first reason after the kind correction | Slots |
| ----------------------------------------------------------------------- | ----: |
| `kind-mismatch` → `established`                                         |   150 |
| `kind-mismatch` → `about-mismatch`                                      |   141 |
| `kind-mismatch` → `contradicted-by-rows`                                |    20 |
| `kind-mismatch` → `superseded-by-write`                                 |    20 |
| `citation-unresolved` → `undeclared-empty`                              |    16 |

The other 20 baseline-established slots remain established, producing **170**, not 20 + 331. The 331 old kind mismatches were the first reported blocker; resolving them exposed subject, contradiction and write restrictions. The 16 more specific undeclared-empty diagnoses remain held. This diagnostic change does not establish an absence or authorize another read.

## Step 2: check the supplied subject against recorded scope

The corrected containment rule clears **208 `about-mismatch` slots**: 141 newly exposed by the kind correction plus the 67 already visible in PR 207. The other stage-one verdicts remain unchanged. All recorded public population values must be represented after the bounded normalization and token matching; surrounding model prose is not verified or delivered as the canonical subject.

| Remaining first blocked reason |   Slots |
| ------------------------------ | ------: |
| `search-incomplete`            |      53 |
| `superseded-by-write`          |      32 |
| `stale-turn`                   |      27 |
| `contradicted-by-rows`         |      20 |
| `undeclared-empty`             |      16 |
| `citation-unresolved`          |      14 |
| **Total unestablished**        | **162** |

There were 59 explicit completeness requests. Three partial-absence cases now contain the visible line: **“The requested complete-list claim is not established; only this absence is.”** Their requested kind stays `complete`, their verdict stays `search-incomplete`, every recorded gap remains, and their answers remain withheld. The line is a scoped fallback, not a successful completeness check. It appears only after containment allows the narrower absence itself to pass all guards. No complete request is silently changed to `none` in either corrected stage.

An explicitly complete zero-row search may still satisfy an explicit `complete` request when its completeness and all other guards pass. That is distinct from the three partial-absence fallbacks.

The final runtime would request corrections for 41 answers, down from 57 under the baseline because the 16 known undeclared-empty results no longer look like unresolved citations. These are counterfactual requests; no correction was generated and no tool was repeated.

## Original model and experiment cells

Every cell is evaluated under the same typed `withhold` replay configuration. Observe and near-match cells did not acquire that delivery behavior retroactively.

| Model      | Cell / arm        | Trials | Claim slots | Baseline | Kind only | Kind + subject |
| ---------- | ----------------- | -----: | ----------: | -------: | --------: | -------------: |
| Haiku 4.5  | main / observe    |    240 |         150 |        0 |        30 |            110 |
| Haiku 4.5  | main / enforce    |    240 |         190 |        0 |        50 |            120 |
| Sonnet 4.6 | main / observe    |     72 |          53 |        7 |        35 |             45 |
| Sonnet 4.6 | main / enforce    |     72 |          61 |        3 |        15 |             48 |
| Haiku 4.5  | long / enforce    |     40 |          36 |        0 |         0 |              5 |
| Haiku 4.5  | near / near-count |     60 |          30 |        0 |        20 |             30 |
| Haiku 4.5  | near / near-list  |     60 |          20 |       10 |        20 |             20 |

The exact saved models are `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`. Neither the original prose nor a library-written fallback is assigned a semantic-repetition, usefulness or accuracy rating here. The earlier prose-observation results are not rerun or upgraded.

## Integrity, provenance and limits

The baseline is PR 207 source `eee555c0`; the corrected build is source `c6fe269a`. All **785 original manifest/raw files** were byte-identical before and after. Admission checks the registered tuple, selected saved reply, native execution identity, arguments, caller context and chronology. The trust callback is exactly saved `call.trustedContext === true && record.ledgerComplete`. Neither stage injects model text, reconstructs a missing read or admits evidence captured after the selected answer.

| Provenance                                    | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Original manifest                             | `2726bc57609d7e2e1189247730b13db2487b2f880ef1e1f90752957e0165631d` |
| Baseline built JavaScript tree (1,017 files)  | `3a4c1e740e28ff9d74a9939e928f80cae341e17b0349df44ee19ef389d1593cf` |
| Corrected built JavaScript tree (1,018 files) | `ad844c9efbe11f49c9036cd3d528e0258bbf0e5dcb8b446be6f16bb67d9e255e` |

The aggregate also records dependency-lock and analysis-script hashes. Detailed per-trial results stay private. The staged runner's ten focused tests cover fixed denominators, unchanged candidate/evidence, both actual renderer modes, trusted-context restrictions, completeness fallback accounting, file preservation and aggregate privacy.

The frozen undeclared-empty control stays unchanged and unestablished. The separate [synthetic paired fixture](../../test/bench/negative/declared-absence-counterpart.test.ts) demonstrates that an explicit local `absent()` declaration can support absence while raw `[]` cannot, even with the same search profile. It does not repair historical evidence.

This free analysis spent **$0**. Ratings remain stopped; no full paid rerun, merge or release is authorized by these results.
