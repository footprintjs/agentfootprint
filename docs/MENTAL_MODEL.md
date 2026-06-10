# agentfootprint — Library Mental Model

> **Purpose.** This is the single document to read to understand the *whole* agentfootprint
> library: what it is, how every subsystem fits, the load-bearing invariants, and the known
> gaps. It is built from a deep trace of the real source (not the README's aspirations).
> When code and this doc disagree, the code wins — fix this doc.
>
> Last full synthesis: 2026-05-30. Maintained as a living map.

---

## ★ LOCKED DESIGN — the messageAPI merge-tree chart (one shape, Static + Dynamic)

**This is the agreed target chart shape. Do NOT re-litigate it.** (Re-confirmed with the user
2026-05-31; verified by workflow wi6m0awnx.)

```
Context (fork)
 ├─ system-prompt ┐
 ├─ messages ─────┴─→ messageAPI stage ┐
 └─ tools ──────────────────────────────┴─→ Call-LLM   → [thinking] → route/loop
```

- **messageAPI is a REAL stage**, not a drawing. It assembles the LLM request bulk that today is
  built invisibly inside `call-llm` (`callLLM.ts:132`): `systemPrompt` (separate field) + `messages`
  (= `scope.history`: user/assistant/**tool-result** messages in order) → the message-API payload;
  then `+ tools` (separate field) → Call-LLM. Faithful to the real wire protocol (Anthropic: `system`
  separate, `messages` array, `tools` separate; OpenAI: system becomes first message at the adapter).
- **ONE chart serves BOTH Static (Classic) and Dynamic agent.** Same structure. The ONLY difference
  is **which slot pills LIGHT per iteration**: Static → only `messages` changes each loop (tool result
  appended), so system-prompt + tools pills stay UNLIT; Dynamic → system-prompt and/or tools also
  re-engineer per iteration, so their pills LIGHT. An unlit pill IS the "this slot didn't change"
  signal. No separate Classic chart.
- **Rendering reuses explainable-ui — NO new collapser.** Slots become REAL subflow nodes (not folded
  pills). explainable-ui TracedFlow renders the structure; **node-type alone** picks a different
  renderer per node (slot vs LLM vs tool); **xyflow native grouping** (`parentId` + `extent:'parent'`)
  draws the sf-llm-call group with slot nodes inside — grouping on the DATA side, not a hand-rolled
  fold. topologyRecorder gives the live composition graph. wi6m0awnx verdict: the collapser's
  slot-folding transform DIES; only the thin noise-filter + synthetic User node remain. Both Lens AND
  Trace render the same real structure (different node renderers).

**Build order (LLM-first, agreed):**
1. ✅ DONE — LLMCall-level merge-tree, NO tools: `Context(root selector) → [system-prompt, messages]
   → messageAPI → Call-LLM`. Built (`buildMessageApiChart`), Context is the ROOT (init folded in,
   no Seed node — via footprintjs `flowChartSelector`/`startSelector`). Renders in playground as the
   "LLM call" main-box with slot pills (lit/unlit) and dagre layout. 4/4 tests.
2. ✅ DONE — Agent: the `tools` subflow added as a THIRD selector branch + the loop.
   Built (`buildAgentMessageApiChart`) as ONE FLAT chart (no inner LLM-call box):
   `Context(root selector) → [system-prompt, messages, tools] → messageAPI → Call-LLM
   → Route → [ToolCalls → loopTo(Context)] / Final`. 5/5 tests. Renders in the playground
   as the "Agent" main-box with slot pills; the loop-back edge draws as a right-margin
   CURVE (explainable-ui `LoopBackEdge`) and ToolCalls sits on the loop (right) side via
   the dagre `siblingOrder` layout option — both pure renderer/visual choices, chart spec
   unchanged. (This is the merge-tree VIZ chart; the shipped runtime agent still composes
   `sf-llm-call` via `buildDynamicAgentChart` — see the NOTE below.)

**★ Agent shape (the next build) — the tools PAIR merges into Call-LLM:**

```
┌─ Agent (main box) ─────────────────────────────────────────┐
│  Context (root selector — init + picks slots+tools)         │
│    ├─ system-prompt ┐                                       │
│    ├─ messages ─────┴─→ messageAPI ┐                        │
│    └─ tools ───────────────────────┴─→ Call-LLM            │
│                          ↑ TWO inputs merge into Call-LLM:  │
│                            (a) messageAPI payload           │
│                            (b) tools schemas               │
│  Call-LLM → route → [tool-exec → loop back to Context] / final
└────────────────────────────────────────────────────────────┘
```

Key differences from LLMCall:
- **Call-LLM is a 2-parent MERGE**: `messageAPI` (system-prompt+messages bulk) AND `tools` (schemas)
  both converge into Call-LLM. (In LLMCall there's no tools branch, so Call-LLM has 1 parent.)
- **The loop**: Call-LLM → route → tool-exec → `loopTo(Context)` (ReAct). Context re-runs each
  iteration; which slots/tools light up per iteration = Static (only messages changes) vs Dynamic
  (system-prompt/tools also re-engineer). Same chart, both agents.
- Built with `flowChartSelector` root (Context) + 3 branches (system-prompt, messages, tools) +
  messageAPI + Call-LLM + route/loop. `tools` is a slot subflow like the others.

NOTE: the current `buildDynamicAgentChart` (shipped, opt-in `reactStructure:'subflow'`) now mounts
the 3 slots as a PARALLEL selector fork (`addSelectorFunction('context', …, { failFast })` + 3
`addSubFlowChartBranch` for system-prompt/messages/tools), with the cache grouped into one `sf-cache`
subflow, all inside the `sf-llm-call` boundary; the loop is branch-sourced from `tool-calls` via
`{ loopTo: 'sf-llm-call' }`. It gets the sf-llm-call boundary right (so Lens shows an LLM card) but
does NOT yet add the explicit `messageAPI` merge stage — Call-LLM still assembles the payload inline.
This locked design supersedes it for that slot-internal `messageAPI` shape.

---

## 0. What this library is, in one breath

agentfootprint is an **explainable LLM-agent framework built on footprintjs**. Its differentiator
is pedagogical and observational: every agent is a footprintjs **FlowChart**, so every decision,
every piece of injected context, and every tool call is captured *during traversal* as a typed
event — making the agent **self-explaining** (and reasoning-replayable) rather than a black box.

The north star (load-bearing): **make context engineering visible.** There is *one* agent
primitive (ReAct); RAG / Skills / Memory / Instructions / Tools / Grounding are not separate
features but **flavors of context injection** along five axes. The library and its Lens UI exist
to teach that one model, not N features.

---

## 1. The taxonomy: 2 primitives + 4 compositions + 6 patterns + context engineering

```
PRIMITIVES (2)                COMPOSITIONS (4)            PATTERNS (6)
  LLMCall  — one LLM call       Sequence  — chain           SelfConsistency = Parallel(N LLMCalls)+vote
  Agent    — ReAct loop         Parallel  — fan-out+merge   Reflection      = Loop(Sequence(propose→critique))
                                Conditional — branch        Debate          = Sequence([Loop(]propose→critic[)]→judge)
                                Loop      — iterate          MapReduce       = Sequence(split→Parallel(shards+reduce))
                                                             ToT             = Loop(Parallel(K)+score-prune)
                                                             Swarm           = Loop(Conditional(agents|done))

CONTEXT ENGINEERING (cross-cutting, not a primitive):
  ONE Injection primitive + 4 factories (Steering / Instruction / Skill / Fact)
  → 3 slots (system-prompt / messages / tools), 4 trigger kinds, 5 descriptive axes
```

> **Correction to CLAUDE.md:** the code has **4** compositions (`src/core-flow/`: Sequence,
> Parallel, Conditional, **Loop**), not 3. `translator.ts` `GroupKind` confirms six group kinds:
> `Parallel | Sequence | Loop | Conditional | Agent | LLMCall`. Patterns introduce **no new
> runtime machinery** — they are pure factory compositions of the primitives + compositions.

Everything — primitive, composition, pattern — implements the same `Runner<TIn, TOut>` interface
with `TIn = { message: string }`, `TOut = string`. That uniform string-in/string-out contract is
*why* anything nests inside anything (`src/core-flow/README.md` Decision 4).

---

## 2. How it sits on footprintjs (the foundation)

```
Consumer  →  Runner (Agent/LLMCall/Composition)
                │  builds ONE immutable FlowChart at construction (initChart)
                ▼
            footprintjs FlowChartExecutor   (fresh per run())
                │  DFS traversal — collect during traversal, never post-process
                ├── 3 raw observer channels:
                │     Recorder      (onRead/onWrite/onCommit)      ← data flow
                │     FlowRecorder  (onSubflowEntry/onDecision/…)  ← control flow
                │     EmitRecorder  (onEmit)                       ← consumer events
                ▼
            agentfootprint recorders bridge raw channels → typed AgentfootprintEvents
                ▼
            EventDispatcher (one per Runner) → consumers / Lens
```

Key footprintjs primitives agentfootprint leans on:
- **Subflows** — a child Runner's `getSpec()` is mounted via `addSubFlowChart*`; the child's last
  stage return becomes the parent's `outputMapper` input. One shared `runtimeStageId` address space.
- **`decide()` / `select()`** — capture decision/selection *evidence* natively on
  `FlowRecorder.onDecision`/`onSelected`. Used by Route, CacheGate, Conditional, memory pickers.
- **`loopTo(id)`** — backward edge for iteration (the ReAct loop, Loop composition).
- **`$emit` / EmitRecorder** — the telemetry channel (see invariant #4).
- **`$break(reason)`** — graceful termination; `propagateBreak` carries it across subflow mounts.
- **runtimeStageId** = `[subflowPath/]stageId#executionIndex` — the universal correlation key.

### The two subflow-boundary rules that govern EVERYTHING (memorize these)

1. **`inputMapper` keys are FROZEN inside the subflow.** They land in `_readOnlyValues`;
   `ScopeFacade.setValue` *throws* on any key that came through `inputMapper`. So a key the
   subflow must *write* cannot also be passed in under the same name — pass the prior value under
   a `prior*` alias and seed a writable working key from it (this is exactly how
   `buildDynamicAgentChart` round-trips token/skill accumulators across the loop).
   *Source:* `footPrint/src/lib/scope/protection/readonlyInput.ts` (`assertNotReadonly`),
   `SubflowInputMapper.ts` (`seedSubflowGlobalStore` writes inputMapper values to the mutable
   GlobalStore *and* readOnlyContext — readable via `scope.x`, not writable).

2. **`outputMapper` arrays CONCATENATE by default.** `applyOutputMapping` does `[...parent, ...sub]`
   for array values unless you pass `arrayMerge: ArrayMergeMode.Replace`. In any *looping* chart,
   an array field re-emitted each iteration will double (8→16→24…) without `Replace`. This burned
   the InjectionEngine in v2.5.1; `Replace` is now pervasive on every injection/cache/thinking mount.

---

## 3. Runner lifecycle (`RunnerBase`)

`src/core/RunnerBase.ts` — abstract base for every primitive/composition (Template Method).

- **`initChart(() => buildChart())`** — called *once* in the subclass constructor. Eager build so:
  StructureRecorder fires exactly N times, `getSpec()` is reference-stable (Lens/OpenAPI memos),
  no `_mergeStageMap` false-positives. Throws if called twice.
- **`getSpec()`** — returns the cached chart; reference-stable across all calls.
- **`createExecutor()`** (per concrete runner, per `run()`) — mints a fresh `RunContext`
  (`makeRunId()` = `run-${Date.now()}-${++seq}`), `new FlowChartExecutor(getSpec())`,
  `enableNarrative()`, then **auto-attaches recorders** (table below), then consumer recorders.
- **`run()/resume()`** — abstract; each subclass implements. Both end in `finalizeResult()`, which
  calls `detectPause()` first (→ `RunnerPauseOutcome` if paused), then type-specific result handling.
- **`attach(recorder)`** — pushes a `CombinedRecorder` applied to every future executor.
- **`enable` namespace** — `.thinking()` `.logging()` `.flowchart()` `.observability()` `.cost()`
  `.liveStatus()`. All route through the `EventDispatcher`, not the executor.
- **`getUIGroup<T>()`** — lazy, reference-stable result of the consumer's `GroupTranslator` over
  `buildUIGroupMetadata()`. The Lens contract (see §10).

**Auto-attached recorders (Agent):** ContextRecorder, contextEvaluatedRecorder, streamRecorder,
agentRecorder, errorBridge, evalRecorder, memoryRecorder, skillRecorder, toolsRecorder,
reliabilityRecorder (always); costRecorder (if pricingTable); permissionRecorder (if permissionChecker).
LLMCall attaches a subset (no agent/tools/permission).

> **Concurrency:** an Agent instance is **not** concurrency-safe — `createExecutor()` mutates
> `this.currentRunContext`/`this.lastExecutor`, and `providerToolCache` is chart-scoped. Use one
> instance per concurrent request (factory-build the chart).

---

## 4. Primitive 1 — LLMCall (`src/core/LLMCall.ts`)

Single LLM invocation, no tools. Outer/inner shape so Lens gets a clean card that drills in:

```
Client (stage)
  → sf-llm-call (SUBFLOW): Initialize → sf-system-prompt → sf-messages → call-llm
                                 → [sf-thinking] → extract-final
  → loopTo(Client)            (one-shot: 2nd Client visit $break()s with scope.answer)
```

- No `sf-tools` slot by design (tools are Agent's territory).
- Description prefix `LLMCall:` is the taxonomy marker (vs `Agent:`); Lens treats only `Agent:`
  subflows as true agent boundaries.
- Loop shape is identical to future chat-mode (swap `$break()` for `pause()`).

---

## 5. Primitive 2 — Agent = ReAct (`src/core/agent/buildAgentChart.ts`)

The flat chart (the default — `reactStructure:'flat'` + `reactMode:'dynamic'`; the LLM is a flat
`call-llm` STAGE; the same builder also serves the opt-in `reactMode:'classic'`):

```
Seed
  → [memory READ subflows]                       (TURN_START, once per turn)
  → sf-injection-engine        ← loopTo target
  → sf-system-prompt → sf-messages → sf-tools     (the 3 slots)
  → sf-cache-decision → UpdateSkillHistory → CacheGate(decider)→ApplyMarkers|SkipCaching
  → CallLLM (emits the per-iteration `iteration_start` marker) → [sf-thinking]
  → Route(decider) → tool-calls (pausable, loopTo(sf-injection-engine)) | final (subflow, propagateBreak:true)
```

The loop is **branch-sourced** from the `tool-calls` branch via
`addPausableFunctionBranch('tool-calls', …, { loopTo: 'sf-injection-engine' })`, so the chart draws
`ToolCalls → sf-injection-engine` and `Final` is a plain terminal leaf (not a decider-level loop).

`AgentState` (the scope shape) — the contract every stage reads/writes. Notable cross-iteration
**accumulators**: `totalInputTokens/OutputTokens`, `cumTokens*`/`cumEstimatedUsd`/`costBudgetHit`,
`skillHistory`, `activatedInjectionIds`, `history`, `iteration`. Per-iteration working keys:
`activeInjections`, `*Injections`, `dynamicToolSchemas`, `cacheMarkers`, `llmLatest*`, `thinkingBlocks`.

**Stage contracts (who reads/writes what):**
- `seed` — initializes the whole AgentState from `AgentInput`; restores `pendingResumeHistory` if `resumeOnError`.
- `callLLM` — reads `systemPromptInjections`+`history`+`dynamicToolSchemas`+`cacheMarkers`; calls
  provider stream()→complete(); writes `llmLatestContent/ToolCalls`, `rawThinking`, accumulates `totalInput/OutputTokens`; `emitCostTick`.
  Also emits the per-iteration `agentfootprint.agent.iteration_start` marker at the top of the stage (folded in from the former dedicated `IterationStart` stage — emit is passive, so no separate stage is warranted).
- `route` (decider) — reads `llmLatestToolCalls`, `iteration`, `maxIterations` → `'tool-calls' | 'final'`.
- `toolCalls` (pausable handler, OUTSIDE the LLM region) — executes tools, appends to `history`,
  sets `lastToolResult`, appends `read_skill` ids to `activatedInjectionIds`, increments `iteration`;
  permission gate (allow/deny/halt); pause via `pauseHere`.
- `prepareFinal`/`breakFinal` — capture `(user,assistant)` into `newMessages`, then `$break()`.

### Dynamic ReAct chart (`src/core/agent/buildDynamicAgentChart.ts`)

A second builder (opt-in via `reactStructure: 'subflow'`) that wraps the entire context-engineering + call region in an
`sf-llm-call` **subflow** (the same boundary LLMCall produces) so the Dynamic agent renders in Lens
as an LLM group with slots + a peer Tool node + the loop — with *zero* Lens special-casing.

```
Seed → [memory READ] → sf-llm-call(SUBFLOW: turn-seed → InjectionEngine → 3 slots → cache →
        UpdateSkillHistory → CacheGate → CallLLM (emits iteration_start) → [thinking])
     → Route → {tool-calls | final} → loopTo(sf-llm-call)
```

Reuses **every** existing dep verbatim — only the wiring changes. The boundary `inputMapper` passes
read-only keys + `prior*` accumulator aliases + `memoryInjection_*`; a small `dynamicTurnSeed`
copies `prior* → writable working key`; `outputMapper` bubbles the LLM result + accumulators back
(arrayMerge Replace). **Status: SHIPPED + wired + tested.** `Agent.ts` selects the builder from two
`AgentOptions`:
- **`reactStructure: 'flat' | 'subflow'`** (default `'flat'`) — `'subflow'` wraps the LLM turn in
  the `sf-llm-call` boundary (this builder); `'flat'` keeps the bare `call-llm` stage (`buildAgentChart`).
- **`reactMode: 'classic' | 'dynamic'`** (default `'dynamic'`) — loop SEMANTICS. `'dynamic'` re-runs
  the InjectionEngine + all three slots each iteration; `'classic'` engineers context once and the
  Context selector stops re-selecting system-prompt/tools after turn 1 (loops only Messages).
  `'classic'` takes precedence and always uses the flat chart (`buildAgentChart`) — the subflow
  grouping re-seeds context every turn, so it stays dynamic-only.

So `buildDynamicAgentChart` runs when `reactStructure === 'subflow'` AND `reactMode !== 'classic'`
(`Agent.ts:945-954`).

---

## 6. Context Engineering — the conceptual heart (`src/lib/injection-engine/`, `src/core/slots/`)

**One `Injection` primitive; everything else is sugar.** A piece of developer-engineered content
reaching the LLM — a safety policy, a retrieved doc, a skill body, a fact — is an `Injection`:

```ts
interface Injection {
  id: string; description?: string;
  flavor: ContextSource;        // 'skill'|'steering'|'instructions'|'fact'|'rag'|'memory'|'custom'
  trigger: InjectionTrigger;    // WHEN
  inject: InjectionContent;     // WHAT + WHERE: { systemPrompt?, messages?, tools? }
  metadata?: Record<string,unknown>;  // surfaceMode, refreshPolicy, autoActivate, cache
}
```

**4 trigger kinds (the WHEN):** `always` · `rule{activeWhen(ctx)}` · `on-tool-return{toolName|RegExp}`
· `llm-activated{viaToolName}` (active when `id ∈ ctx.activatedInjectionIds`).

**The 5 descriptive axes** every injection answers: **slot** (system-prompt/messages/tools) ×
**role** (system/user/assistant/tool) × **flavor** (the 7 ContextSources) × **timing** (the trigger
kind) × **decision-rule** (static vs predicate vs tool-event vs LLM). All flavors emit the *same*
`context.injected` event — add a flavor = one `ContextSource` value + one factory file, zero engine
change. `ContextSource` partitions into **baseline** (user/tool-result/assistant/base/registry —
Lens hides as implicit edges) and **engineered** (rag/skill/memory/instructions/steering/fact/custom
— Lens shows as chips).

**The 4 factories** (`factories/`): `defineSteering` (always, system-prompt, cache:'always') ·
`defineInstruction` (rule, system-prompt|messages, cache:'never') · `defineSkill` (llm-activated,
system-prompt+tools, cache:'while-active') · `defineFact` (always|rule, data, cache:'always').

**The InjectionEngine subflow** (`buildInjectionEngineSubflow.ts`): one `evaluate` stage. Reads
`InjectionContext{iteration,userMessage,history,lastToolResult,activatedInjectionIds}`, runs the
**build-time-frozen** injection list through `evaluateInjections`, writes `activeInjections` (POJO
projection) and **emits** `agentfootprint.context.evaluated` with the active/skipped breakdown
(observability — replaced the old dead `injectionEvaluation` scope write). Mounted with
`arrayMerge: Replace`.

**`projectActiveInjection` — why POJO:** footprintjs `structuredClone`s scope writes; functions
(triggers, `tool.execute`) aren't cloneable. The projection drops the trigger and reduces
`inject.tools` to `{schema, injectionId}[]`; the Agent's closure-held `registryByName` map converts
`injectionId → execute` at dispatch.

**The 3 slot subflows** (`src/core/slots/`): each reads `activeInjections` from args, filters by its
slot, composes content, writes an `InjectionRecord[]` (observed by ContextRecorder → `context.injected`)
+ a `SlotComposition` summary (→ `context.slot_composed`). ToolsSlot is 2-stage (discover via
`ToolProvider.list(ctx)` → compose+dedup by name). SystemPromptSlot honors `surfaceMode:'tool-only'`
(skip body in system slot).

**Skills runtime:** registered as `flavor:'skill'` Injections. `buildToolRegistry` auto-attaches
`read_skill` (catalog embedded in its description) when ≥1 skill exists; `autoActivate:'currentSkill'`
skills' tools are hidden from the static LLM list until activated (but kept in `registryByName` for
dispatch). LLM calls `read_skill(id)` → toolCalls handler appends `id` to `activatedInjectionIds`
(turn-scoped, never deactivates mid-turn) → next InjectionEngine pass the `llm-activated` trigger
fires → body+tools flow into slots. `surfaceMode` (auto/system-prompt/tool-only/both) resolved by a
3-level cascade (skill → registry → provider/model heuristic: Claude≥3.5 → `both`, else `tool-only`).

---

## 7. Memory (`src/memory/` — the largest subsystem)

**3D model: TYPE × STRATEGY × STORE.** A memory is a pair of footprintjs FlowCharts (read + write)
plus an identity-scoped store.

- **TYPE (4):** `episodic` (raw messages) · `semantic` (facts or embedded msgs) · `narrative`
  (story beats) · **`causal`** (footprintjs snapshots — the differentiator). Type gates legal strategies.
- **STRATEGY (7):** `window` · `budget` · `summarize` · `topK` · `extract` · `decay` (NOT wired —
  throws) · `hybrid`. No-LLM ones are free; topK/summarize/extract need embedder/LLM.
- **STORE:** `MemoryStore` interface (get/put/list/delete/seen/feedback/forget, optional `search`).
  Built-in `InMemoryStore`; adapters `RedisStore` (no `search`), `AgentCoreStore` via
  `agentfootprint/memory-providers` (lazy-required SDKs).

**`defineMemory({id,type,strategy,store,timing?,asRole?,projection?})`** → compiled `MemoryDefinition`
(branded read/write FlowCharts). Wired via `mountMemoryRead` (TURN_START, between Seed and the loop)
and `mountMemoryWrite` (in the final branch). Read writes `memoryInjection_${id}` to parent scope;
write persists `newMessages`. Identity = `{tenant?, principal?, conversationId}` → `identityNamespace`.

**Causal memory** stores `SnapshotEntry{query, finalContent, decisions[], toolCalls[], narrative?}`,
embeds `query` for cosine recall, projects the stored run back as a system message for
"why did you decide X?" follow-ups. `decisions[]`/`toolCalls[]`/tokens/duration are harvested
automatically by `causalEvidenceRecorder` (the #5 evidence bridge). *This is the capability no
other library has* (footprintjs captures WHY, not just WHAT). Not yet captured: commitLog,
narrative. `exportForTraining` (snapshots as RL/SFT data) is the v2.1 hook.

> **⚠ LATENT GAP (verified):** the Agent chart does **not** merge `memoryInjection_${id}` into
> `scope.history`/the LLM request. The read pipeline runs and writes the scope key, but nothing
> consumes it into the prompt — there is no merge stage. Writes persist correctly; reads don't reach
> the LLM in the current chart. (`buildDynamicAgentChart` threads the key through the boundary, so it
> preserves — not worsens — this behavior.) Also: causal `decisions`/`toolCalls` are written empty
> (TODO), `COMMITS` projection falls back to decisions, `DECAY` throws, `HYBRID`-episodic uses only
> the first sub-strategy, topK/causal threshold is strict (no below-threshold fallback).

---

## 8. Providers / Adapters (`src/adapters/`, `src/thinking/`)

Ports-and-adapters. The port is a **3-member interface**:

```ts
interface LLMProvider { readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
  stream?(req: LLMRequest): AsyncIterable<LLMChunk>; }   // optional; callLLM falls back to complete()
```

`LLMRequest{systemPrompt?,messages,tools?,model,temperature?,maxTokens?,cacheMarkers?,thinking?}`;
`LLMResponse{content,toolCalls,usage,stopReason,providerRef?,rawThinking?}`;
`LLMChunk{tokenIndex,content,done,response?,thinkingDelta?}` (response only on `done`).

**Adapters:** Anthropic, OpenAI(+`ollama()`), Bedrock (Converse, model-agnostic), BrowserAnthropic
& BrowserOpenAI (fetch+SSE, for playgrounds), Mock. All lazy-`require` peer-dep SDKs (bundler-safe),
expose a `_client` test seam, and **preserve raw `error.status`** (reliability classifies on it).
Factory: `createProvider({kind,...})`. Public subpath `agentfootprint/llm-providers` (legacy `/providers`).

**$0 testing:** swap `provider` for `MockProvider` — `mock({reply})`, `mock({replies:[...]})`
(scripted multi-turn, cursor-based, exhaustion throws), `mock({respond})`, `MockProvider.realistic()`
(latency for live-feel demos). Same interface as real providers → zero-cost tests, identical chart.

**Thinking** (`src/thinking/`): consumer `ThinkingHandler{id,providerNames,normalize(raw),parseChunk?}`
auto-wired by `provider.name`; `buildThinkingSubflow` wraps it in a real subflow. **Signature
round-trip**: Anthropic thinking blocks must echo byte-exact + ordered FIRST in the assistant turn
or HTTP 400. `thinkingBlocks` persist in `scope.history`; `ephemeral` messages do not.

**Cost:** `PricingTable.pricePerToken(model,kind)` → `emitCostTick` emits `cost.tick`/`cost.limit_hit`
(warn only, never auto-aborts).

---

## 9. Compositions (`src/core-flow/`) & Patterns (`src/patterns/`)

Each composition wraps child Runners as subflows; `scope.current` (Sequence/Loop) or
`scope.branchResults` (Parallel) or `scope.result` (Conditional) carries data; a `Finalize`/`Merge`
stage returns the chart's TraversalResult.

- **Sequence** — `.step(id,runner).pipeVia(fn?)`; output of step N → input of N+1.
- **Parallel** — `.branch(id,runner)` + `.mergeWithFn`/`.mergeWithLLM` (STRICT: any branch failure
  throws) or `.mergeOutcomesWithFn` (TOLERANT: `BranchOutcome` map). `Promise.allSettled`; branch ids
  must not contain `/`. (Pre-v2-Phase5 silently swallowed failures — fixed to strict-default.)
  `.branch(id, runner, { required: true })` makes that branch's failure reject the whole run (named
  after the branch) even under a tolerant merge; all-required engages footprintjs fork-level
  `failFast` (`Promise.all`, first failure aborts before the merge).
- **Conditional** — `.when(id,predicate,runner)` + `.otherwise(id,runner)`; first match wins; one branch runs.
- **Loop** — `.repeat(runner).times(n).forAtMost(ms).until(guard)`; `loopTo` + Guard; HARD cap 500.

**6 patterns** (factories returning a Runner): SelfConsistency, Reflection, Debate, MapReduce, ToT,
Swarm — see §1 for their recipes. None add primitives.

---

## 10. Observability (`src/recorders/`, `src/events/`, `src/observe.ts`)

**Pipeline:** footprintjs 3 channels → recorder bridges → **`EventDispatcher`** (one per Runner,
O(1) hash-dispatch, typed `on/off/once` + domain-wildcards + `'*'`, error-isolated) → consumers/Lens.

**64 typed events / 18 domains**, all `agentfootprint.*`: `composition.*`(8) `agent.*`(8)
`stream.*`(7) `context.*`(5 — the thesis) `memory.*`(4) `tools.*`(6) `validation.*`(1) `skill.*`(2) `permission.*`(4)
`credential.*`(4) `cost.*`(2) `eval.*`(2) `error.*`(3) `reliability.*`(3) `pause.*`(2)
`embedding.*`(1) `risk.*`(1) `fallback.*`(1).
Emitted via `typedEmit(scope,name,payload)` (compile-time-safe) → EmitRecorder →
**`EmitBridge`** (prefix-match per domain) → `buildEventMeta` enriches
(`runtimeStageId, subflowPath, runId, wallClockMs, compositionPath, turnIndex, iterIndex`) → dispatch.

**Core recorders:** most are `EmitBridge` factories per domain (stream/agent/composition/cost/eval/
memory/skill/permission/tools). **ContextRecorder** is the exception — it listens on the *Recorder +
FlowRecorder* channels, watches slot-subflow entry/exit + scope writes, diffs by `contentHash` →
one `context.injected` per unique injection. **ErrorBridge** listens `FlowRecorder.onRunFailed` →
humanizes → emits `error.fatal` *unconditionally* (terminal signal; fixed the "stuck thinking" bug).

**The Lens data path:**
- **`enable.flowchart()` → `FlowchartHandle{getSnapshot,boundary,unsubscribe}`.**
- **`BoundaryRecorder`** = single source of truth: merges both channels into one ordered
  `DomainEvent[]`, tags `slotKind/primitiveKind/isAgentInternal/actorArrow` at capture time,
  composition-safe `clear()` (no-op while `openTokens>0`).
- **`buildStepGraph(boundary)`** = pure fold → `StepGraph{nodes,edges,activeNodeId}` with actor-arrow
  `StepNode.kind`: `user->llm | llm->tool | tool->llm | llm->user | subflow | fork-branch | decision-branch`.
  Slot subflows + agent-internal stages are excluded from slider positions.
- **`RunStepRecorder`** = incremental `RunStep[]` for the slider (Fork/Sequence/Candidate/Root/ActorArrow trackers).
- **`LiveStateRecorder`** = O(1) live "thinking/responding" state (LLM/Tool/AgentTurn trackers);
  `error.fatal` clears in-flight.
- **`getUIGroup()` / `GroupTranslator`** = the *static* Lens contract: Agent →
  `{kind:'Agent', extra:{slots:[sys,msgs,tools], toolNames, maxIterations}}`; LLMCall → 2 slots.

**`enable.observability(tier)`** — minimal/standard(default, drops `stream.token`)/firehose; vendor
strategies (CloudWatch/X-Ray/OTel/AgentCore) via `agentfootprint/observability-providers`; optional
detach so slow exporters don't block. **`toSSE(runner)`** streams events as HTTP SSE.

---

## 11. Cache · Reliability · Resilience

**Cache (`src/cache/`) — 3 layers:** (1) consumer DSL `cache:'always'|'never'|'while-active'|{until}`
per injection; (2) provider-agnostic `CacheMarker{field,boundaryIndex,ttl,reason}` from
`CacheDecisionSubflow` (longest contiguous cacheable prefix per slot); (3) per-provider `CacheStrategy`
translates to wire (Anthropic ≤4 breakpoints; OpenAI auto-caches ≥1024 tok → `cache:'never'` is a
no-op there; Bedrock model-aware). **CacheGate** decider: kill-switch / hit-rate<0.3 / skill-churn
(≥3 unique skills in 5 iters) → skip. *Gap:* `recentHitRate` not yet written back (v2.7).

**Reliability — TWO independent systems:**
1. **Provider decorators** (`src/resilience/`): `withRetry` (backoff; skips 4xx except 429; no stream
   retry), `withFallback` (primary→fallback; first-chunk commit), `withCircuitBreaker` (per-instance,
   class state). Invisible to footprintjs. Compose: `withFallback(withCircuitBreaker(anthropic()), withCircuitBreaker(openai()))`.
2. **Rules-based** (`src/reliability/` + `stages/reliabilityExecution.ts`): `Agent.reliability({preCheck,
   postDecide, providers, circuitBreaker, fallback})`. `executeWithReliability` runs *inside* the
   CallLLM stage (closure-local loop, max 50); branches `continue|ok|retry|retry-other|fallback|fail-fast`;
   `classifyError` taxonomy (`rate-limit|5xx-transient|schema-fail|circuit-open|unknown`); first-chunk
   arbitration (post-first-chunk only `ok`/`fail-fast`); fail-fast writes scope → `Agent.run` throws
   typed `ReliabilityFailFastError`. v2.13 `feedbackForLLM` = ephemeral retry message (Instructor pattern).
   CircuitBreaker here is **pure functions over scope state** (serializable/distributable).

**Fault-tolerant resume (`src/core/runCheckpoint.ts`):** `RunCheckpointTracker` snapshots
`history`+`lastCompletedIteration` on each `iteration_end`; on a non-terminal error with prior
history, `agent.run()` throws `RunCheckpointError{cause,checkpoint}`. `agent.resumeOnError(checkpoint)`
reloads history via the seed side-channel and replays from the failed iteration. *Distinct from*
`agent.resume(FlowchartCheckpoint)` (intentional `askHuman` pause, exact mid-flowchart resume).
Resume = REPLAY, not exact-state restore: only history is restored — the resumed run gets a fresh
`runId`, re-seeds `iteration = 1` with a full `maxIterations` budget, and the failed iteration's
tool calls may be re-issued by the model and re-execute (no built-in toolCallId dedup) — mutating
tools must be idempotent, keyed on stable call content.

---

## 12. Tools · Security · Output Schema · Pause

**Tools (`src/core/tools.ts`, `src/tool-providers/`):** `defineTool({name,description,inputSchema,
execute})` → `Tool`. `buildToolRegistry` = static tools + auto `read_skill` + non-autoActivate skill
tools; cross-source name-uniqueness enforced. `ToolProvider.list(ctx)` for dynamic tools
(`staticTools`/`gatedTools`/`skillScopedTools`); `ProviderToolCache` shares one `list()` call per
iteration between the Tools slot and the dispatch handler.

**Security (`src/security/`):** `PermissionChecker.check({capability,actor,target,context,sequence,
history,iteration,identity?,signal?}) → {result:'allow'|'deny'|'halt'|'gate_open', tellLLM?, reason?}`.
deny → synthetic tool_result, LLM recovers; halt → generic message (never leaks `reason`) + `$break`
→ `PolicyHaltError`. Throwing checker = deny-by-default. `extractSequence` derives the dispatched-call
sequence from history (excludes denied calls) for sequence-aware policies. `PermissionPolicy.fromRoles`.

**Output schema (`src/core/outputSchema.ts`):** `OutputSchemaParser{parse,description?}` (Zod/Valibot/
ArkType/custom duck-typed). `.outputSchema()` auto-pushes an always-on JSON instruction + feeds the
reliability loop (schema-fail → retry-with-feedback). `agent.parseOutput`/`runTyped`; 3-tier
`outputFallback` (LLM-repair → canned, both schema-validated; canned validated at build time).

**Pause (`src/core/pause.ts`):** `pauseHere(data)`/`askHuman` throws `PauseRequest`; the tool handler
commits partial state + returns pause data → footprintjs checkpoint → `RunnerPauseOutcome{paused,
checkpoint,pauseData}`. `agent.resume(checkpoint,input)` continues; the handler's `resume` treats
`input` as the tool result.

---

## 13. Cross-cutting invariants (the load-bearing list)

1. **`inputMapper` keys are frozen inside a subflow** — writes throw. Round-trip writable accumulators
   via `prior*` aliases + an inner seed (§2 rule 1).
2. **`outputMapper` arrays concatenate** — use `ArrayMergeMode.Replace` in any looping chart (§2 rule 2).
3. **POJO-project anything with functions before a scope write** — `structuredClone` drops them
   (ActiveInjection, and never store detach handles in scope).
4. **Telemetry flows through `$emit`, never commit/state** — retries, tokens, chunks, costs. Reading
   telemetry from `CommitBundle` is forbidden (v2.6 refactor).
5. **Chart built once at construction; fresh executor per run** — `getSpec()` reference-stable;
   one Agent instance per concurrent request.
6. **Raw provider errors must propagate untouched** — reliability `classifyError` reads `error.status`/message.
7. **Recorder attach is idempotent by ID** (footprintjs) — well-known IDs let consumers override built-ins.
8. **`runId` per run** — recorders detect new runs via `runId` change (but BoundaryRecorder/RunStep
   deliberately ignore the *dispatcher* runId — they reset on FlowRecorder run boundaries to avoid
   false resets during nested composition).
9. **Capture-time tagging** — producers self-describe (`isAgentInternal/slotKind/actorArrow`);
   consumers dispatch on tags, not name-parsing.
10. **`loopTo` target choice is semantic** — classic loops to `sf-injection-engine` (every iteration
    re-evaluates triggers); the dynamic chart loops to `sf-llm-call`. Wrong target silently breaks Dynamic ReAct.

---

## 14. Known gaps / latent issues (verified during this study)

- **Memory read output is not injected into the LLM** — `memoryInjection_*` written but never merged
  into `scope.history`/request (no merge stage). Biggest functional gap. (§7)
- **Causal memory `decisions`/`toolCalls` written empty** — replay capability architecturally ready,
  not yet populated from the live FlowRecorder. `COMMITS` projection falls back to decisions.
- **Cache `recentHitRate` not written back** — CacheGate hit-rate rule can't auto-fire (v2.7).
- **`DECAY` strategy throws**; **`HYBRID`-episodic** uses only the first sub-strategy.
- **Bedrock streaming yields empty toolCalls** — tool-using Bedrock agents must use `complete()`.
- **MapReduce shard runners don't wire recorders** — LLM events inside shards don't reach the outer dispatcher.

### Scope↔Emit audit (verified 2026-05-30, 5-pillar workflow)

The §13 law ("scope = business logic / emit = Lens") was independently verified and **largely holds**
— BoundaryRecorder (Lens) has zero commitLog references; the backtrack tools read only the commitLog.
Five places where reality bends the rule (each is a backlog task):

1. **`context.evaluated` — IMPLEMENTED (2026-06-05).** Previously the aggregate trigger-firing
   metadata was a DEAD `injectionEvaluation` scope write that nothing read and that never even left
   the InjectionEngine subflow (the `outputMapper` only bubbled `activeInjections`). It is now a real
   **emit** — `agentfootprint.context.evaluated`, fired once per iteration from the InjectionEngine
   ([buildInjectionEngineSubflow.ts](../src/lib/injection-engine/buildInjectionEngineSubflow.ts)). It
   carries the active/skipped breakdown + skip reasons + trigger-kind counts — the "what was
   considered, what won, what was **skipped and why**" view that the per-injection `context.injected`
   events (survivors only) do NOT carry. It is the upstream counterpart to `context.slot_composed`.
   (Naming caveat retained: the firing is deterministic capture, not output-quality *scoring* — see
   §17; the event name follows the established `context.*` family.)
2. **Permission `gate_open` — RESOLVED ON REVIEW, not a gap.** `permission.check` fires
   **unconditionally** for every result including `gate_open` (`toolCalls.ts:176`), so the decision
   *is* on the audit stream. The separate `gate_opened`/`gate_closed` span-events are unused, but
   that's a reserved gate-span semantic, not a leak. No action.
3. **Reliability per-attempt visibility — RESOLVED (Task 2, 2026-05-30; Option A).**
   Intent-verification surfaced a knot the audit missed: `error.retried`/`error.recovered` are shaped
   for the **provider-decorator** model (`withRetry` has fixed `maxAttempts` + exponential `backoffMs`;
   `totalDurationMs` is a decorator notion), but the **rules-based loop has no fixed cap and no backoff**
   — so firing them from the loop forced misleading values. AND a deeper latent gap was found:
   `reliability.fail_fast` was emitted from 6 sites (1 loop + 5 gate-chart) via raw `$emit` but was
   **never registered** in the event registry and had **no EmitBridge**, so it never reached
   `agent.on(...)` at all (its tests read a raw harness array). Fix (the "correct for the library" path,
   no consumers yet so no back-compat constraint):
   - Established a proper typed **`reliability.*` domain** in the registry + payloads:
     `ReliabilityFailFastPayload`, `ReliabilityRetriedPayload {attempt, action, errorKind, errorMessage?,
     fromProvider, toProvider}`, `ReliabilityRecoveredPayload {attempt, recoveredVia, priorFailures,
     errorKind}` — shaped for what the rules loop actually knows.
   - Added a `reliabilityRecorder` EmitBridge (prefix `agentfootprint.reliability.`), auto-attached
     always-on in `Agent.createExecutor` (mirrors `costRecorder`), so the whole family is now consumable
     via `agent.on(...)`.
   - Converted ALL 6 `fail_fast` emits (loop + gate-chart) to compile-time-safe `typedEmit`, conforming
     the one outlier payload (`providerIdx` → `errorMessage`).
   - Wired the loop to fire `reliability.retried` (retry + retry-other, with from/to provider) and
     `reliability.recovered` (success/fallback after ≥1 failure). Recovery tracking is closure-local
     (never scope → not in commitLog). Pure telemetry.
   - **`error.*` + `fallback.triggered` deliberately left for the decorators** (their shapes fit
     withRetry/withFallback exactly). Provider decorators remain standalone, consumer-wired via
     `onRetry`/`onStateChange` — not a gap. 7 tests, tsc clean, full suite 2211 green.
   - **⚠ NEW BUG FOUND (deferred): live-path `retry-other` does not actually switch providers.**
     `executeWithReliability` calls `callFn` (= `singleProviderCall` in callLLM.ts) which closes over
     the agent's DEFAULT `deps.provider`; on `retry-other` it only bumps `providerIdx` (telemetry +
     breaker keying), never passing `providers[idx].provider` to the real call. So the `providers`
     failover list is **ignored** by the inline path — `retry-other` retries the *same* provider. (Only
     the dead `buildReliabilityGateChart` honored it.) Consequence for Task 2: `reliability.retried` is
     deliberately NOT emitted on the `retry-other` branch (emitting `toProvider: <next>` would be
     misleading telemetry); only `reliability.recovered(via:'retry-other')` fires. **Backlog task: fix
     real provider-switching in `executeWithReliability` (behavior change — own 7-test + 7-review), then
     add the `retry-other` emit.** The working failover today is the provider decorator `withFallback`.
4. **Redaction has three agentfootprint-layer gaps** (the footprintjs scope layer itself is solid —
   the old "EventLog-only" gap from `redaction-design.md` is **CLOSED**; `ScopeFacade` scrubs both
   channels before any recorder sees a value): (a) slot `rawContent` lives inside `InjectionRecord[]`
   under internal key names, so consumer `RedactionPolicy.keys` won't catch it unless they target
   undocumented internal keys; (b) `thinkingPatterns` is documented as "Phase 3" but the field
   **doesn't exist** and `redactThinkingBlocks()` is unwired — chain-of-thought PII is unprotected by
   default; (c) Agent/LLMCall expose **no `setRedactionPolicy`** surface — the footprintjs protection
   is unreachable from the agentfootprint public API.
5. **`reliabilityFail*` keys — RESOLVED (Task 1, 2026-05-30).** Were written via 5 unsafe
   `(scope as unknown as {...})` casts; now typed fields on `AgentState` (mirroring `policyHalt*`),
   written through `TypedScope`, and read back via `Pick<AgentState, …>` in `Agent.finalizeResult`.
   They legitimately live in scope as the business-logic courier across `$break` to `Agent.run`'s
   typed-error throw (telemetry still fires separately via the `reliability.fail_fast` emit). The
   change is pure compile-time hardening — behaviour byte-identical, full suite green. Follow-up
   nicety (out of scope): narrow the `policyHalt*` read in `finalizeResult` the same way.

---

## 15. Directory map (where to look)

```
src/
  core/
    RunnerBase.ts          lifecycle, enable.*, getUIGroup, auto-recorders
    Agent.ts               Agent class, createExecutor, resumeOnError, finalizeResult
    LLMCall.ts             single-call primitive (Client→sf-llm-call→loop)
    tools.ts               defineTool, Tool, ToolExecutionContext
    pause.ts               pauseHere/askHuman, RunnerPauseOutcome
    runCheckpoint.ts       AgentRunCheckpoint, RunCheckpointError
    outputSchema.ts / outputFallback.ts   structured output + 3-tier fallback
    translator.ts          GroupTranslator/GroupMetadata (Lens static contract)
    cost.ts                emitCostTick
    agent/
      buildAgentChart.ts          CLASSIC ReAct chart (call-llm = flat stage)
      buildDynamicAgentChart.ts   DYNAMIC chart (sf-llm-call subflow) — NEW, unwired
      AgentBuilder.ts             fluent DSL (.system/.tool/.memory/.skill/.reliability/…)
      buildToolRegistry.ts        static + read_skill + autoActivate dispatch map
      stages/                     seed, callLLM (emits iteration_start), route, toolCalls, prepare/breakFinal, reliabilityExecution
    slots/                 buildSystemPromptSlot/MessagesSlot/ToolsSlot/ThinkingSubflow, helpers
  core-flow/               Sequence, Parallel, Conditional, Loop (+ README = 9 decisions)
  patterns/                SelfConsistency, Reflection, Debate, MapReduce, ToT, Swarm
  lib/injection-engine/    Injection types, evaluator, buildInjectionEngineSubflow, factories/, SkillRegistry, skillTools
  memory/                  define(.types), pipeline/, causal/, store/, identity/, wire/mountMemoryPipeline
  adapters/                types.ts (LLMProvider port), llm/* providers, memory/* stores, observability/*
  thinking/                ThinkingHandler, registry, per-provider handlers
  cache/                   types, CacheDecisionSubflow, CacheGateDecider, strategyRegistry, strategies/
  reliability/             types, classifyError, CircuitBreaker (pure), buildReliabilityGateChart
  resilience/              withRetry, withFallback, withCircuitBreaker, fallbackProvider
  security/                PermissionChecker/Policy, PolicyHaltError, extractSequence
  recorders/
    core/                  typedEmit, EmitBridge, ErrorBridge, ContextRecorder, per-domain bridges
    observability/         BoundaryRecorder, FlowchartRecorder(buildStepGraph), RunStepRecorder, LiveStateRecorder
  events/                  registry (EVENT_NAMES, ALL_EVENT_TYPES), payloads (59 shapes), dispatcher, types(EventMeta)
  bridge/                  eventMeta (RunContext, buildEventMeta)
  observe.ts stream.ts status.ts   public observability surfaces
  llm-providers.ts memory-providers.ts observability-providers.ts   subpath barrels
```

**Subpath exports** (from `package.json`): `agentfootprint` (main), `/memory`, `/providers` (legacy
alias of `/llm-providers`), `/llm-providers`, `/memory-providers`, `/observability-providers`,
`/observe`, `/resilience`, `/stream`, `/injection-engine`, `/memory-redis`, `/memory-agentcore`,
`/tool-providers`, `/security`, `/reliability`, `/thinking`, `/locales`, `/status`.

---

## 16. Reading order for a newcomer (or future me)

1. `src/core/runner.ts` + `RunnerBase.ts` — the contract everything implements.
2. `src/core/LLMCall.ts` — the simplest real chart.
3. `src/lib/injection-engine/` — the conceptual heart (Injection + 5 axes).
4. `src/core/agent/buildAgentChart.ts` — the ReAct chart that ties slots + cache + call + route together.
5. `src/recorders/observability/BoundaryRecorder.ts` + `FlowchartRecorder.ts` — how a run becomes a StepGraph.
6. Then breadth: memory → providers → compositions/patterns → cache/reliability.

---

## 17. Determinism & "evaluation" — terminology lock (LOAD-BEARING)

Two words that get conflated; keep them strictly separate.

**Deterministic behavior = CAPTURED, never "evaluated."** Everything the agent *does* — which
injection triggers fire, which branch Route takes, which tool runs, what context lands in the 3
slots — is **deterministic**: predicate-based, designed up front, same inputs → same outcome. There
is no scoring or judgment involved to know what happened. It is simply **captured**: live via the
**emit** channel (what the developer monitors in Lens) and replayable via **scope/commitLog**
(backtrack). You never need to "evaluate" what the agent did to know what it did — that's the
footprintjs promise. ⇒ A "which triggers fired" signal is deterministic *observability*. It now
ships as the emit `agentfootprint.context.evaluated` (2026-06-05), following the `context.*` family —
where "evaluate" reads as *"ran the trigger predicates"*, NOT output scoring. Per this terminology
lock the word still leans toward scoring, so a stricter name (`context.captured` /
`context.triggers_fired`) is a live rename candidate — see the stage-naming audit. Either way it is
**capture, not §17 evaluation**; reserve "evaluation"/`eval.*` for output scoring below.

**Evaluation = SCORING the output (the only true use of the word).** Judging the LLM's *output*
quality — correct? faithful? hallucinated? a 0–1 score — is a real *evaluation*: a math/judgment
operation over **non-deterministic** model output. This is **optional and separate**, the only place
"evaluation" belongs. Deferred design (the user's framing):
- **Runtime:** attach an **evaluation subflow** on demand — an LLM-judge or rule set scores the answer
  and emits `eval.*`. Off by default, zero cost when not attached.
- **Offline:** score **over collected data later** — causal-memory snapshots already hold each run's
  question + answer + decisions, so a batch pass can score them after the fact (→ training/eval data).

| | Trigger firing / context resolution | Response evaluation |
|---|---|---|
| Nature | deterministic (predicate) | judgment over non-deterministic output |
| Mechanism | captured | scored (LLM-judge / rules) |
| Channel | emit (Lens) + scope (backtrack) | `eval.*`, optional |
| Is it "evaluation"? | **No** — it's capture | **Yes** — the only true evaluation |
```
```
