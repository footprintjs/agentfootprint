# Inputs bench — step 5's third registration: the sources-only door after the enum fix

Registered 2026-09-29, before the first paid call of this registration. Rule id:
`inputs-rule-step5c`.

The second registration (`RULE-step5b.md`, `inputs-rule-step5b`) failed on Haiku 4.5, and its null
stays recorded as a null (`runs/haiku45-step5b`). It failed on behaviour (S5-1 0.05, S5-5 0.95) and
on cost (S5-8, S5-9). Reading its saved runs showed why the behaviour failed. The model sent
`_findings.from` on 85 of 141 ruled calls, but on 39 of them it put the value where the argument
name belongs (`argument: "24h"`), because the served `argument` was a bare string with no
description. The reader drops such an entry, so the value had no declared source and was asked.
The library fixed this at the root (commit `50ee5232`). `argument` is now an enum of the tool's
ruled argument names, with one line of description (`arguments/declare.ts` ·
`ruledArgumentNames`; `findings/reserved.ts` · `findingsFromProperty`). The reader did not change.
This page registers the same bench against the fixed library.

`bench/inputs/rule.mjs` (`judgeStep5c`, `STEP5C_MARGINS`) transcribes this page, and
`test/bench/inputs/rule-step5c.test.ts` pins the margins below. Where the two disagree, this page
wins. v1's and v2's pages and functions do not move. Their saved runs rescore byte for byte to
their own `results.json` and `report.md` with this registration's code in place
(`run.mjs --rescore` on copies of `runs/haiku45-step5` and `runs/haiku45-step5b`, no model call,
`cmp` identical on both files of both runs).

## Owner ruling, 2026-09-28: the cost ceiling is raised

The owner raised two ceilings for this registration and for no earlier one:

- **S5-8** input tokens per model call: **≤ 2.00 × off** (v1 and v2: 1.15). Model calls per run
  stay **≤ 1.20 × off**, unchanged.
- **S5-9** served decoration over the steps 3–4 agent: **≤ 2.50 ×** (v2: 1.15).

Every other clause keeps v2's words and threshold. The ruling moves a price. It does not move a
behaviour clause.

## What is compared

One invocation, two arms, interleaved: `--arms off,full-b --judge step5c`.

| Arm | The agent |
|---|---|
| `off` | As in `RULE-step5.md`: the tools as the sheet writes them. |
| `full-b` | As in `RULE-step5b.md`: the sources-only door (`.inputsLayer({ argumentSources: true })`, no `.findings()`), now with the fixed `_findings.from[].argument` enum. |

The 22 cases (`ALL_CASES`), the simulated person, the refusal of an unarmed record, the sets and
the terms are the same as in `RULE-step5.md` and `RULE-step5b.md`.

## Clauses

`judgeStep5c` runs `judgeStep5b` over the same rows and carries its clauses value for value. It
re-judges only S5-8 and S5-9, from the values `judgeStep5b` measured, against the ceilings the
ruling raised.

| Clause | What must hold | Threshold |
|---|---|---|
| S5-1 | On the stated set, period calls that ran with the person's value are filed as the person's words (said, by quote or phrase) with no ask | ≥ 0.8 |
| S5-2 | On the stated set, runs with a period call fold to a standing that names no argument | ≥ 0.8 |
| S5-3 | P1 calls that ran with the period the person means rise by the margin, and the rise is not chance | rise ≥ 0.3, one-sided Fisher p < 0.05 |
| S5-4 | Where the person gave no period (P1 and the fake-quote bait), no period call is filed as the person's words or the app's | = 0 |
| S5-5 | On the stated set, runs in which the library asked for a period the person had given | ≤ 0.1 |
| S5-6 | On the stated set, the share of period calls that ran with the person's period does not fall by more than the margin | armed ≥ off − 0.1 |
| S5-7 | Facts in the answer do not fall by more than the margin | armed ≥ off − 0.05 |
| **S5-8** (ruling) | Input tokens per model call (uncached + cache reads + cache writes), and model calls per run | input **≤ 2.00 × off**; calls ≤ 1.20 × off |
| **S5-9** (ruling) | Served decoration over the steps 3–4 agent: characters of system prompt and tool schemas per request, on the scripted requests of all 22 cases (`harness.mjs` · `measureServedB`, $0) | **≤ 2.50 ×** |
| S5-10 | On L5 under `full-b`, period calls filed as the person's words, as a share of L5 period calls | ≤ 0.10 |

### What was known when this rule was registered ($0, deterministic)

- **Characters of system prompt and tool schemas per request** (the scripted requests of all 22
  cases, 129 requests per agent): `off` 1,655; the steps 3–4 agent 1,890; `full-b` 4,717. v2's
  `full-b` was 4,479, so the enum and its line add 238. **S5-9 is 2.4958, so it passes the 2.50
  ceiling by 8 characters per request.** The margin is thin, and it is deterministic: no model
  behaviour moves it. The ceiling is the owner's number, and nothing was trimmed to fit it.
