# The negative-claim replay — registered rule

Registered before the free replay ran (design `docs/design/2026-10-negative-claims.md`, § 7). The
replay is computed by `replay.mjs` from these rules; nothing here is chosen after seeing a number.

## Frozen

| What | Value |
|---|---|
| Grammar | `src/integrity/negative-claim/phrases.ts`, version `1`, sha256 `7d83d90ecd339d0eebd31ab1e30d4849048c47faf4bd8121739db6f6b6dd915d` (pinned by `test/integrity/negative-claim/phrases.test.ts`) |
| Statement | `STATEMENT_VERSION` `1` (`src/integrity/negative-claim/statement.ts`) |
| Split | `measure.mjs` · `splitCases`, seed `negative-claims/split/1` |
| Bounds | 2000 case resamples, seed `20261023` |

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
  none, or that a list is complete, true or not. The detector's target.
- `flagged` — the reply states such a claim, or an overclaim, that is FALSE: the positive of § 7
  ("a flat claim the record cannot support").

Resolutions: rater A, rater B, and the replies both agree on (a disputed reply is left out and
counted). Every number is PRELIMINARY until the sentence labels exist.

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

Per split, model, arm role and resolution, each with a case-clustered 95% bound: detector
sensitivity, specificity and precision against `claimsNonExistence`; for the baseline and for
detector + record, missed overclaims and specificity against `flagged`, and the share of correct
true-zero replies (kind G, not flagged) a withhold would hold. Gates, held-out test-arm replies:
detector sensitivity ≥ 0.85 (lower ≥ 0.70); detector specificity ≥ 0.95 (lower ≥ 0.85); missed
overclaims ≤ 0.05 (upper ≤ 0.15); specificity ≥ 0.10 above the ablation baseline. The typed false-
hold gate (≥ 60 true-zero replies from ≥ 6 cases) needs the paid arm: this bank has two true-zero
cases.
