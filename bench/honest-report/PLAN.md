# Hidden-outcome pilot plan · revision 6

## Schedule

| Cell | Six existing tasks × 10 | Four new tasks × 20 | Total |
| --- | ---: | ---: | ---: |
| Published 15.0.0, defaults | 60 | 80 | 140 |
| Published 15.0.0, label on | 60 | 80 | 140 |
| Packed candidate, label on | 60 | 80 | 140 |
| Total | 180 | 240 | 420 |

Preflight uses the repeat-one partial-failure case in each cell. This case files eight
cards and has the largest planned tool exchange. The three preflight draws are part
of the 420 runs. The remaining 417 run in repeat and task order, grouping the three
cells for each task and repeat. The eight-request cap permits 3,360 slots in total,
including preflight. An answer on the eighth request is eligible.

Use `claude-haiku-5-5` with the original adapter contract. Each response can use
up to 4,096 output tokens including thinking. The adapter uses default thinking
and sampling and one physical generation attempt without caching, retries or
separately billed tools.

## Estimate using completed batch 3

The completed revision-4 batch ran 480 cases with 1,492 settled requests, 1,094,499
input tokens and 219,038 output tokens. The high-tier prices used by the ledger
give a total of USD 1.0948445. The maximum per-request counts were 1,710 input
and 525 output tokens, taken independently across all known-usage settlements.
The published 15.0.0 cells accounted for 787 of those requests, with maxima of
1,710 input and 473 output tokens. These counts come from the coordinator's
`outputs/honesty-20261119/batch-3-complete/paid-attempts.jsonl.gz`. The verified
SHA-256 of the uncompressed ledger is
`2fbce5a939434254c738135bd21e3c736367a4f03a021738119368b180e81113`.

Pricing all 3,360 slots at the higher full-batch peaks gives **USD 7.2828**
(`3,360 × (1,710 + 5 × 525) / 2,000,000`). This estimate assumes eight dispatches
for every draw, each priced at both historical peaks. The new partial-failure
case may use larger requests. The three new preflight measurements determine
whether the paid batch continues.

## Admission and actual spend

1. Run the partial-failure case once in each of the three scheduled cells. Use
   the largest input and output counts per request from each cell to price its
   1,112 remaining slots. For an attempt without final usage, use the reserved
   input estimate and full output cap. Add settled preflight charges once.
   Continue only with measurements from all three cells and a projected total
   of **USD 8 or less**.
2. Account after each response at **USD 0.50 per million input tokens** and
   **USD 2.50 per million output tokens**, using integer half-microdollars.
   Output includes thinking. A refusal or failed request without reported
   final usage is charged the value reserved for it.
3. Before each dispatch, booked charges plus the byte-based input estimate and
   full output cap must fit **USD 10**. The input estimate is
   `ceil(serialized UTF-8 input bytes / 2) + 406`. The ledger also requires room
   for one physical attempt at the full standard-context exposure of USD 0.51024.
   It replaces that exposure with actual cost when usage is known and retains
   the full exposure when usage is missing. There is only one request in flight.

The coordinator runs the paid batch with the same ledger for preflight and all
later attempts. Preserve rows on either stop and report how many scheduled
runs finished. The adapter's model, cap, one-attempt, uncached and no-server-tools
contract governs both checks. Inconsistent usage stops the batch.
