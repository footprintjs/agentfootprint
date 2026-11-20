# Hidden-outcome pilot plan · batch 6

## Schedule

| Cell | Six existing tasks × 10 | Four hidden tasks × 20 | Total |
| --- | ---: | ---: | ---: |
| Published AgentFootprint 15.0.1, label on | 60 | 80 | 140 |
| Hosted candidate from #424, label on | 60 | 80 | 140 |
| Total | 120 | 160 | 280 |

Use the candidate archive identified by the rehearsal receipt. Batch 6 uses
the revision 7 scoring rule and the schedule and budget below.

Preflight runs the first partial-failure draw in each cell. The eight-target
case has the largest planned tool exchange. The two preflight draws count
toward the 280 runs. The remaining 278 run in repeat and task order, grouping
both cells for each task and repeat. The eight-request cap permits up to
2,240 requests across the batch, including preflight. An answer on the eighth
request is eligible.

Use `claude-haiku-5-5` with the original adapter contract. Each response can
use up to 4,096 output tokens including thinking. The adapter uses default
thinking and sampling and one physical generation attempt without caching,
retries or separately billed tools.

## Historical projection from batch 5

The coordinator's batch 5 ledger
`outputs/honesty-20261119/batch-5-complete/paid-attempts.jsonl.gz` has an
uncompressed SHA-256 of
`cea918212ad416f3b1680fef623b558c232bb27097ded02573e109c14c0d4477`.
Its two label-on preflight draws (published 15.0.0 and candidate #419) each
peaked at 1,257 input tokens and 372 output tokens per request. Applying the
batch 6 schedule to those historical draws yields a conservative projection
of **USD 3.471568**. This prices 1,112 slots per cell at both peaks and adds
the 10,928 units settled for those two draws.

The historical projection fits within the corrected USD 4 admission limit.
Fresh preflight usage from 15.0.1 and #424 determines admission.
The offline rehearsal uses scripted model replies.

## Admission and actual spend

1. Run the partial-failure case once in each of the two cells. Use that cell's
   largest input and output counts per request to price each of its 1,112
   remaining slots. For an attempt without final usage, use the reserved
   input estimate and full output cap. Add the settled preflight charges once.
   Continue only with measurements from both cells and a projected total of
   **USD 4 or less**.
2. Account after each response at **USD 0.50 per million input tokens** and
   **USD 2.50 per million output tokens**. One accounting unit is half a
   microdollar. Output includes thinking. A refusal or failed request without
   reported final usage is charged the value reserved for it.
3. Before each dispatch, booked charges plus the byte-based input estimate and
   full output cap must fit **USD 5**. The input estimate is
   `ceil(serialized UTF-8 input bytes / 2) + 406`. The ledger also requires room
   for one physical attempt at the full standard-context exposure of USD 0.51024.
   It replaces that exposure with actual cost when usage is known and retains
   the full exposure when usage is missing. There is only one request in flight.

The coordinator uses the same paid ledger for preflight and any later attempts.
Preserve rows on either stop and report how many scheduled runs finished.
Inconsistent usage stops the batch.
