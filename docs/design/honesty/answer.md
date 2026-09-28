# Layer 4 · Give the answer — the answer layer

**Built, 2026-09-27 (step 6, unreleased).** The standing fold shipped first as a pure reader over
recorded runs (step 1); step 6 runs the same fold inside a live run and serves it as data. This
page records what shipped, the decisions the build took, and every place it went beyond or
stricter than [the architecture note](README.md) (§ 3.4, § 4, § 5.2) and the adopted answers
([decisions.md](decisions.md); for this layer Q1, Q3, Q6, Q11 and Q12).

**Law.** The standing is folded from the rows, never from the model's confidence, and "known"
needs a row that supports it.

Code is cited as `file · symbol`, as in the architecture note: paths are under `src/`, and
`findings/`, `stages/`, `evidence/`, `assessment/`, `coverage/` and `honesty/` mean
`src/core/agent/<folder>/`.

## What shipped

```ts
const agent = Agent.create({ provider, model })
  .tool(listDownPorts)
  .answerLayer() // or .answerLayer({ standingLine: true }) for one line to the person
  .build();

agent.on('agentfootprint.answer.assessed', (e) => e.payload.standing); // 'not-sure'
// turn_end.answerAssessment carries the same projection; agent.assessment() folds it again.
```

- **The layer** — `.answerLayer()` (`AgentBuilder.answerLayer`; `AgentOptions.answerLayer`). One
  stage heads the final branch, `assess-answer` (`honesty/mounts.ts` · `startFinalBranch`, the one
  helper both chart builders call; the body is `assessment/stage.ts` · `assessAnswerStage`, loaded
  through `import()` on the first armed answer). It reads the committed keys the fold reads —
  only those the agent's arms can write (`honesty/mounts.ts` · `answerFoldReads`) — runs
  `assessment/assess.ts` · `assessAnswer` over them, files the projection for PrepareFinal and
  fires the event. Unarmed, the final branch is built exactly as it always was.
- **The witness rows** — two new `FindingsRow` kinds (`assessment/witness.ts`), filed through the
  one writer by the Route decider ONLY under the arm, because that is where the verdicts are
  computed: `grounded` (the evidence gate's clean pass — `stages/route.ts` · `judgeEvidence`) and
  `steps-unfinished` (an answer accepted or cut short before a skill's declared steps finished —
  `stages/route.ts` · `judgeUnfinishedSteps` returns it, `fileStepsWitness` files it once the
  answer has stood every later judge — decision 11). Names, enums and counts: the posture, the counts,
  `afterRevision`; the skill, each unrun step's position and tool — never a value, a quote or a
  step's note. They emit nothing of their own (the verdict's event fired beside them). The
  checkpoint door has an arm for each (`core/runCheckpoint.ts`); an older runtime refuses a
  checkpoint that carries either kind.
- **The fold reads them** — a `grounded` row of this turn files the `names-and-numbers` check as
  having run (a membership pass: it never supports "known"); a `steps-unfinished` row of this
  turn fires the new layer-4 reason `steps-unfinished`. Both are read for this turn only (every
  witness row carries `turn`).
- **The standing as data** — `turn_end.answerAssessment` and ONE event,
  `agentfootprint.answer.assessed` (the draft name kept, Q10), carrying the same projection
  (`assessment/compose.ts` · `assessmentDataOf`): the value, the owner's word, the reason kinds and
  the checks that ran (layer, check, ran, of) — plus `turn` and `iteration` on the event. No
  witness pointer, no digest, no value, no quote. The `answer.*` domain ships with its wildcard and
  its bridge.
- **The line** — `.answerLayer({ standingLine: true })` appends ONE line to a prose answer, after
  the limits separator, through the one composer (`coverage/answer.ts` ·
  `composeAnswerWithCoverage`; the words are `assessment/compose.ts` · `standingLineOf`, a closed
  table, `STANDING_LINE_VERSION` 1). The line is the headline of the appended section; beside
  `.limitsTravelWithTheAnswer()` it owns the "assumed" sentence (the "Assumed" block is not
  appended too — one composer for one fact), printing an assumed value only in the tool's own view.
