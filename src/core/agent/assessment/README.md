**Mixed** — the answer's standing, folded from the run's committed record: known · consistent with the record · not sure (with the reasons) · ask · not assessed — read after the run, and (honesty layer 4, the answer layer) inside it.
Fold: `assess.ts` (the one fold), `reasons.ts` (the closed reason table) and `sources.ts` (what each reason rests on, and `rowList`, the one way a list on a row is read).
Map: `witness.ts` (the answer layer's committed witness rows — `grounded`, `steps-unfinished`, `script-shown` — filed by the Route decider).
Walker: `stage.ts` (the answer layer's one stage, at the head of the final branch).
Lens: `compose.ts` (the standing as data, and as one line for the person under its own arm).
Support: `answerLayerOptions.ts` (the rules `.answerLayer()` and its option door share).

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

## In the run — the answer layer

The same fold, run INSIDE the run, as the first stage of the final branch — after
the Route decider's checks filed their verdicts, before the turn is captured — and
served as data the moment the answer exists:

```ts
const agent = Agent.create({ provider, model })
  .tool(listDownPorts)
  .namesAndNumbersFromEvidence({ posture: 'assist' })
  .build();

agent.on('agentfootprint.answer.assessed', (e) => e.payload.standing); // 'not-sure'
const text = await agent.run({ message: 'Which ports on switch A are down?' });
// 'No ports on switch A are down.\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.'
// turn_end.answerAssessment carries the same projection; assessAnswer(recording) folds it again.
```

- **One stage** — `stage.ts` · `assessAnswerStage`, mounted by `honesty/mounts.ts` ·
  `startFinalBranch` (the one helper both chart builders call) and loaded through
  `import()` on the first armed answer. It reads ONLY the committed keys the fold
  reads that this agent's arms can write (`honesty/answerFoldReads.ts` · `answerFoldReads`),
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
  restored ledger's latest stamp (`runtime/conversation/seedHistory.ts` · `turnNumberFor`): a window
  strategy trims the stored history, and its count of user messages repeats.
- **The line** — `compose.ts` · `standingLineOf` renders the line for eligible prose
  answers. The default selects `'not-sure-or-ask'` and serves data alone beside
  `.answerValidation()` or `.outputSchema()`. An explicit line still fails to
  build beside either. The composer puts the line after the limits separator.
  Beside `.limitsTravelWithTheAnswer()`, the line names assumed values when it
  appears. The "Assumed" block supplies them when the line is absent. Values
  appear only in the tool's own view.
- **Delivery** — ordinary tokens carry the model's text. When output admission
  holds provider chunks, PrepareFinal emits the composed answer in one token.
  In either case, `turn_end.finalContent` carries the completed answer.
- **THE EQUALITY LAW** — the in-run standing equals `assessAnswer()` over the same
  recording read afterwards: one pure function over the same committed rows, at the one
  moment nothing after it can change them. Pinned by
  `test/core/agent/assessment/answer-layer-equality.test.ts` across a pause and its
  resume, a continued conversation, typed answers, the evidence revision, a limit that
  cut the turn short, an agent mounted in a composition, and 40 generated
  configurations.

See `examples/features/123-answer-standing-default.ts` for the default and the
opt-out, and `examples/features/76-answer-layer.ts` for an explicit line.

### When the line is said — `standingLine: { when }`

**The rule.** Omit `.answerLayer()` to use the default. Call `.answerLayer()` or
`.answerLayer({ standingLine: false })` to serve data only, or `.answerLayer(false)`
to remove the layer. Set `standingLine` to `true` (equivalent to
`{ when: 'always' }`) or `{ when }` to select a mode explicitly.

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

The rows, with what each reason reads: [REASONS.md](./REASONS.md). What each integrity
finding does is one more table, `integrityReasons.ts`: a kind fires a reason, or it leaves a
`notes` entry that never moves the standing and never counts as a check that ran. A
`.claims()` comparison that never happened (no tool settled the field, or no value could be
read from the answer) fires `claim-unsettled`; an agreeing field fires nothing.
`claim-unsettled` rows are not de-duplicated by identity, so after a re-ask in one turn a row
filed against the superseded answer stays and may over-report; it never hides.

The inputs layer's rows (honesty layer 2, `core/agent/arguments/README.md`) are
read for THIS turn only — the ledger crosses turns, and every `argument` row
carries its `turn`. A later observation replaces one for the same argument at
the same proved result address. With no retained compatible result, only an
explicit library pre-dispatch row can replace the prior observation of the
same turn, tool and call ID. Ordinary observations without an address are kept.
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

**A conflict whose readings the record cannot place — the incomplete-record
policy** (`assessment/conflicts.ts` · `conflictOfThisTurn`). Each reading of a conflict row
(`witnesses`) is placed by the call it names, as the record shows it:

- **current** — a call of this turn;
- **earlier** — a call `history` places before this turn began: its result, or
  the request that asked for it;
- **unresolved** — no call id, or one the record does not place anywhere: a
  hole, a getter's entry, an id whose result the kept history no longer holds.

Which turn the row belongs to is decided in this order:

1. a row stamped with ANOTHER turn is never this turn's;
2. a current reading places the row here, stamped or not (the call-id rule);
3. a row stamped with THIS turn stays this turn's unless EVERY reading is
   earlier. An unresolved reading, no readings at all, or a list the fold cannot
   read whole (`rowList`, above) establishes no placement elsewhere. When
   admitted, the source counts readings it cannot name in `unnamed`;
4. an UNSTAMPED row is placed only by a current reading, and so is any row of a
   record with no `turnNumber`.

**Why.** The stamp says the writer filed this conflict in this turn. A missing
id says nothing about which turn a reading belongs to, and neither does an id
the kept history does not hold — a shortened history is not proof of an earlier
turn. Reading either as "not this turn" made a doubt the record holds vanish:
the answer read "consistent with the record" over a conflict filed in its own
turn. The fold keeps the uncertainty instead — "not sure", resting on readings
it cannot name — and lifts the stamp only on a placement the record establishes.
The reverse stays refused: an unstamped conflict is never attached to today's
answer by a reading the record does not show to be today's.

**Older recordings.** A keyless record can predate occurrence and settlement
evidence. In the absence of settlement, tool-entry or middleware evidence and
of withheld calls, a conflict placed in this turn yields the run-level reason
`check-unreachable` if the list cannot be read whole or if it has at least two
readings and one or more are unplaced. The line says the record holds a conflict
whose readings it cannot place. A served placeholder entry is an unplaced
reading, and a placeholder replacing the entire list leaves it unreadable.
A fully read list of fewer than two entries is outside the rule because the
writer files conflicts only with at least two readings. Keyed and delivery-governed records
still need the existing admission proof, as does any `sources-conflict` reason
that attributes the conflict to results.

If the same record also shows an unverified answer check, the standing line
and the answer account state both causes. During replay, a saved line that
states only the older answer-check wording is still credited to the library
when the record independently supports that check and the text exactly matches
the appended section.

```ts
// turnNumber: 2; history: [person 't1', result of old1, person 't2', result of c2]
const reading = (toolCallId?: string) => ({ toolCallId, subject: { kind: 'host', id: 'h1' }, predicate: 'state' });
const filedNow = (witnesses: unknown[]) => ({ kind: 'conflict', key: 'host h1 · state', witnesses, iteration: 1, turn: 2 });
const fold = (witnesses: unknown[]) =>
  assessAnswer({ snapshot: { sharedState: { turnNumber: 2, history, findingsLedger: [filedNow(witnesses)] } } });
fold([reading('missingA'), reading('missingB')]).reasons[0].source; // { kind: 'run' } for check-unreachable
fold([reading('old1'), reading('missingB')]).standing;               // 'not-sure' — one earlier, one unresolved
fold([reading(), reading()]).standing;                               // 'not-sure' — no ids at all
fold([reading('old1')]).standing;                                    // 'consistent' — every reading earlier
// The same rows with no `turn`: none of them is placed in this turn.
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

**The rule.** Every reason carries `source`, one of `{ kind: 'calls', calls: {
toolCallId, toolName }[], unnamed? }`, `{ kind: 'answer' }` or `{ kind: 'run' }`. The
KIND comes from `REASONS` (`reasons.ts`). When the model's value came from a
result it had set aside, the witness says whether the value reached a call's
inputs or the answer itself. The fold reads the calls off the admitted witness
rows (`sources.ts` · `reasonSourceOf`): a result's own call, a coverage,
argument, period or middleware row's call, a conflict's readings, or the
exact call a native declaration check names. A call the record does not name
in full is counted in `unnamed`. Names and IDs only, with the recorded outcome
when one is available for `call-not-completed`. Each outcome belongs to one
history occurrence. The provider can use the same ID again.

| Rests on | Reasons |
|---|---|
| `calls` | `unsupported-argument`, `column-type-mismatch`, `missing-column`, `argument-assumed`, `argument-unverified`, `argument-read`, `value-contingent`, `call-not-completed`, `result-cut`, `placed-unread`, `times-without-zone`, `coverage-gap`, `declared-absent`, `empty-undeclared`, the six `period-*`, `sources-conflict`, `declaration-overclaimed` |
| `answer` | `value-contingent` (answer witness), `unsupported-claim`, `claim-unsettled`, `value-unsupported`, `value-survived-revision`, `derived-from-reading`, `script-unmatched`, `negative-prose-unverified`, `claim-exceeds-search`, `answer-check-failed` |
| `run` | `asked`, `argument-asked`, `invariant-violation`, `stopped-early`, `steps-unfinished`, `step-skipped`, `result-withheld`, `check-unreachable` |

**Why.** "Not sure — a tool said nothing matched" did not say which tool: when an
answer rested on one call's rows and another call reported no matching results, a reader could not
tell which part the doubt touched. The source is a projection of what is recorded —
which claim depends on which call is NOT on the record, so naming a source never
says the rest of the answer is unaffected, and it never moves the standing. An
empty list of calls never stands for "the run": that is a kind of its own.

**A declaration check identifies its exact return.** `.negativeClaims()`
records its audit checks. A check on the native result also carries the ID,
name and iteration of that call in the host's validation report
(`negativeClaims/delivery.ts` · `reportWithNegatives`). The public standing
reads the check only when the record binds it to an occurrence and establishes
that the tool's return reached the model. A throw or a framework refusal
can still be reported in the audit. A host rewrite is assessed from what it
served to the model.

**A list on a row is read by index — never through its own iterator or index
getters.** Every list the fold reads off a row — a conflict's readings, a
contingent value's carriers, an answer check's `tools`, a request's `toolCalls`
— goes through ONE reader, `sources.ts` · `rowList`: the bounded-copy
convention (`lib/boundedJson.ts` · `copyJson`) as a reader that does not refuse
an ordinary array (`readOwnList`). A plain array only, its own `length`, the own
data property at each index, at most `MAX_ROW_LIST_ENTRIES` (1,000). The record
handed to `assessAnswer` may be host-built, so a list can be SPARSE, carry its
own iterator or put a getter at an index; the reader never calls the iterator
or the getter. Unless the value is a Proxy, what it cannot read is counted,
never dropped and never a throw (a Proxy, and a getter on an entry object, are
outside this: see [Not covered](./LIMITS.md#not-covered)):

- a hole, or an entry behind a getter, is one entry that names no call;
- the entries past the bound are counted, never walked (a `length` is the
  record's own claim);
- a value that is not a plain array is not trusted as a list: one call the
  record cannot name, and — for a conflict — no placement shown elsewhere, so
  a row stamped with this turn keeps its doubt (`assessment/conflicts.ts` ·
  `conflictOfThisTurn`).

**Why.** `Array.from` and `for…of` run a list's own iterator: an empty one hid a
named reading (the source read `{ calls: [], unnamed: 1 }`), and a getter would
have run inside the fold.

```ts
const witnesses = [
  { toolCallId: 'c2', subject: { kind: 'host', id: 'h1' }, predicate: 'state' },
  { subject: { kind: 'host', id: 'h1' }, predicate: 'state' }, // names no call
];
witnesses.length = 3; // index 2 is a hole
Object.defineProperty(witnesses, Symbol.iterator, { value: function* () {} }); // never called
const conflict = { kind: 'conflict', key: 'host h1 · state', witnesses, iteration: 1, turn: 2 };
assessAnswer({ snapshot: { sharedState: { turnNumber: 2, history, findingsLedger: [conflict] } } })
  .reasons[0].source; // { kind: 'run' } on a legacy record with no delivery evidence
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
names, then "and N other call(s)"). They came in with `STANDING_LINE_VERSION` 2
and the three integrity rows at 4; the version the code says today is
`compose.ts` · `STANDING_LINE_VERSION`, which is bumped whenever a word in either
column changes, so this table can lag it but the code cannot:

| Reason | Without a declared name (unchanged) | Named |
|---|---|---|
| `declared-absent` | a tool said nothing matched | {who} reported no matching results |
| `coverage-gap` | a tool said there is ground it did not check or cannot cover | {who} declared ground that was not checked or cannot be covered |
| `empty-undeclared` | a lookup came back empty without saying what it searched | {who} came back empty without saying what was searched |
| `call-not-completed` | a call was refused / a call failed | {who} did not complete (refused) / {who} did not complete (failed) |
| `result-withheld` | a result was kept out by a rule | Same wording for every tool |
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
| `unsupported-argument` | a value a call ran with appears nowhere the run served the model | {who} ran with a value the run never served the model |
| `column-type-mismatch` | a tool's rows hold a different type than the tool declares | {who} returned rows with a different type than declared |
| `missing-column` | a column a tool declares is in none of its rows | {who} returned rows without a declared column |
| `argument-assumed` | window = "2h" was assumed by search_logs's rule, not given by you | window = "2h" was assumed by the rule of {name}, not given by you |

## How the turn ended

The standing is about an answer, so the turn's end is settled first:

| The turn ended | `agent.assessment()` | `assessAnswer(recording)` | the account's "How sure" |
|---|---|---|---|
| in an answer | the fold | the fold | the fold |
| in a pause (any kind — the library's own batch ask included, `argument-asked`) | `ask` | `ask` | "Ask — the run stopped to ask a question before it could answer:" |
| in an error before any answer (it threw, or a rule halted it — a policy halt, a fail-fast, an input denial) | `undefined` | not settled — see [Not covered](./LIMITS.md#not-covered) | "How sure cannot be told: this record does not show the run giving an answer." (no `turn_end`) |
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
| DECLARE | existing: `.answerValidation()`, `.namesAndNumbersFromEvidence()`, `.claims()`; the tools' `absent()` / `coverage()` / `describedResult()`; `.answerLayer()` configures the default layer |
| VERIFY | existing: the Route decider's checks (`core/agent/stages/route.ts` · `judgeClaims`), `core/agent/evidence/gate.ts` · `checkAnswer`, `answer-validation/validate.ts` · `executeAnswerValidation` |
| RECORD | the existing committed keys, and — under the layer's arm — the two witness rows (`witness.ts`), filed by the Route decider (`core/agent/stages/route.ts` · `judgeEvidence`, `judgeUnfinishedSteps`) |
| RESOLVE | the fold labels the answer and appends a line for the selected standings |
| FOLD | `assess.ts` · `assessAnswer` — pure, committed rows only, one function for every reader, in the run and after it |
| SERVE | after the run: `agent.assessment()`, `assessAnswer` on `agentfootprint/observe`, and the answer account's "How sure" row. In the run: `turn_end.answerAssessment`, `agentfootprint.answer.assessed`, and a line for selected standings |
| ARM + MEASURE | enabled by default; `.answerLayer(false)` restores the prior off behavior |

## Parity with the study's RQ3 rule

`test/core/agent/assessment/rq3-parity.test.ts` runs this fold and a
transcription of the study's registered RQ3 algorithm (standing per turn from
recorded EVENTS) over the same recorded runs: ASKED ↔ `ask`, NOT-COVERED ↔
`coverage-gap`, DECLARED-ABSENT ↔ `declared-absent`, FOUND ↔ `unrefuted` (never
`known`), UNKNOWN ↔ "the record cannot vouch" (`not-applicable`, or only
`empty-undeclared` or `call-not-completed` reasons). Three differences are named and pinned, all in one
direction — the fold says more, never less: RQ3 scopes to the entity the
question names and the fold reads every call of the turn (`entity-scope`); RQ3's
DECLARED-ABSENT reads only the last lookup and the fold reads every one
(`last-lookup`); RQ3's ASKED reads a typed ask only and the fold reads every
pause as `ask` (`pause-kind`). The oracle is a TRANSCRIPTION: the study's frozen
copy (`study/rq3-standing/`) does not exist yet, so the parity is re-run against
it at the study's freeze (adopted Q12).

## Not covered

See [assessment limits](./LIMITS.md#not-covered).

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
