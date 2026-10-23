# The negative-claim bench — the free replay

Does the negative-claim grammar (`src/integrity/negative-claim/`) find the flat "there are none"
and "that is the full list" sentences a person would flag, and what would withholding them cost?
This folder answers it for free, by replaying the grammar and the record-backed prose check over
replies a study already recorded and labelled (design `docs/design/2026-10-negative-claims.md`,
§ 7). No model is called and nothing is paid.

```sh
npm run build                                   # the command reads the BUILT package
node bench/negative/replay.mjs <data-dir>       # a study's data folder, read only
node bench/negative/replay.mjs <data-dir> --json out.json
```

The data folder is NOT in this repository and nothing of it is copied here: the replay prints
aggregates only — counts, rates and exact case-level 95% bounds, per case split, model, arm role
and label resolution. `study.mjs` says which layout it reads. The checker is passed in, so the
tests (`test/bench/negative/`) run on the sources with no build.

| File | Its one job |
|---|---|
| [`RULE.md`](RULE.md) | the registered rule: grammar hash, split, labels, record, gates — fixed before the replay ran |
| `study.mjs` | reads the folder: the case bank, the replies, the two raters' labels (rebuilding a missing label key by the study's own sheet rule) |
| `measure.mjs` | the split, the case-level bounds, the measures, the floors and the gates — pure |
| `replay.mjs` | the command: reads each reply, measures every cell, prints the report |

**What it can and cannot say today.** The labels are reply-level and come from two sessions of
one model, which no person has checked yet, so every number is preliminary. They exclude the
scoped sentences the grammar targets, so the grammar's false-fire rate cannot be read from them. No recorded call carries a composed
`search` row, so detector + record equals the ablation baseline by construction (`RULE.md`
§ Record). The paid arm (§ 7, PR 6) supplies what this cannot: sentence labels, the tool
rewrites and enough true-zero cases.

Tested on a synthetic folder: `test/bench/negative/replay.test.ts`.