- **The turn stamp** — while the answer layer is armed, every row the one writer files carries
  `turn` (adopted Q6: "while any layer is armed"), and the continued conversation's restore is
  wired (the same widening step 3 made for the inputs layer). `honestyLayers` gains `answer: true`.
  The checkpoint carries the turn it ended on (`AgentRunCheckpoint.turnNumber`, while a layer is
  armed), so the stamp never repeats in a conversation (decision 12).

## The equality law, pinned

The in-run standing equals `assessAnswer()` over the same run's recording read afterwards:
`test/core/agent/assessment/answer-layer-equality.test.ts` holds the event, `turn_end` and the
read-after fold (and `agent.assessment()`) equal across a pause and its resume (a tool's own
question; the inputs layer's batch ask), a three-turn continued conversation, a typed answer
re-asked for its schema, the evidence gate's one revision (grounded, and still flagged), a limit
that cut the turn short (wrapped up, and cut short), an agent mounted in a Sequence, and 40
generated configurations. It holds by construction: the stage reads the same committed keys with
the same pure function at the one moment nothing after it can change them — after the Route
decider committed, before PrepareFinal, which writes nothing the fold reads.

## Decisions — and where the build went beyond or stricter than the design

1. **One stage heads the final branch, not a nested subflow.** The design drew the layer as a
   subflow (Q3, § 5.1). footprintjs starts every chart with a function stage
   (`FlowChartBuilder.start`), so a subflow cannot be the first node of the final branch without
   an empty stage before it, and a nested mount would commit a second copy of the history the
   final branch was handed, in its own seed. The final branch is already an isolated subflow, and
   the layer's run-time work is one fold: one stage keeps the isolation without either cost. The
   seven clauses map as § 3.4 says — Declare and Verify stay in the Route decider, Record gains the
   two witness rows there, and the stage is Fold plus the served forms (Resolve: label only).
2. **No rows return through Final's output mapping.** The design assumed the layer's rows would
   (Q3, § 5.2). That mapper receives the branch's RESULT — BreakFinal's return value, the answer
   string every composition that mounts an agent reads as a string (`core-flow/Sequence.ts`) —
   never the final branch's scope. (Checked: for the same reason `sharedState.finalContent` reads
   `undefined` after a standard run; that pre-existing quirk is not changed here.) So the layer
   files no rows of its own: the witness rows it folds are filed by Route, as designed; the
   standing is derived, and it is committed only in the final branch's OWN state
   (`answerAssessment`, `answerStandingLine` — so the branch's subflow result and commit log hold a
   copy, `subflowResults.final`), never in the run's state (§ 9: a stored assessment was
   rejected). That copy is not a source: it is the hand-off to PrepareFinal, and every reader
   re-folds the committed rows (`assessAnswer`, `agent.assessment()`, the answer account). The
   branch mapping is byte-identical when armed. A later layer-4 row that must reach the run's
   state from the final branch needs the branch's result shape changed — and every composition
   mount that reads it as a string with it.
3. **"A field on the run's result" is `turn_end.answerAssessment`.** `run()` returns a bare string,
   so the result a consumer reads is `turn_end` — the event that already carries `stoppedEarly` and
   `answerCoverage`. It also reaches a composition that mounts the agent (its dispatcher bridges
   the agent domain, not `answer.*`). The one event is `agentfootprint.answer.assessed`; both carry
   one projection built by one function.
