**Fold** — the answer's standing, folded from the run's committed record: known · consistent with the record · not sure (with the reasons) · ask · not assessed.

**The law.** The standing is folded from the rows, never from the model's
confidence, and "known" needs a row that supports it.

```ts
import { assessAnswer } from 'agentfootprint/observe';

const a = agent.assessment();            // the last run — or, from a saved recording:
const b = assessAnswer(recording);       // the same fold over the same committed rows
a?.standing;                             // 'not-sure'
a?.reasons.map((r) => r.reason);         // ['empty-undeclared']
a?.checked;                              // [{ layer: 3, check: 'result-shape', ran: 1, of: 1, … }, …]
```

The runnable example is `examples/features/73-answer-standing.ts`: three lookups
answer one question — a bare `[]` reads "not sure" (`empty-undeclared`), an
`absent()` that names a gap reads "not sure" with the reasons a person can act on
(`coverage-gap`, `declared-absent`), and rows with nothing declared read
"consistent with the record" — never "known".

## The values, and the words

`assess.ts` · `assessAnswer` returns `AnswerAssessment` (`types.ts`). The value
set is the honest-answer design's (`assessment`), and `standing` is the owner's
rendering of it — derived from the value and the reasons' class alone, never a
second value set:

| `assessment` | `standing` | When (this turn's committed rows) |
|---|---|---|
| `unknown` | `ask` | a reason of the ask class fired: a typed question is still waiting |
| `unknown` | `not-sure` | any other reason fired |
| `known` | `known` | a SUPPORTING row, and no reason: a passed enforce answer check (`.answerValidation()`) for these exact bytes |
| `unrefuted` | `consistent` | at least one check ran, none fired, nothing supports — never "verified" |
| `not-applicable` | `not-assessed` | no check's verdict is on the committed record |

Precedence: ask > not sure > known > consistent > not assessed.

## The reasons — one committed row each

`reasons.ts` · `REASONS` is the closed table: each reason's layer, its class and
the row it is read from. A reader skips a reason it does not know — the union
grows as later honesty steps commit new rows.

| Reason | Layer | Read from |
|---|---|---|
| `asked` | every | the paused run's checkpoint: `pauseData.awaitingInput` (a tool's own `requestInput`), never the pause event |
| `coverage-gap` | 3 | `coverageDeclared`: a `notChecked` or `cannotCover` item on a call of this turn |
| `declared-absent` | 3 | `coverageDeclared`: an absence; or `history`: an empty rowset inside a declared `coverage()` boundary |
| `empty-undeclared` | 3 | `history`: an empty rowset (a top-level array, or the app's `rowsAt` key) whose call has no coverage row |
| `sources-conflict` | 3 | `findingsLedger`: a conflict row whose witnesses name a call of this turn |
| `value-unsupported` | 4 | `unsupportedValues` (`revised: false`) |
| `value-survived-revision` | 4 | `unsupportedValues` (`revised: true`) |
| `stopped-early` | 4 | `stoppedEarly` |
| `answer-check-failed` | 4 | `answerValidation`: `status: 'failed'` |
| `check-unreachable` | every | `answerValidation`: `status: 'unverified'` — an armed check that could not reach a verdict |

Every result is read through the ONE emptiness reader,
`core/agent/coverage/emptiness.ts` · `readEmptiness`, the one the answer account
reads through too — so the person's account and the answer's standing cannot
disagree about what came back. The fold hands it the door the RECORD holds for
the call (its coverage rows): an envelope a tool returned as JSON text, which the
run never recognized, is data, not a declaration.

## Seven rules the fold keeps

1. **No "known" from silence.** Nothing fired is `unrefuted`, and `checked`
   shows how little ran.
2. **No membership pass supports.** A result that came back non-empty, a value
   found in a result, a declared boundary with no gap: each can keep a reason
   from firing; none supports "known". Only a tie check does.
3. **An unarmed check is not a reason.** It is simply absent from `checked`,
   which is printed as it is.
4. **Declared silence is a reason.** An empty rowset that said nothing about
   what it searched is `empty-undeclared`.
5. **This turn only.** The turn begins after the last message a person said
   (`lib/saidByPerson.ts` · `isSaidByPerson`, the one owner of that question —
   a library frame is not a person's turn); `turnFrom` says where the fold began.
6. **"Rests on" is every call of the turn.** It may over-report; it never hides.
7. **The model's own answer-level standing never moves the value.** A lens may
   show it beside the word.

## The layer contract (layer 4 · give the answer), as this step ships it

| Clause | Here |
|---|---|
| DECLARE | existing: `.answerValidation()`, `.namesAndNumbersFromEvidence()`, `.claims()`; the tools' `absent()` / `coverage()` / `describedResult()` |
| VERIFY | existing: the Route decider's checks (`core/agent/stages/route.ts` · `judgeClaims`), `core/agent/evidence/gate.ts` · `checkAnswer`, `answer-validation/validate.ts` · `executeAnswerValidation` |
| RECORD | existing committed keys only — nothing new is written |
| RESOLVE | label only: the fold never asks, refuses or rewrites |
| FOLD | `assess.ts` · `assessAnswer` — pure, committed rows only, one function for every reader |
| SERVE | data: `agent.assessment()`, `assessAnswer` on `agentfootprint/observe`; the answer account's "How sure" row (`lib/answer-account/facts/howSure.ts` · `readHowSure`). Nothing reaches the model |
| ARM + MEASURE | none — a reader: nothing runs inside a run, so every run's bytes are what they were; this README's last section |

## Parity with the study's RQ3 rule

`test/core/agent/assessment/rq3-parity.test.ts` runs this fold and a
transcription of the study's registered RQ3 algorithm (standing per turn from
recorded EVENTS) over the same recorded runs: ASKED ↔ `ask`, NOT-COVERED ↔
`coverage-gap`, DECLARED-ABSENT ↔ `declared-absent`, FOUND ↔ `unrefuted` (never
`known`), UNKNOWN ↔ "the record cannot vouch" (`not-applicable`, or only
`empty-undeclared`). Two differences are named and pinned, both in one
direction — the fold says more, never less: RQ3 scopes to the entity the
question names and the fold reads every call of the turn (`entity-scope`); RQ3's
DECLARED-ABSENT reads only the last lookup and the fold reads every one
(`last-lookup`).

## Not covered

- **Verdicts that exist only as events.** The evidence gate's clean pass
  (`agent.evidence_checked`), the `.claims()` dispositions — so `claim-contradicted`
  and a claims-supported "known" — and the integrity dispositions are not on the
  committed record in this version. The fold never reads events; the step that
  needs each verdict commits one row, and its reason joins `REASONS` then.
- **Asks other than a typed input.** A check-in or a middleware ask awaits a
  DECISION, not an input; it is not the `asked` reason.
- **A trimmed recording.** A snapshot without its `coverageDeclared` (the answer
  account's reduced fixture is one) reads "not assessed" even when its events
  show an absence — `test/core/agent/assessment/fold-real-record.test.ts` pins it.
- **Subject placement.** Which entity the question names is on hold, so the fold
  reads every call of the turn.
- **The run-time answer layer, the served standing and its event** — a later
  step; this one is a reader.

## What it lets you measure

From the record alone, per model and per prompt or skill version: the **standing
mix** (known · consistent · not sure · ask · not assessed); the **reason mix**,
per layer; **how much actually ran** (`checked`: how many calls declared what
they covered, how many results could be read at all — the unreadable share); the
**empty-undeclared rate** (empty results that did not say what they searched);
and, beside a rater's claim label, **answers that exceed their standing** — a
flat non-existence or completeness claim on an answer whose standing carries
`declared-absent` or `coverage-gap` (the study's `exceeds`). The limit: it
measures claims within the record, not truth — a tool that misstates what it
searched produces an honest-looking standing.
