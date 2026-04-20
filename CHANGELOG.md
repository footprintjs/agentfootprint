# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.17.4]

### Documentation

- **New `docs/guides/patterns.md`** covering both loop patterns
  (`AgentPattern.Regular` vs `Dynamic`) and the four composition pattern
  factories (`planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`)
  that ship from `agentfootprint/patterns` but were previously
  undocumented. Each pattern section includes an everyday analogy, the
  canonical research citation (Yao et al. 2023, Shinn et al. 2023, Wang
  et al. 2023, Madaan et al. 2023, Dean & Ghemawat 2004), an
  "honesty box" naming the simplification (e.g. shipped `reflexion`
  factory is closer to Self-Refine than full Reflexion), per-pattern
  observability + failure-mode notes, and a
  "Picking a quality pattern" decision table.
- **`docs/guides/concepts.md` updated to reflect the seven shipped
  concepts** (was documenting five — `Parallel` and `Conditional` were
  missing). Added builder + runner sections for both, plus
  per-concept analogies, ReAct/RAG/Swarm citations, and failure-mode
  notes for every concept.
- **`docs/guides/recorders.md` adds the missing `ExplainRecorder`
  section** — the per-iteration grounding evidence recorder that the
  README pitches as the differentiator. Also adds the LLM-as-judge
  caveat (Zheng et al. 2023) on `QualityRecorder`, the recorder-id
  idempotency rule, and updates the summary table with `ExplainRecorder`,
  `PermissionRecorder`, and `agentObservability()`.
- **All other guides (`quick-start`, `providers`, `adapters`,
  `orchestration`, `security`, `instructions`, `streaming`) reviewed
  through a four-persona lens** (student / professor / senior engineer
  / researcher) and updated with: opening analogies, prior-art
  citations where applicable, "Failure modes" / "Cost note" /
  "What's novel" subsections at production-relevant spots, and honest
  positioning language separating shipped behavior from prior art.
- Quick-start example tool replaced (deterministic `add` instead of a
  fake `web_search` returning a hallucinated answer); a new
  "Before You Ship" production checklist links the security /
  orchestration / observability primitives readers should add before
  deploying with a real provider.
- No source code changes — documentation-only release.

## [1.17.3]

### Fixed

- **`agentfootprint.stream.llm_end` now forwards token usage and stop
  reason.** The typed `AgentStreamEvent` schema carried
  `{iteration, toolCallCount, content, model, latencyMs}` but omitted
  `usage` and `stopReason` — so stream consumers (Lens, cost meters,
  any dashboard subscribing to the stream) got `0→0` tokens and no
  finish reason, even though the same data was already present on the
  sibling `agentfootprint.llm.response` event. Three emit sites
  (`callLLMStage.ts` + both paths in `streamingCallLLMStage.ts`) now
  include `usage: response.usage` and
  `stopReason: response.finishReason`. Schema additions are optional
  fields → backwards-compatible for consumers that ignore them.

## [1.17.2]

### Fixed

- **InstructionsToLLM subflow was concatenating arrays across Dynamic
  ReAct iterations.** `buildAgentLoop` mounted `sf-instructions-to-llm`
  without `arrayMerge: ArrayMergeMode.Replace`, so each loop iteration
  appended its `promptInjections` / `toolInjections` to the parent
  scope — the effective system prompt grew 7→14→21→28 lines, and the
  tool list doubled on every turn, triggering Anthropic's
  `"tools: Tool names must be unique"` rejection on iter 4+. Matches the
  existing Replace flag on `sf-messages` / `sf-tools`.
- **`.skills(registry)` did not register per-skill tools for dispatch.**
  Skill tools were declared to the LLM via `AgentInstruction.tools`
  injections, but the dispatch registry only had `list_skills` +
  `read_skill`. When an LLM called a skill-gated tool,
  `staticTools.execute()` returned `{error: true, content: "Unknown
  tool: ..."}` and the turn wedged. `.skills()` now iterates each
  skill's `tools: []` and registers them into the agent's `ToolRegistry`
  so dispatch is always reachable.
- **ToolProvider dispatch now falls back to the registry on "Unknown
  tool" errors.** Callers who use a narrow resolve-time provider
  (`staticTools([listSkills, readSkill])` + injection-based visibility)
  need dispatch to reach the registered skill tools. Both the
  sequential and parallel dispatch paths in `lib/call/helpers.ts` now
  check: if the primary provider reports the tool as unknown AND the
  registry has it, fall through to the registry handler.
- **Decision scope now persists across `.run()` calls.** Previously
  `scope.decision = { ...initialDecision }` reset the decision on every
  turn, so follow-up messages would silently lose the `currentSkill`
  written by the prior turn's `read_skill` — causing `autoActivate` to
  stop surfacing the skill's tools on iter 1 of turn 2+. The runner now
  captures `state.decision` after each run and re-seeds from it next
  time. Cleared by `resetConversation()` for clean new dialogues.
  Unblocks multi-turn chat where the skill context should feel
  continuous.
- **`buildToolsSubflow` now defensively dedupes on three axes.** Base
  tools vs. base tools (in case the provider returned duplicates),
  base vs. injections (pre-existing check), and within injections
  themselves. First-wins on every axis. Belt-and-braces safety net
  against the Anthropic "tool names must be unique" rejection even if
  a future bug reintroduces an injection collision.
- Added 2 new tests to `test/lib/slots/tools.test.ts` pinning the dedup
  behaviors — 15/15 slot tests pass, 1874/1874 full suite still green.

## [1.17.1]

### Fixed

