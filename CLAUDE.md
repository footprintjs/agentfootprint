<!-- analyzed-at: d9afbaa @ 2026-07-02 | model: fable-5 -->
# agentfootprint — feature-work map

Agent framework layered on footprintjs: every runner (Agent, LLMCall, compositions, patterns) is a footprintjs chart built ONCE at construction and executed on a fresh `FlowChartExecutor` per run. Engine seams (stage kinds, $-methods, engine handlers) live UPSTREAM in footprintjs and are closed here. This file maps this repo's seams and blast radius — **trust the code** where any doc disagrees.

## Definition of done — every change, every session

This repo is built mostly by coding agents. The rules below are what keep docs,
examples and releases honest without anyone remembering anything.

1. **Before designing, grep [CAPABILITIES.md](CAPABILITIES.md)** — the thing may
   already exist (it has happened repeatedly). Then the nearest noun in `src/index.ts`.
2. **Code + tests.** Run the area's tests while working (`npx vitest run test/<area>`);
   the full suite (`npm test`, ~5 min) before you finish.
3. **One change fragment** in `.changes/<slug>.md` for anything touching `src/`
   (`type: fixed|added|changed|breaking|internal|…` — see [.changes/README.md](.changes/README.md)).
   **Never** edit `CHANGELOG.md`, bump `package.json`'s version, or write a version
   number anywhere — the release computes and writes it.
4. **A new public capability** adds one row to CAPABILITIES.md with Since `unreleased`.
5. **A user-visible feature** updates its page under `docs-next/content/docs/` and has a
   runnable example under `examples/` (`npm run example -- examples/<dir>/<file>.ts`).
   Docs pull code from the example (`<CodeFile region>`) rather than pasting it.
6. **`npm run docs:regen`**, then commit everything it changed. CI's `generated` job
   fails when a generated file (API mirror, docs-truth report, examples README,
   AI-instruction copies) is stale.
7. **Fast gate:** `npm run lint && npm run format && npx tsc --noEmit`.
8. **Releasing is not part of a change.** Actions → Release (`.github/workflows/publish.yml`)
   computes the version from the fragments, regenerates docs, runs every gate, then
   tags, publishes to npm with provenance and deploys the docs site.

**Three kinds of docs — keep them apart:**

| Kind | Where | Written how |
|---|---|---|
| API reference | `docs-next/content/docs/api/` | GENERATED from TSDoc on exports — write good TSDoc, never a signature table |
| Features (how do I…) | `docs-next/content/docs/{getting-started,build,debug,monitor,infrastructure}` | Plain words: what it is, when to use it, one example, gotchas. No design history |
| Internals (why / blast radius) | this file, `.claude/rules/`, `docs/design/`, `docs/proposals/` | Never linked from a feature page, never shipped to npm |

## Before you design it: it may already exist

The capability index lives in **[CAPABILITIES.md](CAPABILITIES.md)** (≈120 rows, keyed by
what you would call the thing). Grep it; do not read it whole.

**One law before you add a mapping.** Any function turning caller data into a KEY,
a namespace, a filename or an index entry must be injective, and its collision
check ships in the SAME change — not the release that discovers it. Six defects of
that exact shape were fixed between 9.37.0 and 9.46.0. Use `encodeIdentityField`
rather than writing a seventh. The ONE acceptable alternative is refuse-by-domain —
assert a safe charset and refuse everything else by name, as `fileRecordingSink`
does for internal runIds — because a refusal cannot collide. What is never
acceptable is a third thing: a fold that quietly rewrites.

