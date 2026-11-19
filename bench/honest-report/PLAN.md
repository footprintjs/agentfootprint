# Four-cell pilot plan · revision 3

## Schedule

Five blocked tasks and one successful control × both published cohorts × defaults
and the documented answer-label opt-in × 20 repeats = **480 runs**. That is 400
blocked-case runs and 80 controls. The four failed-step preflight runs are part
of repeat one, leaving 476 later runs. Each task interleaves the two cohorts
within each arm. Every run allows eight provider requests, for at most 3,840
dispatch slots before the spend stop.

Use `claude-haiku-5-5`, as named in the original rule and used in the earlier
benchmark batches. Each response has a 4,096-output-token cap, including thinking.
The coordinator's adapter uses default thinking and sampling and exactly one
physical generation attempt without caching, retries or separately billed tools.
[Haiku 5.5 reference](https://platform.claude.com/docs/en/models/haiku-5-5/overview) · [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)

## Scripted sizing

The runner measures the UTF-8 bytes of system text, messages and tool definitions.
The planning estimate is `ceil(input bytes / 2) + 406` per request. The table uses
the largest estimate among scripted answer variants. It applies to both arms
in the rehearsal, which produced identical prompt sizes. Output is charged from
provider usage in a paid run; scripted output cannot forecast adaptive thinking.

| Task | 14.10.1 requests | Estimated input tokens/run | 15.0.0 requests | Estimated input tokens/run |
| --- | ---: | ---: | ---: | ---: |
| Unavailable tool | 2 | 1,648 | 2 | 1,648 |
| Refused call | 2 | 1,607 | 2 | 1,607 |
| Declined call | 2 | 1,606 | 2 | 1,606 |
| Failed step | 2 | 2,593 | 3 | 4,837 |
| Empty search | 3 | 2,737 | 3 | 2,737 |
| Successful control | 2 | 1,604 | 2 | 1,604 |

At those scripted request counts the schedule would use about 1,033,360
estimated input tokens and 63,160 estimated scripted output tokens across
1,080 requests, or about **USD 0.67** at the high-tier prices. Filling the
output cap on every scripted-sized request would instead cost about USD 11.58.

The coordinator's stopped revision-2 batch reported peaks of about 1,300 input
and 270 output tokens per request. At those observed peaks, all 3,840 revision-3
slots would project **USD 5.088** at the high tier
(`3,840 × (1,300 + 5 × 270) / 2,000,000`). The new preflight measures the
actual revision-3 requests before the batch continues.

## Admission and actual spend

1. Run one failed-step case per cell. Print each final input/output pair or its
   flagged fallback. Project each cell's remaining request slots at that
   cell's maximum observed input and output tokens per request, then add
   the four runs' settled costs once. Continue only for a projection of **USD 8
   or less**. Missing usage contributes the reservation values to this projection.
2. Account after each response at **USD 0.50 per million input tokens** and
   **USD 2.50 per million output tokens**, using integer half-microdollars.
   Output already includes thinking. A refusal or failed request without
   reported final usage is charged the estimate used for its reservation.
3. Before each dispatch, booked charges plus the byte-based input estimate and
   full output cap must fit **USD 10**. Separately require room for one physical
   attempt at the full standard-context exposure of USD 0.51024. Replace that
   exposure with actual known cost at settlement. An attempt without usage
   retains its full exposure in this second accounting. There is only one
   in-flight request. A breach stops dispatches and preserves the existing rows.

Both checks rely on the trusted adapter conforming to the model, cap, one-attempt,
uncached and no-server-tools contract. A token-count heuristic alone cannot cap
a real bill. The second check covers estimation error without pre-reserving the full
context for every scheduled run. If usage is inconsistent with the contract, stop.
The USD 8 projection leaves USD 2 before the spend stop and USD 5 below the
original USD 15 authorization. Neither the projection nor the scripted sizing
guarantees that the full schedule will finish.

The plan keeps the successful controls and removes the legacy extra arms, model
judges, closed-set matrix, and separately billed smoke run. It starts with traps.
Report an early stop and the completed denominators without presenting a partial
batch as a complete comparison.
