# Full runtime benchmark — registration 1

This is PR 6 of the negative-answer program. The historical replay and its
registration in `../RULE.md` remain unchanged. No old study reply is held out here.
The final private manifest freezes the bank, translated declarations, prompts,
schema, implementation, models, subsets and order before generation or labeling.

## What this experiment measures

The experiment measures answer generation, native evidence checking, a genuine
tools-off citation correction when requested by the runtime, and final delivery.
Fixture-scheduled tool proposals pass through the real Agent dispatcher. Backend
results are synthetic, fixed by the private bank. It does not measure tool selection.
Every raw record retains the native recording and an independent tool-execution log.
The paid transport uses ordinary Messages completions; runtime stream buffering is
tested with scripted chunks. These are not network streaming latency measurements.

The shared system prompt and JSON schema are the exported constants in `harness.mjs`.
Output strategy is `instruct`, temperature 0, maximum output 384 tokens, schema
retries 0. The typed arm additionally receives the library's real citation
instructions. No prompt or grammar is tuned from a paid answer.

- **Observe:** `.negativeClaims({prose:true})` with the shared output schema. It
  delivers the model's own answer without typed correction or library rewriting.
  This is the baseline with typed delivery off; observation remains on, and its
  cost is included. Candidate typed dispositions are computed offline from the
  saved native evidence. It is not a fully unarmed agent.
- **Enforce:** the actual typed arm with `unestablished:'withhold'`. Established
  citations become library-written statements; failed citations may trigger the
  actual no-tools correction and then withhold. Prose never blocks.
- **Long context:** a real first run dispatches the fixture reads and stores a
  scripted long first answer. A real follow-up uses the paid provider; earlier
  reads remain earlier-turn evidence. A requested fresh read uses only authored
  fixtures. The frozen padding is artificial, not a naturally generated answer.
- **Near names:** an additional synthetic name-index lookup returns `absent({among})`
  in both arms. The baseline exposes count and source; the experimental arm also
  exposes at most three quoted candidates in source-labelled ancillary data.
  Original tool results are unchanged. This is benchmark scaffolding only; no
  candidate-list feature is enabled in the library.

## Fixed sample sizes and private bank

| Cell | Model | Cases × repetitions | Scored replies |
| --- | --- | --- | --- |
| Observe | Haiku 4.5 | 24 × 10 | 240 |
| Observe | Sonnet 4.6 | 12 × 6 | 72 |
| Enforce | Haiku 4.5 | 24 × 10 | 240 |
| Enforce | Sonnet 4.6 | 12 × 6 | 72 |
| Long, second turn | Haiku 4.5 | 8 × 5 | 40 |
| Near count / near candidates | Haiku 4.5 | 6 × 10 × 2 | 120 |

Total: **784 scored replies**, plus any actual correction or follow-up read calls.
`plan.mjs` fixes IDs, subsets, repetitions and a seeded order. There is no smaller
fallback. A budget or transport stop is an incomplete run, never a smaller success.

The bank has eight true-zero, six false-nonexistence, four completeness, three
contradiction and three superseded primary cases. A separate AI author wrote the
original bank without old replies, grammar, implementation, or statement templates.
The author did read the repository's contributor overview. This differs from the
design's human-author requirement and needs owner acceptance before paid execution.
The manifest records that acceptance. A pre-generation amendment authored explicit
auxiliary index cardinalities for the near-name arms; its provenance is retained.

Questions, schemas, fixtures, replies, keys, recordings, rater packets and owner
decisions stay outside the repository. Public reports contain aggregates and
digests only. The command refuses private input/output paths inside the repository.

## Raters and owner decisions

The approved fallback is used when no other vendor key is available: two isolated
`claude-haiku-5-5` sessions, a different model from both tested agents. Both raters
are the same model and family. Their agreement is not independent human truth.
`labels.mjs` freezes prompts, sentence splitting, output validation and blinding.

Every model-authored sentence and citation in each draft/correction is labeled with
actual tool results shown. Packets hide the model, arm, checker findings, grammar
and library-written answers. A separate usefulness pass necessarily sees delivered
wording; that is an explicit exception to statement blinding, not truth-label data.
Missing, invalid or truncated labels are unknown. The owner adjudicates every
substantive disagreement. No automatic tie-break may promote a metric to pass.

## Gates and statistics

`score.mjs` freezes the design's thresholds. Citation failures and false holds have
disjoint populations: a false hold requires a true-zero case and a correct
citation. Field drop counts required negative conclusions with no populated
citation field. Rewording, usefulness, tokens and latency include correction calls.

Detector positives are sentences labeled non-existence, completeness or
scoped-negative, whether supported or unsupported; other text supplies specificity
controls. A correct scoped negative that is detected is a true positive, not a
false positive. Unsupported negative overclaims remain a separate truth-based
measure, including persistence after correction.

Observation/reply rates and case bounds are different estimands. An error case has
at least one eligible error among its repetitions; a success case has all eligible
observations succeed. Exact 95% Clopper–Pearson intervals use these integer case
outcomes. They are bounds on this case event, not bounds on a per-reply rate.
The old replay's rounded rate-times-case calculation is not reused.

Several specified bounds cannot pass at these fixed counts even with perfect
answers: zero errors over eight cases has upper bound 0.369; over three, 0.708;
over six, 0.459. Twelve all-success cases have lower bound 0.735. Report
`insufficient-independent-cases`, preserving the thresholds and counts. No
recommendation, prose enforcement or candidate lists are enabled by this PR.
Any missing expected reply, missing label or pending owner decision prevents a
final pass. Zero eligible checks never counts as success.

## Spending

The latest owner instruction sets **$4.30 total**, superseding the older $4.50 cap.
One private, append-only, fsynced ledger covers agent calls, corrections, raters
and explicit retries. Token counting is free; requests reserve counted input plus
framing margin at the dearest registered cache-write rate and maximum output.
Unknown charges retain the whole reservation. No SDK retries occur silently.
The agent phase holds $1.00 for ratings. A process lock prevents concurrent writers.
One process runs three independent agents at a time in the frozen shuffled order.
On failure it stops scheduling and waits for in-flight calls before releasing the
lock. Every reservation shares the same ledger. Recorded latency includes the
budget instrument's free token-count request as well as generation; it is not
an uninstrumented production latency claim.

Prices checked 2026-10-23 against
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing):
Haiku 4.5 $1/$5 input/output per million tokens; Sonnet 4.6 $3/$15;
Haiku 5.5 $0.10/$0.50 for prompts at most 100,000 tokens. The code charges cache
reads and writes separately. It refuses unpriced models, the higher rater context
tier, fast service and one-hour cache writes. Recorded usage is a cost estimate at
these posted rates, not an account invoice. Release stays on hold.