## Module map
Entry points — SEVENTEEN doors, and `package.json` `exports` is exhaustive, so a path not on this list does not resolve at all: `.` core API · `/providers` everything you plug a backend into (mock/anthropic/openai/bedrock/browser*, embedders, staticTools/gatedTools/skillScopedTools/mcpClient, thinking handlers, code runners) · `/memory` (defineMemory, MEMORY_TYPES, InMemoryStore, mockEmbedder, redis/agentcore/bedrockAgentMemory stores) · `/rag` index-time loaders/splitters/indexCorpus · `/cache` prompt caching (+ registerCacheStrategy; side-effectful, hence its own door) · `/observe` the whole watching story (recorders, recordRun, strategies + attach*, vendor sinks, run-autopsy finders, toSSE, status, locales) · `/events` typed event system · `/context` the injection engine (defineInjection/Skill/Fact/Instruction/Steering, decideSkill) · `/resilience` provider decorators + the reliability RULES · `/hosting` nodeHost/httpHost/standingAgent + session stores · `/security` permissions + tool credentials (it absorbed the old identity door) · `/reliability` the retained alias, kept ONLY because it is the sole home of the gate's `CircuitOpenError` · `/skill-graph` the framework-neutral routing layer · `/recipes` the declared unit of agent CONFIGURATION (defineAgentRecipe → `.recipe()`; authoring-time vocabulary, so it stays off the main barrel) · `/maps` the mount kernel's vocabulary (9.58.0: Claim<T> + the engagement lease machine + its renewal feed — pure data and pure functions, no run entry point; mounted via `.maps()`) · `/classify` the calibrated-classifier port (9.104.0: `Classifier`, `typesafe`, `mockClassifier`, `ClassifierError` — a backend that SCORES declared candidates; spent by `.findings({ judge })` and by `classifierScorer` on `/skill-graph`) · `/ontology` the declared map (9.106.0: `defineOntology`, `ontologyHash`, `ontologyPiece`, `ONTOLOGY_INSTRUCTION`, the shapes — what each term IS, how terms RELATE, which SOURCE holds a term and which registered TOOL reads it; pure data and pure functions, no run entry point, no fetch path; mounted via `.ontology()`, served as one request-only system piece per call; 9.112.0 `fromSkos`/`readSkos`/`toSkos` — the SKOS JSON-LD adapter onto the same spec, no second validation path). 9.0.0 removed sixteen older paths (`/llm-providers`, `/injection-engine`, `/tool-providers`, `/strategies`, `/observability-providers`, `/identity`, `/stream`, `/thinking`, `/status`, `/locales`, `/debug`, `/debug/finders`, `/memory-providers`, `/embedders`, `/hosting-providers`, `/observability/contextError/finders`) — it removed PATHS, not code; each name still ships through the door that absorbed it. This list is pinned against `package.json` by test/api-conformance/documented-doors.test.ts, and the removed sixteen by subpath-exports.test.ts. **Main barrel does NOT export** mock/browser*/defineMemory/defineSkill/skillGraph/mcpClient/InMemoryStore — import from the doors above.

