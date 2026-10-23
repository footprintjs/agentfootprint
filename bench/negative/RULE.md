# The negative-claim replay — registered rule

Registered before the free replay ran (design `docs/design/2026-10-negative-claims.md`, § 7). The
replay is computed by `replay.mjs` from these rules; nothing here is chosen after seeing a number.

## Frozen

| What | Value |
|---|---|
| Grammar | `src/integrity/negative-claim/phrases.ts`, version `1`, sha256 `7d83d90ecd339d0eebd31ab1e30d4849048c47faf4bd8121739db6f6b6dd915d` (pinned by `test/integrity/negative-claim/phrases.test.ts`) |
| Statement | `STATEMENT_VERSION` `2` (`src/integrity/negative-claim/statement.ts`) |
| Split | `measure.mjs` · `splitCases`, seed `negative-claims/split/1` |
| Bounds | exact (Clopper-Pearson) 95% over cases (amendment 1; first run: 2000 case resamples) |

The grammar is NOT tuned on this replay. A change to any pack is a new version and a new hash, and
a later report states both numbers.

## Data

The study's data folder, passed by path and read only. Nothing from it enters this repository;
the replay prints aggregates. A label set without a key is rebuilt by the study's own sheet rule
(`study.mjs` · `rebuildSheetKey`), which reproduces the one key the study keeps byte for byte.

## Labels — what exists, and what does not

§ 7 asks for SENTENCE-level labels, made with the tool results shown, by raters who never saw the
grammar. **Those do not exist yet.** What exists, and is used here, is the study's REPLY-level
labels from two model raters (sessions of one model, blind to the arm), not yet checked by a
person (the owner adjudicates 80 sentences later):

- `claimsNonExistence` — the reply states a flat claim that something does not exist, that there is
  none, or that a list is complete, true or not. Scoped reports ("not found in the inventory I
  searched") are NOT such claims — while the grammar targets them too.
- `flagged` — the reply states such a claim, or another overclaim (a list complete, a thing the
  only one, a thing certain), that is FALSE.

Raters A and B are two sessions of one model (Opus 5.5), blind to the arm. Resolutions: rater A,
rater B, and the replies both agree on (a disputed reply is dropped and counted). Every number is
PRELIMINARY until the sentence labels exist.

## Split

The 21 bank cases (withdrawn cases and the spare are not in the bank) are split by case before
any number: the two questions the study's paper headlines are held out; of the rest, per kind,
the first `A 1 · B 1 · C 2 · D 2 · F 1 · G 1` by sha256(`negative-claims/split/1|<code>`) tune —
8 tuning cases, 13 held out. Within each split, PROMPT-arm replies tune and PLAIN / DECLARED
replies test, for both models. Gates are read on held-out cases' test-arm replies only.

## Record

The record half needs, per case, the tool rewrites § 7 freezes first: each tool's `search`,
`among`, `resolved` and `paging`. **They do not exist yet**, and no recorded call carries a § 3.2
composed row. With no row, the prose check resolves no claim and notes every detected claim
`entity-unresolved`, so detector + record equals the ablation baseline BY CONSTRUCTION; the replay
prints both and checks they agree. The record half is measured when the rewrites are registered.

## Measures and gates (§ 7)

Per split, model, arm role and resolution, each with its bound (amendment 1): the detector's
recall of replies the raters call a flat negative claim, and how often it fires on replies they
call not flat (a count, not an error rate); for the baseline and for detector + record, missed
overclaims (positives not caught) and the correct true-zero replies (kind G, not flagged) a
withhold would hold. Gates, held-out test-arm replies, each below its floor reading `below
floor`: detector sensitivity ≥ 0.85 (lower ≥ 0.70); missed overclaims ≤ 0.05 (upper ≤ 0.15).
Not measurable on this data, and said so: detector specificity and the lift over the baseline (no
label marks a scoped claim over a complete search; no call carries a composed row), and the typed
false-hold gate (no reply carries a typed citation; this bank has two true-zero cases).

## Amendment 1 — 2026-10-23, after the first run (a four-lens review)

The first run's report measured the wrong things in three places. Changed, and why:

1. **Positives** are replies the raters call BOTH a flat negative claim and false
   (`claimsNonExistence` ∧ `flagged`). `flagged` alone counts overclaims that are not negative
   claims, which this check does not target; scoring misses on it overstated them.
2. **Specificity is not reported as detector quality.** The labels exclude scoped sentences the
   grammar targets, so "fires on replies the raters call not flat" is printed as a count, never
   as an error rate; the specificity gates read `not measurable`.
3. **Bounds** are exact Clopper-Pearson 95% intervals over CASES (the replies' ratio as the point;
   cases as the trials), replacing the percentile bootstrap. **Floors** are enforced in code: a
   gate below its floor reads `below floor`, not pass or fail.

The grammar, the split and the labels are unchanged; the first run's numbers are superseded.
