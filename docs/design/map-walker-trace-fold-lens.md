# Map, Walker, Trace, Fold, Lens — the five roles, in this library

Every file in `src/` does one of five jobs. This page names the five, lists
agentfootprint's real folders under each, and states the laws that hold here.
It is a reading aid for the folder tree, not a new abstraction: nothing in the
code changed when this page was written.

## The five words

- **Map** — what could happen: declared, validated, still. A Map never changes
  because of a walk.
- **Walker** — what is happening: a cursor, its guards, its moves.
- **Trace** — what happened and why: append-only, written DURING the walk,
  never reconstructed afterwards.
- **Fold** — what may be claimed now: derived from the Trace, detached, never
  stored beside the Trace.
- **Lens** — what THIS reader needs now. In agentfootprint the Lens is **the
  wire**: the system prompt, the messages and the tool list a model is served,
  plus every composer that writes a sentence into one of them.

A folder may carry more than one role. Those say **Mixed** on their first line
and name which files carry which.

## Where each role lives

### Map — what could happen

`src/recipes/` (the declared unit of agent configuration) ·
`src/lib/tool-lint/` (a check over what is declared, before any run) ·
`src/memory/wire/` (declared stage compositions).

Mixed folders carrying Map: `src/core-flow/` (three declared control-flow shapes
plus Parallel's declared half; `Parallel.ts` · `mergeWithLLM` runs in the walk
and composes the merging model's turn) · `src/memory/pipeline/` (five
declaration-only presets; `auto.ts` mounts a stage of its own and composes the
message it injects) · `src/patterns/` (seven caller-prompted research
patterns; `LlmRouter.ts` composes one) · `src/lib/injection-engine/factories/`
(seven declaration-only `define*` verbs; `defineRelevanceHint.ts` composes its
own sentence) · `src/core/` (`LLMCall.ts`, `Agent.ts`'s
`buildChart`, `toolContract.ts`, `outputSchema.ts`) · `src/core/agent/`
(`buildAgentChart.ts`, `buildDynamicAgentChart.ts`, `buildToolRegistry.ts`,
`AgentBuilder.ts`, `skillGraphDeclared.ts`) · `src/lib/injection-engine/`
(`skillGraph.ts` the compiler, plus the build-time checkers) ·
`src/lib/semantics/` (`types.ts`, `envelope.ts`) · `src/lib/rag/` (`defineRAG`
declares a read-only corpus).

### Walker — what is happening

The walk wiring in `src/core/` (`RunnerBase.ts`, `runner.ts`, `runCheckpoint.ts`,
`pause.ts`, `toolSessions.ts`, `durabilityBarrier.ts`).

Mixed folders carrying Walker: `src/core/agent/stages/` (the ReAct loop's stage
functions — `seed.ts`, `pickEntry.ts`, `routeTurn.ts`, `window.ts`,
`deliver.ts`, `route.ts`, `outputRetry.ts`, `reliabilityExecution.ts`,
`prepareFinal.ts`, `breakFinal.ts`; the same folder's Lens tenants are listed
under Lens, and it appears in exactly these two places) · `src/core/agent/`
(`toolDispatch.ts`, `toolEffects.ts`, `toolArgsValidation.ts`, `validators.ts`) ·
`src/core/agent/middleware/` (`runChain.ts` — allow / deny / ask) ·
`src/lib/injection-engine/` (`buildInjectionEngineSubflow.ts`, one Gather →
Evaluate → Route → Delta pass per iteration) · `src/core/runbook/`
(`runbookAsTool.ts`, `dispatch.ts`) · `src/memory/stages/` (load, filter, pick)
· `src/cache/` (`CacheDecisionSubflow.ts`) · `src/lib/recorded-chat/` (`send()`).

### Trace — what happened and why

`src/recorders/core/` (always-on writers nobody can disable).

Mixed folders carrying Trace: `src/events/` (the 78-name closed contract in
`registry.ts` + `payloads.ts` and the `dispatcher.ts` that carries them — but
`eventTail.ts` is a Fold, listed under Fold; its own header says so) ·
`src/recorders/observability/`
(`BoundaryRecorder.ts` is the ordered stream; `RouteRecorder.ts`,
`ToolLineageRecorder.ts`, `ToolChoiceRecorder.ts`, `RunStepRecorder.ts`) ·
`src/core/agent/middleware/ledger.ts` · `src/core/agent/window/types.ts`
(`WindowRecord` / `CompactionRecord`) · `src/memory/causal/`
(`writeSnapshot.ts`, `evidenceRecorder.ts`) · `src/hosting/ingressRecord.ts`
(the requests that never became a run) · `src/core/slots/buildMessagesSlot.ts`
(a projection of the conversation for the record — **not** the wire) ·
`src/cache/cacheRecorder.ts`.

