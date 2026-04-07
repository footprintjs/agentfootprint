# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