4. **`answerCoverage` stays where it is written** (the review of #27, follow-up 2). It is committed
   by the Route decorator (`stages/answerCoverage.ts` · `withAnswerCoverage`), and it stays there:
   the final branch cannot write back (decision 2), the key must exist whether or not the answer
   layer is armed (one writer), and § 5.4's law is that nothing moves without a bench. The key,
   `agent.answerCoverage()` and `turn_end.answerCoverage` are unchanged.
5. **A typed answer's limits carry the assumed values** (follow-up 4). Step 3's "Assumed" admission
   reached only the prose block; a typed answer's limits data (9.121.0) had no place for it. It
   does now: `answerCoverage.assumed`, the same rows read by the same function the block prints
   from (`arguments/serve.ts` · `assumedLinesFor`), each value in the tool's own view
   (`'REDACTED'` with `hidden`). The value type is `AnswerCoverage` (a `Coverage` plus the optional
   list), so every 9.121.0 reader still compiles.
6. **One fold, two forms** (follow-up 3). `coverage/answer.ts` · `foldSections` merges each
   section once; the block (capped for the reader) and the data (uncapped) are its two callers, and
   a property test holds the block's items equal to the data's.
7. **The account reads what travelled with the answer** (follow-up 1).
   `lib/answer-account/account.ts` · `readAnswer` reads `turn_end.answerCoverage` into a new fact,
   `limitsData` (recorded; a pointer to every item), and a typed answer's `limitsBlock` now reads
   `not-recorded` with `missing: 'as-data'` — never `not-applicable` when the limits travelled.
   The split of a prose answer finds the framework's whole appended section — the blocks by their
   headings, the standing line by its exact words rebuilt from the record (decision 13) — so an
   "Assumed" block alone, or a standing line alone, no longer reads as the model's words (the
   "Assumed"-alone case was a step-3 gap). Template set 5 adds the `steps-unfinished` reason's
   line.
