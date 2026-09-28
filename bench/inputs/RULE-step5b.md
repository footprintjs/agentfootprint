# Inputs bench — step 5's second registration: declared sources through the sources-only door

Registered 2026-09-28, before the first paid call of this registration. Rule id:
`inputs-rule-step5b`.

The first registration (`RULE-step5.md`, `inputs-rule-step5`) failed on Haiku 4.5. Its null stays
recorded as a null (`runs/haiku45-step5`). The model almost never declared `from` for the person's
words, so stated values were asked (S5-1 0.08, S5-5 0.91). Riding `.findings()` cost 4.91 × the
input tokens per call (S5-8). S5-9 measured 1.1501. The library was then redesigned (decisions
Q44), and this page registers the same bench against the arm the library now documents.

`bench/inputs/rule.mjs` (`judgeStep5b`, `STEP5B_MARGINS`) transcribes this page, and
`test/bench/inputs/rule-step5b.test.ts` pins the margins below. Where the two disagree, this page
wins. `RULE-step5.md` and its code do not move: v1's saved runs rescore to v1's verdict byte for
byte, with no model call (`run.mjs --rescore`).

## What is compared

One invocation, two arms, interleaved: `--arms off,full-b --judge step5b`.

| Arm | The agent |
|---|---|
| `off` | As in `RULE-step5.md`: the tools as the sheet writes them. |
| `full-b` | The `full` arm's tools, unchanged: every period argument is ruled `ask`, and its choices carry the author's phrases (`AUTHOR_PHRASES`) and `period`. The agent is built with `.inputsLayer({ argumentSources: true })` and no `.findings()`. The three ruled tools carry `_findings.from`, which comes first, is required and is explained once. The armed ask sentence names `_findings.from`, and an answered note permits `turn`. No other tool carries anything. |

The simulated person, the refusal of an unarmed record (`honestyLayers.argumentSources`) and the
22 cases (`ALL_CASES`) are the same as in `RULE-step5.md`, and so are its sets and terms.

## Clauses

