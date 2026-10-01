# Time bench: the registered success rule for the unread-words line

Registered 2026-10-01, before the first paid call of this rule. Rule id: `time-rule-unread`. It
reuses the T6b bench ([RULE.md](RULE.md)) for its sheet, its harness and its simulated person.
Nothing in `RULE.md` or `RULE-v2.md` changes.

`bench/time/rule-unread.mjs` (`judge`, `MARGINS`, `unreadRowOf`) is this page written as code, so
the verdict is computed, not argued. If the two disagree, this page wins, and the code is fixed
before any paid run reads it. `test/bench/time/rule-unread.test.ts` fails if the margins below
drift from `MARGINS`.

## The question

When the English reader cannot read the person's time words at all ("yesterday morning", "last
week"), the library holds no reading to confirm. Its own form still asks the person which time
they meant, with nothing filled in — but only when the model calls the period tool with the period
left out. In the T6b runs (`runs/haiku45-t6b-v2`) Haiku 4.5 never made that call on
`yesterday-morning`: 15 of 15 runs asked the person in prose, with no tool call, so the library's
ask never opened. The 2026-10-01 demo video showed the same on an app ("which clients had slow
operations yesterday morning"). The served line then read: "The window for “yesterday morning” is
not settled yet: the library could not read those words, so its own form asks the person which
time they meant, with nothing filled in, and it opens when client_activity is called with
start_time, end_time left out … So the next step is that call — not a question about the time in
the reply …".

The fix (`arguments/serve.ts` · `unreadSentence`) follows the serving playbook's last link,
phrasing: it serves the library's conclusion and the ONE next step first, then the move not to
make: "The library could not read “yesterday morning”, so the next step is to call client_activity
with start_time, end_time left out, or search_logs with window left out: that call opens the
library's own form, which asks the person which time they meant, with nothing filled in (or the
call is refused with the reason). Do not ask about the time in the reply — the form asks it — and
do not write a window into the call, which would run unconfirmed."

The question: does the new line make the library's free-entry ask open on unreadable phrases, by
a large margin, without harming the controls?

## What is compared

Both arms run the T6b sheet (`cases.mjs`: the system prompt, the two tools, `.time({ zone:
'America/Los_Angeles', reader: englishTimeReader() })` — T6b's arm `on`). They differ only in the
BUILD of the library:

| Arm | Build |
|---|---|
| `before` | the released build at commit `21fbe0ae` (agentfootprint 9.134.2), built, read-only (`--before <dir>`) |
| `after` | this branch at the rule's commit, built (`npm run build`) |

`run-unread.mjs` · `loadDoors` refuses a `before` build whose `dist/esm/core/agent/arguments/serve.js`
already holds "The library could not read “" and an `after` build that does not.

## The cases (from `cases.mjs` · `CASES`, unchanged)

| Role | Case | Message | Tool the person means |
|---|---|---|---|
| unread | `yesterday-morning` | What client activity was there yesterday morning? | `client_activity` |
| unread | `last-week` | Any errors last week? | `search_logs` |
| control | `c-node` | Which clients were busiest on node 11? | `client_activity` |
| control | `c-backup` | Any errors on the backup service? | `search_logs` |

An unread run ends at its FIRST ask, unanswered (`harness.mjs` · `runCase`, `maxAnsweredAsks:
0`, kept as `pendingAsk`): this rule measures whether the ask opens, not what follows it. A control
run is T6b's: every ask is answered by the case's person and the run goes on to its answer.

**Labels** are deterministic, from the record only (`rule-unread.mjs` · `unreadRowOf`). No model
judges.

- **free-entry ask opened**: the run's first ask (answered or pending) holds a `time-range` field
  that offered no value — the library's own form, nothing filled in.
- **asked in prose**: the run ended with an answer, made no tool call, and its answer holds a
  question mark (reported).
- **wrote its own window**: a period tool READ a window (the tools' read log) before any ask
  (reported).
- **completed**: the run ended with an answer (controls).
- **time ask**: an ask with a `time-range` or `zone` field (controls).
- **served the new line**: the run's first request's late time line holds "The library could not
  read “".

## The protocol

- **Model:** `claude-haiku-4-5-20251001` only, through each build's own Anthropic adapter. No
  temperature is sent. `maxIterations` 6, `maxTokens` 1024 (the T6b harness).
- **Repetitions:** N = 15 per case per arm: 4 × 2 × 15 = 120 runs.
- **Interleaving:** one invocation, both arms. Within each repetition every (case, arm) pair runs
  in a seeded shuffle (`run-unread.mjs` · `planOf`). The seed is drawn fresh with
  `crypto.randomInt` at the start of the invocation and recorded in `results.json`.
- **Cost:** the T6b-v2 run measured $0.0016–$0.0028 per run on these four cases, and an unread
  run here ends at its first ask, so about $0.25 in all. The cap is `--max-usd 0.35`, at
  concurrency 2. `run.mjs` · `runPlan` stops before any run its projection would carry past the
  cap; a stopped run is judged on what it holds.
- **Stopping early:** only for a harness bug. It is fixed at the root, this page stays frozen,
  and the re-run draws a fresh seed.
- **Order:** the scripted $0 run (`node bench/time/run-unread.mjs --before <dir>`) comes first and
  checks the harness. Then this page and its code are committed and pushed. Only then does the
  paid run start.

## The rule

PASS only when every clause passes and each had runs to count. FAIL when any fails.
NOT-MEASURABLE when one had nothing to count and none failed.

| Clause | What | Passes when |
|---|---|---|
| U1 | The free-entry ask opens on unread words (primary) | over the unread cases' runs that did not error, both cases pooled: `after`'s share of runs whose free-entry ask opened ≥ `before`'s share + `gain` (absolute) |
| U2 | Controls still complete | answered share of control runs: `after` ≥ `before` − `completedMargin` |
| U3 | Controls raise no time ask | control runs with a time ask: `after` ≤ `before` + `controlTimeAsks` |
| G1 | The harness ran | errored runs (and, on controls, stuck runs) at most `errorRate` of each arm |
| G2 | The arm was armed | `after` unread runs that served the new line on their first request ≥ `servedNewLine`; no `before` run served it |

**Reported, not judged:** per case and arm — the free-entry ask opened, asked in prose, wrote its
own window, completed, time asks, served the new line, model calls; spend.

## Margins

These are the numbers `rule-unread.mjs` · `MARGINS` carries.

| Key | Value |
|---|---|
| `gain` | 0.4 |
| `completedMargin` | 0.1 |
| `controlTimeAsks` | 0 |
| `errorRate` | 0.05 |
| `servedNewLine` | 0.95 |

## If the rule fails

The rule stays frozen. We follow the serving playbook in order and fix the earliest broken link
at the root: (1) is the fact right in the record (`pendingUnread`)? (2) is it served? (3) late, at
the decision point? (4) phrased as the conclusion and the one next step? A re-run then uses a
fresh seed under this same rule. A null is recorded as a null.
