**Mixed** — one run's redaction: which policy covers it, and what each record of
it is served as.
Map: `policy.ts` (a policy as data — the shape check, the union),
`declared.ts` (which runner declared which policy; a composition adopts its
members') and `conversation.ts` (the names an agent's record carries the
conversation under — `conversationRedaction()`). Walker: `runRedaction.ts` (the
per-run wiring every runner's `createExecutor` goes through; `emitServed`, the
one way a typed event leaves a stage; `setEventSource`, the one way a stage
writes a value the library derives events from; `servingAhead`, a resume's
serving before its executor exists). Lens: `served.ts` (what an event's payload
and meta are served as — `DERIVED`, the content the library quotes under names
of its own) and `marker.ts` (the one sign a record was served under a policy,
which every reader of a record asks before it reads a placeholder as kept out).

Nothing in this folder decides what is secret. footprintjs's `RedactionRule`
(`footprintjs/advanced`) is the one owner of every verdict; this folder only
chooses WHICH of its decisions applies to a record agentfootprint makes, and
WHERE — once, at the record's source.

## The law

An agent's `redact` (`Agent.create({ redact })`) is a footprintjs
`RedactionPolicy` for every run the agent's records come from. It covers
**everything the library retains or serves** about those runs and **never what
the agent computes on or hands back to its caller**.

| Covered — the placeholder where a selected value was | Never covered — real values |
|---|---|
| the commit log (scrubbed at write, by footprintjs) | the model's input |
| `getLastSnapshot()` — footprintjs's redacted view | the answer `run()` returns; a host's streamed reply; `toSSE({ format: 'text' })` |
| the narrative (`getLastNarrativeEntries()`) | the conversation it continues: `checkpoint()`, `followUp`, `continueFrom`, a host's session store |
| every typed event — `agent.on`, recorders on the executor, the deferred tier | the resume checkpoints: a pause's `checkpoint`, `RunCheckpointError.checkpoint` |
| recordings (`recordRun`, packed or plain), traces, strategies (otel, file, audit, console, CloudWatch, X-Ray, AgentCore) | memory — what a later run recalls, a causal snapshot's tool calls included (`defineMemory({ redact })` is refused; `../memory/redactRefusal.ts`) |
| bug reports, answer accounts, the self-explain tools, recordings a host files | the run's verdict accessors (`stoppedEarly()`, `findings()`, `answerCoverage()`, …) and `agent.assessment()` |
| the record a chart-backed tool keeps (`flowchartAsTool` / `runbookAsTool`) — under the calling run's policy too | what that tool hands the MODEL, when the calling run keeps its conversation out (below) |
| | the context ledger's counts, whose gates decide what later runs are offered (below) |