**S5-1 … S5-8 are `RULE-step5.md`'s**, with the same words and the same thresholds, and they are
computed by the same code: `judgeStep5b` runs `judgeStep5` with `full-b` as the armed arm. S5-8's
input tokens are the uncached tokens plus cache reads and cache writes (v1's amendment).

| Clause | What must hold | Threshold |
|---|---|---|
| **S5-9** (re-based) | The served decoration `full-b` adds over the steps 3–4 agent (the same ruled tools, with no sources): characters of system prompt and tool schemas per request, on the scripted requests of all 22 cases (`harness.mjs` · `measureServedB`, $0) | ≤ 1.15 × the steps 3–4 agent |
| **S5-10** (added) | On L5 under `full-b`: period calls whose current row is `said` (not a reading) or `app`, which files them as the person's words, as a share of L5 period calls | ≤ 0.10 |

**Why S5-9's base changed.** v1's base was the `.findings()` agent, because v1's arm rode on
`.findings()` and S5-9 measured what sources added over the agent they needed. `full-b` never
serves the ledger. The agent it adds to is the steps 3–4 agent, so v2 measures against that
agent. Measuring over `.findings()` would compare against bytes this arm does not serve.

**Why S5-10.** A required `from` must not turn "our 24h status page" into the person's period.
The guard only makes the rule stricter. At N = 6, one L5 call filed as the person's is 1 of about
6, which fails, so in practice S5-10 passes only when no L5 call is filed as the person's.

### What was known when this rule was registered ($0, deterministic)

- **Characters of system prompt and tool schemas per request** (the scripted requests of all 22
  cases): `off` 1,655; the steps 3–4 agent 1,890; `full-b` 4,479. S5-9 is therefore 2.3698, and
  **S5-9 fails on the day it is registered**. The `_findings` property with `from` alone is 795
  characters on each of the three ruled tools, and the armed sentence adds about 55 more to each.
  The ceiling was not moved to fit.
- **S5-8 is expected to fail.** `full-b` serves 2,824 more characters per request than `off`. At
  the 0.288 tokens per served character v1 measured, that is about 1,989 input tokens per call,
  against `off`'s 1,175 (about 1.69 ×).
- **So this registration's verdict is FAIL before the paid run, on cost**, as v1's was. The run is
  made for the same reason v1's was. S5-1, S5-5 and S5-10 are the behaviour the redesign changed,
  and the report says which clauses failed. A FAIL on cost alone is a different finding from a
  FAIL on behaviour.
- **The scripted run of both arms** (`--arms off,full-b --judge step5b` on the mock; 116 runs, no
  error, no script ran out) proves the harness and the reader, never a model. It reads FAIL on
  S5-1, S5-5, S5-8, S5-9 and S5-10: the mock's L5 script quotes "24h" on purpose, and S5-10 catches
  it.

## The protocol

1. **Model.** Haiku 4.5 only (`claude-haiku-4-5-20251001`), through the package's own Anthropic
   adapter. No temperature is sent. `maxTokens` is 1024 and `maxIterations` is 6.
2. **Cases.** All 22 (`ALL_CASES`).
3. **Repetitions.** N = 6 per case per arm (`--runs 6`), 264 runs. N is chosen by the projection
   below: N = 6 is the largest N whose projected cost is at most $1.90.
4. **One invocation, arms interleaved**, with a fresh seed, 368417884 (v1 used 20260927), and
   `--concurrency 2`.
5. **Fresh state and reading from the record**, as in `RULE-step5.md`.
6. **Cap.** `--max-usd 1.95`, under the $2.00 reserved for this run in the overnight spend log. The
   bench stops rather than cross the cap, and the stop is written into the results. A clause is
   computed over the runs that finished, and an empty denominator is NOT-MEASURABLE.
7. **Spend recorded** in the overnight spend log, and the reservation is released.

**The projection.** It comes from the $0 scripted run: every scripted variant of the 22 cases once,
58 runs per agent (`measureServedB` · `projection`). Tokens are the whole request (system, tools
and messages) and the reply (text and tool calls) at characters ÷ 4, the mock provider's own
heuristic extended to the tool schemas it leaves out, priced at Haiku 4.5's list prices with no
cache.

- The mock measured `off` at $0.001309 per run and `full-b` at $0.002967 per run.
- The mock undercounts a real run. It has no tool-use system prompt, shorter answers and fewer
  calls. So both figures are scaled by v1's real `off` arm over the mock's `off`, on the same 22
  cases and the same model: $0.7425 ÷ 176 runs = $0.004219 per run, ÷ $0.001309 = × 3.22.
- The projected cost per repetition, both arms, is $0.303: **N = 6 gives $1.82** and N = 7 gives
  $2.12.
- Cross-check from v1's measured tokens per served character and calls per run: $1.47 at N = 6.

## Verdicts

As in `RULE.md`: **PASS** when every gated clause holds, **FAIL** when any fails (the null is
recorded, and the arm stays opt-in with the null stated, or is withdrawn; the owner decides), and
**NOT-MEASURABLE** when a clause had nothing to count (this is not a pass).

## Reported, not gated

R5-a … R5-j as in `RULE-step5.md`: the declared-source rate, the verified rate, the failed-claim
mix, readings, hints and one-token quotes (R5-e), asks per set, names (tracing a host back to the
result it came from), the L5 limit (R5-h), `turn` claims (T5, R5-i), and tokens and dollars. The
report also gives the standing mix and the cost per arm.

## Margins

These are the numbers `rule.mjs` · `STEP5B_MARGINS` carries. The first eleven are
`STEP5_MARGINS`, unchanged, and `test/bench/inputs/rule-step5b.test.ts` pins this table.

| Key | Value |
|---|---|
| `verifiedShare` | 0.8 |
| `standingShare` | 0.8 |
| `meantGain` | 0.3 |
| `fakeVerifiedCeiling` | 0 |
| `needlessAskCeiling` | 0.1 |
| `personDrop` | 0.1 |
| `factsDrop` | 0.05 |
| `inputTokensRatio` | 1.15 |
| `modelCallsRatio` | 1.2 |
| `servedRatio` | 1.15 |
| `alpha` | 0.05 |
| `limitFiledCeiling` | 0.1 |
