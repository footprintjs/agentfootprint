<!-- analyzed-at: 3fbcef8 @ 2026-07-02 | model: fable-5 -->
# agentfootprint — feature-work map

Agent framework layered on footprintjs: every runner (Agent, LLMCall, compositions, patterns) is a footprintjs chart built ONCE at construction and executed on a fresh `FlowChartExecutor` per run. Engine seams (stage kinds, $-methods, engine handlers) live UPSTREAM in footprintjs and are closed here. This file maps this repo's seams and blast radius — **trust the code** where any doc disagrees.

## Module map
Entry points (package.json exports): `.` core API · `/observe` ALL observability recorder factories (deliberately off the main barrel) · `/debug` + `/debug/finders` run-autopsy kit · `/events` typed event system · `/llm-providers` vendor adapters (mock, anthropic, openai, browser*) · `/memory` (defineMemory, MEMORY_TYPES, InMemoryStore, mockEmbedder) · `/memory-providers` (redis, agentcore, bedrockAgentMemory stores) · `/injection-engine` (defineSkill/Fact/Instruction/Steering, skillGraph, decideSkill) · `/tool-providers` (staticTools, gatedTools, skillScopedTools, mcpClient) · `/strategies` `/observability-providers` `/security` `/identity` `/reliability` `/resilience` `/stream` `/thinking` `/cache` `/status` `/locales`. **Main barrel does NOT export** mock/browser*/defineMemory/defineSkill/skillGraph/mcpClient/InMemoryStore — import from the subpaths above (older docs showed these on the main barrel; wrong).

| src/ | one job |
|---|---|
| core/ | primitives: Agent.ts (ReAct runner), LLMCall.ts, RunnerBase.ts (dispatcher + attach + enable.*), tools.ts (defineTool), pause.ts, runCheckpoint.ts |
| core/agent/ | chart assembly: buildAgentChart / buildDynamicAgentChart (picked by reactMode, Agent.ts:1145-1147), buildToolRegistry, stages/ (seed, callLLM, route, toolCalls, prepareFinal, breakFinal, reliabilityExecution) |
| core/slots/ | the 3 context-slot subflow builders + thinking subflow — intentionally NOT exported |
| core-flow/ | Sequence/Parallel/Conditional/Loop — RunnerBase subclasses with own charts |
| patterns/ | Debate/MapReduce/Reflection/SelfConsistency/Swarm/ToT — pure composition of runners, no new control flow |
| adapters/ | hexagonal ports (types.ts = ALL port interfaces) + vendor impls (llm/, memory/, identity/, observability/) |
| recorders/core/ | bridges footprintjs events → typed EventDispatcher (ContextRecorder, EmitBridge, typedEmit) — auto-attached by Agent.createExecutor; most factories also exported via `/observe` for manual wiring (EmitBridge itself stays internal) |
| recorders/observability/ | consumer recorders over the typed stream (RunStepRecorder, FlowchartRecorder, Status, Trace replay) |
| lib/ | first-party sub-libraries: injection-engine/, context-bisect/ (localizeContextBug), influence-core/, trace-toolpack/ (selfExplain), mcp/, rag/, tool-lint/ |
| memory/ | store/ (MemoryStore port) + pipeline presets + stages + beats/facts + causal/ (dev-only, TOP_K+search()-only) + wire/mountMemoryPipeline |
| events/ | EventDispatcher (wildcard subs), registry (EVENT_NAMES, AgentfootprintEventMap), payloads |
| conventions.ts | THE builder↔recorder protocol: SUBFLOW_IDS/STAGE_IDS (internal), INJECTION_KEYS/stageRole/milestoneFor (exported, Lens-facing) |

Traps: `src/observability/` holds the finder IMPLEMENTATIONS (canonical home; `debug/finders.ts` re-exports them — only the old subpath is deprecated), while real recorders live in `recorders/observability/`; `identity` appears twice (src/identity.ts = tool credentials; memory/identity/ = tenant scoping — unrelated); `resilience` (provider decorators) ≠ `reliability` (in-loop rules gate).

