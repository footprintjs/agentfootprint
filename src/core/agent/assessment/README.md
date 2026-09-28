**Fold** — the answer's standing, folded from the run's committed record: known · consistent with the record · not sure (with the reasons) · ask · not assessed.

**The law.** The standing is folded from the rows, never from the model's
confidence, and "known" needs a row that supports it.

```ts
import { assessAnswer } from 'agentfootprint/observe';

const a = await agent.assessment();      // the last run — or, from a saved recording:
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
| `unknown` | `ask` | a reason of the ask class fired: the turn ended in a pause still waiting for a person |
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
| `asked` | every | `pausedToolCallId`: the call a pause is still waiting on — a typed input (`requestInput`), a question (`askHuman` / `pauseHere`), a consent gate (a tool's `checkIn`, a middleware's `ask`) or a credential consent; never the pause event |
| `argument-asked` | 2 | `argumentAsk`: the inputs layer's batch ask with a question still out (`waiting`) — nothing in that batch has run; this turn's current `asked` rows on `findingsLedger` name the values; never the pause event |
| `argument-assumed` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'default'` — a tool's `askOrAssume` rule filled the value, or the model sent that same default; or `middlewareDecisions`: a before-tool rewrite of a ruled argument (`changedKeys`) with no declared origin (`allow(args, why, { from })`) |
| `argument-unverified` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'model'` on a ruled argument, or with a failed declared-source check |
| `coverage-gap` | 3 | `coverageDeclared`: a `notChecked` or `cannotCover` item on a call of this turn; or `history`: the result's own envelope lists one, when its call has no coverage row |
| `declared-absent` | 3 | `coverageDeclared`: an absence; or `history`: an empty rowset inside a declared `coverage()` boundary, or an absence in the result's own envelope when its call has no coverage row |
| `empty-undeclared` | 3 | `history`: an empty rowset (a top-level array, or the app's `rowsAt` key) whose call has no coverage row |
| `period-not-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `not-held` — the store holds none of what the read asked for (honesty step 7b) |
| `period-partly-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `partly-held` |
| `period-unknown` | 3 | `findingsLedger`: a `period` row of this turn with verdict `unknown` — the tool declared `held: 'unknown'`, on a non-empty result too (adopted Q33) |
| `period-undeclared` | 3 | `findingsLedger`: a `period` row of this turn with verdict `undeclared` — the tool declares a `ToolPeriod` and its result declared no period |
| `sources-conflict` | 3 | `findingsLedger`: a conflict row whose witnesses name a call of this turn |
| `value-unsupported` | 4 | `unsupportedValues` (`revised: false`) |
| `value-survived-revision` | 4 | `unsupportedValues` (`revised: true`) |
| `stopped-early` | 4 | `stoppedEarly` |
| `answer-check-failed` | 4 | `answerValidation`: `status: 'failed'` |
| `check-unreachable` | every | `answerValidation`: `status: 'unverified'` — an armed check that could not reach a verdict |

The inputs layer's rows (honesty layer 2, `core/agent/arguments/README.md`) are
read for THIS turn only — the ledger crosses turns, and every `argument` row
carries its `turn` — and the last row per (call, argument) is the current one.
When the layer filed any, `checked` gains `argument-rules` (layer 2): every row
is a verdict, so `ran` equals `of`. No argument row ever supports "known": a
membership pass only keeps a reason from firing.

The results layer's `period` rows (honesty layer 3, `core/agent/results/README.md`)
are read for this turn too — but EVERY row, never the last per call: the layer
files one row per judged call, so a second row under an id is another call (a
leg resumed with `resumeOnError` repeats the failed leg's synthetic ids, and a
provider may reuse an id across batches), and a later `covered` must not hide an
earlier `not-held`. `covered` fires nothing;
each other verdict fires its `period-*` reason, and its witnesses are the `period`
row AND, when the tool declares a `ToolPeriod`, the inputs layer's `argument` row
for the same call and argument — who chose the period, beside what the read
covered (the join, joined by call id and argument name; neither side parses the
other's words). When the layer filed any, `checked` gains `result-period` (layer
3). No period row ever supports "known".

```ts
// backup_runs read the 02:00 export for 09:00–10:00 → absent({ …, period }) → verdict not-held
(await agent.assessment())?.reasons.map((r) => r.reason); // ['declared-absent', 'period-not-held']
```

Every result is read through the ONE emptiness reader,
`core/agent/coverage/emptiness.ts` · `readEmptiness`, the one the answer account
reads through too. A call with committed coverage rows is read through the door
those rows are. A call with NONE is handed no door, so the reader reads the
envelope in the bytes (`declaredByValue`, the rule the run's own recognizer files
rows by) — and a gap it lists is a `coverage-gap`. Committed state can lose a
row the run filed, and the fold must not read that as silence:

```ts
// agent.run() → find_vm returns absent({ …, notChecked: ['powered-off VMs'] }) → the provider
// fails → agent.resumeOnError(cp) → list_hosts returns rows → 'No VMs are hosted on host-9.'
(await agent.assessment())?.reasons.map((r) => r.reason); // ['coverage-gap', 'declared-absent']
// The checkpoint carried the history (the envelope) and not `coverageDeclared` (the row).
```

The cost, named: an envelope a tool returned as JSON TEXT that the run never
recognized (an `mcpClient` in text mode) is read as a declaration here, while the
account's "It found" — which reads this run's calls through their EVENTS, a door
that is always there — calls it "returned a result". The fold may over-report;
it never hides.

## How the turn ended

The standing is about an answer, so the turn's end is settled first:

| The turn ended | `agent.assessment()` | `assessAnswer(recording)` | the account's "How sure" |
|---|---|---|---|
| in an answer | the fold | the fold | the fold |
| in a pause (any kind — the library's own batch ask included, `argument-asked`) | `ask` | `ask` | "Ask — the run stopped to ask a question before it could answer:" |
| in an error before any answer (it threw, or a rule halted it — a policy halt, a fail-fast, an input denial) | `undefined` | not settled — see Not covered | "How sure cannot be told: this record does not show the run giving an answer." (no `turn_end`) |
| in an answer a rule then refused (`UnsupportedValuesError`, `AnswerValidationError`, …) | `undefined` — `run()` returned no answer; the typed error carries the verdict | the fold | the fold — the record holds the answer (a `turn_end`), and the account explains that one |

A pause is read from the committed state every pause leaves —
`pausedToolCallId`, written by each pause the dispatch loop raises and cleared
by each resume — so the snapshot, the checkpoint and a saved recording all say
it, and no checkpoint is needed:

```ts
const out = await agent.run({ message: 'shut the down port' }); // a tool called askHuman(...)
(await agent.assessment())?.standing;   // 'ask'
assessAnswer(recording).standing;       // 'ask' — the saved recording alone
accountForAnswer(recording).facts.standing.value; // 'ask'
```

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
| SERVE | data: `agent.assessment()` (async: it loads this fold through `import()` on first use, so an agent that never asks does not carry it — pinned by `test/lib/trace-toolpack/browserGraph.test.ts`), `assessAnswer` on `agentfootprint/observe`; the answer account's "How sure" row (`lib/answer-account/facts/howSure.ts` · `readHowSure`). Nothing reaches the model |
| ARM + MEASURE | none — a reader: nothing runs inside a run, so every run's bytes are what they were; this README's last section |

## Parity with the study's RQ3 rule

`test/core/agent/assessment/rq3-parity.test.ts` runs this fold and a
transcription of the study's registered RQ3 algorithm (standing per turn from
recorded EVENTS) over the same recorded runs: ASKED ↔ `ask`, NOT-COVERED ↔
`coverage-gap`, DECLARED-ABSENT ↔ `declared-absent`, FOUND ↔ `unrefuted` (never
`known`), UNKNOWN ↔ "the record cannot vouch" (`not-applicable`, or only
`empty-undeclared`). Three differences are named and pinned, all in one
direction — the fold says more, never less: RQ3 scopes to the entity the
question names and the fold reads every call of the turn (`entity-scope`); RQ3's
DECLARED-ABSENT reads only the last lookup and the fold reads every one
(`last-lookup`); RQ3's ASKED reads a typed ask only and the fold reads every
pause as `ask` (`pause-kind`). The oracle is a TRANSCRIPTION: the study's frozen
copy (`study/rq3-standing/`) does not exist yet, so the parity is re-run against
it at the study's freeze (adopted Q12).

## Not covered

- **Verdicts that exist only as events.** The evidence gate's clean pass
  (`agent.evidence_checked`), the `.claims()` dispositions — so `claim-contradicted`
  and a claims-supported "known" — and the integrity dispositions are not on the
  committed record in this version. The fold never reads events; the step that
  needs each verdict commits one row, and its reason joins `REASONS` then.
- **A run that threw, read by `assessAnswer` directly.** No committed row says a
  turn ended in an error in this version, so the fold folds what the crashed run
  left, as if it had answered. `agent.assessment()` (which knows) resolves to
  `undefined` and the answer account (which reads the recording's `turn_end`)
  says the record shows no answer; a caller of `assessAnswer` checks the run's
  outcome first. The committed row that settles it arrives with the answer
  layer's witness rows (honesty step 6).
- **A row lost AND its envelope gone.** A record that lost a call's coverage row
  is still read from the envelope in `history` — `fold-real-record.test.ts` pins
  the account's reduced fixture reading the same standing as the full record. A
  record that dropped the history too has nothing left to read.
- **Evicted results.** Under `.window()`, a window strategy can remove this
  turn's early results from `history`; the commit log still has them, but the
  fold reads the final state, so an evicted undeclared `[]` fires nothing.
- **Conflicts from an earlier turn that reuse a call id — on an agent without an
  honesty layer.** A carried conflict row counts as this turn's when a witness
  shares a `toolCallId` with a call of this turn — a provider that reuses ids
  across turns makes an earlier turn's conflict read `sources-conflict`. It
  over-reports and never hides. While the inputs layer is armed, the one writer
  stamps every row with its conversation `turn` (honesty step 3), and a stamped
  conflict row counts only in its own turn.
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

**Not yet measured.** The design puts the confusion table of this fold against
the oracle over the retained recorded runs first in this step. It is blocked by
data, not code: the retained selection-arm records are event streams and routing
shadows with no committed state, so a fold that reads only committed state
cannot run on them. The fix is the data path — the step-2 inputs baseline saves
`recordRun` recordings WITH their snapshot, and the table runs over those.
