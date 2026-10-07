**Mixed** — one run's redaction: which policy covers it, and what each record of
it is served as.
Map: `policy.ts` (a policy as data — the shape check, the union),
`declared.ts` (which runner declared which policy; a composition adopts its
members') and `conversation.ts` (the names an agent's record carries the
conversation under — `conversationRedaction()`). Walker: `runRedaction.ts` (the
per-run wiring every runner's `createExecutor` goes through; `emitServed`, the
one way a typed event leaves a stage; `setEventSource`, the one way a stage
writes a value the library derives events from). Lens: `served.ts` (what an
event's payload and meta are served as).

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
| recordings (`recordRun`, packed or plain), traces, strategies (otel, file, audit, console, CloudWatch, X-Ray, AgentCore) | memory — what a later run recalls (`defineMemory({ redact })` is refused; `../memory/redactRefusal.ts`) |
| bug reports, answer accounts, the self-explain tools, recordings a host files | the run's verdict accessors (`stoppedEarly()`, `findings()`, `answerCoverage()`, …) and `agent.assessment()` |

**It selects by NAME, never by content** (footprintjs's law). A key or a pattern
masks a STATE key of that name and everything under it; in every record handed
out WHOLE — an event's payload, a pause's question, the run's input, a thrown
error — it masks a key of that name at ANY depth. An agent keeps its whole
conversation in ONE state key, `history`, so a field like `ssn` inside a tool's
arguments is masked in every event but stays inside the snapshot's `history`
until `history` itself is named. Free text has no name: to keep what people say
out of the record, name every key that carries it — which is what the
library's vocabulary does.

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
  runs each feature in `CONVERSATION_FEATURES` (the turn, tools, thinking,
  asking a person, structured output, memory and RAG, the evidence gate) with a
  canary in every place it moves the conversation: without a policy every
  canary reaches a record; under the vocabulary none reaches any record, the run
  emits the SAME events, and its answer account is still told. Compositions are
  proven in `agent-redaction.propagation.test.ts`. A feature added to the list
  needs a case there. And it agrees with the audit export: every field the
  audit's bounded mode treats as content (`adapters/observability/audit.ts` ·
  `boundedContentFieldNames`) is on the list — pinned in the same file.
- **What stays readable.** Ids, counts, kinds, tool names, timings and verdict
  words — the record still shows WHAT happened, without the words.
- **Not on it, by design.** Error text written by code (`error`,
  `errorMessage`, `lastError`): a message a tool or provider throws can quote
  what it failed on, and `error` also names a flag the record's readers count on
  (`stream.tool_end`'s `error: true`) — add those names yourself if your errors
  carry personal data. Fields your own tools or rules name — join them.
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
4. **Derived fields** (`served.ts` · `DERIVED`): a field the library computes
   from another value and carries under its own name — a parser's message quotes
   the model's draft — is served as the placeholder whenever the rule keeps the
   value it came from out (`rawOutput`). footprintjs's taint rule for a mapper's
   computed copy, applied to the library's own copies; still the rule's verdict,
   by name.
5. **Relayed writes** (`setEventSource`): the context recorder derives
   `context.injected` / `slot_composed` / `budget_pressure` from the slots'
   writes, and a selected key's write reaches recorders as the placeholder. The
   slots hand the value they wrote to the run as they write it; the recorder
   derives from that, and the event it dispatches is served by name — so a
   kept-out injection is still an injection the record shows.
6. The **real-value path** (`EventDispatcher · onRealEvent`) carries each event
   as its producer made it, to the library's own mechanisms that compute on it:
   the crash-checkpoint tracker, the window's token meter, a host's streamed
   reply and spend ledger, `toSSE({ format: 'text' })`. Outside a runner's class
   it is reached only through `core/runnerLive.ts` (with the run's live state, for
   a host's session store), which no barrel exports and no runner method hands
   out — so no consumer can reach it, and nothing on it is stored, exported or
   shown.

## Readers of a redacted record

A placeholder is never read as a value. The answer account
(`lib/answer-account/view.ts`) reads a kept-out field or state key as ABSENT and
NAMES it, so a fact says "kept out" where it would otherwise say "not recorded":
the question, the answer (a run whose answer is kept out still finished), a tool
result's emptiness, a call's outcome, the flagged values of the evidence gate,
the history earlier results sit in. A reader that touches a kept-out value
without asking about it would state a fact about a placeholder, so the view
watches, and the account then refuses to tell (`notToldAccount`) instead of
saying "no tool ran". `assessAnswer` gives no standing over a state key the
record keeps out (`AnswerAssessment.keptOut`); `agent.assessment()` reads live
state and is unaffected.

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
- **A resume is its own leg.** A per-run `redact` (`run(input, { redact })`) is
  not stored in the checkpoint: pass `resume()` the same one. The names the
  paused run masked travel with the checkpoint; a policy the agent DECLARED
  (`Agent.create({ redact })`) covers every leg by itself.