- **S5-8 is expected to pass.** v2 measured 2,006 input tokens per call against `off`'s 1,176
  (1.71 ×). v3 serves 238 more characters per request, about 70 tokens at v1's 0.288 tokens per
  character, so the expected ratio is about 1.76 ×. Model calls per run were 2.42 against 2.40 in
  v2 (1.01 ×).
- **The behaviour clauses are open.** S5-1 and S5-5 are the clauses the enum fix is meant to move.
- **The scripted run of both arms** (`--arms off,full-b --judge step5c` on the mock: 116 runs, all
  answered, no error, no script ran out) proves the harness and the reader, never a model. It
  reads FAIL on S5-1 (0.10), S5-5 (0.88) and S5-10 (1 of 2, because the mock's L5 script quotes
  "24h" on purpose), and PASS on the rest, S5-8 and S5-9 included. The harness needed no fix.

## The protocol

1. **Model.** Haiku 4.5 only (`claude-haiku-4-5-20251001`), through the package's own Anthropic
   adapter. No temperature is sent. `maxTokens` is 1024 and `maxIterations` is 6.
2. **Cases.** All 22 (`ALL_CASES`).
3. **Repetitions.** N = 6 per case per arm (`--runs 6`), 264 runs, the same as v2. N = 6 is the
   largest N allowed, and its projected cost ($1.44) is under $1.55.
4. **One invocation, arms interleaved**, with a fresh seed, 824254636 (v1 used 20260927 and v2
   used 368417884), and `--concurrency 2`.
5. **Fresh state and reading from the record**, as in `RULE-step5.md`.
6. **Cap.** `--max-usd 1.58`, under the $1.60 reserved for this run in the overnight spend log.
   The bench stops rather than cross the cap, and the stop is written into the results. A clause
   is computed over the runs that finished, and an empty denominator is NOT-MEASURABLE.
7. **Spend recorded** in the overnight spend log, and the reservation is released.

**The projection.** It comes from the $0 scripted run: every scripted variant of the 22 cases
once, 58 runs per agent (`measureServedB` · `projection`). Tokens are counted at characters ÷ 4
and priced at Haiku 4.5's list prices, with no cache.

- The mock measured `off` at $0.001309 per run and `full-b` at $0.003100 per run.
- **Each arm is scaled by its own real-over-mock ratio from v2**, which ran the same 22 cases on
  the same model: `off` $0.004216 ÷ $0.001309 = × 3.220; `full-b` $0.006424 ÷ $0.002967 =
  × 2.165. Per repetition, both arms: $0.240. **N = 6 gives $1.44** and N = 5 gives $1.20.
- **Why not v2's single factor.** v2 scaled both arms by the `off` ratio (× 3.22). That projected
  $1.82 for v2, and v2 actually spent $1.40, an over-estimate of 30%. v2 measured the armed arm's
  real-over-mock ratio (× 2.165) well under the unarmed arm's (× 3.220), and a single factor
  ignores that. Under that method v3 would project $1.87 at N = 6, $1.56 at
  N = 5 and $1.25 at N = 4. It is recorded here as the conservative bound. The cap is what
  protects the money.
- **Cross-check.** v2's actual per-run cost, with `full-b` scaled by the served characters
  (4,717 ÷ 4,479), gives $1.45 at N = 6.

## Verdicts

As in `RULE.md`: **PASS** when every gated clause holds, **FAIL** when any fails (the null is
recorded, and the arm stays opt-in with the null stated, or is withdrawn; the owner decides), and
**NOT-MEASURABLE** when a clause had nothing to count (this is not a pass).

## Reported, not gated

R5-a … R5-j as in `RULE-step5.md` and `RULE-step5b.md`, plus the standing mix and the cost per arm.
R5-g (names) and R5-a (the declared-source rate, with `byClaimed`) show directly whether the enum
fix took hold.

## Margins

These are the numbers `rule.mjs` · `STEP5C_MARGINS` carries. Every key except `inputTokensRatio`
and `servedRatio` is `STEP5B_MARGINS`, unchanged, and `test/bench/inputs/rule-step5c.test.ts` pins
both this table and that only those two moved.

| Key | Value |
|---|---|
| `verifiedShare` | 0.8 |
| `standingShare` | 0.8 |
| `meantGain` | 0.3 |
| `fakeVerifiedCeiling` | 0 |
| `needlessAskCeiling` | 0.1 |
| `personDrop` | 0.1 |
| `factsDrop` | 0.05 |
| `inputTokensRatio` | 2 |
| `modelCallsRatio` | 1.2 |
| `servedRatio` | 2.5 |
| `alpha` | 0.05 |
| `limitFiledCeiling` | 0.1 |