- `SkillRegistry.toTools()` aliased `this` via `const registry = this` which
  tripped the `@typescript-eslint/no-this-alias` rule post-release CI.
  Replaced with explicit `.bind(this)` method captures + a direct reference
  to `this.options.autoActivate` — cleaner closure pattern, no behavioral
  change, 1872/1872 tests still pass.

## [1.17.0]

### Added

- **`SkillRegistry.autoActivate`** — one-line skill-gated tool visibility
  (`agentfootprint/skills`). Unlocks the 25+-tool regime without
  customers hand-wiring a ~30-LOC bridge for every adopter.

  When configured, the auto-generated `read_skill(id)` tool writes the
  loaded skill's id into agent decision scope. Downstream
  `AgentInstruction.activeWhen: (d) => d[stateField] === 'my-skill'`
  predicates fire naturally — so each skill's `tools: [...]` only reach
  the LLM when that skill is active. Smaller tool menus per turn, no
  token-budget drift on long tool lists.

  ```ts
  const registry = new SkillRegistry<TriageDecision>({
    surfaceMode: 'auto',
    autoActivate: { stateField: 'currentSkill' },
  });
  ```

  - `SkillRegistryOptions.autoActivate?: AutoActivateOptions` — new
    config shape: `{ stateField: string, onUnknownSkill?: 'leave'|'clear' }`
  - `read_skill` now returns `{ content, decisionUpdate: { [stateField]: id } }`
    when configured; decisionUpdate is merged into agent decision scope
    by the tool-execution stage.
  - `toInstructions()` auto-fills `activeWhen: (d) => d[stateField] === skill.id`
    on any skill that doesn't declare its own — so consumers set
    `autoActivate` once and every skill gates its own tools by id.
  - `AgentBuilder.skills(registry)` auto-switches agent pattern to
    `Dynamic` when registry has autoActivate, because Regular pattern
    assembles instructions once per turn and wouldn't re-materialize
    tools on the next iteration. Explicit `.pattern(AgentPattern.Regular)`
    after `.skills()` overrides.
  - `SkillRegistry.hasAutoActivate` / `.autoActivate` getters for
    consumers writing custom builders.

- **`ToolResult.decisionUpdate` + `ToolExecutionResult.decisionUpdate`**
  — new optional field any tool (not just auto-generated skill tools)
  can use to write a partial update into the agent's decision scope.
  The tool-execution stage applies shallow `Object.assign(decision, update)`
  after the tool runs. Built-in ToolProviders (`staticTools`,
  `gatedTools`, `compositeTools`, `agentAsTool`) pass it through from
  the inner handler.

### Changed

- Tool-execution subflow: `decisionRef` is now always allocated as `{}`
  when the inbound decision scope is undefined (previously tri-state).
  Simpler invariant + fixes a latent bug where the first turn's
  decision writes from any tool (decide() or decisionUpdate) could be
  dropped if no initial decision scope was configured.

### Tests

- 13 new 5-pattern tests for `autoActivate` (unit / boundary / scenario
  / property / security). Library total: **1872 tests passing**
  (was 1859).

## [1.16.0]

### Added

- **Skills** (`agentfootprint/skills`) — typed, versioned agent skills
  with cross-provider correct delivery. The Claude Agent SDK pattern,
  packaged at `agentfootprint`'s framework layer.
  - `defineSkill<TDecision>(skill)` factory — typed, inference-friendly.
  - `SkillRegistry<TDecision>` — compile skills into `AgentInstruction[]`
    + auto-generated `list_skills` / `read_skill` tools + optional
    system-prompt fragment.
  - `Skill extends AgentInstruction` — every `activeWhen` / `prompt` /
    `tools` / `onToolResult` field inherited, skills add `id`,
    `version`, `title`, `description`, optional `scope[]`, `steps[]`,
    and `body` (string or async loader for disk/blob/Notion).
  - Four surface modes: `'tool-only'` (portable default, works on every
    provider), `'system-prompt'`, `'both'`, `'auto'` (library picks per
    provider — Claude ≥ 3.5 → `'both'`, everyone else → `'tool-only'`).
  - `AgentBuilder.skills(registry)` — one-line wiring. Idempotent
    replace (call twice, latest wins).
  - Tag-escape defense in rendered skill bodies: `</memory>`,
    `</tool_use>`, `</skill>` escaped in author-controlled fields.
  - Error paths (unknown id, lazy-loader throws, path-traversal
    attempts) return `isError: true` in the tool result — agent
    recovers, no crash.
  - Full documentation: `/guides/skills`.
  - `ToolRegistry.unregister(id)` — small focused API for builder-layer
    idempotent replace flows.

### Tests

- 41 new tests across 2 files (32 unit + 9 acceptance).
- Library total: 1859 tests passing.

## [1.15.0]

### Added

- **`autoPipeline()`** — the opinionated default memory preset
  (`agentfootprint/memory`). Composes facts (dedup-on-key) + beats
  (append-only narrative) on a single store, emitting ONE combined
  system message on read.
  - Zero-LLM-cost defaults (`patternFactExtractor` + `heuristicExtractor`).
  - Single `provider` config knob upgrades BOTH extractors to
    LLM-backed in one line.
  - Explicit `factExtractor` / `beatExtractor` escape hatches for
    mixed-quality configurations.
  - READ subflow: `LoadAll` (one `store.list`, split by payload shape
    via `isFactId` + `isNarrativeBeat`) → `FormatAuto` (facts block +
    narrative paragraph in one system msg).
  - WRITE subflow: `LoadFacts` (update-awareness) → `ExtractFacts` →
    `WriteFacts` → `ExtractBeats` → `WriteBeats`.
  - `AutoPipelineState` extends both `FactPipelineState` +
    `ExtractBeatsState` for typed scope.
  - Full documentation: `/guides/auto-memory`.

