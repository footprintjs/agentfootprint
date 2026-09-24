**Mixed** — the two primitives that build a map, and the wiring that runs one.
Map: `LLMCall.ts`, `Agent.ts`'s `buildChart`, `toolContract.ts`, `outputSchema.ts`.
Walker: `RunnerBase.ts`, `runner.ts`, `runCheckpoint.ts`, `pause.ts`,
`toolSessions.ts`, `durabilityBarrier.ts`.
Fold-feeding: `Agent.ts` · `readSkillOfferFor` and `Agent.ts` ·
`hiddenSkillIdsNow` — the two resolvers every model-facing composer downstream
filters with. Trace: `cost.ts`. Support: `tools.ts`, `runInput.ts`,
`conversation.ts`, `translator.ts`, `humanizeLLMError.ts`, `outputFallback.ts`.
Note: "Lens" in `runner.ts`, `RunnerBase.ts`, `Agent.ts`, `translator.ts` and
`LLMCall.ts` means the VIEWER PRODUCT, not the wire-facing role.

# `src/core/` — primitives + Runner foundation

## What lives here

The consumer-facing primitives (`LLMCall`, `Agent`) and the shared Runner infrastructure they build on.

```
core/
├── runner.ts         Runner interface (extends footprintjs ComposableRunner).
├── RunnerBase.ts     Shared implementation (.on/.off/.once/.attach/.emit/.enable).
├── LLMCall.ts        Primitive: single LLM invocation (no tools, no loop).
├── Agent.ts          Primitive: ReAct loop (LLM + tools + iteration).
├── tools.ts          Tool<TArgs, TResult> contract.
├── inputRequest.ts   Typed missing fields, accepted values and response validation; pause.ts supplies requestInput().
└── slots/            The 3-slot context model (see slots/README.md).
```

`requestInput()` is a data-collection arm of the existing pause mechanism.
Partial typed replies update the returned checkpoint before executor resume;
full replies use the normal paused-tool result path. It does not share the
consent decision vocabulary. See the input-requests guide for the wire shape.

## A batch that pauses settles its un-dispatched siblings (9.113.0)

**A batch that pauses settles its un-dispatched siblings: each gets a
past-anchored result, a bracket and a count — the request a resume sends never
carries a call without a result.**

**Why.** A model may propose several tool calls in one turn, and the loop
dispatches them in order. When one of them pauses — a middleware `ask`, a
tool's `checkIn`, a credential consent, or a tool that raised `pauseHere` /
`askHuman` / `requestInput` — the calls after it were never dispatched. Every
resume path used to answer the paused call and stop: the next request carried a
`tool_use` block with no `tool_result` (a provider builds results only from
`role: 'tool'` messages), `iteration_end` counted one call, and the calls after
the pause had no `tool_start` / `tool_end` at all.

**How.** All four resume paths go through one settlement
(`agent/stages/toolCalls.ts` · "── The batch settlement (9.113.0)"). Each call
after the paused one gets:

- one fixed sentence as its result (`toolCalls.ts` · `notDispatchedResult`):
  past tense, anchored to the paused call by id and by tool, naming no
  destination — the law a library correction is written against is in
  `agent/README.md`;
- its bracket: `tool_start`, then `tool_end` with the sentence as `result`,
  `durationMs: 0` and no `error` — the call produced no result and did not
  fail — both halves carrying the marker below;
- a place in the resume leg's `iteration_end.toolCallCount`, which counts the
  brackets THAT leg closed: the paused call's own plus one per settled call.
  Paused on the last of three → 1 (as before); on the middle → 2; on the
  first → 3;
- the same fact as DATA, `notDispatched: { pausedCall: { toolCallId,
  toolName } }`, on its message in `history` and on both halves of its bracket
  — the law under "One owner of 'never dispatched'" below.

Nothing is dispatched on resume: a resumed dispatch has no second checkpoint,
so a call that would ask a person, meet a check-in or wait on consent could
not. The model reads the fact and decides whether to propose the call again.
The batch is read from the assistant turn in `history` that proposed it
(`toolCalls.ts` · `pausedBatchOf`) — the message the `tool_use` blocks are
built from — so the checkpoint gains no key and one written before this
release settles the same way. The calls before the paused one keep today's
behaviour: they ran, and closed their brackets, on the leg that paused. A
settled call never returned, so it joins neither `lastToolResult` nor
`toolResults`, and no `on-tool-return` trigger or skill-graph route fires on
it.