## Core state & flow
- `AgentState` (core/agent/types.ts:287) — THE chart state; every stage gets `TypedScope<AgentState>`. Mutability conventions documented ON the type (:276-286). Everything in scope must survive structuredClone → functions stay in closures, errors stringified, injections projected to POJOs.
- **Two runId namespaces**: typed-event `meta.runId` (Agent's makeRunId, RunnerBase.ts:55) vs footprintjs `traversalContext.runId` — never correlate across them.
- **Event path**: stage `typedEmit` → `scope.$emit` → footprintjs emit channel → `EmitBridge.onEmit` (drops if no dispatcher listener! EmitBridge.ts:44) → `buildEventMeta` → dispatcher → `agent.on()` listeners. Fires MID-STAGE, **before that stage's commit** — correlate events↔commits by runtimeStageId, never arrival order.
- Executor defaults DIVERGE from footprintjs: `readTracking:'summary'`, `commitValues:'delta'` (Agent.ts:779-782) — read commit values via `commitValueAt`, never `bundle.overwrite[key]`.
- Recorders never read AgentState directly; slot subflows write `INJECTION_KEYS` convention keys, `ContextRecorder.onWrite` resolves the slot from the write's own runtimeStageId (parallel-safe).
- $break is the only clean-stop channel; structured fail context rides scope fields (`policyHalt*`, `reliabilityFail*`), decoded post-run by `Agent.finalizeResult` (Agent.ts:884) into typed errors.

## Extension points
- **Tool**: `defineTool` (core/tools.ts:155); shape `Tool = {schema, needs?, execute(args, ctx)}` (:23). Register `AgentBuilder.tool()` (AgentBuilder.ts:184); merged with auto `read_skill` in buildToolRegistry (:65; same-reference skill tools dedupe, any other name collision THROWS at build). Chart-as-tool: `flowchartAsTool` (core/flowchartAsTool.ts:203). MCP: `mcpClient(...).tools()`.
- **ToolProvider** (per-iteration visibility): `list(ctx): Tool[]` (tool-providers/types.ts:121); max ONE per agent (AgentBuilder.ts:238 throws on second); combinators staticTools/gatedTools/skillScopedTools chain decorator-style.
- **LLM provider**: `LLMProvider = {name, complete, stream?}` (adapters/types.ts:230) passed as `AgentOptions.provider`. `provider.name` keys THREE auto-resolutions: cache strategy (cache/strategyRegistry.ts:40), thinking handler (thinking/registry.ts:43), Lens labels.
- **Recorder, 3 layers**: (1) raw footprintjs CombinedRecorder via `agent.attach()` (RunnerBase.ts:474 — NOT idempotent); (2) typed stream `agent.on(type|'*')`; (3) new built-in = factory taking `{dispatcher, getRunContext}`, registered in the attach block inside `Agent.run()` (Agent.ts:807-845), barreled in src/observe.ts.
- **New typed event (3-step)**: payload interface in events/payloads.ts + entry in `AgentfootprintEventMap` (registry.ts:198) + append to `ALL_EVENT_TYPES` (registry.ts:488, count-asserted by tests). New DOMAIN also needs a bridge attach in Agent.createExecutor or emits never reach the dispatcher — AND a hand-edit to `DomainWildcard` (dispatcher.ts:67-82; already missing validation/credential/reliability).
- **Strategy (vendor sink)**: shapes in strategies/types.ts (Observability :130, Cost :169, LiveStatus :201, Lens :234); attach via `agent.enable.*` or `registerObservabilityStrategy` (strategies/registry.ts). New vendor = export from observability-providers.ts, NOT a new subpath.
- **Memory store**: implement `MemoryStore` (memory/store/types.ts:113; `search?` REQUIRED for causal memory); pass to `defineMemory({store})`. Memory TYPE/STRATEGY unions are CLOSED (define.types.ts:57/74 — new one edits defineMemory dispatch + a pipeline builder).
- **Injection/skill**: `Injection = {id, flavor, trigger, inject}` (lib/injection-engine/types.ts:161); trigger is a closed 4-variant union (:30 — new kind edits evaluator.ts:40-74 switch). Factories defineSkill etc.; skill graph via `skillGraph()` (skillGraph.ts:347) with pluggable `EntryScorer` (entryScorer.ts:64).
- **Ports table** (wired via AgentOptions): PermissionChecker (adapters/types.ts:403), PricingTable (:412), CredentialProvider (identity/types.ts:89), CacheStrategy (cache/types.ts:151, registerCacheStrategy), ThinkingHandler (thinking/types.ts:114 — auto-wire scans HARDCODED SHIPPED_THINKING_HANDLERS, registry.ts:26), ReliabilityConfig (reliability/types.ts:183), OutputSchemaParser (core/outputSchema.ts:62, duck-typed).
- **Finder** (context-error localization): conform to `Finder` (observability/contextError/finders/types.ts:92); NO registry by design — one file + barrel line. Pluggable `InfluenceScorer` via `localizeContextBug({scorer})` (lib/context-bisect/localize.ts:340).
- **New composition/pattern**: extend RunnerBase, expose `getSpec(): FlowChart`, compose others' specs — no engine change.
- **Closed seams**: Agent chart internals (AgentChartDeps not exported — extend via injections/tools/memory/thinking, never by adding a ReAct stage); ContextSlot (3 slots fixed); ProviderKind factory; dormant ports with no consumer (ContextSourceAdapter, EmbeddingProvider, RiskDetector — adapters/types.ts only); reserved tool names under selfExplain (AgentBuilder.ts:827-838).

## Change-impact map
- **conventions.ts** (STAGE_IDS/SUBFLOW_IDS/INJECTION_KEYS) → chart builders that mount by id, ContextRecorder slot attribution, localizer loop-head detection (lib/context-bisect/trajectory.ts:17-33), `stageRole`/`milestoneFor` (Lens contract), BoundaryRecorder. Renaming an id is the whole blast radius.
- **AgentState** → all 8 stages/ files, both builders' mappers, memory-wire STRING-TYPED keys ('runIdentity'/'turnNumber'/… buildAgentChart.ts:177-180 — not refactor-safe), finalizeResult's `reliabilityFail*`/`policyHalt*` reads (rename silently kills the typed errors).
- **events/** → 65 typed events across 18 domains (counts anti-drift-tested against this file — update BOTH when adding events): ALL_EVENT_TYPES exhaustiveness tests, DomainWildcard hand-list, ~42 importers (recorders, strategies, stream, commentary).
- **adapters/types.ts LLMMessage/LLMRequest** → 62 importers: tool_use round-trip (toolCalls.ts:115-135), wire assembly (callLLM.ts:150-160), providers, cache strategies, security/extractSequence, reliability loop.
- **Cache** → strategy registration is a MODULE SIDE EFFECT (src/index.ts:15-17); an entry point skipping that import silently falls back to NoOp. Resolved once per Agent at construction (Agent.ts:347).
- **Injection engine eval semantics** → Evaluate stage cursor keystone (buildInjectionEngineSubflow.ts:216-218), Route stage MIRRORS slot filters (:297-307 — keep in sync with buildSystemPromptSlot), read_skill gate (toolCalls.ts:380-400).
- **Chart shape** (stage order/loop target) → trajectory.ts loop-head bucketing, selfExplain, FlowchartRecorder/RunStepRecorder step synthesis, milestoneFor, the `maxIterations * 2 + 10` engine headroom (Agent.ts:634).
- **RunnerBase** → all six runners + enable.* strategies + Agent's crash-checkpoint tracker (subscribes to its own dispatcher, Agent.ts:729-752).

## End-to-end trace (agent.run; 1 tool call then final answer; default reactMode 'dynamic')
build (once): Agent.create → AgentBuilder.build → Agent ctor → initChart(buildChart) (Agent.ts:429; RunnerBase throws on re-init :256) → buildAgentChart assembles: seed → sf-injection-engine → Context selector (`failFast: true`, selects the 3 slot subflows in parallel) → sf-cache → call-llm → route decider → branches tool-calls (pausable, `{loopTo}`) / final (PrepareFinal → memory writes → BreakFinal `$break`, `propagateBreak: true`).
run: createExecutor (Agent.ts:769): fresh runId + FlowChartExecutor(readTracking 'summary', commitValues 'delta') + enableNarrative + ~12 bridge recorders (causal-evidence ALWAYS inline even under deferred, Agent.ts:814) → installCheckpointTracker (listens iteration_start/end) → executor.run({input, maxIterations: N*2+10}).
seed#0 (stages/seed.ts:58): history from $getArgs OR consumePendingResumeHistory (:67-72); every emit flows typedEmit → $emit → EmitBridge (drops if no listener) → dispatcher, MID-STAGE pre-commit.
loop body: sf-injection-engine (Gather→Evaluate→Route→Delta; outputMapper `ArrayMergeMode.Replace` — load-bearing) → Context selector fans out sf-system-prompt ‖ sf-messages ‖ sf-tools (each writes its INJECTION_KEYS key; ContextRecorder resolves slot from runtimeStageId) → sf-cache gate → call-llm#N (cacheStrategy.prepareRequest; stream tokens; writes llmLatest*/token counters; reliability retry loop INSIDE this one stage if configured) → route (toolCalls.length && iteration < max ? 'tool-calls' : 'final', stages/route.ts:22-26).
tool-calls#N (pausable): per call — permission gate → arg validation → credential resolve → tool.execute; PauseRequest → commit partial + RETURN payload = footprintjs pause; result appended role:'tool'; iteration++; `{loopTo: sf-injection-engine}` re-enters the loop (buildAgentChart.ts:473).
final: prepareFinal sets finalContent + emits turn_end → breakFinal `$break()` returns finalContent → outputMapper bubbles it up → executor resolves → finalizeResult (Agent.ts:884): detectPause → reliabilityFail scan → policyHalt scan → return string. Errors: recoverable + history captured → wrapped in RunCheckpointError (Agent.ts:649-661).