Name collision to know about: the exported type `Trace`
(`src/recorders/observability/trace.ts` · `Trace`) is a redacted PROJECTION for
offline replay — a Fold artifact, not this role. The append-only evidence is
`BoundaryRecorder.ts`.

### Fold — what may be claimed now

`src/integrity/**` (the finding kernel plus one folder per check, `disposition/`
among them — seven of those check folders are Mixed, see the Lens list) ·
`src/observability/**` (the context-error finders) ·
`src/lib/context-bisect/**` (the driver and its arms) · `src/lib/influence-core/` ·
`src/memory/retrieval/`.

Mixed folders carrying Fold: `src/lib/injection-engine/`
(`skillGraph.ts` · `makeReachableSkills`, `skillGraph.ts` ·
`classifySkillTarget`, `skillGraph.ts` · `makeResolveCursor`, `evaluator.ts`,
`routingPolicy.ts`) · `src/lib/context-ledger/` (`contextLedger.ts`) ·
`src/maps/engagement/` (`lease.ts` — the sole owner of the parked set) ·
`src/core/agent/evidence/` (`evidenceIndex.ts`) · `src/lib/` (`spokenIds.ts`,
`saidByPerson.ts`, `iterationBudget.ts`) · `src/events/` (`eventTail.ts` — how
much of the stream was retained, how much was dropped, where the window starts) ·
`src/recorders/` and `src/recorders/observability/` (`FlowchartRecorder.ts`'s `buildStepGraph`,
`trace.ts`, and `recordRun.ts` — which is the one KNOWN BREACH of Fold law 3,
stated at its header and again below).

### Lens — what this reader is served

`src/tool-providers/` (the tool list itself) · `src/lib/trace-toolpack/` (a
completed run served to a model) · `src/lib/bug-report/` (a run served to a
human) · `src/recorders/observability/commentary/` and
`src/recorders/observability/status/` (prose for a human viewer).

Those last three are Lens FOR A HUMAN, never for the wire, and each says so on
its own first line. The role word alone does not separate the two audiences, and
question 1 below turns on the difference, so the qualifier is part of the claim.