### Tests

- 16 new tests across 2 files (5-pattern coverage + acceptance).
- Library total: 1818 tests passing.

## [1.14.0]

### Added

- **Fact extraction** (`agentfootprint/memory`). Stable key/value
  fact memory with dedup-on-write — "what's currently true" as a
  complement to beats ("what happened").
  - `Fact<V>` type with `key` / `value` / optional `confidence` /
    `category` / `refs[]` (source-message provenance, like beats).
  - `factId(key)` helper → stable `fact:${key}` MemoryStore ids.
    Last-write-wins: the same key written twice REPLACES the prior
    entry (unlike beats/messages which are append-only).
  - `FactExtractor` interface + two implementations:
    - `patternFactExtractor()` — zero-dep regex heuristics for
      identity / contact / location / preference. Free.
    - `llmFactExtractor({ provider })` — LLM-backed extraction with
      `existing`-facts prompt injection so the model can update
      rather than duplicate. One call per turn. Malformed JSON falls
      back to `[]` with `onParseError` callback.
  - Stages: `extractFacts`, `writeFacts`, `loadFacts`, `formatFacts`.
    `formatFacts` renders a compact `Known facts:` key/value block
    (not `<memory>` tags, not a paragraph) — the shape LLMs parse
    most efficiently.
  - `factPipeline({ store, extractor? })` preset. Read subflow:
    LoadFacts → FormatFacts. Write subflow: LoadFacts → ExtractFacts
    → WriteFacts (LoadFacts-on-write surfaces existing facts to the
    extractor for update-awareness).
  - Full documentation: `/guides/fact-extraction`.

### Tests

- 104 new tests across 6 files (5-pattern coverage per layer).
- Library total: 1802 tests passing.

## [1.13.0]

### Added

- **Semantic retrieval** (`agentfootprint/memory`). Vector-based
  recall via cosine similarity over entry embeddings.
  - `Embedder` interface with `embed()` / optional `embedBatch()` —
    pluggable (OpenAI / Voyage / Cohere / custom). Ships
    `mockEmbedder()` (deterministic character-frequency hash) for tests.
  - `MemoryEntry.embedding?` + `embeddingModel?` fields for indexing.
  - `MemoryStore.search?(identity, query, options)` optional method;
    `InMemoryStore` implements O(n) cosine scan. Options: `k`,
    `minScore`, `tiers`, `embedderId` (cross-model safety).
  - `cosineSimilarity(a, b)` helper; length-mismatch throws,
    zero-magnitude returns 0 (never NaN).
  - Stages: `embedMessages` (write-side) + `loadRelevant` (read-side,
    pulls query from last user message by default).
  - `semanticPipeline({ store, embedder, embedderId? })` preset —
    drop-in replacement for `defaultPipeline` with vector recall.
  - Write-side: `writeMessages` attaches per-message embeddings
    from `scope.newMessageEmbeddings` when present.
  - Read-side: `mountMemoryRead` passes `scope.messages` into the
    subflow so `loadRelevant` derives the query from the user turn.
  - 85 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/semantic-retrieval` docs.

### Changed

- `test/lib/concepts/Agent.parallelTools.test.ts` — perf threshold
  relaxed from 2× to 2.5×DELAY to tolerate dev-machine jitter while
  still discriminating parallel (≤2.5×) from sequential (3×).

## [1.12.0] — BREAKING

### Added

- **Narrative memory** (`agentfootprint/memory`). A new memory strategy
  that compresses each turn into `NarrativeBeat`s on write and recalls
  them as a single cohesive paragraph on read — instead of storing
  raw messages.
  - `NarrativeBeat` type: `{ summary, importance, refs, category? }`
    — every beat carries `refs[]` traceable back to source messages
    for explainability / audit.
  - `BeatExtractor` interface with two built-in implementations:
    - `heuristicExtractor()` — zero-dep, zero-cost baseline.
    - `llmExtractor({ provider, systemPrompt?, onParseError? })` —
      one LLM call per turn, produces semantically rich beats. Robust
      JSON parsing; malformed responses skipped without crashing turns.
  - `extractBeats(config)` + `writeBeats(config)` write-side stages.
  - `formatAsNarrative(config)` read-side stage — composes selected
    beats into a single paragraph (vs `formatDefault`'s per-entry blocks).
  - `narrativePipeline({ store, extractor?, ... })` preset — drop-in
    replacement for `defaultPipeline` with beat-based memory.
  - **Differentiator**: no other open-source agent framework provides
    beat-level traceability for recalled memory.
  - 77 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/narrative-memory` docs.

### Removed (hard break — pre-GA, no deprecation cycle)

- **`Agent.memory(config: MemoryConfig)`** builder method.
  Superseded by `.memoryPipeline(pipeline)` which landed in 1.11.0.
- **`MemoryConfig` / `ConversationStore`** interfaces and the legacy
  `InMemoryStore` adapter from `src/adapters/memory/`. The canonical
  store interface is now `MemoryStore` in `agentfootprint/memory`.
- **`createCommitMemoryStage` / `CommitMemoryConfig`** —
  `CommitMemory` stage retired; the memory pipeline's write subflow
  lives inside the `final` branch subflow and is composed via
  `mountMemoryWrite`.
- **`createPrepareMemorySubflow` / `PrepareMemoryConfig`** —
  absorbed into the memory pipeline's read subflow.
