# Time bench: the registered success rule for step T6b, version 2

Registered 2026-10-01, before the first paid call under it. Rule id: `time-rule-t6b-v2`.
`bench/time/rule-v2.mjs` (`judge`, `MARGINS`) is this page written as code, so the verdict is
computed, not argued. If the two disagree, this page wins, and the code is fixed before any paid
run reads it. `test/bench/time/rule-v2.test.ts` fails if the margins below drift from `MARGINS`.

## Why version 2 exists

Version 1 ([RULE.md](RULE.md), `time-rule-t6b`, registered 2026-09-30) stays frozen. It is not
edited, and neither is any verdict it gave.

Time gap G16 (agentfootprint PR #52) serves the run clock on every request under `.time()`: the
served time line now opens, on both arms and on every request, with "This turn's time: Friday
2026-10-09 09:00 America/Los_Angeles (UTC-07:00)." It is there by design: apps used to serve their
own clock block, and with the layer armed the model had no date on any turn. A review found that
gap and named it a regression.

Version 1's T2 was written before a clock existed. It counts ANY late time line on an on-arm
control, so it fails by construction once the clock is served. That is what happened: the v1 run
on `fix/time-g13-g14` (`runs/haiku45-t6b-g13-g16`, seed 1900613709) FAILED on T2 with time lines
on 60/60 on-arm controls, every one of them the opening note plus the clock sentence and nothing
else. That FAIL stands in the record.

T2's intent was "no time STEERING on controls that hold no time words": no ask, no reading, and
no served part that tells the model about a window. Version 2 says that directly and splits T2:

- **T2a** keeps the intent: no time ask, no reading row, and no STEERING part in any served line.
- **T2b** allows a clock-only line on every request. It is not free: its cost is bounded by T5
  (the same 1.15× ceiling on input tokens per call, unchanged) and by a new clause, T7: no answer
  on a control reads the clock line as the person correcting it.

Everything else — the question, the arms, the cases, the simulated person, the protocol, every
other clause and every other margin — is version 1's, word for word in effect. `rule-v2.mjs`
computes T1, T3, T4, T5, T6, G1 and G2 by calling version 1's own `judge`, so the two cannot drift.

## What is compared, the cases, the protocol

As in [RULE.md](RULE.md): "The question", "What is compared", "The cases", "The protocol"
(Haiku 4.5 only, N = 15 per case per arm, 390 runs, a fresh seed per invocation, a scripted $0
run first, deterministic labels). The run is started with `--rule t6b-v2`.

## The rule

The result is PASS only when every clause passes and each measurable clause had runs to count.
It is FAIL when any clause fails. It is NOT-MEASURABLE when a clause had nothing to count and
none failed.

| Clause | What | Passes when |
|---|---|---|
| T1 | The gain on readable phrases | as in version 1 |
| T2a | No time steering on controls | on `on`, control runs raise at most `controlTimeAsks` time asks, file at most `controlReadingRows` time-reading rows with a mention, and at most `controlSteeringLines` runs serve a line with a steering part |
| T2b | The clock line is allowed | a clock-only line may be served on every request; the clause holds when T5 and T7 hold |
| T3 | Controls are not harmed | as in version 1 |
| T4 | Unreadable phrases and the future date are not harmed | as in version 1 |
| T5 | The ceiling on tokens per call | as in version 1 (`inputTokensRatio` unchanged) |
| T6 | Never filed as said | as in version 1 |
| T7 | The clock line is not read as the person | among control runs of either arm whose every served line was clock-only, at most `controlMisreads` answers open with the misread pattern |
| G1 | The harness ran | as in version 1 |
| G2 | The arm was armed | as in version 1 |

**A steering part** is anything a served time line says besides its opening note (the `[…]` that
says who speaks) and the clock sentence ("This turn's time: …."): a settled window, a pending or
unread quote, a refused window, a limit, the app's control window. It is read by position and the
clock sentence's own words (`rule-v2.mjs` · `steeringOf`), so a part this rule has never seen
still counts as steering.

**The misread pattern** is the one `time-rule-shift` registered (`bench/time-checks/rule-shift.mjs`
· `MISREAD`), matched against the OPENING of the answer only: "You're right", "Good catch", "My
apologies", "I apologize for…", "Thank you for the clarification", and the like. A refusal that
opens "I apologize, but…" is not a misread. Only control runs whose every line was clock-only are
counted, so a misread there is attributable to the clock line.

**Reported, not judged:** as in version 1, plus the clock-only lines served on on-arm control
requests.

## Margins

These are the numbers `rule-v2.mjs` · `MARGINS` carries. Every one but `controlSteeringLines`
and `controlMisreads` is version 1's value; version 1's `controlTimeLines` is gone.

| Key | Value |
|---|---|
| `alpha` | 0.05 |
| `gain` | 0.15 |
| `controlTimeAsks` | 0 |
| `controlReadingRows` | 0 |
| `controlSteeringLines` | 0 |
| `controlMisreads` | 0 |
| `completedMargin` | 0.1 |
| `askMargin` | 0.1 |
| `hurtMargin` | 0.1 |
| `inputTokensRatio` | 1.15 |
| `saidRows` | 0 |
| `errorRate` | 0.02 |

## If the rule fails

As in version 1: the rule stays frozen, the serving playbook is followed in order, the earliest
broken link is fixed at the root, and a re-run uses a fresh seed under this same rule.