Mixed folders carrying Lens: `src/core/slots/` (`buildSystemPromptSlot.ts`,
`buildToolsSlot.ts`) · `src/core/agent/stages/` (the same Mixed folder listed
under Walker: `toolCalls.ts`'s refusals, `stepNudge.ts`, `evidenceRecheck.ts`,
`wrapUp.ts`, and the wire assembly in `callLLM.ts` · `buildCallLLMStage`) ·
`src/core/agent/window/` (`notice.ts`, `summarize.ts`) ·
`src/core/agent/coverage/` (`answer.ts`) · `src/core/agent/`
(`selfCallNotice.ts`, `stagedRefs.ts`, `presentTool.ts`, `repeatedCall.ts`,
`resultCeiling.ts`, `outputEnforcement.ts`) · `src/lib/injection-engine/`
(`skillToolDescriptors.ts`, `skillSteps.ts`'s sentence half,
`promptTemplate.ts` · `renderTemplate`, `constrainedEnumPick.ts` ·
`pickByParse`, `llmClassifier.ts` · `systemPromptFor`) · `src/artifacts/` (`present.ts`, `wants.ts`,
`placement.ts`, `capability.ts`) · `src/maps/` and `src/maps/engagement/`
(`parkCard.ts`) ·
`src/memory/` and its formatting tenants — `src/memory/stages/`
(`formatDefault.ts`, and `summarize.ts`'s own compaction prompt),
`src/memory/beats/` (`formatAsNarrative.ts`, and `llmExtractor.ts`'s extractor
prompt), `src/memory/facts/` (`formatFacts.ts`, and `llmFactExtractor.ts`'s
extractor prompt), `src/memory/causal/` (`loadSnapshot.ts`) ·
`src/memory/pipeline/` (`auto.ts` · `renderAutoMessage`) ·
`src/patterns/` (`LlmRouter.ts` · `compileRouterPrompt`) ·
`src/core-flow/` (`Parallel.ts` · `mergeWithLLM`) ·
`src/lib/injection-engine/factories/` (`defineRelevanceHint.ts` ·
`defineRelevanceHint`) · the seven integrity check folders that compose their
own finding prose — `src/integrity/empty-lookup/`,
`src/integrity/prior-turn-evidence/`, `src/integrity/unsupported-argument/`,
`src/integrity/unsupported-claim/`, `src/integrity/dangling-reference/`,
`src/integrity/column-types/` and `src/integrity/invariant-violation/` (each
`check.ts`'s finding `message`, plus `invariant-violation`'s `wire.ts` ·
`fileDirection`, emitted for every ContextError by
`src/core/agent/integrityFindings.ts` · `fileIntegrityFindings` and served
verbatim to a debugging model by
`src/lib/trace-toolpack/traceToolpack.ts` · `buildFindContextErrors`; only the
first three carry a `test/modelFacingScan.test.ts` LEDGER row, because that scan
keys on a time anchor the other four do not use) ·
`src/core/runbook/verdicts.ts` · `src/lib/rag/defineRAG.ts` ·
`src/lib/semantics/envelope.ts` (`semanticsForModel`).

Second name collision: "Lens" in `src/README.md` and in `src/core/runner.ts`,
`RunnerBase.ts`, `Agent.ts`, `translator.ts`, `LLMCall.ts` means the VIEWER
PRODUCT that renders a run afterwards. That is the other side of the wire from
this role. Where those files say Lens they mean the product; where a `LENS ·`
header says it, it means this role.

### Support — everything else

READING RULE FOR EVERY LIST ON THIS PAGE: a path ending in a doubled star
(`src/adapters/**`) covers every folder beneath it; a path ending in a single
slash names that folder only. Without the rule, `src/adapters/**` would leave
eleven vendor folders unnamed and `src/integrity/**` nine check folders, and the
“no folder is missing” claim would hold only by luck. `test/architecture/folderRoles.test.ts`
is what actually guarantees no folder goes unanswered — it fails on a folder with
no README, whatever this page happens to list.

Ports, adapters, transports and leaf utilities: `src/adapters/**`,
`src/hosting/**`, `src/identity/`, `src/security/`, `src/reliability/`,
`src/resilience/`, `src/strategies/**`, `src/thinking/`, `src/embedders/`,
`src/locales/`, `src/rag/**`, `src/lib/mcp/`, `src/lib/claim/`, `src/bridge/`,
`src/debug/` (a re-export-only barrel over the context-error finders),
`src/artifacts/conformance/`, `src/cache/strategies/`,
`src/core/agent/delivery/`, `src/core/agent/window/strategies/` (which chooses
BETWEEN drop notices — see its README), `src/memory/embedding/`,
`src/memory/entry/`, `src/memory/identity/`, `src/memory/store/`,
`src/memory/turn/`, and `src/recorders/observability/internal/`.
Support carries a Lens someone else composed and writes into a Trace someone
else owns; it decides nothing about WHAT the model may see — and
`test/architecture/folderRoles.test.ts` pins that claim by refusing to let any
registered model-facing producer live in a Support folder.

Two folders are Mixed and belong to no single heading above.

`src/` itself — the root holding `conventions.ts`, `index.ts`, `status.ts`,
`stream.ts` and the nine sibling barrels. Its role is stated on
[src/README.md](../../src/README.md): Fold for the `saidByPerson` predicates
`index.ts` publishes, Support for the barrels. It is named here because the
lists above cover the folders BENEATH `src/`, and without this line the
“no folder is missing” claim would hold for 98 of the 99.

`src/doors/` — eleven published barrels cut by the JOB a consumer has rather
than by role, so a door usually publishes several. Its own README says which role each door carries.

## The three Fold laws, as they apply here

**1. One owner per fact.** A fact has exactly one function that computes it;
everyone else reads that function.

> `spoken()` — `src/lib/spokenIds.ts` — owns "which ids may this sentence name,
> and was the set non-empty before the filter ran". It is a zero-import leaf
> precisely so that a composer inside the skill-graph fence (`describeOffer`,
> `skillToolDescriptors.ts` · `describeOffer`) and the dispatch gate outside it
> (`toolCalls.ts` · "── Skill-graph read_skill GATE") cannot answer it
> differently. `held` is REQUIRED, not
> optional, so the compiler asks every caller the question the call sites
> forgot.

**2. A Fold is derived, never stored beside the Trace.** Rebuild it from the
record; do not keep a second copy that can drift.

> `src/recorders/observability/FlowchartRecorder.ts` · `buildStepGraph` is
> rebuilt per call from `BoundaryRecorder`'s events and never stored — storing
> it would be a second content surface that a per-event `redact` could not
> reach (`src/recorders/observability/trace.ts` · "The step graph is ALWAYS a
> derived projection of those events").

**3. A Fold hands out detached values.** No live reference to run state leaves
a Fold.

> `hiddenSkillIds` — resolved once per iteration at
> `src/core/slots/buildToolsSlot.ts` · `discoverStage` and published on the same
> stage, under the FOLD banner that names its consumers — is
> a plain `string[]` on scope; every consumer copies it into a fresh `Set` and
> every named set leaves through `spoken()`, which returns a new array.
>
> The one place this law is breached and known: `recordRun().toRecording()` hands
> out the runner's own snapshot objects by reference — the argument is at
> `src/recorders/observability/recordRun.ts` · `toRecording`, on its `snapshot`
> field, and the handout is that same field.
> That is why `src/artifacts/recordingArtifact.ts` stores the JSON text instead,
> and why `includeSnapshot` is opt-in, and why the folder README names the breach
> beside the role word rather than leaving `recordRun.ts` filed under Fold plain.

## The two Lens laws, as they apply here

**1. A Lens may OMIT; it may never DENY.** A narrowing may take a name off a
sentence. It may not turn that name's absence into a claim that the thing is
gone.

> `src/lib/injection-engine/skillToolDescriptors.ts` · `describeOffer`
> filters the catalog through `visibleSkills` FIRST, then gates its negative
> sentence on `!hopsSpoken.held`: if the run holds hops the role may
> not be told about, the clause is dropped rather than negated.
>
> Two kinds of omission, and they behave differently: an **attention** omission
> (budget, paging, top-K) must be VISIBLE — `eventTail` publishes `dropped` and
> `firstRetainedIndex` beside the events. An **authority** omission (role-hidden)
> must be INVISIBLE — hidden means unnamed. `src/security/index.ts` · "A local
> allowlist and a remote policy engine differ in one way that matters here" states
> the difference: "the gate decides what the model is SHOWN, the checker decides
> what actually RUNS."

**2. Every model-facing clause is anchored to the call it was composed on.** A
tool result is composed on iteration N and re-read on every call after it, so a
present-tense or forward-looking clause is a prediction that outlives its own
evidence.

> `src/core/agent/selfCallNotice.ts` · `selfCallNotice` is the worked
> example. Every clause is past tense about one named call ("that call"); the
> only two present-tense phrases are timeless, not temporal; and it names no
> destination at all, because any id named as somewhere `read_skill` could go
> is falsified later in the same turn by the budget, the posture arm or the
> cursor (`src/core/agent/stages/toolCalls.ts` · "No routing map is passed, and
> that is the fix rather than an omission").

## What a reader should be able to answer from the folder tree and this page

1. For any file: which of the five it is, and therefore whether it may compose a
   sentence a model reads.
2. For any model-facing sentence: which facts it is allowed to read, and which
   function owns each of them.
3. For any fact: the one function that computes it, and whether what leaves that
   function is detached.
4. Whether an omission on a surface is an attention omission (must be visible)
   or an authority omission (must be invisible).
5. Which words in this repo mean a role and which mean something else —
   `Trace` the exported projection type, `Lens` the viewer product, `folded`
   the compaction verb, and "PURE CORE" the dependency zone, not a role.

Each `src/` folder's `README.md` opens with its role word and the same four
sections: what it reads, what it writes, the one law of that role that applies
there, and the file list.

## How a pointer on this page is written, and why

**Every pointer here and in the role headers is `file · symbol` — never
`file:line`.** The symbol is a function, const, interface, or the first words of
a named comment banner in quotes. A line number rots the moment anyone inserts a
comment above its target, which is exactly what happened twice in this pass. The
first draft numbered its headers against the files as they stood BEFORE the
headers were inserted, so `toolCalls.ts` citations came out short by 21–26 and
`skillGraph.ts` ones by 3, 6 and 9. The fix pass re-derived the numbers — but
only in the `.ts` files, and with the same pre-insertion arithmetic in the folder
READMEs, so nine pointers across four of them stayed wrong by exactly the header
size inserted above each target. Every one of those landed INSIDE the target
function's docblock, which no "is this line filler?" check can see. A number can
always be wrong and look right; a name cannot.

`test/architecture/citations.test.ts` enforces this mechanically. It reads every
`file · symbol` citation in `src/` and on this page, resolves the file (a bare
basename that several files answer to is a FAILURE, not a silent skip), and fails
when the symbol text does not occur in that file. It fails separately, quoting
the rule, on any `file:NNN` pointer that creeps back onto those surfaces. It
cannot prove a pointer means what the sentence around it says — the reviewer does
that — but it can prove the pointer names something real, and it breaks when that
something is renamed, which a line number never could.