8. **Stricter: the line is refused beside `.outputSchema()` too.** The design names
   `.answerValidation()` (exact bytes). A typed answer is JSON, and JSON followed by a line is not
   (the #27 bug); the standing already travels as data there, so the line would be inert — refused
   at build, with the data path named in the sentence.
9. **Stricter: a clean pass that looked nothing up is not a check that ran.** A `grounded` row
   whose `lookedUp` is 0 (the answer stated no name or number, or every one was exempt) leaves
   `names-and-numbers` out of `checked`, so an answer the gate could not read never reads
   "consistent" on the gate's account.
10. **`steps-unfinished` is a reason with no `checked` entry.** The design named the witness row,
    not its reading. The record holds only the unfinished verdict (a finished procedure files
    nothing, before and after this step), so a `checked` entry would appear only when the check
    failed and misstate how often it ran.

### Fixed in the review of the build (round 1)

11. **A witness row is filed only for the answer that stands.** The step judge runs before the
    evidence gate, and it filed its `steps-unfinished` row at once — so a draft the gate sent back
    left a row describing an answer that was replaced: a revision that finished the steps still
    read "the answer came before the skill's declared steps finished", and one that did not filed
    the verdict twice. `stages/route.ts` · `judgeUnfinishedSteps` now RETURNS the row, and each
    decider files it (`fileStepsWitness`) only where it really answers `'final'` — after the gate
    (and, in the enforcing decider, the schema) has let the answer stand. The
    `skill.steps_unfinished` event still fires where it always did (unarmed runs are
    byte-identical). Pinned: a stepped skill beside the gate, both deciders, both chart builders;
    the equality test asserts at most one witness row of each kind per turn on every case.
12. **The turn stamp never repeats in a conversation.** `seed.ts` counted the user messages of the
    stored history, and a window strategy (or a compaction) trims that history — the count
    repeated and went backwards, and an earlier turn's witness row was folded as a later turn's
    (the line then told the person about steps a plain turn never had). While a layer is armed the
    checkpoint now carries the turn its history ends on (`AgentRunCheckpoint.turnNumber`, both
    carriers, validated at the door, an optional field — version 1 still), and seed continues from
    it (`turnNumberFor`): a continued conversation is the turn after it, a `resumeOnError` retry
    the same turn. The restored ledger's latest stamp is a second floor, for a conversation stored
    before the carrier existed — the rule `memory/turn/resolveTurnNumber.ts` applies to a store.
13. **The account credits the line to the library only when the record proves it.** The split
    matched the line's short openings ("Not sure — ", "Known — ") on every recording — a plain
    agent's model words were read as a block the library appended. The account now rebuilds the
    exact line from the record (`turn_end.answerAssessment`, and — for an assumed value — the
    committed rows it names, through the same `assessment/compose.ts` · `assumedValuesSourceOf` the
    stage composes from) and splits only on that line, where the composer puts it. The two block
    headings (limits, "Assumed") are matched as before. A recording without its committed state
    cannot rebuild an assumed value, and then the line is not claimed.
14. **`stoppedEarly` is read on every armed agent.** The read list kept it behind the tool arm,
    but the Route decider writes it on any agent whose model asks for calls when a limit fires —
    a tool registered or not — so a tool-less agent's in-run standing said "not assessed" and the
    recording "not sure". Every key's writers were checked against the list.
15. **Both doors meet the build refusals.** `AgentOptions.answerLayer` skipped the line's refusals
    beside `.outputSchema()` and `.answerValidation()` — the line was appended to a typed answer's
    JSON. `AgentBuilder.build` now resolves the arm once from both doors, through one validator.
16. **The line never drops an assumed value.** It replaces the uncapped "Assumed" block, so its
    assumed clauses are exempt from the clause cap; only the other reasons fold into "… and N
    more".

## The layer contract, as step 6 ships it

| Clause | Here |
|---|---|
| DECLARE | the existing arms (posture, `.claims()`, `.outputSchema()`, `.answerValidation()`, `.limitsTravelWithTheAnswer()`, the answer's `_findings`); the layer's own arm is `.answerLayer()` |
| VERIFY | the Route decider's checks, unchanged: schema → steps → `judgeEvidence` → claims |
| RECORD | the two witness rows (`grounded`, `steps-unfinished`), filed by Route under the arm, stamped with `turn` |
| RESOLVE | label only: no ask, no refusal, no edit of the model's reply |
| FOLD | `assessment/assess.ts` · `assessAnswer` — the same pure function in the run and afterwards |
| SERVE | `turn_end.answerAssessment`, `agentfootprint.answer.assessed`; the line only under `{ standingLine: true }`, only on a prose answer |
| ARM + MEASURE | `.answerLayer()`; off → byte-identical (the 25 references under `test/core/tools/reference/` unchanged; one armed reference, `agent-answer-layer`) |

**Resolve verbs here.** Label only. No ask at the answer: the call that could have used an answer
has already run, and the library never replaces the model's reply with a question.

**What it costs a plain agent.** The stage body, the fold and the line load through `import()`
under the arm; what a synchronous door needs stays static (the list:
`src/core/agent/honesty/README.md`, "What a plain agent carries"). The docs site's budget,
measured with a local `EXPORT=true` build of the same docs with only the library swapped: the
deferred demo 440.8 → 442.8 KB gzip (ceiling 450 KB); search 2.12 MB gzip over 1,029 records;
the export 693.70 MB across 7,374 files. Every ceiling holds; no raise.

## Not covered, and gaps left

- **A run that threw is still not settled by the fold.** No committed row says a turn reached its
  answer (decision 2 is why the layer cannot file one from the final branch), so `assessAnswer`
  over a crashed run's record folds what the run left; `agent.assessment()` and the answer account
  still settle it first. A Route-filed "answered" witness is the natural next row; it needs the
  fold's return shape to say "no answer", which is a decision of its own.
- **"No errors" and small numbers** are never checked by the gate; a question asked in prose reads
  as an answer (the fold has no row for it).
- **The `.claims()` dispositions and the integrity dispositions** are still events only — no
  `claim-contradicted`, and no claims-supported "known" yet.
- **A finished step procedure** files no row, so it cannot count as a check that ran.
- **The line's reasons carry no counts** — a person reads which kinds of reason fired, and the
  account's "How sure" row (or `agent.assessment()`) has the counts and the rows.
- **The app's declarations do not reach the in-run fold.** `rowsAt` declarations
  (`AssessmentDeclarations`) reach `assessAnswer(record, declarations)`,
  `agent.assessment(declarations)` and the account; the layer folds without them, so for an app
  that declares them the event and the line can say less than the account does about the same run
  (an object result's empty rows read `not-assessed` in the run, `not sure` afterwards).
  Accepting them as build-time data on `.answerLayer()` is the natural next arm.
- **A composition does not receive `agentfootprint.answer.assessed`.** The composition's dispatcher
  bridges the agent domain, not `answer.*`, so a Sequence (or any runner that mounts an agent)
  reads the standing on `turn_end.answerAssessment`.
- **A typed answer that failed its own contract** (`outputContractUnmet`) folds on the model's
  bytes — no reason reads the contract verdict, and a fallback value `runTyped()` returns was never
  assessed.
- **A refused answer** (the evidence gate's `rails` posture) still fires `answer.assessed` and puts
  the line on `turn_end.finalContent`; the run then throws, and `agent.assessment()` returns
  `undefined`. The event is about the answer the run composed, not one that was delivered.
- **The line and the limits are not streamed** — `stream.token` carries the model's text; the
  returned answer carries the appended section.
- **A retried turn after a final-branch failure** (`resumeOnError` of a crash after Route chose
  `final`) files the retry's witness rows under the same turn as the failed attempt's; the fold
  reads every `steps-unfinished` row of the turn, so the failed attempt's can still fire.

## Its benchmark

The protocol is the architecture note's § 6.1. Provoking cases: the paper study's absent and
wrong-kind cases (its C, D and F kinds: false non-existence, overclaim). Baselines: the model's
verbalised confidence, and its own `_findings` answer standing. No served honesty arm is on in any
study arm (architecture § 6.3). The build made no paid call: the step's registered success rule and
its runs belong to the bench, after the rule is committed.

**Measured, 2026-09-28 — PASS** (`bench/answer/`, rule `answer-rule-step6` in
`bench/answer/RULE.md`, committed and pushed before the first paid call). Haiku 4.5, arms `off`
and `layer` interleaved, 12 cases × 10, seed 20260928, $0.77. Every gated clause held: the in-run
standing flagged 50/50 provoking answers and supported 50/50 control answers; in-run equalled
read-after (event, `turn_end`, `assessAnswer`, `agent.assessment()`) on 120/120; the first request
was byte-identical across arms on 12/12 cases; 120/120 answers were the model's own text; facts,
hedges, asks, tokens per call (×1.002) and calls per run (×0.993) did not move. Reported: 14 of 50
provoking answers exceeded their standing — all ten answers to the bare empty lookup said flatly
"there are no open incidents" — and the standing flagged 14/14 of them; the model's own words
(a phrase reader, hand labels pending) flagged 26/50. The gap set — a wrong-kind entity and an
undeclared partial lookup — was flagged 2/20: those limitations reach no committed row in this
version. Before it, at $0: the 800 recorded inputs-bench runs re-folded unchanged by this build.
The model called a tool on every run, so the live sensitivity is mostly the fold reaching rows it
was built to read; a run that answers without a lookup reads "not assessed" (scripted). Details:
`bench/answer/README.md`, "Results".

## What the answer layer lets you measure

From the record alone — and now at the moment the answer exists, from one event per answer:
**answers that exceed their standing** — a flat non-existence or completeness claim on an answer
whose standing is not sure or ask (RQ3's `exceeds`); the standing mix per model; how often the
gate's check actually ran on an answer (`grounded` rows with values looked up) against how often
it flagged one (`unsupportedValues`); how often an answer came before its declared steps finished;
unsupported values; claim contradictions once they are committed. They measure claims within the
record, not whether an answer is true.