- **`persistentHistory()` message strategy + its bundled `InMemoryStore`** —
  message strategies now focus on in-context reshaping (sliding
  window, char budget, summary). Durable persistence lives in the
  memory pipeline.
- **`MessagesSlotConfig.store` / `.conversationId`** fields — the
  Messages slot is now strategy-only. Durable persistence is owned by
  the memory pipeline.
- **`AgentLoopConfig.commitMemory` / `.useCommitFlag` / `.onStreamEvent`**.
  Memory wiring flows via `memoryPipeline`. Stream events route
  through the emit channel — attach an onEvent callback via
  `agent.run(msg, { onEvent })`.
- **`memory_storedHistory` scope field + `MEMORY_PATHS.STORED_HISTORY`** —
  dead after `CommitMemory` removal.
- **Legacy store adapters** `redisStore`, `dynamoStore`, `postgresStore`
  — real backends land in Phase 3 against the new `MemoryStore` interface.

### Changed

- **Conditional concept** (`Agent.route()` extensions) now mounts
  branches as subflows when the runner exposes `toFlowChart()`,
  matching the `FlowChart.ts` / `Swarm` patterns. UI consumers get
  drill-down into routed-to agents for free.
- **Stream events now flow through the emit channel.**
  `agentfootprint.stream.llm_start` / `llm_end` / `token` / `thinking`
  / `tool_start` / `tool_end` events are emitted with the full
  `AgentStreamEvent` as the payload. `AgentRunner` attaches a
  `StreamEventRecorder` (public API in `agentfootprint/stream`) that
  forwards emits to the consumer's `{ onEvent }` callback — zero
  closure capture of handlers inside stage code.
- **Agent chart is now CACHED** — built once per agent, reused across
  all `.run()` and `.toFlowChart()` calls. Per-run data (stream handler,
  memory identity, seed messages) flows via args / attached recorders.
- **`pickByBudget`** restructured as a proper decider stage with three
  branches (`skip-empty`, `skip-no-budget`, `pick`) — decision evidence
  now lands on `FlowRecorder.onDecision` with structured `rules[]`.
- **`MemoryStore.putMany`** added for batched writes. `writeMessages`
  now persists a turn's messages in one round-trip instead of N.
- **`RouteResponse` decider** uses the filter-form `decide()` DSL with
  structured evidence (`{ key: 'hasToolCalls', op: 'eq', threshold: true, … }`).
  `ParseResponse` lifts `parsedResponse.hasToolCalls` to the flat
  `scope.hasToolCalls` so the filter form can reach it.
- **`buildSwarmRouting` + `Conditional`** deciders return full
  `DecisionResult` objects so `FlowRecorder.onDecision` captures
  evidence (no more silent `.branch`-only returns).

### Migration

Replace:

```ts
const store = new InMemoryStore();
const agent = Agent.create({ provider })
  .memory({ store, conversationId: 'user-123' })
  .build();
```

With:

```ts
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';

const pipeline = defaultPipeline({ store: new InMemoryStore() });
const agent = Agent.create({ provider })
  .memoryPipeline(pipeline)
  .build();

await agent.run(message, {
  identity: { conversationId: 'user-123' },
});
```



## [1.11.0]

### Added

- **`agentfootprint/memory` subpath — full memory pipeline system.** Built bottom-up in 9 reviewed layers, 190 tests, composing into a flowchart-first architecture consistent with the rest of the library.
  - **Identity + entries** — `MemoryIdentity { tenant?, principal?, conversationId }`, `MemoryEntry<T>` with decay/tier/source/version, pure `computeDecayFactor()` with exponential time decay + access boost.
  - **`MemoryStore` interface** — 9-method CRUD boundary with pagination cursor, `putIfVersion` optimistic concurrency, `seen()` recognition, `feedback()` usefulness aggregation, `forget()` GDPR delete. `InMemoryStore` reference implementation (zero deps, TTL-aware, tenant-isolated).
  - **Reusable stages** — `loadRecent`, `writeMessages`, `pickByBudget` (decider — budget-aware selection with `decide()` evidence), `formatDefault` (source-cited `<memory>` blocks + prompt-injection escape), `summarize` (deterministic contract for prompt caching).
  - **Pipeline presets** — `defaultPipeline()` (load → pick → format for read; persist for write), `ephemeralPipeline()` (read-only, compliance-grade no-write guarantee).
  - **Wire helpers** — `mountMemoryRead`, `mountMemoryWrite`, `mountMemoryPipeline` for composing pipelines into custom flowcharts.
- **`Agent.memoryPipeline(pipeline)` builder method** — first-class integration wiring the pipeline's read subflow before `AssemblePrompt` and write subflow after `Finalize`. Prior-turn memory is injected as citation-tagged `system` messages that AssemblePrompt prepends to the LLM prompt.
- **Per-run identity via `agent.run(msg, { identity, turnNumber?, contextTokensRemaining? })`** — same agent instance can serve many tenants / sessions with hardware-enforced isolation. Identity defaults to `{ conversationId: 'default' }` when omitted.
- **Example** `examples/memory/30-remember-across-turns.ts` — Alice/Bob session isolation demo using `mock` adapter.
- **5 integration tests** in `test/integration/memoryPipeline.test.ts` covering turn-1 persistence, turn-2 retrieval, per-run identity scoping, tenant isolation, and `.memory()` vs `.memoryPipeline()` mutual exclusivity.

### Process