```typescript
// The model batches three calls, and the MIDDLE one asks a person:
//   c1 search_orders   → ran before the pause; its result is in history
//   c2 collect_input   → requestInput({ … }) — the run pauses here
//   c3 fetch_invoices  → never dispatched
const paused = await agent.run({ message: 'Which orders shipped late?' });
if (!isInputPause(paused)) throw new Error('expected an input pause');
await agent.resume(paused.checkpoint, {
  requestId: paused.awaitingInput.requestId,
  values: { week: 37 },
});
// The resumed leg's request answers all three tool_use blocks, in call order:
//   c1 → search_orders' own result (from the leg that paused)
//   c2 → { status: 'input_received', … }  (the person's answer)
//   c3 → "Tool 'fetch_invoices' was not executed on that call: the run paused
//         on call 'c2' to 'collect_input', earlier in the same batch, and
//         resumed without executing the calls that followed it in that batch."
// Its events: tool_end c2 · tool_start c3 · tool_end c3 { durationMs: 0 }
//             · iteration_end { toolCallCount: 2 }
// c3's history message (never the wire) and BOTH of its brackets carry
//   notDispatched: { pausedCall: { toolCallId: 'c2', toolName: 'collect_input' } }
// and its tool_end carries no `error`. A stream reader that counts outcomes
// tells it from a call that ran by the field — it neither succeeded nor failed:
const succeeded: string[] = [];
agent.on('agentfootprint.stream.tool_end', (e) => {
  if (e.payload.notDispatched !== undefined) return; // never dispatched
  if (e.payload.error !== true) succeeded.push(e.payload.toolCallId);
});
```

Pinned by `test/core/scenario/batch-pause-settlement.test.ts`: all four doors,
the count, the sentence word for word, the marker on the message AND on both
brackets (and on no other bracket), its history readers (the permission
`sequence` — paired by position, both directions of a reused id, a fresh
process that mints the settled id again for a call that runs, an older
proposal of the id that nobody answered (the settlement answers the LATEST
turn that proposed it; the in-flight limit under "Not covered yet" below is
pinned beside it), and seeded histories: exactly the calls that ran, and the
pre-9.113.0 sequence wherever no marker is — a policy halt,
the check-in trail, the window's pin, the findings offer, `knownResults`, the
piece, the collapse, `droppedStandings`, and no marker on any request, the
collapse path's included), a fresh instance resuming a JSON-restored
checkpoint on each door, two batches with a restart between, `continueFrom` a
JSON-stored checkpoint, and a batch whose LAST call pauses held byte-identical
to 9.112.2. Every stream reader in the table below is fed one real run in
`test/core/scenario/batch-pause-settlement-readers.test.ts`, with a tool that
really throws as the control. The window's readers are pinned beside their
own suites (`test/core/window-last-tool-result.test.ts`,
`test/core/window-drop-observations.test.ts`,
`test/core/window-ledger-fact-pins.test.ts`,
`test/integrity/danglingReference.test.ts` — which also holds the dangling
trap's narrative step for step against 9.112.2, so the check can never add a
tracked read), and so is the empty-lookup corpus
(`test/integrity/emptyLookup.test.ts`); the toolpack's arm (stream first,
history fallback, the latest decides — a reused id's outcome and duration off
its LAST `tool_end`, with and without a settlement) in
`test/lib/trace-toolpack/inspectToolCall.test.ts`; and the
served-view rebuild under `.findings()` by the conformance law in
`test/lib/time-travel/receipt-conformance.test.ts`.

**Not covered yet — three doors that leave the later calls unanswered, or
answer them another way.** A permission `halt` mid-batch ends the run with the
calls after the halted one unanswered, so a conversation continued from that
`checkpoint()` carries them without a result. `abandonPause()` followed by
`followUp()` (or `run({ continueFrom: agent.checkpoint() })`) continues the
PAUSED turn's history, where the paused call and the calls after it have no
result. And the hosting door's input cancel (`hosting/standingAgent.ts`, the
`'cancel' in response` branch of its decision handling) answers every
unanswered call — the paused one and the ones after it — with
`{"status":"input_cancelled","requestId":…}`, which carries no marker, so a
policy's `sequence` still counts those siblings as dispatched (as it did
before this release). In the first two the window's LAW 2 refusal
(`'unresolved-tool-call'`) keeps the unanswered turn from folding, and a
permission policy's `sequence` (`security/extractSequence.ts`) reads an
unanswered call as in flight only until its id has a result: a call never
answered — a halt's later siblings, a paused turn continued after
`abandonPause()` — counts once a later call that runs reuses its id. The
marker is what keeps a call out when its id comes back (it is paired by
position, never by id), so settling those doors with it is what would close
that too. Settling all three with `notDispatchedResult` and the marker is a
named follow-up; a halt needs its own anchor, since "halted" is not "paused".