## Backtracking
Six mechanisms layered on footprintjs (whose transaction/checkpoint machinery lives upstream): **M1** pause/resume — `pauseHere/askHuman` throw PauseRequest inside tool.execute; toolCalls commits history + pausedTool* to scope BEFORE returning the pause payload; scope is the ONLY carrier across the checkpoint. **M2** `resumeOnError` — history-only `AgentRunCheckpoint` (a DIFFERENT type from FlowchartCheckpoint) built from iteration_end events; resume REPLAYS from restored history via the `pendingResumeHistory` side channel. **M3** inline reliability retry — up to 50 attempts inside ONE stage; retry state closure-local, never scope. **M4** chart-level reliability gate — built but UNMOUNTED (buildReliabilityGateChart; editing it changes nothing at runtime). **M5** ReAct loopTo re-entry with `ArrayMergeMode.Replace` guards. **M6** counterfactual replay (context-bisect ablation probes; causal claims only from majority-flip over ≥2 seeded reruns). Deep dive: [.claude/rules/backtracking.md](.claude/rules/backtracking.md).

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
- [.claude/rules/backtracking.md](.claude/rules/backtracking.md) — 6 mechanisms with step tables + pseudocode
- [examples/](examples/) — canonical imports (the authority on which subpath exports what) · [src/conventions.ts](src/conventions.ts) — the builder↔recorder protocol
- Build/test: `npm run build`, `npm test`