| src/ | one job |
|---|---|
| answer-validation/ | optional final-answer contract, scoped bounded artifact reads, canonical JSON and explicit check dispositions; the Agent route owns invocation and final capture owns delivery |
| core/ | primitives: Agent.ts (ReAct runner), LLMCall.ts, RunnerBase.ts (dispatcher + attach + enable.*), tools.ts (defineTool), pause.ts, runCheckpoint.ts |
| core/agent/evidence/ | (9.35.0) the evidence gate — `.namesAndNumbersFromEvidence()`. Pure + deterministic BY LAW (no model, no embedding: a guard that needed a bigger model to police a smaller one inverts the library's thesis). normalize (one spelling per value, both sides) → extract (which tokens are DATA — conservative, justified clause by clause) → evidenceIndex (STRUCTURAL walk of `role:'tool'` results; the exempt corpus is user message + user/system turns + `systemPromptInjections`, MINUS the library's own frames — see frames.ts, the laundering bug) → gate (resolve/judge/sentences) → errors (`UnsupportedValuesError`). Fabrication detector, NOT a correctness judge: a false claim built from real values passes |
| core/agent/coverage/ | the two FIELD-INVENTED result primitives. `absent()` = an absence that names its own coverage (checked / not checked / cannot cover) and says a retry returns the same; `coverage(result, …)` = the ledger of what a clean verdict does NOT rule out. Both RECOGNIZED (reserved `af_absent`/`af_coverage` keys, the effects-envelope strictness law), not conventions. Pure; the moving parts are `declareCoverage` in stages/toolCalls.ts, the whitelist in evidence/evidenceIndex.ts, and `prepareFinalWithLimitsStage` |
| core/agent/ | chart assembly: buildAgentChart / buildDynamicAgentChart (picked by reactMode, Agent.ts:1145-1147), buildToolRegistry, stages/ (seed, callLLM, route, toolCalls, prepareFinal, breakFinal, reliabilityExecution), window/ (the `.window()` strategy family), middleware/ (the `.toolMiddleware()` / `.messageMiddleware()` chains — outcomes are a CLOSED union with no `result` arm; three call sites walk it via runChain.ts: toolCalls dispatch, seed `'input'`, route `'output'`, plus mcpServe) |
| core/slots/ | the 3 context-slot subflow builders + thinking subflow — intentionally NOT exported |
| core-flow/ | Sequence/Parallel/Conditional/Loop — RunnerBase subclasses with own charts |
| patterns/ | Debate/MapReduce/Reflection/SelfConsistency/Swarm/ToT — pure composition of runners, no new control flow |
| adapters/ | hexagonal ports (types.ts = ALL port interfaces — one exception: `RecordingSink` lives beside `recordRun` in recorders/observability/, per "anything that saves a run goes through it") + vendor impls (llm/, memory/, identity/, observability/). memory/sqliteVector.ts (8.9.0) = the only FULL MemoryStore we ship with `search` besides InMemoryStore — exact cosine over a resident Float32Array matrix, hydrated per namespace on first search and dropped on any write to it |
| recorders/core/ | bridges footprintjs events → typed EventDispatcher (ContextRecorder, EmitBridge, typedEmit) — auto-attached by Agent.createExecutor; most factories also exported via `/observe` for manual wiring (EmitBridge itself stays internal) |
| recorders/observability/ | consumer recorders over the typed stream (RunStepRecorder, FlowchartRecorder, Status, Trace replay) + `recordRun` — THE producer of a recording `{snapshot, events, structure}` (the shape lens's `observeRecording` consumes; `structure` = `getSpec().buildTimeStructure`, which no snapshot carries). Anything that saves a run goes through it |
| rag/ | (8.10.0, door `/rag`) index-TIME: `DocumentLoader` adapters (text/markdown/html zero-dep, pdf via lazy `unpdf`) + `Splitter` factories + `indexCorpus` — a REAL footprintjs chart whose commit log IS the indexing report. `defineRAG` deliberately stays on the MAIN barrel (run-time wiring); this door is the half that runs once, before any agent exists |
| ontology/ | (9.106.0) the declared map — `defineOntology` (validate, detach, freeze, `ontologyHash` through the receipt's `stableJson`) + `serve.ts · ontologyPiece` (the ONE composer, called by `callLLM` and by `servedView.viewOf`; every line quotes the declaration under a constant header that quotes the context contract's three meanings) + `instruction.ts` (the always-on ask). Behind the `/ontology` door; `Agent.buildChart` checks every `via` tool name against `registryByName` at build; `seed` writes `AgentState.ontology` once; the grouped chart crosses the key into `sf-llm-call` under `hasOntology`. 9.112.0 `fromSkos.ts`/`toSkos.ts`/`skosJsonLd.ts` = the SKOS adapter (a customer's concept scheme → `OntologySpec` → `defineOntology`, and back); `define.ts`/`serve.ts`/`instruction.ts`/`score.ts`/`types.ts` untouched by it, pinned by test/ontology/fromSkos.test.ts |
| lib/ | first-party sub-libraries: injection-engine/, context-bisect/ (localizeContextBug, toBacktrackTrace + sliceToBacktrackTrace — the atui board serializers), influence-core/, trace-toolpack/ (selfExplain; 6 tools incl. variable-first `backtrack(variable, element?)`), context-ledger/ (which pieces EARNED their tokens — post-run offers/uses/outcomes bookkeeping + demote-never-starve gates `ledgerToolGate`/`ledgerEntryScorer`/`ledgerGated`; grouped-mode folds sf-llm-call inner logs, unmeterable runs → undefined; /observe), mcp/, rag/, tool-lint/ |
| memory/ | store/ (MemoryStore port) + pipeline presets + stages + beats/facts + causal/ (dev-only, TOP_K+search()-only) + wire/mountMemoryPipeline + retrieval/ (8.8.0: the `RetrievalStrategy` seam + `RetrievalEvidence`, the record a retrieval leaves — `topK()` is what every earlier release did unnamed) |
| maps/ | (9.58.0, door `/maps`) the mount kernel: claim/ (`Claim<T>` honesty primitive) + engagement/ (lease machine `advanceEngagement` + renewal feed `renewalEvidenceOf` + vocabulary). Pure data/functions; the ONE framework hook is `ctx.parkedIds` in the evaluator (the `leaseActiveIds` mirror), fed by the Evaluate stage; state rides `AgentState.mapEngagement` as a TOP-LEVEL array (the StepPointerCarrier law) |
| events/ | EventDispatcher (wildcard subs), registry (EVENT_NAMES, AgentfootprintEventMap), payloads |
| recipes/ | (9.48.0, door `/recipes`) the declared unit of agent CONFIGURATION — `defineAgentRecipe` + `AgentBuilder.recipe()`. PURE and tiny: id/version validators, the provenance value, the refusal sentences. The mutation lives in `AgentBuilder.recipe()` (application stack + two provenance maps); the manifest rows ride `RunManifestSources.recipes`. The door publishes the AUTHORING vocabulary only (`defineAgentRecipe`, `InvalidAgentRecipeError`, 4 types) — every validator and refusal formatter is internal, imported by module path |
| conventions.ts | THE builder↔recorder protocol: SUBFLOW_IDS/STAGE_IDS (internal), INJECTION_KEYS/stageRole/milestoneFor (exported, Lens-facing) |

Traps: `src/observability/` holds the finder IMPLEMENTATIONS (canonical home; `debug/finders.ts` re-exports them — only the old subpath is deprecated), while real recorders live in `recorders/observability/`; `identity` appears twice (src/identity.ts = tool credentials; memory/identity/ = tenant scoping — unrelated); `resilience` (provider decorators) ≠ `reliability` (in-loop rules gate).

## Core state & flow
- `AgentState` (core/agent/types.ts:287) — THE chart state; every stage gets `TypedScope<AgentState>`. Mutability conventions documented ON the type (:276-286). Everything in scope must survive structuredClone → functions stay in closures, errors stringified, injections projected to POJOs.
- **Two runId namespaces**: typed-event `meta.runId` (Agent's makeRunId, RunnerBase.ts:55) vs footprintjs `traversalContext.runId` — never correlate across them.
- **Event path**: stage `typedEmit` → `scope.$emit` → footprintjs emit channel → `EmitBridge.onEmit` (drops if no dispatcher listener! EmitBridge.ts:44) → `buildEventMeta` → dispatcher → `agent.on()` listeners. Fires MID-STAGE, **before that stage's commit** — correlate events↔commits by runtimeStageId, never arrival order.
- Executor defaults DIVERGE from footprintjs: `readTracking:'summary'`, `commitValues:'delta'` (Agent.ts:779-782) — read commit values via `commitValueAt`, never `bundle.overwrite[key]`.
- Recorders never read AgentState directly; slot subflows write `INJECTION_KEYS` convention keys, `ContextRecorder.onWrite` resolves the slot from the write's own runtimeStageId (parallel-safe).
- $break is the only clean-stop channel; structured fail context rides scope fields (`policyHalt*`, `reliabilityFail*`), decoded post-run by `Agent.finalizeResult` (Agent.ts:884) into typed errors.

## Seams and blast radius, by area

Each file loads **only when you work on its paths** (`.claude/rules/*.md`, `paths:` frontmatter):

| Rule file | Loads for | Holds |
|---|---|---|
| [agent-loop](.claude/rules/agent-loop.md) | `src/core/**`, core-flow, patterns, integrity, answer-validation, classify, ontology, recipes | Tool/ToolProvider, run input, output contract, evidence gate, coverage, wrap-up, window refusal, closed seams; AgentState / chart shape / RunnerBase impact; the end-to-end trace |
| [events-and-observability](.claude/rules/events-and-observability.md) | events, recorders, observability, strategies, bridge, conventions.ts | recorder layers, adding a typed event, vendor strategies, finders; conventions / BoundaryRecorder / EventMeta impact |
| [providers-and-adapters](.claude/rules/providers-and-adapters.md) | adapters, cache, thinking, mcp, resilience, reliability, tool-providers | LLM provider, MCP gateway fetch, ports table; LLMMessage / cache / AWS-adapter impact |
| [memory-and-rag](.claude/rules/memory-and-rag.md) | memory, rag | memory store, loaders, splitters, durable store, retrieval |
| [injection-and-skills](.claude/rules/injection-and-skills.md) | injection-engine, maps, `src/core/agent/**` | injections, skill graph, read_skill gate, cursor, per-skill brains |
| [hosting-and-security](.claude/rules/hosting-and-security.md) | hosting, security, identity | identity verifier, admission, session ops, ingress record, permissions |
| [artifacts-and-semantics](.claude/rules/artifacts-and-semantics.md) | artifacts, semantics, code runners | recordings as artifacts, code staging-in, semantic results |
| [backtracking](.claude/rules/backtracking.md) | pause / checkpoint / Agent / RunnerBase / toolCalls | the six backtracking mechanisms in depth |

## Backtracking
Six mechanisms layered on footprintjs (whose transaction/checkpoint machinery lives upstream): **M1** pause/resume — `pauseHere/askHuman` throw PauseRequest inside tool.execute; toolCalls commits history + pausedTool* to scope BEFORE returning the pause payload; scope is the ONLY carrier across the checkpoint. **M2** `resumeOnError` — history-only `AgentRunCheckpoint` (a DIFFERENT type from FlowchartCheckpoint) built from iteration_end events; resume REPLAYS from restored history via the `pendingResumeHistory` side channel. **M3** inline reliability retry — up to 50 attempts inside ONE stage; retry state closure-local, never scope. **M4** chart-level reliability gate — built but UNMOUNTED (buildReliabilityGateChart; editing it changes nothing at runtime). **M5** ReAct loopTo re-entry with `ArrayMergeMode.Replace` guards. **M6** counterfactual replay (context-bisect ablation probes; causal claims only from majority-flip over ≥2 seeded reruns). **M7 (triage surface)** variable-first tools over fp's slice layer: toolpack `backtrack(variable, element?)` (element mode = per-iteration history attribution, exact under the delta default) + `sliceToBacktrackTrace` (structural slice on the atui board — always correlational, every card an upper bound). Deep dive: [.claude/rules/backtracking.md](.claude/rules/backtracking.md).

## Invariants (assumed, not stated)
- ONE in-flight run per Agent instance (currentRunContext/lastExecutor/pendingResumeHistory are instance fields; concurrent runs corrupt event meta).
- Chart built once, reference-stable; closures over per-run state must be accessor lambdas (seed.ts:42-49) — direct field capture goes stale on run #2.
- Subscribe BEFORE run() — listener-presence gating drops (not queues) events at ContextRecorder/EmitBridge/RunnerBase.emit.
- `arrayMerge: Replace` on EVERY loop-crossed subflow mount (buildAgentChart.ts:284,345,358,382,431,455) — footprintjs default concatenates; omission = injections grow 8→16→24 per iteration.
- Context selector must stay `failFast: true` (buildAgentChart.ts:329) — default allSettled would swallow a throwing required slot and call the LLM half-built.
- Event payloads must be DETACHED plain data (typedEmit dev-guard) — a live TypedScope proxy breaks deferred-delivery capture and checkpoint serialization.
- Causal-evidence recorder stays inline even under `observerDelivery:'deferred'` (Agent.ts:808-814) — the memory write stage reads its accumulator mid-run.
- Tool names + memory ids unique at construction; LLM dispatches by name — a rename is a behavioral change.

## Landmines
1. Stale comment at Agent.ts:1053-1054 says the chart is rebuilt per run — it is NOT (eager initChart at :429); providerToolCache IS shared across runs; safety comes only from the Discover stage overwriting `current` each iteration.
2. `'classic'` reactMode "caching" is the ABSENCE of re-selection (Context stops picking static slots after turn 1) — "fixing" the selector converts classic into dynamic; classic + skills is broken by design (mid-run activation never reaches cached slots).
3. Branch stage ids are BARE (`'final'`, `'tool-calls'`), not the SUBFLOW_IDS prefixed forms — matchers written against SUBFLOW_IDS alone miss real runs (stageRole/milestoneFor deliberately match both).

## Pointers
- [CAPABILITIES.md](CAPABILITIES.md) — what already ships · [.changes/README.md](.changes/README.md) — how a change is recorded
- [examples/](examples/) — canonical imports (the authority on which subpath exports what) · [src/conventions.ts](src/conventions.ts) — the builder↔recorder protocol
- Build/test: `npm run build`, `npm test` · docs: `npm run docs:regen` · release: Actions → Release
