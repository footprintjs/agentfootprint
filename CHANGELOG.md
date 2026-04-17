# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