**It selects by NAME, never by content** (footprintjs's law). A key or a pattern
masks a STATE key of that name and everything under it; in every record handed
out WHOLE — an event's payload, a pause's question, the run's input, a thrown
error — it masks a key of that name at ANY depth (and a dotted-path pattern or
a `fields` selector, a path). So a field like `ssn` inside a tool's arguments is
masked wherever a record hands the arguments out WHOLE — every event's `args`,
and the copies the library renders from them (a check-in's `willDo`, a
validation issue's quoted value — `DERIVED` below). A copy held in STATE is
selected by its own top-level key, never by a name inside it: the history, a
paused call's arguments (`pausedToolArgs`), the model's latest tool calls
(`llmLatestToolCalls`) carry `ssn` under keys of their own, and are kept out
by naming those keys — which the vocabulary does. TEXT has no name: the conversation —
the `history` state key, a tool's result, a refusal sentence that quotes what
it refused, the model's words — carries a value as text, and is kept out only
by naming the keys it travels under, which is what the library's vocabulary
does.

## The vocabulary — `conversationRedaction()`

An agent's record carries the conversation under many names, nearly all of them
the library's own: the person's message, the model's words and thinking, tool
arguments and results, what memory and retrieval recalled, what was injected
into the model's context, a paused call's arguments, a person's reply, the draft
a schema check rejected, what one member of a composition hands the next.
`conversationRedaction()` (`conversation.ts`, exported from
`agentfootprint/security`) is that list as one policy, joined with the names
your own app adds:

```ts
import { Agent } from 'agentfootprint';
import { conversationRedaction } from 'agentfootprint/security';

const agent = Agent.create({
  provider,
  model,
  // The conversation, wherever the library carries it — plus the fields your
  // own tools name, wherever they appear.
  redact: conversationRedaction({ patterns: [/ssn|email|phone/i] }),
})
  .tool(lookupCitizen)
  .build();
```

- **Proven per feature.** `test/redaction/agent-redaction.vocabulary.test.ts`
  runs each feature in `CONVERSATION_FEATURES` — the turn, tools (with argument
  validation), thinking, asking a person, the inputs layer, structured output,
  memory and RAG, the evidence gate (with its figures), a person approving a
  call (check-in), skill graphs — with a canary in every place it moves the
  conversation: without a policy every canary reaches a record; under the
  vocabulary none reaches any record, the run emits the SAME events, and its
  answer account is still told. Compositions are proven in
  `agent-redaction.propagation.test.ts`. A feature added to the list needs a
  case there. Two pins keep the list honest in both directions: every field
  the audit's bounded mode treats as content (`adapters/observability/audit.ts`
  · `boundedContentFieldNames`) is on it, and every `DERIVED` row names a real
  event and a source the vocabulary keeps out — each row checked at every path
  it names in `served.test.ts`.
- **What stays readable.** Ids, counts, kinds, tool names, timings and verdict
  words — the record still shows WHAT happened, without the words.
- **Not on it, by design.** Error text written by code (`error`,
  `errorMessage`, `lastError`, a provider fallback's `reason`, a fatal event's
  `error`): a message a tool or provider throws can quote what it failed on,
  and `error` also names a flag the record's readers count on
  (`stream.tool_end`'s `error: true`) — add those names yourself if your errors
  carry personal data. The thrown value itself, handed to your caller by
  `run()`'s rejection, is the caller's own. Fields your own tools or rules
  name — join them.
- **Names it shares with structure** are kept out with it: `permission.check`'s
  `result` is its verdict word, so a refused call reads as refused from
  `stream.tool_end`'s `notExecuted`, without the rule that refused it.

`examples/features/95-agent-redaction.ts` runs an agent under it and asserts
that no message, argument or result reaches the recording, the narrative or
the snapshot — while the model, the tool and the caller get the real values —
and that the answer account says the question and the answer are kept out.

## Where a policy reaches

- **Composed runners.** `Sequence`, `Parallel`, `Conditional`, `Loop`, `Graph`
  and `Workflow` run their members as subflows of ONE executor, so a member's
  `redact` is adopted by the composition at construction (`declared.ts`) and the
  composition's one run applies the union.
- **Runs a tool starts.** `ctx.redact` is the policy the calling run is covered
  by. `flowchartAsTool`, `runbookAsTool` and the `.selfExplain({ delegate })`
  debugger join it with their own; a tool that runs another agent passes it on —
  `specialist.run(input, { redact: ctx.redact })`, as it passes `ctx.signal`.
  A per-run `redact` is an `Agent`'s run option only: a composition takes
  none, so a tool that runs one keeps it covered by what its members DECLARE
  (a member's `redact` is adopted, above). An `LLMCall` and an `LlmRouter`
  declare nothing — neither takes a `redact` — so one run on its own, or a
  composition made only of them, is covered by nothing (named limit below).
- **A chart-backed tool: the record, the model's view, and the boundary
  between them.** The inner run of `flowchartAsTool` / `runbookAsTool` is
  covered by the UNION — its log, narrative, kept record and recording keep out
  every name either policy selects. What the tool hands the MODEL (the state a
  `resultMapper` reads, a runbook envelope's rows and report) becomes the
  tool's RESULT, which the calling run keeps in its own conversation — so the
  model's view is decided by where that result lands
  (`core/servableSnapshot.ts` · `modelFacingState`, the one owner):
  - the calling run keeps its WHOLE conversation out of its records
    (`conversation.ts` · `keepsConversationOut` — `conversationRedaction()` or
    more): the model reads the run's live state under the TOOL's own `redact`
    and the chart's own marks only — the live input, never redacted — and the
    result it rides in on is kept out of every record of the calling run by
    that run's own names. The one case it cannot tell apart: the rule marks a
    key the caller's policy selects whenever it is written, so a key the chart
    ALSO marks itself (a per-call `$setValue(key, value, true)`) reaches the
    model unmasked — name it in the tool's own `redact`;
  - a narrower calling policy: the result would carry the value into the
    calling run's records as text, under names that policy does not select —
    so the model reads exactly what the record reads, the placeholder. The
    calling policy reaches this tool's model view: the price of the promise.

  Pinned end to end, with every artifact of the calling agent searched, by
  `test/redaction/agent-redaction.tool-boundary.test.ts`.
- **The union only adds.** A run covered by several declarations masks every name
  any of them selects (`unionRedactionPolicies`).

## How it works

1. `RunnerBase · openRunRedaction` runs for EVERY run of every runner: it joins
   the runner's declaration with any policy the caller handed down, hands the
   result to footprintjs (`executor.setRedactionPolicy`), installs the serving on
   the runner's dispatcher, and wraps the chart's scope factory so each stage's
   scope knows its run.
2. `emitServed` (called by `typedEmit` and every other `$emit` in the library)
   serves a typed event's payload BEFORE footprintjs's `$emit` — so `agent.on`,
   every recorder attached to the executor, the deferred tier and the narrative's
   `[emit]` lines all receive one served payload. footprintjs serves `$emit` by
   event name only; a typed event is a record handed out whole, so it is served
   the way footprintjs serves those (`served.ts`).
3. The dispatcher serves every fact a runner dispatches directly (pause events,
   artifact facts, the run manifest, `context.*`, `error.fatal`) and the identity
   on every event's meta, by the same rule.
4. **Derived fields** (`served.ts` · `DERIVED`): content the library computes
   from another value and carries under a name of its own IN AN EVENT is served
   as the placeholder whenever the rule keeps a value it came from out — a
   parser's message quotes the model's draft (`rawOutput`); a validation issue,
   an external ground and an assumed value quote an argument (`args`, or the
   argument's own name on the row); a check-in's evidence pack quotes the
   model, the arguments (its `willDo` text is kept out by ANY argument name the
   rule keeps out — on the check-in event and on the pause it asks with) and the
   conversation; a matcher's witness quotes the
   person's words; a route guard's summary and a tool's progress report quote a
   result, a figure the answer computed quotes the answer and its results; a
   retrieved passage's heading quotes what was retrieved. Generic names
   (`value`, `note`, `text`) are never put on a policy — selected by name they
   would hide structure in every event.
   footprintjs's taint rule for a mapper's computed copy, applied to the
   library's own copies; still the rule's verdict, by name. A copy the library
   keeps in STATE (the turn's routing verdict `turnRoute`, a map's
   `mapEngagement`) is a state key, kept out by its own name — the vocabulary
   names both.
5. **Relayed writes** (`setEventSource`): the context recorder derives
   `context.injected` / `slot_composed` / `budget_pressure` from the slots'
   writes, and a selected key's write reaches recorders as the placeholder. The
   slots hand the value they wrote to the run as they write it, with the rule's
   verdict on the key; the recorder derives the same events from that, and when
   the key was kept out it keeps only the derived record's STRUCTURE (ids, slot,
   source, position, counts, budget — `ContextRecorder.ts` ·
   `INJECTION_STRUCTURE` / `COMPOSITION_STRUCTURE`) and serves every other field
   as the placeholder. A kept-out injection is still an injection the record
   shows — without its words.
6. **A resume is covered like its first leg** (`servingAhead`,
   `policyOfMarks`, `AgentState.runRedaction`): the resumed leg's policy is the
   runner's declaration, the per-run `redact` the paused run was handed (read
   back off the checkpoint's state), any the resume adds, and the names the
   paused leg kept out (the checkpoint's marks). `pause.resume` carries the
   person's reply and is dispatched before the leg's executor exists, so the
   runner installs that serving first — a fresh instance, a later process or
   another pool lane serves the leg as the instance that paused would. A
   carried policy this library did not write refuses the resume.
7. **The marker** (`marker.ts`): under a policy, the run's snapshot carries one
   recorder row, `agentfootprint.redaction` — the positive sign that a
   placeholder in the record is a value the policy kept out. Without a policy
   nothing is attached and the snapshot is byte-identical.
8. **A run's redaction is the RUN's, never the instance's.** The policy a run
   is covered by is handed to its executor (`applyTo`), and a snapshot is
   served under the policy of the executor it comes from (`policyOfExecutor`)
   — never whatever run came after; the policy a paused run carries is read
   off the run that owns the seed's scope (`policyInForce`), never an agent
   field; a resume's leg policy goes back from `emitPauseResume` to that leg's
   executor; and a fact is served under its own run's serving, by its run id
   (`EventDispatcher · servingsByRun`) — one dispatched before any run opened
   (a consumer's `emit`, a `parseOutputAsync` fallback) under the policy the
   runner declares (`EventDispatcher · useDefaultServing`). One run at a time per agent instance
   is the conversation law (`RunInFlightError`, `PendingQuestionError`); a
   resume that cannot carry its redaction is refused (`ResumeRedactionError`).
   Pinned by `test/redaction/agent-redaction.run-state.test.ts`.
9. The **real-value path** (`EventDispatcher · onRealEvent`) carries each event
   as its producer made it, to the library's own mechanisms that compute on it:
   the crash-checkpoint tracker, the window's token meter, causal memory's tool
   calls, a host's streamed reply and spend ledger, `toSSE({ format: 'text' })`'s
   token text. Outside a runner's class it is reached only through
   `core/runnerLive.ts` (with the run's live state and snapshot, for a host's
   session store and the context ledger), which no barrel exports and no public
   runner method hands out — so no consumer reaches it through the library's
   API, and nothing on it is stored, exported or shown. The fence is the API,
   not a runtime wall: TypeScript's `protected` is erased at compile time, so
   code that casts past it (`(runner as any).dispatcher`) reaches the live
   taps — as it reaches every value in its own process. A consumer's `toSSE`
   `filter` sees the served record.

## Readers of a redacted record

A placeholder is never read as a value — and a value is never read as a
placeholder. The readers that interpret a record ask its MARKER first
(`marker.ts` · `servedUnderPolicy`): only a record served under a policy holds
placeholders, so on a run no policy covered a tool that really returned the
word `REDACTED` is read as what it returned, and the account is the one it
always was. (A bug report's `redactedKeys` is different on purpose: it lists
the keys whose value IS a placeholder string in the evidence, read off the
bytes, for any recording — an agent's or a chart's.)

- **The answer account** (`lib/answer-account/view.ts`) reads a kept-out field
  or state key as ABSENT and NAMES it, so a fact says "kept out" where it would
  otherwise say "not recorded": the question, the answer (a run whose answer is
  kept out still finished), a tool result's emptiness (a row set kept out
  INSIDE a result too), a call's outcome, the flagged values of the evidence
  gate, the history earlier results sit in. A reader that touches a kept-out
  value without asking about it would state a fact about a placeholder, so the
  view watches, and the account then refuses to tell (`notToldAccount`)
  instead of saying "no tool ran".
- **`assessAnswer`** gives no standing over a state key the record keeps out
  (`AnswerAssessment.keptOut`). `agent.assessment()` folds the run's LIVE state
  as values (`core/agent/assessment/assess.ts` · `assessLive`): the live
  snapshot carries the marker too — its commit log IS scrubbed — but its state
  never is.
- **The served views** (`servedAt`, `servedViews`) read a redacted piece as
  absent, and name the fold base a served snapshot lacks (`no-fold-base`).
- **The context ledger** (`lib/context-ledger/contextLedger.ts`) is not a
  reader of the record but a mechanism: its gates decide what LATER runs are
  offered, so a placeholder must never count as "never used". A runner is read
  live — a final value the log keeps out (the history it counts tool calls
  from, the slot records) comes from the run's end state, so the counts match
  the run without a policy. A read nothing live can answer — what each CALL
  was offered lives only in the log, and a snapshot handed in has no live
  state — leaves its kind UNMETERED for that run (`RecordedRun.unmetered`):
  neither its offers nor its uses are counted, and its gate keeps offering it.
  Under the vocabulary that is injections and skills (`activeInjections`
  carries their text); tools stay metered.

## Named limits

- **The answer as the run's output.** A run's answer leaves its chart as a bare
  string, and footprintjs serves an unnamed root output as it is: a recording's
  `run.exit` boundary payload, the step graph's run node (`exitPayload`) and the
  `onRunEnd` payload of a recorder you attach carry the answer whatever the
  policy. The vocabulary keeps it out of state and every event (`turn_end`'s
  `finalContent`, the streamed tokens); the run's output stays. Closing it needs
  a chart to name its output for footprintjs's rule — a footprintjs change.
- **A copy under a new name inside a stage.** An event field built from a state
  value under a different name is selected by its own name only (footprintjs's
  rule for a stage function's copies). The vocabulary names the copies the
  library makes; a copy your own code makes is yours to name.
- **The window's provenance.** Under a policy that selects `history` whole, the
  window meter cannot see the window's length on the record channel, so an
  eviction's `removedStageIds` names none and its `survivalMs` is 0 ("birth
  unknown"). The window's DECISION is unaffected — its token count rides the
  real-value path.
- **Console diagnostics.** Warnings the library prints for a developer are not
  records and are not served: a tool's or a memory extractor's thrown message
  can appear in one. The output-schema warning leaves the parser's message out
  when the run keeps the draft out (`stages/route.ts`); route the rest of your
  console in production as you would any log.
- **A fold of a redacted snapshot.** `getLastSnapshot()` omits `initialState`
  under a policy (footprintjs: the raw pre-run base never passed the policy), so
  a fold of it reports `basis: 'log-only'` and `servedAt` names `no-fold-base`.
- **Event meta.** `principal` and `tenant` (who asked) are served by name; every
  other meta field is the record's address — run, stage, session, trace ids —
  and is never selected.
- **Fingerprints and hashes stay.** They are structure, and the record's
  readers join on them: a repeated call's `argsFingerprint` / `resultFingerprint`
  (`core/agent/repeatedCall.ts` · `fingerprint`, an unsalted 32-bit FNV-1a), a
  context piece's `contentHash` (FNV-1a over its text), and a receipt's hashes
  (salted with the `runId` the same record carries). A hash hides a value; it
  does not keep a GUESSABLE one secret — a short or low-entropy value the policy
  kept out (a PIN, an SSN, a yes/no) can be confirmed offline by hashing
  candidates. Treat a recording as confirming such a value to anyone who can
  guess it.
- **Causal memory's decisions.** A causal snapshot's tool calls are read on the
  real-value path (the store is working state), but the decisions it keeps
  come from footprintjs's flow channel, which serves them under the policy: a
  decision's evidence in the store holds the placeholder where the policy
  selected a value.
- **The context ledger under the vocabulary.** Injections and skills are not
  metered while `activeInjections` is kept out (above, `RecordedRun.unmetered`):
  their gates keep offering them rather than judge on what the record cannot
  show.
- **A chart-backed tool's narrative.** What `flowchartAsTool` hands a
  `resultMapper` as `snapshot.narrative` is the inner run's narrative, written
  through the run's rule — under the UNION, the caller's policy too. A mapper
  that quotes it hands the model the placeholder where the caller's names were;
  the state it reads (`snapshot.values`) is the model's view, above.
- **Two copies of the package.** The live taps are a module's own registry
  (`core/runnerLive.ts`), so a runner built by one copy of agentfootprint (CJS
  and ESM loaded side by side, two installed versions) is not read live by the
  other: `standingAgent` refuses it, `toSSE({ format: 'text' })` streams the
  served tokens, the context ledger counts the served record.
- **A recording without its snapshot.** The marker rides the snapshot's
  `recorders`; an events-only recording carries none, so a reader quotes a
  placeholder there as it stands.
- **A very late fact.** A fact a runner dispatches after its next run opened
  (a host's artifact fact, a teardown report) is served under ITS run's policy,
  found by the run id it carries — for the 32 most recent runs a dispatcher
  opened; one older than that is served under the run in force.
- **A conversation continued is a new run.** A per-run `redact` rides the
  run's own state into a pause's checkpoint (`AgentState.runRedaction`, names
  only), so a resumed leg is covered by it without being handed it again, and
  the names the paused leg kept out (footprintjs's `redactionMarks`) cover the
  leg whatever policy it is given (`redaction/policy.ts` · `policyOfMarks`).
  Every resumed leg writes its WHOLE policy back (`Agent · resume`), so a
  `redact` passed to `resume()` covers every later leg too. A
  conversation CONTINUED from a run (`followUp`, `continueFrom`,
  `resumeOnError`) is a new run, covered by what that run is given — declare
  the policy on the agent (`Agent.create({ redact })`) to cover every run.
- **A checkpoint is not proof.** The resume refuses a carried policy it cannot
  read (`'unreadable'`) and a missing one the checkpoint's own marks give away
  (`'missing'`), but a checkpoint EDITED to drop both its policy and its marks,
  or to carry a narrower policy this library could have written, resumes under
  what it says. A host that lets checkpoints leave its trust boundary signs
  them — as it does for the identity a checkpoint names.
- **A tool's coverage declaration.** The words a tool's author passes to
  `coverage()` / `absent()` are the AUTHOR's text about what the tool read
  (`coverageDeclared`, `answerCoverage`, the `tools.coverage_declared` /
  `tools.absent` events), served as written, like a tool's description — they
  are not on the vocabulary, because the answer account reads them to say what
  the tools covered. Keep the person's data out of them; to keep them out of
  the record anyway, name `coverageDeclared` and `answerCoverage` yourself, and
  the account then says it cannot tell what the tools covered.
- **An `LLMCall` or an `LlmRouter` on its own.** Neither takes a `redact`, so
  neither declares one: its records — run on its own, or in a composition made
  only of such steps — are covered by nothing. Run the step as an `Agent`, or
  compose it beside a member that declares the policy.
- **Overlapping runs of one composition.** An `Agent` refuses a second run
  while one is in flight (`RunInFlightError`); a composition does not, and it
  stamps every event with the run it started LAST. Two overlapping runs of ONE
  composition instance are both covered by its declared policy, but a resumed
  leg's extra names (the paused leg's marks) can be served under the other
  run's policy. Run a composition instance one run at a time.
- **A chart's own marks with no policy at all.** footprintjs keeps its
  redacted mirror only under a policy: a chart-backed tool that runs with none
  (no tool `redact`, no calling policy) serves its state as it is, while its
  log holds the placeholder where the chart marked a write
  (`$setValue(key, value, true)`). Give the tool a `redact` to have its kept
  record and recording served.
