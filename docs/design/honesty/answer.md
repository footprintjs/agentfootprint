# Layer 4 · Give the answer — the answer layer

**Stub, 2026-09-27. Nothing new is built.** The standing fold ships first as a pure reader over
recorded runs (step 1); the answer layer runs it inside a live run (step 6). This page holds the
layer's place in the folder and grows with those steps. The design is
[the architecture note](README.md): the layer in § 3.4, the one ledger and the standing fold in § 4,
the placement in § 5.2. Every design question was answered on 2026-09-27
([decisions.md](decisions.md); for this layer Q1, Q3, Q6, Q11 and Q12).

**Law.** The standing is folded from the rows, never from the model's confidence, and "known"
needs a row that supports it.

Code is cited as `file · symbol`, as in the architecture note: paths are under `src/`, and
`findings/`, `stages/` and `evidence/` mean `src/core/agent/<folder>/`.

## What exists today

The architecture note § 3.4 lists it by clause:

- **Declare** — posture, shapes, exempt; `.claims()`; `.outputSchema()`; `.answerValidation()`;
  `.limitsTravelWithTheAnswer()`; the answer's own `_findings`, peeled in the Route decider
  (`findings/peel.ts` · `peelAnswerFindings`, `stages/route.ts` · `peelAnswerStandings`).
- **Verify** — `stages/route.ts` (schema → steps → `judgeEvidence` → claims); `evidence/gate.ts` ·
  `checkAnswer`; `integrity/prior-turn-evidence/`; `answer-validation/validate.ts` ·
  `executeAnswerValidation`.
- **Record** — `unsupportedValues`, `outputAttempts`, `stoppedEarly`, `answerValidation`; the
  answer's `ContingentRow`s.
- **Resolve** — revise once (`stages/evidenceRecheck.ts`); refuse (rails, `.answerValidation()`, a
  message `deny`); flag.
- **After the run** — `lib/answer-account/account.ts` · `accountForAnswer`, which reads events.
  `lib/answer-account/facts/howSure.ts` still says the whole-answer standing is not built.

## What the plan adds

- **Step 1 — the standing as a pure reader ($0).** `assessment/assess.ts` · `assessAnswer` over
  recordings, from existing rows only: four values (`known`, `unrefuted`, `unknown`,
  `not-applicable`), rendered known · consistent with the record · not sure · ask · not assessed,
  with precedence ask > not sure > known > consistent > not assessed; the reasons marked "1" in
  architecture § 4.2; `howSure.ts` and the lens chip read it. First in the step: the fold's
  confusion table against the oracle over the retained recorded runs, and the parity test with the
  study's frozen RQ3 — run now over the recorded runs and re-run at the study's freeze (Q12).
- **Step 6 — the answer layer in the run.** A subflow at the head of the final branch (Q3), whose
  rows return through Final's output mapping; committed witness rows for the verdicts that are
  events only today (the gate's "grounded" and unfinished steps), filed by the Route decider under
  the layer's arm; the standing as data — a field on the run's result and one event,
  `agentfootprint.answer.assessed` (name open), carrying the value, the reason kinds and the checked
  list, no values; a prose line only under its own arm, refused with `.answerValidation()`; and a
  test that the in-run fold equals the fold of the same recording read afterwards.

**Resolve verbs here.** Label only. No ask at the answer: the call that could have used an answer
has already run, and the library never replaces the model's reply with a question.

**Gaps left.** "No errors" and small numbers are never checked by the gate; a question asked in
prose reads as an answer (the fold has no row for it; RQ3 labels it from the reply by hand).

## Its benchmark

The protocol is the architecture note's § 6.1. Provoking cases: the paper study's absent and
wrong-kind cases (its C, D and F kinds: false non-existence, overclaim). Baselines: the model's
verbalised confidence, and its own `_findings` answer standing. No served honesty arm is on in any
study arm (architecture § 6.3).

## What the answer layer lets you measure

From the record alone: **answers that exceed their standing** — a flat non-existence or
completeness claim on an answer whose standing is not sure or ask (RQ3's `exceeds`); the standing
mix per model; grounded values; unsupported values; claim contradictions. The same rows feed the
bench, the paper and the lens. They measure claims within evidence, not whether an answer is true.
