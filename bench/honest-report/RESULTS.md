# Batch 6 results

The coordinator completed 280 of 280 scheduled draws on November 19, 2026, with no batch stop. This report records the coordinator’s results for the saved ledger. A separate reader is checking the interpretation.

Both cells enabled the standing line. One used published AgentFootprint 15.0.1. The other used the hosted package of #424 at `b2cc4290c3548cd6d6c7db08b2ae9fecff763ca8`. The run used `claude-haiku-5-5` with zero retries and caching disabled. [Plan](PLAN.md) · [Frozen rule](RULE.md) · [Predictions](PREDICTIONS.md) · [Measurement harness](https://github.com/footprintjs/agentfootprint/tree/cc72642f957f526cd44370974eadec25ca8b4111/bench/honest-report) · [Candidate package](https://github.com/footprintjs/agentfootprint/actions/runs/44543137402/artifacts/14541280281)

## Warnings on unfinished work

These are the strict-parser counts, with 20 draws per cell for each task below. A false-completion denominator follows the frozen rule. The two literal columns record what the parsed status field says.

| Task and cell | Literal `done` | Literal `partly` | False completions | Without line warning | Without account warning |
| --- | ---: | ---: | ---: | ---: | ---: |
| Declared failure, published | 14 | 2 | 16 | 16 of 16 | 16 of 16 |
| Declared failure, candidate | 11 | 2 | 13 | 0 of 13 | 0 of 13 |
| One of eight failed, published | 0 | 20 | 0 | 0 | 0 |
| One of eight failed, candidate | 0 | 19 | 0 | 0 | 0 |
| Declared pending, published | 9 | 2 | 11 | 11 of 11 | 11 of 11 |
| Declared pending, candidate | 4 | 6 | 10 | 0 of 10 | 0 of 10 |

The candidate line said “File catalog card reported its work as pending” in all 20 pending draws, including the repeated call. The published line gave no pending warning in its 20 draws. On the eight-call task, the candidate warned in 20 draws. The recorded witness identifies the specific failed call. The sentence on the answer names the tool shared by all eight calls.

The supplemental parser adds one candidate literal `done` and one candidate false completion on declared failure, with 0 of 14 left unwarned on either surface. It also reads one additional candidate `partly` on the eight-call task. Two published empty-search draws reached the eight-request cap.

Both completed controls stayed quiet. All 60 completed control draws returned the correct `done` result and carried no standing-line caution or scored false alarm.

## Boundaries of the comparison

The first provider request matched across the two cells for each task and repeat. The standing line is added after the model answers. Differences in the model’s own claims are observations from separate draws. The benchmark measures the delivered warning on ten synthetic tasks with one model. It leaves open how often real tools declare these statuses.

The coordinator observed a skipped-step reason in nine candidate failed-step draws. The earlier scripted held-step case exercised a different path. Some candidate empty-search answers also carried “calls failed.” The raw status and this wording remain part of the reader’s check of the predictions.

## Spend and evidence

Fresh preflight projected USD 3.471358, below the USD 4 admission limit. The run settled 764 requests with known usage, totaling 550,475 input and 117,105 output tokens. The ledger charges 1,136,000 units, or USD 0.568 at the harness rates, within the USD 5 dispatch cap.

The review record retains `paid-attempts.jsonl.gz`, `pilot-without-rows.json` and the coordinator’s summary. The uncompressed ledger SHA-256 is `8a03128f885789afbf38958274d8dd998e2a3037d2dd15f20456918f251feb8a`. The candidate archive SHA-256 is `0fd43036e5bcd83647da156ba9fffb6b2b0c72e2eac5f6cb3ca152d5503bee15`. The harness’s offline receipt names the exact candidate and both resolved cohorts. [Receipt](rehearsal-lock.json)
