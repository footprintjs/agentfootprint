# Paired pilot plan

This plan is for the coordinator after review. The rehearsal incurred no model cost.

## Runs and model

Run five blocked tasks × two published cohorts × one paired repeat = **10 runs**.
The runner interleaves before/after within each task in the frozen task order.
Each run gets at most two generation attempts. The failed-step case gets at most
three on either cohort so the 15.0.0 continuation can finish. The entire batch can
dispatch at most **22** times. A missing or invalid answer remains in the results.

Use `claude-haiku-5-5`, the model named in #351's original rule and used in the
earlier benchmark batches. Keep default thinking and sampling, no caching,
no SDK retries and no server-side tools. Cap every response at 4,096 output
tokens, inclusive of thinking. The coordinator supplies the adapter described
in the [runner instructions](README.md).

## Sizing from the rehearsal

The runner measures the UTF-8 bytes of each JSON projection of system text,
messages and tool definitions. Estimates below take the largest of the three
scripted answer variants for each task and version. For a request with `B`
input bytes the planning estimate is `ceil(B / 2) + 406` input tokens,
including room for tool framing. These are input estimates before vendor
serialization and tokenization.

| Case | 14.10.1 requests | Estimated input tokens/run | 15.0.0 requests | Estimated input tokens/run |
| --- | ---: | ---: | ---: | ---: |
| Unavailable tool | 2 | 1,646 | 2 | 1,646 |
| Refused call | 2 | 1,605 | 2 | 1,605 |
| Declined call | 2 | 1,604 | 2 | 1,604 |
| Failed step | 2 | 2,591 | 3 | 4,826 |
| Empty search | 2 | 1,605 | 2 | 1,605 |

The rehearsal-shaped pilot projects about 20,337 input tokens and at most
86,016 output tokens over 21 dispatches. Using the short-request rates of
$0.10/M input and $0.50/M output, that totals about **$0.0451** when every
rehearsal-shaped response uses its full output budget. Actual tokens and
request choices can differ. The spend check uses the following bound instead.
[Haiku 5.5 reference](https://platform.claude.com/docs/en/models/haiku-5-5/overview) ·
[Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Reserve each dispatch at the higher $0.50/M input and $2.50/M output tier, with
the full 1,000,000-token context charged as input and 4,096 output tokens added.
That is $0.510240 each, or **$11.225280 for 22 dispatches**, leaving **$3.774720**
of the $15 ceiling. This envelope assumes a standard uncached generation,
no separately billed tools, and no additional SDK or transport attempts.
Every dispatch, including one with no recorded usage, consumes the full
reservation. Any adapter whose billing differs needs a new estimate before use.

Cut the legacy closed-set matrix, extra arms, model judges, paid success control,
and additional repeats. This keeps the comparison trap-first with one complete
pairing and reserve. Counts are descriptive pilot results, with insufficient
independent tasks and repeats for a statistical improvement claim.