- Every one of the 9 layers cleared an 8-person review gate (performance, DS/algorithms, security, research/RAG, platform, Anthropic, abstract/modular, 5-pattern tests) — iterating until no actionable findings remained. All 7 industry + 3 research reviewer asks from the design phase landed (hierarchical identity, pagination, `putIfVersion`, source-tagged recall, budget-aware picker, `seen()` + `feedback()`, decay math, ephemeral mode, deterministic summarizer, prompt-injection escape in formatter).

### Compatibility

- Existing `Agent.memory(MemoryConfig)` legacy API is unchanged. New consumers should prefer `.memoryPipeline()`. The two cannot be combined on the same builder — builder throws if both are set.
- Internals: `AgentLoopConfig` gains optional `memoryPipeline?: MemoryPipeline` alongside the existing `commitMemory?`. Legacy `commitMemory` path takes precedence when both somehow reach the loop (guards exist at the builder level).

## [1.10.0]

### Added

- **`exportTrace(runner, { redact?: boolean })`** — capture an agent run's full state as a portable JSON trace for external sharing. Bundles `snapshot`, `narrativeEntries`, `narrative`, and `spec` into a `AgentfootprintTrace` shape with `schemaVersion: 1`. Default `redact: true` requests `getSnapshot({ redact: true })` from the runner so footprintjs's [4.14.0 redacted-mirror](https://github.com/footprintjs/footPrint/blob/main/docs/internals/adr-002-redacted-mirror.md) feature scrubs `sharedState`. Use this to ship traces to a viewer, support engineer, or audit log without leaking PII.
- **`AgentfootprintTrace` + `ExportTraceOptions` types** exported from the main entry. Pin consumers to `schemaVersion: 1`; future shape changes will bump the version.
- **Example** `examples/observability/29-export-trace.ts` — captures and prints a trace using the `mock` adapter.
- **10 new tests** (5 patterns) covering schema version, snapshot pass-through, missing-method graceful degradation, JSON round-trip, and the safe-by-default `redact: true` choice.

### Changed

- **`footprintjs` peer dep + devDep bumped to `^4.14.0`** — required for the redacted-mirror `getSnapshot({ redact })` API. `exportTrace` falls back to a 0-arg `getSnapshot()` if the runner predates 4.14, so older deployments still produce a (raw) trace.

## [1.9.0]

### Added

- **`agentfootprint/patterns` — canonical composition patterns as thin factories.** Each pattern composes existing concepts (FlowChart / Parallel / Conditional / Agent / LLMCall) and returns a standard Runner — no new primitives, no new classes. Source files are short and teach the composition pattern.
  - `planExecute({ planner, executor })` — sequential planning → execution (FlowChart of 2).
  - `mapReduce({ provider, mappers, reduce })` — N pre-bound mappers fanned out, then reduced via LLM or pure fn (Parallel with named merge).
  - `treeOfThoughts({ provider, branches, thinker, judge })` — N parallel thinkers, judge picks the best (FlowChart of Parallel → judge).
  - `reflexion({ solver, critic, improver })` — single-pass Solve → Critique → Improve (FlowChart of 3). Multi-iteration variants compose with `Conditional`.
- **Example**: `examples/orchestration/28-patterns.ts` — all four patterns + a composed `Conditional` routing between them, all using the `mock` adapter.
- **10 new tests** covering wiring, input propagation, argument validation, and patterns-inside-patterns composition.

## [1.8.0]

### Added

- **`Conditional` concept — the DAG branch primitive.** Thin wrapper over footprintjs `addDeciderFunction` + `addFunctionBranch` that routes between runners based on synchronous predicates. First-match-wins; failing predicate fail-opens to the next branch; `.otherwise(runner)` is required. Exposes the same Runner surface as other concepts (`run`, `getNarrative`, `getSnapshot`, `getSpec`, `toFlowChart`) and composes inside `FlowChart` / `Parallel` / `Agent.route()` / another `Conditional`.
  ```ts
  const triage = Conditional.create({ name: 'triage' })
    .when((input) => /refund/i.test(input), refundAgent, { id: 'refund' })
    .when((input) => input.length > 500, ragRunner)
    .otherwise(generalAgent)
    .build();

  await triage.run('I want a refund');
  // narrative: "[triage] Chose refund — predicate 0 matched"
  ```
  Completes the DAG primitive set: **leaf** (LLMCall/RAG), **cycle** (Agent), **sequence** (FlowChart), **fan-out** (Parallel), **branch** (Conditional), **dispatch** (Swarm). Users can now build any composition from existing concepts without dropping to raw footprintjs.
- **Guards on `Conditional.when()`** — rejects non-function predicates, non-runner values, reserved `'default'` id, branch IDs with `/` or whitespace (would break `runtimeStageId`), and duplicate IDs. Fail-open on throwing predicates (never blocks a valid branch). Frozen state snapshot passed to predicate — mutation attempts silently no-op.
- **Example**: `examples/orchestration/27-conditional-triage.ts` — deterministic triage demo using the `mock` adapter.
- **25 new tests** across 5 patterns (unit/boundary/scenario/property/security), including real Agent composition and nested Conditionals.

## [1.7.1]

### Fixed

- **CI + npm publish** — `devDependencies.footprintjs` was pinned to `file:../footPrint`, which doesn't resolve in CI. Switched to `^4.13.0` so CI installs from the registry. `footprintjs` is also now declared as a `peerDependency` (`>=4.13.0`) to make the install-time contract explicit. This is why v1.7.0 failed to publish.

## [1.7.0]

### Added

- **Emit-channel LLM diagnostics.** `CallLLM` stage (both streaming and non-streaming) now fires `scope.$emit('agentfootprint.llm.request', {...})` before the provider call and `scope.$emit('agentfootprint.llm.response', {...})` after, surfacing the exact shape being sent/received. Payloads include iteration, message roles, tool names + required fields, usage, stop reason, and tool-call signatures.
- **`agentRenderer.renderEmit`** — custom narrative rendering for `agentfootprint.llm.request`/`response` events. Output like `LLM request (iter 2): 5 msgs [system,user,assistant,tool,tool], 4 tools — calculator required:[expression]` appears inline under each `CallLLM` stage in combined narratives.
- **`AgentBuilder.maxIdenticalFailures(n)`** — threshold for repeated-identical-failure escalation. When a tool call with the exact same `(name, args)` has failed `n` times in a row, a one-shot `escalation` field is injected into that tool result content urging the LLM to change arguments, switch tools, or finalize. Fires exactly once per `(name, args)` key per conversation. Defaults to `3`. Pass `0` to disable. Uses strict JSON parsing (not substring sniffing) so legitimate prose containing `"error":true` is not misclassified; stable key-sorted stringify so equivalent arg objects match regardless of insertion order.
- **`scope.maxIterationsReached` signal** — when the agent loop hits `maxIterations`, the structural guard now sets this flag AND force-routes to the default branch. Any terminal stage (default `Finalize`, `Swarm.RouteSpecialist` fallback, user-supplied terminals) can detect forced termination and synthesize an appropriate final message. Finalize now emits a user-facing fallback when the flag is set.
- **Tool-call signatures in narrative.** `ParseResponse` now renders `responseType` as `tool_calls: [calculator({"expression":"4+5"}), web_search({"query":"weather"})]` — names plus JSON-stringified args (tight cap) so debuggers see at a glance whether the LLM passed required fields. Names alone hid the common failure mode of retrying with empty / wrong args.

### Fixed

- **Anthropic streaming adapters dropped tool arguments.** `BrowserAnthropicAdapter.chatStream()` and `AnthropicAdapter.chatStream()` yielded `tool_call` chunks with `arguments: {}` at `content_block_start`, then accumulated `input_json_delta` chunks into a buffer that was never consumed. The streaming stage pushed the empty-args version, causing LLMs to re-attempt calls with `{}` until `maxIterations` exhausted. Fixed by deferring the `tool_call` yield until args are complete — emit at `content_block_stop` with parsed JSON (browser) / after `stream.finalMessage()` (Node SDK). Combined with the new emit-channel diagnostics, this bug was diagnosable for the first time.

### Changed

- **Requires `footprintjs` >= 4.13.0** for emit-channel features. Install explicitly: `npm install footprintjs@^4.13.0 agentfootprint@^1.7.0`.

## [1.6.1]

### Fixed

- **CI + publish workflows** — `npm install` instead of `npm ci`, no npm cache (lockfile not committed due to platform-specific native deps). This is why v1.5.0 and v1.6.0 failed to publish to npm.
- **footprintjs devDep** bumped to `^4.12.2` (resume continuation fix).

## [1.6.0]

### Added

- **`examples/` directory** — 22 type-checked examples as single source of truth (was in separate agent-samples repo). 8 categories: basics, providers, orchestration, observability, security, resilience, memory, integration.
- **`test:examples` npm script** — type-checks all examples against library source.
- **Barrel exports** — `agentLoop`, `AgentLoopConfig`, `defineInstruction`, `AgentPattern`, `quickBind`, `AgentInstruction`, `InstructedToolDefinition`, `TokenRecorder`, `ToolUsageRecorder`, `TurnRecorder`, `CostRecorder` from main entry. `staticTools`, `noTools` from `/providers`. `ExplainRecorder` from `/observe`.
- **3 new examples** — agent-loop (low-level engine), instructions (conditional context injection), explain-recorder (grounding evidence).

### Changed

- **`ToolHandler` type** — `(input: any)` instead of `(input: Record<string, unknown>)`. Allows typed destructured params in tool handlers: `({ query }: { query: string }) =>`. Non-breaking.
- **`footprintjs` peer dep** — bumped to `>=4.12.0` (backtracking, quality trace, staged optimization).

### Fixed

- **4 pre-existing type errors** in examples (API drift from agent-samples): resilience callbacks, ToolDefinition.name→id, message strategy args, instruction type casts.

## [1.5.0] - 2026-04-09

### Added

- **`runtimeStageId`** — mandatory on `LLMCallEvent` and `ToolCallEvent`. The universal key linking recorder data to execution tree nodes and commit log entries. Format: `[subflowPath/]stageId#executionIndex`.
- **Map-based recorders** — `TokenRecorder`, `ToolUsageRecorder`, `CostRecorder` extend `KeyedRecorder<T>` from `footprintjs/trace`. O(1) lookup via `getByKey(runtimeStageId)`, `getMap()`. Zero fallback keys.
- **`EvalIteration.runtimeStageId`** — each iteration links to its execution step
- **`createLLMCaptureRecorder()`** — shared factory for run() and resume() LLM capture. Both paths now track `runtimeStageId` for stream bridge tool events.
- **`RecorderBridge.setToolRuntimeStageId()`** — encapsulated state tracking (was public mutable field)
- 5 new tests for runtimeStageId on all recorder types

### Changed

- **footprintjs >=4.7.0 required** — added to `dependencies` (was only in devDependencies)
- **`agentLoop.ts`** — uses `buildRuntimeStageId` + `createExecutionCounter` from `footprintjs/trace`
- **`LLMCallRunner` + `RAGRunner`** — use `findCommit` from `footprintjs/trace` (zero `(b: any)` casts)
- CLAUDE.md + AGENTS.md — documented `runtimeStageId`, `KeyedRecorder`, `getByKey()` pattern

### Removed

- All `__auto_` fallback keys — runtimeStageId is always provided
- Duplicate LLM capture code in resume() path — replaced by shared factory

## [1.4.2] - 2026-04-07

### Fixed

- **README rewrite** — Architecture moved to 3rd section, headers renamed to relatable terms (Conditional Behavior, Observability, Human-in-the-Loop), 4 broken import paths fixed, redundant sections folded, 380→280 lines
- **5 folder READMEs** — concepts, adapters, providers, memory, tools with relatable naming and code examples
- **recorders/README.md** — 5 categories, event→recorder mapping, design principles
- **What's Different section** — 10 unique features grouped by concern (Quality/Safety/UX/Debugging)

## [1.4.1] - 2026-04-07

### Fixed

- **`RecorderBridge.loopIteration`** — now increments after each `dispatchLLMCall` (was always 0)
- **Per-iteration context** — each LLM call gets its own context snapshot (was sharing last state for all)
- **`resume()` path** — captures context same as `run()` (was empty)
- **`ExplainRecorder`** — guards `iteration: -1` when `onTurnComplete` fires without `onLLMCall`
- **Format gate** — release script fails on unformatted files instead of silently fixing

### Added

- **5 folder READMEs** — concepts, adapters, providers, memory, tools — with relatable naming (Single LLM / Multi-Agent), code examples, and cross-references
- **Main README** — 5-layer architecture diagram (Build → Compose → Evaluate → Monitor → Infrastructure), updated Recorders section with 5 categories
- **recorders/README.md** — event → recorder mapping, design principles
- **5 tests** for `EvalIteration`, per-iteration context, flat/iteration consistency
- **Flattened `recorders/v2/`** → `recorders/` — removed unnecessary indirection

### Changed

- `CLAUDE.md` + `AGENTS.md` — updated directory tree descriptions

## [1.4.0] - 2026-04-07

### Added

- **`explain().iterations`** — per-iteration evaluation units with connected data. Each iteration captures context (what the LLM had), decisions (tools chosen), sources (results), and claim (LLM output). Evaluators walk iterations to check faithfulness, relevance, and hallucination.
- **`EvalIteration` type** — self-contained evaluation unit for each loop iteration

## [1.3.0] - 2026-04-07

### Added

- **`explain().context`** — ExplainRecorder captures evaluation context during traversal: input, systemPrompt, availableTools, messages, model
- **`LLMContext` type** — what the LLM had when making decisions
- **`LLMCallEvent.systemPrompt`/`toolDescriptions`/`messages`** — context fields on events (optional, backward-compatible)

## [1.2.0] - 2026-04-07

### Added

- **`obs.explain()`** — ExplainRecorder bundled into `agentObservability()` preset. Grounding analysis (sources vs claims) out of the box — the differentiator.
- **8-gate release script** — mirrors footprintjs: doc check, dup type check, build, tests, sample projects, CHANGELOG validation
- **`scripts/check-docs.sh`** — blocks release if docs reference removed APIs
- **`scripts/check-dup-types.mjs`** — blocks release if duplicate type definitions found across src/

### Fixed

- **ModelPricing duplicate** — CostRecorder now imports from `models/types` instead of redefining

## [1.1.0] - 2026-04-07

### Added

- **Message strategies in providers barrel** — `slidingWindow`, `charBudget`, `fullHistory`, `withToolPairSafety`, `summaryStrategy`, `compositeMessages`, `persistentHistory` now exported from `agentfootprint/providers`
- **Error utilities in resilience barrel** — `classifyStatusCode`, `wrapSDKError` now exported from `agentfootprint/resilience`

### Removed

- **`getGroundingSources`, `getLLMClaims`, `getFullLLMContext`** from `agentfootprint/explain` — post-processed narrative entries (anti-pattern). Use `ExplainRecorder` instead, which collects during traversal.
- **`slidingWindow`, `truncateToCharBudget`** from internal `memory/conversationHelpers` — dead code duplicating the public `MessageStrategy` API in `providers/messages/`

## [1.0.0] - 2026-04-06

### Added

- **Capability-based subpath exports** — 7 focused import paths, tree-shakeable:
  - `agentfootprint/providers` — LLM providers, adapters, prompt/tool strategies
  - `agentfootprint/instructions` — defineInstruction, AgentPattern, InstructionRecorder
  - `agentfootprint/observe` — all 9 recorders + agentObservability preset
  - `agentfootprint/resilience` — withRetry, withFallback, resilientProvider
  - `agentfootprint/security` — gatedTools, PermissionPolicy
  - `agentfootprint/explain` — grounding helpers, narrative renderer
  - `agentfootprint/stream` — AgentStreamEvent, SSEFormatter
- **Full backward compatibility** — `import { everything } from 'agentfootprint'` still works
- **`typesVersions`** in package.json for older TypeScript resolution

### Changed

- `index.ts` reorganized with comments pointing to capability subpaths
- PermissionRecorder canonical home is `agentfootprint/observe` (removed from security barrel)

## [0.6.2] - 2026-04-05

### Added

- **Instructions guide** — `docs/guides/instructions.md` (Decision Scope, 3-position injection, decide())
- **Streaming guide** — `docs/guides/streaming.md` (AgentStreamEvent, onEvent, SSE, event timeline)
- **Sample 17** — Instructions (defineInstruction, decide, conditional activation, tool injection)
- **Sample 18** — Streaming events (lifecycle, tool events, ordering, backward compat, SSE)
- **Module READMEs** — `src/lib/instructions/`, `src/streaming/`, `src/lib/narrative/`
- **CLAUDE.md + AGENTS.md** — Instructions, Streaming, Grounding sections + anti-patterns
- **README.md** — Instructions, Streaming, Grounding Analysis sections
- **JSDoc** — `@example` on `getGroundingSources()`, `getLLMClaims()`

## [0.6.1] - 2026-04-05

### Added

- **AgentStreamEvent** — 9-event discriminated union for real-time agent lifecycle
  - `turn_start`, `llm_start`, `thinking`, `token`, `llm_end`, `tool_start`, `tool_end`, `turn_end`, `error`
  - `onEvent` callback on `agent.run()` — full lifecycle visibility for CLI/web/mobile consumers
  - Works in both streaming and non-streaming mode (only `token` requires `.streaming(true)`)
  - `turn_end` emits `paused: true` on ask_human pause
- **Backward compat** — `onToken` still works (deprecated, sugar for `onEvent` token filter)
- **Collision guard** — `onEvent` + `onToken` together: `onToken` ignored + dev-mode warn
- **Error isolation** — `onEvent` handler errors swallowed (never crash agent pipeline)

### Fixed

- `streamingCallLLMStage` fallback path now passes `signal` for cancellation
- `tool_end.latencyMs` excludes instruction processing overhead

## [0.6.0] - 2026-04-05

### Added

- **Instruction Architecture** — `AgentInstruction`, `defineInstruction()`, `InstructionsToLLM` subflow
  - 3-position injection: system prompt, tools, tool-result recency window
  - `activeWhen(decision)` — state-driven conditional instruction activation
  - `decide()` field on `LLMInstruction` — tool results update Decision Scope
  - `AgentScopeKey` enum — type-safe scope key references
- **Agent builder API** — `.instruction()`, `.instructions()`, `.decision()`, `.verbose()`
- **Grounding helpers** — `getGroundingSources()`, `getLLMClaims()`, `getFullLLMContext()`
- **Verbose narrative** — `createAgentRenderer({ verbose: true })` shows full values
- **Dynamic ReAct + Instructions** — `AgentPattern.Dynamic` loops back to `InstructionsToLLM`

### Fixed

- Tool names duplication in Dynamic mode (uses `ArrayMergeMode.Replace`)
- `toolProvider` wired through `buildConfig` for execution
- AssemblePrompt replaces system message in Dynamic mode
- Browser compat (`process.env` guarded)
- Registry mutation moved to constructor (runs once)
- Pausable root stage (no post-build graph mutation)
- Streaming stage typed as `TypedScope<AgentLoopState>`

### Changed

- Peer dependency: `footprintjs >= 4.4.1` (was `>= 4.0.0`)
- Eliminated `ApplyPreparedMessages` and `ApplyResolvedTools` copy stages

## [0.3.0] - 2026-03-29

### Fixed

- `setEnableNarrative()` removed from FlowChartBuilder chain — call `executor.enableNarrative()` instead (footprintjs v3.x API)
- Stage functions in LLMCall, Agent, RAG, FlowChart now receive a plain `ScopeFacade` via `agentScopeFactory`, bypassing TypedScope proxy (required for `getValue`/`setValue` access)

### Changed

- Peer dependency: `footprintjs >= 3.0.0` (was `>= 0.10.0`)

## [0.2.0] - 2026-03-17

### Added

- **Browser LLM adapters**: `BrowserAnthropicAdapter` and `BrowserOpenAIAdapter` — fetch-based, zero peer dependencies
  - Direct browser-to-API calls using user's own API key
  - Full chat() + chatStream() with SSE streaming via ReadableStream
  - Tool call support, AbortSignal, custom baseURL for compatible APIs
  - Anthropic CORS via `anthropic-dangerous-direct-browser-access` header
  - OpenAI `stream_options.include_usage` for streaming token counts
- 18 browser adapter tests

### Removed

- Legacy v1 recorders: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder (no users yet, replaced by v2 AgentRecorder interface)

## [0.1.0] - 2026-03-15

### Added

- **Concept ladder**: LLMCall, Agent, RAG, FlowChart, Swarm — each builds on the previous
- **LLM Adapters**: AnthropicAdapter, OpenAIAdapter, BedrockAdapter with full chat + streaming
- **Provider bridge**: `createProvider()` connects config factories (`anthropic()`, `openai()`, `ollama()`, `bedrock()`) to adapter instances
- **Mock adapter**: `mock()` for $0 deterministic testing — same code path as production
- **Multi-modal content**: Base64 and URL image support across all adapters
- **Error normalization**: `LLMError` with 9 error codes, `retryable` flag, `wrapSDKError()` auto-classifier
- **Compositions**: `withRetry()`, `withFallback()`, `CircuitBreaker` for resilient agent execution
- **V2 Recorders**: TokenRecorder, TurnRecorder, ToolUsageRecorder, QualityRecorder, GuardrailRecorder, CostRecorderV2, CompositeRecorder
- **V1 Recorders**: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder *(removed in 0.2.0)*
- **Protocol adapters**: `mcpToolProvider()` for MCP, `a2aRunner()` for A2A
- **Prompt providers**: staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt
- **Tool providers**: agentAsTool, compositeTools, ToolRegistry, defineTool
- **Memory management**: slidingWindow, truncateToCharBudget, appendMessage
- **Streaming**: StreamEmitter, SSEFormatter
- **Agent loop**: Low-level `agentLoop()` for custom control flow
- **16 sample tests** covering every feature
- **608 tests** across 63 test files