### One owner of 'never dispatched' — in history and on the stream

**The fact has ONE definition — `LLMMessage.notDispatched`
(`adapters/types.ts`) — ONE writer, and two carriers: the settled message in
`history` (`agent/stages/toolCalls.ts` · `settleBatch`) and both halves of its
bracket (`toolCalls.ts` · `bracketSettled`, the one stamping site;
`ToolStartPayload.notDispatched` and `ToolEndPayload.notDispatched` in
`events/payloads.ts` are typed off the same field). It is absent on every
other message and every other bracket. A reader asks the marker — never the
sentence, never `durationMs: 0`, never whether `error` is there.**

**The settled `tool_end` carries no `error`.** `error` says a call FAILED: the
tool threw or reported a failure, or the call could not run as written (an
args rejection, a `wants` block, a consent the tool needed and did not get,
an unknown name) — "which tool failed when", as the error-handling guide puts
it. A settled call did not fail. The library decided not to dispatch it, as it
decides for a call a permission policy denies or halts, and those brackets
carry no `error` either. Stamped anyway, it would register a tool failure in
every error-rate reader — a span status, a dashboard, an alert — on every
mid-batch pause, and say a second, false thing beside the marker. So a reader
that counts outcomes reads the marker: a bracket that carries it is neither a
success nor a failure (the example above). The marker never reaches a provider
(`agent/composeRequest.ts` · `stripFrameworkFields`), so a reader that must
see it reads the COMMITTED conversation, not the wire.

The readers, and what each does with it (paths from `src/`):

| reader | carrier | a settled call is… |
|---|---|---|
| `security/extractSequence.ts` — a policy's `sequence`, `PolicyHaltError.sequence` | history | left out: "verify before transfer" is not met by a verify that never ran. Each marker settles the ONE proposal it answers, paired by position (`settledProposals`), never by id alone: a provider may reuse an id — the library's own fallback ids are minted per provider instance, so a fresh process mints them again — and a call that really ran under the same id, before the settled one or after it, is counted while the settled one is not |
| `core/agent/stages/toolCalls.ts` · `producerCorpusOf` — the empty-lookup check's producer corpus (`noticeEmptyLookup`) | history | no producer text: a value only the sentence carries is not one "this run produced", and a ground that was only ever settled served nothing (the row reads `unreachable`) |
| `core/checkin.ts` · `buildTrail` — the check-in trail's `toolCalls` | history | left out: never shown as a receipt |
| `core/agent/window/toolNames.ts` · `toolNameOfMessage` — the last-tool-result pin, the drop notice, the dangling-reference check (`core/agent/stages/callLLM.ts`, which names the frame from the history the stage already read at its top — never a second read, which would add a narrative step to every run) | history | named as no tool: the pin stays on the tool's real result |
| `core/agent/findings/offer.ts` · `isResultMessage` — the offer, `knownResults`, the piece's `undeclared:` line, the collapse (`core/agent/findings/serve.ts` · `collapseJudged`), `WindowRecord.droppedStandings` (`core/agent/stages/window.ts`) | history | no result to judge: never offered, never resolved (a model that names it files `unknownId`), never undeclared, never collapsed, never listed as dropped — the request and its rebuild (`lib/time-travel/servedView.ts`) both read the committed conversation |
| `core/agent/window/ledgerFactPins.ts` · `turnStandingOf`, `ledgerFactPinsOf` — a turn's standing (`WindowStrategyInput.standingOf`) and the `'ledger-fact'` pin, by the same `isResultMessage` | history | no result to rank: it takes no part in its turn's standing (a batch whose results the model judged all noise stays `noise`), a `fact` filed on its id holds nothing, and a pin never lists its id |
| `lib/trace-toolpack/traceToolpack.ts` · `notDispatchedOf` — `inspect_tool_call` | stream first, history fallback | "not dispatched", with no arguments, duration or inside. For an id a provider reused, the latest bracket and the latest message decide whether it was dispatched; a call that ran under it after a settlement is read off its own bracket — its outcome and duration off the LAST `tool_end` for the id (`buildInspectToolCall`), its step off the first bracket of a call that ran (`bracketsFor`) — never the settlement's `durationMs: 0` |
| `memory/causal/evidenceRecorder.ts` | stream | no `ToolCallRecord`: no args went to a tool, no result came back |
| `adapters/observability/audit.ts` | stream | the marker rides verbatim on both chained records (identifiers only, both payload modes), with no `error` |
| `adapters/observability/otel.ts` | stream | no `execute_tool` span; one span event `agentfootprint.tool.not_dispatched` on the active span — on a leg the adapter traces. **Known limit: no run records it yet.** A trace opens on `agent.turn_start`, a resumed leg emits none under a new `meta.runId`, so none of a resumed leg is traced, and a settled bracket only ever rides one |
| `adapters/observability/xray.ts` | stream | no subsegment — moot today for the same reason: a resumed leg is not traced |
| `recorders/observability/StatusRecorder.ts` (default line), `status/statusTemplates.ts` · `selectStatus` (chat bubble) | stream | never "Calling …", "Got result from …", "… failed" or the tool at work |
| `recorders/observability/commentary/commentaryTemplates.ts` | stream | one line under the NEW key `stream.tool_start.notDispatched`; its `tool_end` is skipped |
| `recorders/observability/RouteRecorder.ts` | stream | never a hop's `lastTool` |
| `recorders/observability/LiveStateRecorder.ts` · `LiveToolTracker` | stream | never in flight |
| `core/Agent.ts` — the in-flight phase a crash is attributed to | stream | never in flight. Nothing observable depends on it today: both halves fire back to back with no await between them, so no crash can land inside a settled bracket |
| `recorders/observability/BoundaryRecorder.ts` → `FlowchartRecorder.ts` | stream | the domain `tool.start` / `tool.end` carry the marker; no `llm->tool` step, no count in a boundary's `toolCalls`, and the next `tool->llm` step shows the last REAL result |
| `recorders/observability/AgentThinkingTraceRecorder.ts` | stream | no ask or return beat |
| `lib/bug-report/transcript.ts` | stream | its tool step carries the marker, and no `error` |

