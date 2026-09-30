**Mixed** — the answer's standing, folded from the run's committed record: known · consistent with the record · not sure (with the reasons) · ask · not assessed — read after the run, and (honesty layer 4, the answer layer) inside it.
Fold: `assess.ts` (the one fold) and `reasons.ts` (the closed reason table).
Map: `witness.ts` (the answer layer's two committed witness rows, filed by the Route decider).
Walker: `stage.ts` (the answer layer's one stage, at the head of the final branch).
Lens: `compose.ts` (the standing as data, and as one line for the person under its own arm).

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

## In the run — the answer layer (`.answerLayer()`)

The same fold, run INSIDE the run, as the first stage of the final branch — after
the Route decider's checks filed their verdicts, before the turn is captured — and
served as data the moment the answer exists:

```ts
const agent = Agent.create({ provider, model })
  .tool(listDownPorts)
  .namesAndNumbersFromEvidence({ posture: 'assist' })
  .answerLayer({ standingLine: true }) // `{}` / no argument: the data only
  .build();

agent.on('agentfootprint.answer.assessed', (e) => e.payload.standing); // 'not-sure'
const text = await agent.run({ message: 'Which ports on switch A are down?' });
// 'No ports on switch A are down.\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.'
// turn_end.answerAssessment carries the same projection; assessAnswer(recording) folds it again.
```

- **One stage** — `stage.ts` · `assessAnswerStage`, mounted by `honesty/mounts.ts` ·
  `startFinalBranch` (the one helper both chart builders call) and loaded through
  `import()` on the first armed answer. It reads ONLY the committed keys the fold
  reads that this agent's arms can write (`honesty/mounts.ts` · `answerFoldReads`),
  folds them, files the projection for PrepareFinal (`answerAssessment`, committed in
  the final branch's own state — its subflow result keeps that copy — never in the
  run's state; the copy is a hand-off, not a source: every reader re-folds) and fires
  `agentfootprint.answer.assessed`.
- **The projection** — `compose.ts` · `assessmentDataOf`: the value, the word, the
  reason KINDS and the checks that ran. The same object on `turn_end.answerAssessment`
  and on the event (which adds `turn` and `iteration`). No witness pointer, no digest,
  no value, no quote.
- **Two witness rows** — `witness.ts`. The Route decider files them on the findings
  ledger ONLY while the layer is armed, because that is where the verdicts are
  computed: `grounded` (the evidence gate's clean pass) and `steps-unfinished` (an
  answer accepted or cut short before a skill's declared steps finished). Each is filed
  only for the answer that STANDS — the step judge returns its row, and the decider
  files it where it answers `'final'`, after the gate (and the schema) let the answer
  stand — so a draft sent back files none. Each carries `turn`; each emits nothing of
  its own (the verdict's event fired beside it); the checkpoint door has an arm for each.
- **The turn stamp never repeats** — "this turn" is read by `turn`, so seed continues
  the stamp from the turn the stored conversation ended on
  (`AgentRunCheckpoint.turnNumber`, carried while a layer is armed) and from the
  restored ledger's latest stamp (`stages/seed.ts` · `turnNumberFor`): a window
  strategy trims the stored history, and its count of user messages repeats.
- **The line** — `compose.ts` · `standingLineOf`, under `{ standingLine: true }` only, on
  a PROSE answer only (refused beside `.answerValidation()` and `.outputSchema()` at
  build). Appended after the limits separator by the one composer; beside
  `.limitsTravelWithTheAnswer()` it names the assumed values itself and the "Assumed"
  block is not appended too. An assumed value is printed only in the tool's own view.
- **THE EQUALITY LAW** — the in-run standing equals `assessAnswer()` over the same
  recording read afterwards: one pure function over the same committed rows, at the one
  moment nothing after it can change them. Pinned by
  `test/core/agent/assessment/answer-layer-equality.test.ts` across a pause and its
  resume, a continued conversation, typed answers, the evidence revision, a limit that
  cut the turn short, an agent mounted in a composition, and 40 generated
  configurations.

The runnable example is `examples/features/76-answer-layer.ts`.

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
| `argument-unverified` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'model'` on a ruled argument, or with a failed declared-source check (`failed`) on ANY argument — the model misstated the record |
| `argument-read` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'said'` and `reading` — the quoted words are the person's, the value is the model's reading of them (declared sources) |
| `value-contingent` | 2 | `findingsLedger`: an `argument` row of this turn with `source: 'result'` and `setAside` (the model named a result it had set aside); or a `contingent` row of this turn (stamped with it; unstamped on a call of this turn; unstamped on the answer on a first turn, or on a later turn when it follows — or is — a row the ledger shows to be this turn's: `assess.ts` · `firstRowOfTurn`) |
| `coverage-gap` | 3 | `coverageDeclared`: a `notChecked` or `cannotCover` item on a call of this turn; or `history`: the result's own envelope lists one, when its call has no coverage row |
| `declared-absent` | 3 | `coverageDeclared`: an absence; or `history`: an empty rowset inside a declared `coverage()` boundary, or an absence in the result's own envelope when its call has no coverage row |
| `empty-undeclared` | 3 | `history`: an empty rowset (a top-level array, or the app's `rowsAt` key) whose call has no coverage row |
| `period-not-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `not-held` — the store holds none of what the read asked for (honesty step 7b) |
| `period-partly-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `partly-held` |
| `period-unknown` | 3 | `findingsLedger`: a `period` row of this turn with verdict `unknown` — the tool declared `held: 'unknown'`, on a non-empty result too (adopted Q33) |
| `period-undeclared` | 3 | `findingsLedger`: a `period` row of this turn with verdict `undeclared` — the tool declares a `ToolPeriod` and its result declared no period |
| `period-differs-from-asked` | 3 | `findingsLedger`: a `period` row of this turn with `differs` (the time layer, step T8 — `core/time/check.ts` · `periodTimeCheck`): what the call read is not the range it asked for — `missing` (asked, not read) or `extra` (read, not asked; TQ8: "not sure" too) — or, for a window the model chose, not the person's window. Witnesses: the row and the call's `argument` row |
| `period-beyond-retention` | 3 | `findingsLedger`: a `period` row of this turn with `beyondRetention` (step T8): the window was wholly older than the tool declares its source keeps — refused before dispatch, or read that way |
| `sources-conflict` | 3 | `findingsLedger`: a conflict row whose witnesses name a call of this turn |
| `value-unsupported` | 4 | `unsupportedValues` (`revised: false`) |
| `value-survived-revision` | 4 | `unsupportedValues` (`revised: true`) |
| `derived-from-reading` | 4 | `findingsLedger`: a `time-derived` row of this turn — the answer states a time value no tool result carried that the library itself spelled from a reading of the person's words (an implied year, an offset, the end-of-grain minute, the served time line; the time layer, step T7 — `core/time/forms.ts` · `timeFormsOf`). Folded like `argument-assumed`: "not sure", never "known" |
| `stopped-early` | 4 | `stoppedEarly` |
| `steps-unfinished` | 4 | `findingsLedger`: a `steps-unfinished` witness row of this turn — the answer came before the active skill's declared steps finished (filed while the answer layer is armed) |
| `answer-check-failed` | 4 | `answerValidation`: `status: 'failed'` |
| `check-unreachable` | every | `answerValidation`: `status: 'unverified'` — an armed check that could not reach a verdict |

The inputs layer's rows (honesty layer 2, `core/agent/arguments/README.md`) are
read for THIS turn only — the ledger crosses turns, and every `argument` row
carries its `turn` — and the last row per (call, argument) is the current one.
When the layer filed any, `checked` gains `argument-rules` (layer 2): every row
is a verdict, so `ran` equals `of`. Under declared sources
(`.findings({ argumentSources: true })`) `checked` gains `argument-sources` too:
`of` is the rows the check judged (they carry `claimed`), `ran` the ones it
reached a verdict on (all but `uncheckable`). A traced source — the person's
quoted words or a declared phrase, their answer, a result, the app — fires
nothing, so a turn whose values all check out reads "consistent with the
record"; no argument row ever supports "known": a membership pass only keeps a
reason from firing.

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

The answer layer's witness rows (honesty layer 4) are read the same way — this
turn's only. A `grounded` row files `names-and-numbers` in `checked` (the gate's
check RAN on this answer) when the gate looked up at least one value — a clean pass
that looked nothing up did not apply, so it is left out; it never supports "known"
(finding a value in a result is a membership pass). A flag (`unsupportedValues`)
stays the verdict when both exist. A `steps-unfinished` row fires the reason of that
name and files no check: the record holds only the unfinished verdict.

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

## The layer contract (layer 4 · give the answer), as it ships

| Clause | Here |
|---|---|
| DECLARE | existing: `.answerValidation()`, `.namesAndNumbersFromEvidence()`, `.claims()`; the tools' `absent()` / `coverage()` / `describedResult()`; the layer's own arm, `.answerLayer()` |
| VERIFY | existing: the Route decider's checks (`core/agent/stages/route.ts` · `judgeClaims`), `core/agent/evidence/gate.ts` · `checkAnswer`, `answer-validation/validate.ts` · `executeAnswerValidation` |
| RECORD | the existing committed keys, and — under the layer's arm — the two witness rows (`witness.ts`), filed by the Route decider (`core/agent/stages/route.ts` · `judgeEvidence`, `judgeUnfinishedSteps`) |
| RESOLVE | label only: the fold never asks, refuses or rewrites; the one opt-in line is appended after the answer, never into it |
| FOLD | `assess.ts` · `assessAnswer` — pure, committed rows only, one function for every reader, in the run and after it |
| SERVE | after the run: `agent.assessment()` (async: it loads this fold through `import()` on first use, so an agent that never asks does not carry it — pinned by `test/lib/trace-toolpack/browserGraph.test.ts`), `assessAnswer` on `agentfootprint/observe`, the answer account's "How sure" row (`lib/answer-account/facts/howSure.ts` · `readHowSure`); in the run (armed): `turn_end.answerAssessment`, `agentfootprint.answer.assessed`, and the line under `{ standingLine: true }` |
| ARM + MEASURE | `.answerLayer()`; off → byte-identical (every reference under `test/core/tools/reference/` unchanged; `agent-answer-layer` is the armed one); this README's last section |

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

- **Verdicts that exist only as events.** The `.claims()` dispositions — so
  `claim-contradicted` and a claims-supported "known" — and the integrity
  dispositions are not on the committed record in this version. The fold never
  reads events; the step that needs each verdict commits one row, and its reason
  joins `REASONS` then. The evidence gate's clean pass and unfinished steps are
  committed only while the answer layer is armed; on an agent without it they
  stay events, and the fold reads them as it always did (not at all).
- **A run that threw, read by `assessAnswer` directly.** No committed row says a
  turn ended in an error in this version, so the fold folds what the crashed run
  left, as if it had answered. `agent.assessment()` (which knows) resolves to
  `undefined` and the answer account (which reads the recording's `turn_end`)
  says the record shows no answer; a caller of `assessAnswer` checks the run's
  outcome first. Step 6 did not settle it: the answer layer's stage runs inside
  the final branch, whose output mapping receives the answer string, never the
  branch's scope, so it cannot commit an "answered" row to the run's state; a row
  filed by the Route decider could, and it needs the fold's return shape to say
  "no answer" — a decision of its own (`docs/design/honesty/answer.md`).
- **A row lost AND its envelope gone.** A record that lost a call's coverage row
  is still read from the envelope in `history` — `fold-real-record.test.ts` pins
  the account's reduced fixture reading the same standing as the full record. A
  record that dropped the history too has nothing left to read.
- **Evicted results.** Under `.window()`, a window strategy can remove this
  turn's early results from `history`; the commit log still has them, but the
  fold reads the final state, so an evicted undeclared `[]` fires nothing.
- **Rows from an earlier turn that reuse a call id — on an agent without an
  honesty layer.** Without a turn stamp, the fold places a ledger row in this
  turn by the call ids it names, and a provider that reuses ids across turns
  (numbering each response's calls from `0`, say) makes an earlier turn's row
  look like this turn's in three places: a carried conflict row whose witness
  shares an id with a call of this turn reads `sources-conflict`
  (`readConflicts`); a contingent row declared on such a call reads
  `value-contingent`; and `firstRowOfTurn` — which finds where this turn's rows
  begin as the first unstamped row naming a call of this turn — can stop at an
  EARLIER turn's row that named the reused id, so every contingent row declared
  on the answer after it, an earlier turn's answer included, is read as this
  turn's. Each over-reports ("not sure") and never hides. The cheap guard —
  start the search after the last row naming an id that only earlier turns
  called — does not help a provider that reuses every id, so it is not built.
  While the inputs layer is armed, the one writer stamps every row with its
  conversation `turn` (honesty step 3), and a stamped row counts only in its own
  turn.
- **An unstamped contingent row declared on the ANSWER, on a later turn the
  ledger cannot place** (an agent without the inputs layer). Such a row names no
  call of its own, and the ledger crosses turns on a continued conversation, so
  on a turn after the first it counts only when it follows — or is — a row the
  ledger shows to be this turn's: one stamped with this turn, or one that names
  a call of this turn (a row cannot name a call before the call exists; a reused
  id is the bullet above). A later turn that made no call and filed nothing else
  leaves it unread: it may be an earlier turn's answer, and an earlier answer
  must never make this one "not sure". Arm the inputs layer and every row
  carries its turn.
- **Subject placement.** Which entity the question names is on hold, so the fold
  reads every call of the turn.
- **A finished step procedure** files no row, so it cannot count as a check that
  ran — only an unfinished one is on the record.
- **The line's reasons carry no counts** — it names which kinds of reason fired;
  `agent.assessment()` and the account have the counts and the rows.
- **In the run, no app declarations.** The layer folds without `rowsAt`;
  `assessAnswer(record, declarations)`, `agent.assessment(declarations)` and the
  account take them and can say more about the same run.
- **Where the event does not reach** — a composition that mounts the agent reads
  `turn_end.answerAssessment` (its dispatcher does not bridge `answer.*`); the line
  is never streamed. The rest of the layer's gaps: `docs/design/honesty/answer.md`,
  "Not covered".

## What it lets you measure

From the record alone, per model and per prompt or skill version — and, with the
answer layer armed, from one event per answer at the moment it exists: the **standing
mix** (known · consistent · not sure · ask · not assessed); the **reason mix**,
per layer; how often the evidence gate's check actually **ran** on an answer (a
`grounded` row with values looked up) against how often it **flagged** one; how
often an answer came **before its declared steps finished**; **how much actually ran** (`checked`: how many calls declared what
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
