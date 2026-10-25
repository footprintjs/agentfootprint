# Full-path negative-answer benchmark

**This run cannot establish typed-checker accuracy.** None of the 784 trials satisfied the output contract. No library-written typed statements were delivered, and no citation-correction requests occurred. Generation is complete; rating is incomplete and further paid calls are on hold pending the owner's decision. No recommendation or enforcement setting is promoted. Release remains on hold.

## Observed execution outcomes

These are runtime observations, not truth or usefulness ratings. The denominator excludes the 40 scripted first turns.

| Model | Cell / arm | Trials | Final strings returned | Contract failed / not reached |
| --- | --- | ---: | ---: | ---: |
| Haiku 4.5 | Main / observe | 240 | 220 | 220 / 20 |
| Sonnet 4.6 | Main / observe | 72 | 72 | 72 / 0 |
| Haiku 4.5 | Main / enforce | 240 | 0 | 220 / 20 |
| Sonnet 4.6 | Main / enforce | 72 | 0 | 72 / 0 |
| Haiku 4.5 | Long context / enforce | 40 | 0 | 37 / 3 |
| Haiku 4.5 | Near names / count | 60 | 60 | 60 / 0 |
| Haiku 4.5 | Near names / candidates | 60 | 60 | 60 / 0 |
| **Total** | | **784** | **412** | **741 / 43** |

All 741 contract failures occurred at JSON parsing. There were **741 fenced responses, zero strict-JSON responses, and 43 harness-limit failures**. No fences were removed, failures excluded, or outputs repaired. There were 795 terminal provider responses and no maximum-token stops.

Of 372 terminal failures, 329 were answer-validation errors and 43 were harness-limit failures. Ten failed turns had already streamed partial text; usefulness raters see that delivery. Long follow-ups attempted 14 fresh reads: five returned and nine failed. **Citation corrections: 0. Delivered typed library statements: 0.** These outcomes do not demonstrate accurate claim checking.

The capture audit retained all 784 artifacts and 824 turn recordings, matching all 1,206 executions to native records. Generation cost was **$3.475819**, with all 795 generation calls settled and no uncertain generation charges. Rating costs are additional.

## Scope and amendments

The owner approved a fresh, blind AI-authored bank instead of the proposed human-authored bank. Its author saw the contributor overview, but no prior replies, grammar, implementation or statement templates. The [registered protocol](full/RULE.md) uses synthetic results, scripted tool selection and an artificial first answer for long-context trials. The baseline keeps prose observation on with typed delivery off. Natural tool selection and backend accuracy are not measured.

After 748 trials, amendment 1 reduced the internal rating reserve from $1.00 to $0.75 without changing the **$4.30 total cap**. It also retained precisely proven unsent harness-guard stages as failed trials for processing. Actual responses and partial delivery remain recorded. Completed trials were not retried; original records and registration were not rewritten. This was a post-generation, pre-rating amendment.

Before any labels existed, the first rating request returned HTTP 400. Amendment 2 removed an unsupported sampling parameter and explicitly disabled thinking for both Haiku 5.5 sessions, following the model's [migration guidance](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide). Its **$0.002908 reservation remains charged**; the corrected attempt has a separate ledger identity. Amendment 1 was preserved, and amendment 2 binds its parent content and exact code hashes.

## Incomplete ratings and limits

With corrected settings, three of the planned 784 rater requests returned responses before an uncharged token-count request failed. The 12 truth-rating packets in those responses contain one valid and 11 invalid label sets; the invalid sets cite unknown or duplicate citation IDs. No usefulness ratings were obtained, and no trial has complete paired ratings. The process is stopped while the owner decides whether to spend more of the existing cap on this diagnostic run. Missing or invalid labels are not owner disagreements to be silently resolved.

Settled rating cost is **$0.006994**. Together with generation, settled spending is **$3.482813**; the rejected request retains a **$0.002908** reservation. Total used or reserved is **$3.485721 of $4.30**, leaving **$0.814279**. These are posted-rate estimates, not an account invoice. The partial scorer receives all 784 trials, scores zero fully labeled trials, and returns `pending-or-incomplete`; no metric or gate passes.

The two isolated raters use the same model and family; agreement is not independent human truth. Truth packets hide treatments, checker findings, grammar and library statements. Separate usefulness ratings necessarily see delivered wording. Every substantive disagreement would require owner adjudication after valid ratings exist.

Repeated replies are not independent cases. Several registered case-level bounds cannot pass at these counts even with perfect answers; thresholds are not relaxed. Missing labels, unresolved disagreements and zero eligible checks never establish a pass. Latency includes free token counting and is not a network-streaming measure.

Local validation at processing revision `7100da13`: **25,260 full-suite tests passed, 21 skipped**; compatibility checks: **61 focused tests passed**. Tests establish exercised software behavior, not paid-model accuracy.

A new measurement should first prove the real provider's output-contract path on separate smoke-test cases, then freeze a new run. It must retain this run's failures and costs rather than repairing its outputs or presenting a rerun as the original experiment.

## Sources and frozen identities

Operational counts come from the privacy-reviewed `operational-aggregates.json` and `.md`, generated on 2026-10-24. Cases and replies remain private.

- Generation source: [da9e658f](https://github.com/footprintjs/agentfootprint/commit/da9e658f1477311a1235a26be96e3bdb395f7a46). Processing source: [7100da13](https://github.com/footprintjs/agentfootprint/commit/7100da13).
- Original registration SHA-256: `a7a106771d2887e32f0541649ac989b036f6a766c596196a0f570f28b72f1b27`.
- Amendment 1 SHA-256: `f56af59fd13789a8cde009f1292848d4fe10263503a9e4580131b8f88902a51b`.
- Amendment 2 SHA-256: `a06671c2410e938fd41cb2be6fb493336c3d6fb9994c8a75c846c1152e8cc791`.
- Bank SHA-256: `775174d0028e5a4b11c43b609487e3ba0c3db9a78ab6252f3805c911a2fb6344`.
