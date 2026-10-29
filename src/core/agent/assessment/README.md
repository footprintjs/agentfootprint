**Mixed** — the answer's standing, folded from the run's committed record: known · consistent with the record · not sure (with the reasons) · ask · not assessed — read after the run, and (honesty layer 4, the answer layer) inside it.
Fold: `assess.ts` (the one fold), `reasons.ts` (the closed reason table) and `sources.ts` (what each reason rests on).
Map: `witness.ts` (the answer layer's two committed witness rows, filed by the Route decider).
Walker: `stage.ts` (the answer layer's one stage, at the head of the final branch).
Lens: `compose.ts` (the standing as data, and as one line for the person under its own arm).

**The law.** The standing is folded from the rows, never from the model's
confidence, and "known" needs a row that supports it.

**And every reason says what it rests on** — `reasons[].source`: specific
calls, the answer itself, or the run as a whole (`sources.ts`, below).

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
- **The line** — `compose.ts` · `standingLineOf`, under `{ standingLine: true }` (or a
  mode, below) only, on a PROSE answer only (refused beside `.answerValidation()` and
  `.outputSchema()` at build, in every mode). Appended after the limits separator by
  the one composer; beside `.limitsTravelWithTheAnswer()` it names the assumed values
  itself and the "Assumed" block is not appended too — the block is appended whenever
  no line was. An assumed value is printed only in the tool's own view.
- **THE EQUALITY LAW** — the in-run standing equals `assessAnswer()` over the same
  recording read afterwards: one pure function over the same committed rows, at the one
  moment nothing after it can change them. Pinned by
  `test/core/agent/assessment/answer-layer-equality.test.ts` across a pause and its
  resume, a continued conversation, typed answers, the evidence revision, a limit that
  cut the turn short, an agent mounted in a composition, and 40 generated
  configurations.

The runnable example is `examples/features/76-answer-layer.ts`.

### When the line is said — `standingLine: { when }`

**The rule.** `standingLine` is `true` (= `{ when: 'always' }`) or `{ when }`:

| `when` | The line is appended for | Left off for |
|---|---|---|
| `'always'` | every standing | — |
| `'unless-consistent'` | known · not sure · ask · not assessed | consistent |
| `'not-sure-or-ask'` | not sure · ask | consistent · not assessed · known |

`ask` is said in every mode. The mode decides ONE thing, in ONE place
(`compose.ts` · `standingLineSaid`, asked by the stage): whether this answer gets
the line. Everything else is the same in every mode — the standing travels as data
(`turn_end.answerAssessment`, `agentfootprint.answer.assessed`, `agent.assessment()`),
the limits block (`.limitsTravelWithTheAnswer()`) is appended whether or not the line
is, and the answer the run returns, emits on `turn_end` and saves to memory is one
string: memory keeps exactly what was delivered, a line only when one was appended. With
nothing to append, there is no separator — the answer is the model's, byte for byte.

**Why.** A line on every reply becomes boilerplate readers learn to skip — which
weakens the "not sure" line on the reply where it matters — and "Not assessed" on a
correct answer reads as doubt, though it only says nothing was checkable.

**What silence means — say it to your users.** No line is never a check. Under
`'not-sure-or-ask'` an answer without a line means no reason fired, and that includes
"nothing could be checked" (`not-assessed`). The data still says which: read
`standing` and `checked`. An app that hides BOTH the line and the data leaves the
person unable to tell "checked" from "not assessed"; the material limitations — the
limits block — stay visible in every mode.

```ts
Agent.create({ provider, model })
  .tool(listDownPorts)
  .limitsTravelWithTheAnswer()
  .answerLayer({ standingLine: { when: 'not-sure-or-ask' } })
  .build();
// rows came back → 'Port eth1/7 on switch A is down.'  (consistent: no line; turn_end still says so)
// [] came back   → '…\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.'
```

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
| `empty-undeclared` | 3 | `history`: an empty rowset (a top-level array, the app's `rowsAt` key, or the dataset ticket left where those rows were, counting 0) whose call has no coverage row |
| `period-not-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `not-held` — the store holds none of what the read asked for (honesty step 7b) |
| `period-partly-held` | 3 | `findingsLedger`: a `period` row of this turn with verdict `partly-held` |
| `period-unknown` | 3 | `findingsLedger`: a `period` row of this turn with verdict `unknown` — the tool declared `held: 'unknown'`, on a non-empty result too (adopted Q33) |
| `period-undeclared` | 3 | `findingsLedger`: a `period` row of this turn with verdict `undeclared` — the tool declares a `ToolPeriod` and its result declared no period |
| `period-differs-from-asked` | 3 | `findingsLedger`: a `period` row of this turn with `differs` (the time layer, step T8 — `time/check.ts` · `periodTimeCheck`): what the call read is not the range it asked for — `missing` (asked, not read) or `extra` (read, not asked; TQ8: "not sure" too) — or, for a window the model chose, not the person's window. Witnesses: the row and the call's `argument` row |
| `period-beyond-retention` | 3 | `findingsLedger`: a `period` row of this turn with `beyondRetention` (step T8): the window was wholly older than the tool declares its source keeps — refused before dispatch, or read that way |
| `sources-conflict` | 3 | `findingsLedger`: a conflict row of this turn — one whose witnesses name a call of this turn, or one stamped with this turn whose witnesses do not all name a call (the incomplete-record policy, below) |
| `value-unsupported` | 4 | `unsupportedValues` (`revised: false`) |
| `value-survived-revision` | 4 | `unsupportedValues` (`revised: true`) |
| `derived-from-reading` | 4 | `findingsLedger`: a `time-derived` row of this turn — the answer states a time value no tool result carried that the library itself spelled from a reading of the person's words (an implied year, an offset, the end-of-grain minute, the served time line; the time layer, step T7 — `time/forms.ts` · `timeFormsOf`). Folded like `argument-assumed`: "not sure", never "known" |
| `stopped-early` | 4 | `stoppedEarly` |
| `steps-unfinished` | 4 | `findingsLedger`: a `steps-unfinished` witness row of this turn — the answer came before the active skill's declared steps finished (filed while the answer layer is armed) |
| `negative-prose-unverified` | 4 | `findingsLedger`: a `negative-claim` or `negative-claim-note` row of this turn. Model prose is observe-only; detected negatives and skipped scans remain not-sure, never verified or blocking. |
| `claim-exceeds-search` | 4 | `answerValidation.checks`: an `agent:negative-claims:` row with `disposition: 'checked-fail'` — a typed negative claimed more than the admitted search |
| `declaration-overclaimed` | 3 | `answerValidation.checks`: an `agent:negative-claims:` row with `reason: 'declaration-overclaimed'` — a tool's refusal said more than it read (`.negativeClaims()`); the row's `tools` name the tool |
| `answer-check-failed` | 4 | `answerValidation`: `status: 'failed'` |
| `check-unreachable` | every | `answerValidation`: `status: 'unverified'` — an armed check that could not reach a verdict — or a `failed` report that also counts `unreachable` checks or names a `reason` (a contradiction found beside them, or beside a validator that did not finish; both reasons fire) |

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

**A conflict whose readings the record cannot name — the incomplete-record
policy** (`assess.ts` · `conflictOfThisTurn`). A conflict row's readings
(`witnesses`) name the calls they read, when the record holds the ids. Which turn
the row belongs to is decided in this order:

1. a row stamped with ANOTHER turn is never this turn's;
2. a reading that names a call of this turn places the row here, stamped or not
   (the call-id rule);
3. a row stamped with THIS turn stays this turn's unless every reading names a
   call and none is a call of this turn — a reading with no call id (a hole, or no
   readings at all) is one the record cannot place in an earlier turn. Its source
   counts those readings in `unnamed`;
4. an UNSTAMPED row is never placed by a missing id, and neither is any row of a
   record with no `turnNumber`.

**Why.** The stamp says the writer filed this conflict in this turn; a missing id
says nothing about which turn a reading belongs to. Reading the missing id as "not
this turn" made a doubt the record holds vanish — the answer read "consistent with
the record" over a conflict filed in its own turn. The fold keeps the uncertainty
instead: "not sure", resting on readings it cannot name. The reverse stays
refused: an earlier turn's unstamped conflict whose ids are gone is never
attached to today's answer.

```ts
const reading = { subject: { kind: 'host', id: 'h1' }, predicate: 'state' }; // no toolCallId
const filedNow = { kind: 'conflict', key: 'host h1 · state', witnesses: [reading, reading], iteration: 1, turn: 2 };
const a = assessAnswer({ snapshot: { sharedState: { turnNumber: 2, history, findingsLedger: [filedNow] } } });
a.standing;          // 'not-sure' (before: 'consistent')
a.reasons[0].source; // { kind: 'calls', calls: [], unnamed: 2 }
// The same row with no `turn`: no reason — a missing id never attaches it to this turn.
```

Every result is read through the ONE emptiness reader,
`core/agent/emptiness.ts` · `readEmptiness`, the one the answer account
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

## What a reason rests on — `reasons[].source`

**The rule.** Every reason carries `source`, one of `{ kind: 'calls', calls:
{ toolCallId, toolName }[], unnamed? }`, `{ kind: 'answer' }` or `{ kind: 'run' }`.
The KIND is declared once per reason in `REASONS` (`reasons.ts`), never decided
per run; the calls of a `calls` reason are read off the very rows its witnesses
point at (`sources.ts` · `reasonSourceOf`) — a result's own call, a coverage,
argument, period or middleware row's own call, a conflict's readings, the results
a contingent value came from, every call this turn of a tool an answer check names
(`declaration-overclaimed`: it may over-report, it never hides). A call the record
does not name in full — no id, or no tool name for it — is counted in `unnamed`,
never dropped and never guessed. Names and ids only: never an argument, a result
or a value.

| Rests on | Reasons |
|---|---|
| `calls` | `argument-assumed`, `argument-unverified`, `argument-read`, `value-contingent`, `coverage-gap`, `declared-absent`, `empty-undeclared`, the six `period-*`, `sources-conflict`, `declaration-overclaimed` |
| `answer` | `value-unsupported`, `value-survived-revision`, `derived-from-reading`, `negative-prose-unverified`, `claim-exceeds-search`, `answer-check-failed` |
| `run` | `asked`, `argument-asked`, `stopped-early`, `steps-unfinished`, `check-unreachable` |

**Why.** "Not sure — a tool said nothing matched" did not say which tool: when an
answer rested on one call's rows and another call reported no matching results, a reader could not
tell which part the doubt touched. The source is a projection of what is recorded —
which claim depends on which call is NOT on the record, so naming a source never
says the rest of the answer is unaffected, and it never moves the standing. An
empty list of calls never stands for "the run": that is a kind of its own.

**Every field the fold reads is on the row the run commits — one name, one
row.** A `.negativeClaims()` verdict reaches the record twice: whole on
`answerNegatives.checks` (its `code`, its `tools`), and as a check row on the
answer-check report, `answerValidation.checks` — the row the fold reads: for
`declaration-overclaimed`, its `reason` and its `tools`. The ONE projection
between them (`negativeClaims/delivery.ts` · `reportWithNegatives`) writes the
code as `reason` and keeps `tools` under that name, so the fold reads one field
for each fact, off one row. A field the projection dropped would read as "a
call the record cannot name" on every real run, so the source is pinned on a
real run, never only on a hand-built row (`reason-sources.test.ts`):

```ts
// .negativeClaims({ field: 'negatives', tools: ['read_incidents'] }) — read_incidents threw
// "Service payments does not exist.": a refused call read nothing, so its refusal overclaims.
agent.answerValidation()?.checks.find((c) => c.reason === 'declaration-overclaimed');
// { id: 'agent:negative-claims:declaration:0', path: '/', disposition: 'not-applicable',
//   reason: 'declaration-overclaimed', tools: ['read_incidents'] }
(await agent.assessment())?.reasons.find((r) => r.reason === 'declaration-overclaimed')?.source;
// { kind: 'calls', calls: [{ toolCallId: 'c1', toolName: 'read_incidents' }] }
```

**A hole is an entry.** Every list a source reads — a conflict's readings, a
contingent value's carriers, an answer check's `tools` — is read by index
(`sources.ts` · `entriesOf`). An in-memory record (a live snapshot, a host-built
one) can be SPARSE: a hole is no entry at all, which `map` and `filter` skip,
where a saved recording would spell it `null`. Read by index, a hole is one
entry that names no call — counted in `unnamed`, never skipped, and never a
throw out of the fold:

```ts
const carriers = [{ toolCallId: 'c1', standing: 'noise' }];
carriers.length = 2; // index 1 is a hole
const contingent = { kind: 'contingent', declaredOn: 'answer', value: 'x-1', carriers };
assessAnswer({ snapshot: { sharedState: { history, findingsLedger: [contingent] } } }).reasons[0]
  .source; // { kind: 'calls', calls: [{ toolCallId: 'c1', toolName: 'inventory' }], unnamed: 1 }
```

**The app's words for a reason's calls.** A tool may declare `displayName`
(`defineTool({ displayName })` — one plain line, at most 60 characters,
`lib/displayName.ts`). The line names a reason's calls ONLY by it — the declared
ones named, the rest counted — and a reason none of whose calls declares one keeps
today's words, byte for byte. The registered name (`schema.name`) is the model's
vocabulary; an app may forbid showing it, so the line never names a reason's calls
by it. Where `displayName` is used today: the line's reason clauses and its assumed
clause, and the limits block's items and its `Period:` / "In progress" lines. Still
printing the registered name — a known follow-up: the time layer's limits lines
(under `.time()`), the answer account's rows, and, for a tool that declares no
`displayName`, the assumed clause and the `Period:` / "In progress" lines (today's
words, unchanged).
The words the line used ride `turn_end.standingLineNames`, so the answer account
rebuilds the very line from the record. The limits block marks each item's
declaring calls the same way (`semantics/coverage/answer.ts` ·
`composeAnswerWithCoverage`), and the account's "How sure" counts each reason's
calls off the same `source` — one owner of "which calls".

```ts
const loadAttachment = defineTool({ name: 'load_attachment', displayName: 'loading the attached data', … });
// load_attachment returned absent(…); list_runs returned one draft run
(await agent.assessment())?.reasons;
// [{ reason: 'declared-absent', layer: 3, witness: [...],
//    source: { kind: 'calls', calls: [{ toolCallId: 'c1', toolName: 'load_attachment' }] } }]
text; // 'One draft run: run-1.\n\n---\n\nNot sure — loading the attached data reported no matching results.'
```

The named clauses (`compose.ts` · `NAMED_REASON_WORDS`; `{who}` = the declared
names, then "and N other call(s)") — `STANDING_LINE_VERSION` 2:

| Reason | Without a declared name (unchanged) | Named |
|---|---|---|
| `declared-absent` | a tool said nothing matched | {who} reported no matching results |
| `coverage-gap` | a tool said there is ground it did not check or cannot cover | {who} declared ground that was not checked or cannot be covered |
| `empty-undeclared` | a lookup came back empty without saying what it searched | {who} came back empty without saying what was searched |
| `period-not-held` | a tool's data does not reach the time the question asked about | {who} read data that does not reach the time the question asked about |
| `period-partly-held` | a tool's data covers only part of the time the question asked about | {who} read data that covers only part of the time the question asked about |
| `period-unknown` | a tool could not say what time its data covers | {who} could not say what time the data covers |
| `period-undeclared` | a tool did not say what time its result covers | {who} did not say what time was covered |
| `period-differs-from-asked` | a tool read a different stretch of time than the one asked about | {who} read a different stretch of time than the one asked about |
| `period-beyond-retention` | the time asked about is older than a tool declares its source keeps | {who} asked about time older than the source is declared to keep |
| `sources-conflict` | two results the answer stood on disagree | results from {who} disagree |
| `argument-unverified` | a value a call ran with came from the model, with no source on the record | {who} ran with a value from the model, with no source on the record |
| `argument-read` | a value a call ran with was read into your words: … | {who} ran with a value read into your words: … |
| `value-contingent` | a value a call ran with was taken from a result the model itself had set aside | a value came from {who}, whose results the model itself had set aside |
| `declaration-overclaimed` | a tool declaration overstates what was checked | {who} declared more than was checked |
| `argument-assumed` | window = "2h" was assumed by search_logs's rule, not given by you | window = "2h" was assumed by the rule of {name}, not given by you |

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

## Eight rules the fold keeps

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
8. **No verdict over a value the record keeps out.** A recording of a run under
   a redaction policy (an agent's `redact`) holds footprintjs's placeholder
   where a selected state key was. The fold reads such a key as ABSENT (a
   `pausedToolCallId` of `'REDACTED'` is not a pause), and when it asks for one
   at all it gives no standing: `not-assessed`, with the keys it needed in
   `keptOut` (`assess.ts` · `keptOutGuard`). `agent.assessment()` reads the
   live run, where nothing is kept out.

   ```ts
   const a = assessAnswer(recordingOfARunUnderRedact);
   a.standing; // 'not-assessed'
   a.keptOut;  // ['history', …] — test/redaction/agent-redaction.readers.test.ts
   ```

## The layer contract (layer 4 · give the answer), as it ships

| Clause | Here |
|---|---|
| DECLARE | existing: `.answerValidation()`, `.namesAndNumbersFromEvidence()`, `.claims()`; the tools' `absent()` / `coverage()` / `describedResult()`; the layer's own arm, `.answerLayer()` |
| VERIFY | existing: the Route decider's checks (`core/agent/stages/route.ts` · `judgeClaims`), `core/agent/evidence/gate.ts` · `checkAnswer`, `answer-validation/validate.ts` · `executeAnswerValidation` |
| RECORD | the existing committed keys, and — under the layer's arm — the two witness rows (`witness.ts`), filed by the Route decider (`core/agent/stages/route.ts` · `judgeEvidence`, `judgeUnfinishedSteps`) |
| RESOLVE | label only: the fold never asks, refuses or rewrites; the one opt-in line is appended after the answer, never into it |
| FOLD | `assess.ts` · `assessAnswer` — pure, committed rows only, one function for every reader, in the run and after it |
| SERVE | after the run: `agent.assessment()` (async: it loads this fold through `import()` on first use, so an agent that never asks does not carry it — pinned by `test/trace-toolpack/browserGraph.test.ts`), `assessAnswer` on `agentfootprint/observe`, the answer account's "How sure" row (`answer-account/facts/howSure.ts` · `readHowSure`); in the run (armed): `turn_end.answerAssessment`, `agentfootprint.answer.assessed`, and the line under `{ standingLine: true }` |
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
- **Where a declared name does not reach yet.** The before-tool rewrite clause
  ("a before-tool rule set a value a call ran with …") stays anonymous: its reason
  mixes rewrite and default rows, and the line does not split them. The time
  layer's own limits lines (`Period:` checks, `Clocks`, under `.time()`) keep the
  registered name. A typed answer's limits as data (`turn_end.answerCoverage`)
  carry no per-item source. A reason's `source` is not on the event or on
  `turn_end.answerAssessment` — their fields are pinned and unchanged; read
  `agent.assessment()` or `assessAnswer(recording)`. A later, versioned projection
  can carry it.
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
