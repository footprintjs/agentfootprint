# Internals

agentfootprint is a library of libraries, following the same architecture as [footprintjs](https://github.com/footprintjs/footPrint). Each module has a single responsibility, clean boundaries, and explicit dependencies.

```
src/
├── types/        Content blocks, messages, LLM interfaces, errors
├── models/       Provider config factories (anthropic, openai, ollama, bedrock)
├── adapters/     LLM adapters + protocol adapters (MCP, A2A)
├── tools/        ToolRegistry, defineTool
├── memory/       Message history helpers (append, slice, truncate)
├── scope/        AgentScope + parsed response handling
├── providers/    Prompt/tool/message providers (static, template, skill-based, composite)
├── stages/       Pipeline stages (seed, prompt, LLM call, parse, handle, finalize)
├── concepts/     High-level patterns (LLMCall, Agent, RAG, FlowChart, Swarm)
├── recorders/    Scope recorders (V1) + AgentRecorders (V2)
├── compositions/ withRetry, withFallback, CircuitBreaker
├── streaming/    StreamEmitter, SSEFormatter
├── executor/     agentLoop — low-level agent execution
└── core/         Shared interfaces (AgentLoopConfig, AgentRecorder, providers)
```

---

## Dependency DAG

```
types/  (zero deps — foundation)
  │
  ├──→ models/     (types only)
  │      │
  │      └──→ adapters/  (types + models + SDKs)
  │
  ├──→ tools/      (types only)
  │
  ├──→ memory/     (types only)
  │      │
  │      └──→ scope/  (types + memory)
  │             │
  │             └──→ stages/  (types + memory + scope + tools + adapters)
  │                    │
  │                    └──→ concepts/  (stages + footprintjs)
  │
  ├──→ core/       (types only)
  │      │
  │      └──→ executor/  (core + types)
  │
  ├──→ recorders/  (core — standalone)
  │
  ├──→ compositions/  (types only — wraps RunnerLike)
  │
  ├──→ streaming/  (standalone)
  │
  └──→ providers/  (core + types)
```

Key constraint: dependencies flow downward. No circular imports. Each module can be understood in isolation.

---

## Module Responsibilities

### types/

Foundation types shared across the entire library. Zero internal dependencies.

| File | Contents |
|------|----------|
| `content.ts` | `ContentBlock`, `TextBlock`, `ImageBlock`, `ToolUseBlock`, `ToolResultBlock` + factories |
| `messages.ts` | `Message`, `SystemMessage`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `ToolCall` |
| `llm.ts` | `LLMProvider`, `LLMCallOptions`, `LLMResponse`, `TokenUsage`, `LLMToolDescription` |
| `tools.ts` | `ToolDefinition`, `ToolHandler`, `ToolResult` |
| `agent.ts` | `AgentConfig`, `AgentResult`, `AgentRunOptions` |
| `retriever.ts` | `RetrieverProvider`, `RetrievalChunk`, `RetrievalResult`, `RAGResult` |
| `multiAgent.ts` | `RunnerLike`, `AgentStageConfig`, `TraversalResult` |
| `errors.ts` | `LLMError`, `LLMErrorCode`, `wrapSDKError` |

### models/

Provider config factories. Map model names to config objects. No SDK dependencies.

- `anthropic(modelId, options?)` returns `{ provider: 'anthropic', modelId, ... }`
- `openai(modelId, options?)` returns `{ provider: 'openai', modelId, ... }`
- `ollama(modelId, options?)` returns `{ provider: 'ollama', modelId, ... }`
- `bedrock(modelId, options?)` returns `{ provider: 'bedrock', modelId, ... }`
- `pricing.ts` — default pricing tables for cost estimation

### adapters/

Implementations of `LLMProvider` for each LLM vendor, plus protocol bridges.

| Adapter | SDK | What it does |
|---------|-----|--------------|
| `AnthropicAdapter` | `@anthropic-ai/sdk` | Anthropic Messages API |
| `OpenAIAdapter` | `openai` | OpenAI Chat Completions (also used for Ollama) |
| `BedrockAdapter` | `@aws-sdk/client-bedrock-runtime` | AWS Bedrock Converse API |
| `MockAdapter` | None | Deterministic responses for testing |
| `MockRetriever` | None | Deterministic retrieval for testing |
| `createProvider()` | None | Factory that resolves `ModelConfig` to adapter |
| `mcpToolProvider()` | None | MCP server as `ToolProvider` |
| `a2aRunner()` | None | A2A endpoint as `RunnerLike` |

### tools/

Tool registration and formatting.

- `ToolRegistry` — register, lookup, and format tools for LLM function calling
- `defineTool()` — convenience factory for inline tool definitions

### memory/

Message history helpers. Stateless functions that operate on `Message[]`.

- `appendMessage()`, `lastMessage()`, `lastAssistantMessage()`
- `lastMessageHasToolCalls()` — check if the last message contains tool calls
- `createToolResults()` — build tool result messages from execution results

### scope/

AgentScope provides typed read/write accessors over footprintjs's `ScopeFacade`. Defines well-known scope keys (`AGENT_PATHS`, `RAG_PATHS`, `MULTI_AGENT_PATHS`).

- `AgentScope.setMessages(scope, msgs)` — write messages to scope
- `AgentScope.getMessages(scope)` — read messages from scope
- `AgentScope.setSystemPrompt(scope, prompt)` — set system prompt
- `ParsedResponse` — extracted tool calls and text from LLM response

### providers/

Three provider interfaces with multiple built-in implementations.

**Prompt providers:** `staticPrompt`, `templatePrompt`, `skillBasedPrompt`, `compositePrompt`

**Message strategies:** `fullHistory`, `slidingWindow`, `charBudget`, `summaryStrategy`, `withToolPairSafety`, `compositeMessages`, `persistentHistory`

**Tool providers:** `staticTools`, `dynamicTools`, `noTools`, `agentAsTool`, `compositeTools`

### stages/

Pipeline stages that implement footprintjs's `PipelineStageFunction`. Each stage is a pure function that reads from scope, does work, and writes results back.

| Stage | What it does |
|-------|--------------|
| `seedScope` | Initialize scope with message, tools, config |
| `promptAssembly` | Resolve system prompt via PromptProvider |
| `callLLM` | Invoke the LLM adapter |
| `parseResponse` | Extract text, tool calls from adapter response |
| `handleResponse` | Execute tool calls or finalize (breaks loop) |
| `finalize` | Extract final result text |
| `retrieve` | Call retriever for RAG |
| `augmentPrompt` | Inject retrieved chunks into prompt |
| `runnerAsStage` | Wrap a RunnerLike as a pipeline stage |

### concepts/

High-level patterns that compose stages into flowcharts using footprintjs's builder API.

Each concept follows the same pattern:
1. Builder class with fluent API (`.system()`, `.tool()`, `.recorder()`, `.build()`)
2. Runner class that builds a footprintjs flowChart internally
3. Runner exposes `.run()`, `.getNarrative()`, `.getSnapshot()`, `.getSpec()`

| Concept | Internal flowchart |
|---------|-------------------|
| `LLMCall` | SeedScope -> CallLLM -> ParseResponse -> Finalize |
| `Agent` | SeedScope -> PromptAssembly -> CallLLM -> ParseResponse -> HandleResponse -> loopTo(CallLLM) |
| `RAG` | SeedScope -> Retrieve -> AugmentPrompt -> CallLLM -> ParseResponse -> Finalize |
| `FlowChart` | Seed -> Runner1 (subflow) -> Runner2 (subflow) -> ... |
| `Swarm` | Wraps an Agent with specialists as tools via agentAsTool |

### core/

Shared interfaces that cross module boundaries.

- `AgentRecorder` — observer interface (`onTurnStart`, `onLLMCall`, `onToolCall`, `onTurnComplete`, `onError`)
- `AgentLoopConfig` — configuration for the low-level agent loop
- `PromptProvider`, `MessageStrategy`, `ToolProvider` — provider interfaces
- Event types: `TurnStartEvent`, `LLMCallEvent`, `ToolCallEvent`, `TurnCompleteEvent`, `AgentErrorEvent`

### recorders/

Two generations of recorders:

**V1 (scope-level):** Implement footprintjs's `Recorder` interface. Observe scope reads/writes. `LLMRecorder`, `ScopeCostRecorder`, `RAGRecorder`, `MultiAgentRecorder`.

**V2 (AgentRecorder):** Implement the `AgentRecorder` interface from `core/`. Observe high-level events (LLM calls, tool calls, turns). `TokenRecorder`, `CostRecorder`, `TurnRecorder`, `ToolUsageRecorder`, `QualityRecorder`, `GuardrailRecorder`, `CompositeRecorder`.

V2 recorders are the primary API. V1 recorders exist for backward compatibility and low-level scope observation.

`RecorderBridge` connects AgentRecorders to the execution pipeline, dispatching events from the runner's execution into the recorder hooks.

### compositions/

Reliability wrappers for `RunnerLike`. No dependencies on concepts or stages.

- `withRetry(runner, options)` — retry with backoff
- `withFallback(primary, fallback, options)` — degrade to backup
- `withCircuitBreaker(runner, options)` — fast-fail after repeated failures

### executor/

Low-level `agentLoop()` function — the core ReAct loop implementation. Used internally by `Agent` concept. Exposed for advanced use cases where the high-level builder is too opinionated.

### streaming/

`StreamEmitter` — event emitter for token-level streaming. `SSEFormatter` — format stream events as Server-Sent Events.

---

## Built on footprintjs

Every concept builds a flowchart internally using footprintjs's `flowChart()` builder. This provides three capabilities for free:

1. **Narrative** — human-readable trace of what happened during execution
2. **Snapshot** — full execution state for time-travel debugging
3. **Spec** — stage graph metadata for flowchart visualization

The flowchart is built fresh for each `.run()` call (stateless). The last executor is cached for `.getNarrative()`, `.getSnapshot()`, and `.getSpec()`.

Runners with `.toFlowChart()` can be mounted as subflows in FlowChart, enabling drill-down into nested execution trees via footprintjs's `getSubtreeSnapshot()`.

---

## Design Decisions

### Why builder pattern?

The builder pattern (`create → configure → build`) keeps configuration separate from execution. The builder is mutable during setup, the runner is immutable after build. This prevents accidental reconfiguration mid-execution.

### Why a layered taxonomy?

The 5-layer taxonomy (2 primitives → 3 compositions → N named patterns → context engineering → features) keeps each layer orthogonal. Users start with a primitive (`LLM` or `Agent`), compose with `Sequence`/`Parallel`/`Conditional`, and add context engineering (RAG, Memory, Skills) as injection into Agent slots. No upfront graph DSL required; named patterns from the literature are expressed as recipes, not new runtime classes.

### Why two recorder generations?

V1 recorders observe scope-level reads/writes (footprintjs's `Recorder` interface). V2 recorders observe high-level agent events (`AgentRecorder` interface). V2 is the primary API because agent-level events (LLM call, tool use, turn lifecycle) are more useful than raw scope mutations for most observability needs.

### Why compositions are separate from concepts?

`withRetry`, `withFallback`, and `withCircuitBreaker` wrap `RunnerLike` — they work with any runner, not just agentfootprint concepts. Keeping them separate means they can wrap external runners, A2A endpoints, or any object that implements `.run()`.