Unchanged on purpose: `recorders/observability/ToolChoiceRecorder.ts` counts
the settled call among the tools the model CHOSE — it was proposed, which is
what that recorder measures; `adapters/observability/file.ts` and the stream
bridge forward the payload as it is; `recorders/observability/trace.ts` ·
`redactContent` redacts a settled `tool.end`'s `result` like any other and
keeps the marker (identifiers only).

History readers that go by the role on purpose, because a settled message IS
what they ask about: what pairs a `tool_use` with its `tool_result` on the
wire (`core/agent/window/turns.ts` · `answeredCallIds` and `segmentTurns`;
`core/agent/delivery/rules.ts`; `toolCalls.ts` · `pausedBatchOf`; the hosting
door's cancel in `hosting/standingAgent.ts`) — the sentence does answer its
call; what the model read — the check-in's `read` frames and `drivers`
(`core/checkin.ts` · `unitsFromHistory`; the `trail`, which claims
"completed", reads the marker) and the unsupported-argument check's corpus of
served text (`integrity/unsupported-argument/check.ts` ·
`unsupportedArgumentsOf`, handed the frame's non-assistant messages by
`core/agent/stages/callLLM.ts`); and `core/agent/stagedRefs.ts` ·
`findStagedRefs`, which takes only a placed-result ticket, and the sentence
never parses as one.

**Not readers yet — five history readers that go by the role.** They see a
settled message as a tool's served result, and each is a named follow-up
(skip it, or label it as a settlement, with a test): the evidence corpus
(`core/agent/evidence/evidenceIndex.ts` · `evidenceFromHistory` indexes the
sentence, counts it in `toolResultsThisTurn`, and files its words under the
settled id in `carriers` — read by the evidence gate and, under `.findings()`,
by the dispatch-time towers and contingent rows, `core/agent/stages/toolCalls.ts`
· `towersFor` → `core/agent/findings/contingent.ts` · `contingentRowsOf`); the
prior-turn-evidence check that reads that count
(`integrity/prior-turn-evidence/check.ts`); the heuristic memory extractor
(`memory/beats/heuristicExtractor.ts` stores a "Tool result: …" beat of the
sentence, which a later run is served outside the turn that bound "that
call"); the compaction summary's input (`core/agent/window/summarize.ts`
labels it `tool_result[name]`); and the messages slot's injection records
(`core/slots/buildMessagesSlot.ts` · `inferSource` tags it `source:
'tool-result'` with the settled id as `sourceId` and no marker, so
`messagesInjections`, the `context.injected` events and every view built on
them — the Lens context view, `contextEngineering`'s baseline split — count it
as a tool's result). Bounded today: the sentence carries names and ids only,
so no grounded answer gains a value from it, and a turn never holds ONLY
settled messages — the paused call's own answer is always beside them.

## Architectural decisions

### Decision 1: Two primitives, period

`LLMCall` (one-shot) and `Agent` (ReAct) are the only leaves. Every higher-level pattern — Pipeline, Swarm, MapReduce, Reflection, Debate, ToT, Constitutional AI — is a **composition** of these two.

Adding a third primitive would be a sign we're modelling the wrong abstraction. Iteration = Loop composition. Routing = Conditional composition. Parallelism = Parallel composition. Delegation = Swarm pattern over Loop + Conditional.

### Decision 2: The `Runner` interface is the ONE consumer-facing surface

Every primitive, every composition, and every pattern factory returns an object implementing `Runner<TIn, TOut>`. That means any runner composes into any other runner. No special types per pattern.

`Runner` declares `.run()` (execute) + `.getSpec()` (the design-time `FlowChart` blueprint, the same value footprintjs's `addSubFlowChart*` accepts) and layers on:

- `.on() / .off() / .once()` — typed event subscription
- `.attach(recorder)` — custom CombinedRecorder attachment
- `.emit(name, payload)` — consumer custom events
- `.enable.*` — Tier-3 observability features

### Decision 3: `RunnerBase` shares the wiring; subclasses supply structure

Primitives + compositions extend `RunnerBase`. The base handles the dispatcher, recorder array, subscription API, and `.enable.*` namespace. Subclasses override `getSpec()` (the FlowChart they mount) and `run()` (how to interpret the executor result).

Keeping the shared code in ONE base class means subscription semantics can't drift between primitives.

### Decision 4: Symmetric builder API

Every primitive / composition has the same shape:

```typescript
Foo.create(opts).<member>(…).<member>(…).build() → Foo
```

Consumers learn the pattern once and apply it everywhere. Today: `LLMCall.create(...).system(...).build()`, `Agent.create(...).system(...).tool(...).build()`. Later: `Sequence.create(...).step(...).step(...).build()`, etc.

### Decision 5: Return values use `return`, not side-channels

Stages in a primitive's internal FlowChart `return` their result. footprintjs's executor carries that as the `TraversalResult`. Consumers call `.run()` and get the string back.

We do NOT write to shared scope + read from `getSnapshot()`. Return is cleaner, makes the runner compositionally pure (the OUTPUT of one is the INPUT of the next in a Sequence), and matches how every function-composition mental model works.

`$break()` is reserved for abnormal termination (max iterations reached, budget exhausted, user-requested cancel). Success uses `return`.

### Decision 6: Each runner owns its own dispatcher

Every time `.run()` is called, a fresh footprintjs executor starts. Internal core recorders (ContextRecorder, StreamRecorder, AgentRecorder) attach to that executor and route events into the runner's dispatcher. Consumer listeners are attached once to the runner and persist across multiple `.run()` calls.

That means you can build an agent once, attach listeners once, and call `.run()` many times — the subscription state persists, the execution state doesn't.

### Decision 7: Primitives and compositions are siblings, not parents

`Agent` does NOT extend `LLMCall`. They're two separate leaves with different internal structures (Agent has a loop + routing; LLMCall doesn't). They share logic only through the slot subflow builders in `slots/`.

This keeps them independently evolvable. When Phase 5 adds skills to Agent, LLMCall doesn't need changes.

## What a primitive provides

Minimum contract:
- A builder with `.create()...build()`
- Implementation of `getSpec()` — the footprintjs FlowChart it mounts
- Implementation of `run(input, options?)` — executes the chart + surfaces the result
- Emits all applicable `agent.*` / `stream.*` events from its internal stages (via `typedEmit()`)
- Attaches `ContextRecorder` + `StreamRecorder` + `AgentRecorder` internally so core domain events flow

## When to add a new primitive (rare)

Before adding one, verify the behavior can't be expressed as a composition of LLMCall + Agent + existing compositions. If it truly can't, the new primitive must:
- Implement `Runner<TIn, TOut>`
- Attach the three core recorders (Context / Stream / Agent) internally
- Document its internal subflow structure + events it emits
