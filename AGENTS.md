# agentfootprint — Agent Coding Instructions

This is the agentfootprint library — the explainable agent framework. Build AI agents you can explain, audit, and trust. Built on footprintjs.

## Core Principles

- **Adapter-swap testing.** Every concept uses `LLMProvider` — swap `mock([...])` for `createProvider(anthropic(...))` with zero code changes. $0 test runs, deterministic assertions.
- **Concept ladder.** Five concepts, each a flowchart: LLMCall < RAG < Agent < FlowChart < Swarm. Each adds exactly one capability.
- **Built-in recorders.** Observe tokens, cost, tool usage, quality, guardrails — all via `.recorder()` on the builder. Never shape behavior, only observe.
- **Collect during traversal.** All data collection happens as side effects of the single DFS traversal pass. Never post-process.

## Architecture

```
src/
├── core/        → AgentLoopConfig, AgentRecorder interface, Provider interfaces
├── concepts/    → 5 builders + runners (LLMCall, Agent, RAG, FlowChart, Swarm)
├── adapters/    → LLMProvider implementations (mock, anthropic, openai, bedrock, mcp, a2a)
├── models/      → ModelConfig factories (anthropic(), openai(), ollama(), bedrock())
├── providers/   → Strategy implementations (prompt/, messages/, tools/)
├── recorders/   → Scope-level recorders + v2 AgentRecorder implementations
├── tools/       → ToolRegistry + defineTool
├── stages/      → Reusable flowchart stages (seedScope, callLLM, parseResponse, etc.)
├── scope/       → AgentScope paths + helpers
├── memory/      → Message utilities (appendMessage, slidingWindow, truncateToCharBudget)
├── executor/    → agentLoop (core ReAct loop)
├── compositions/→ withRetry, withFallback, withCircuitBreaker
├── streaming/   → StreamEmitter, SSEFormatter
└── types/       → All type definitions (messages, llm, tools, content blocks)
```

Single entry point: `import { ... } from 'agentfootprint'`

## Five Concepts — Builder API

All concepts use the builder pattern: `Concept.create(options).configure().build()` returns a runner with `.run()`.

### LLMCall — Single LLM call, no tools, no loop

```typescript
import { LLMCall, mock } from 'agentfootprint';

const caller = LLMCall.create({ provider: mock([{ content: 'Hello!' }]) })
  .system('You are helpful.')
  .recorder(tokens)
  .build();

const result = await caller.run('Hi');
// result.content — string response
```

### Agent — Full ReAct agent with tools and loop

```typescript
import { Agent, defineTool, mock } from 'agentfootprint';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async (input) => ({ content: `Results for: ${input.query}` }),
});

const agent = Agent.create({ provider: mock([...]), name: 'my-agent' })
  .system('You are a research assistant.')
  .tool(searchTool)
  .maxIterations(5)
  .recorder(tokens)
  .build();

const result = await agent.run('Find info about AI');
// result.content, result.messages, result.toolCalls
```

### RAG — Retrieve-Augment-Generate

```typescript
import { RAG, mock, mockRetriever } from 'agentfootprint';

const rag = RAG.create({
  provider: mock([{ content: 'Answer based on context.' }]),
  retriever: mockRetriever([{ chunks: [{ content: 'doc text', score: 0.9 }] }]),
})
  .system('Answer using the provided context.')
  .topK(5)
  .minScore(0.7)
  .recorder(tokens)
  .build();

const result = await rag.run('What is X?');
// result.content, result.retrieval
```

### FlowChart — Sequential multi-agent composition

```typescript
import { FlowChart } from 'agentfootprint';

const pipeline = FlowChart.create()
  .agent('researcher', 'Research', researchRunner)
  .agent('writer', 'Write', writerRunner)
  .recorder(tokens)
  .build();

const result = await pipeline.run('Write about AI');
// result.results — array of per-agent results
```

### Swarm — LLM-routed multi-agent handoff

```typescript
import { Swarm, createProvider, anthropic } from 'agentfootprint';

const swarm = Swarm.create({ provider: createProvider(anthropic('claude-sonnet-4-20250514')) })
  .system('You are a router. Delegate to specialists.')
  .specialist('research', 'Research a topic.', researchRunner)
  .specialist('write', 'Write content.', writerRunner)
  .maxIterations(10)
  .recorder(tokens)
  .build();

const result = await swarm.run('Write about AI');
```

## Tools

```typescript
import { defineTool } from 'agentfootprint';

const tool = defineTool({
  id: 'calculator',
  description: 'Perform arithmetic',
  inputSchema: {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  handler: async (input) => ({ content: String(eval(input.expression)) }),
});
```

Fields: `id` (unique identifier), `description` (sent to LLM), `inputSchema` (JSON Schema), `handler` (returns `{ content: string, error?: boolean }`).

## Provider System

Three provider interfaces — active strategies that shape what the LLM sees:

**PromptProvider** — resolves system prompt per turn:
- `staticPrompt(str)` — fixed string
- `templatePrompt(template, vars)` — variable substitution
- `skillBasedPrompt(options)` — skill-based routing
- `compositePrompt(providers)` — combine multiple

**MessageStrategy** — prepares message array for LLM:
- `fullHistory()` — send all messages
- `slidingWindow(options)` — last N messages
- `charBudget(options)` — fit within character limit
- `summaryStrategy(options)` — summarize old messages
- `persistentHistory(store)` — persist across sessions

**ToolProvider** — resolves available tools:
- `staticTools(tools)` — fixed tool set
- `dynamicTools(resolver)` — context-dependent
- `noTools()` — no tools available
- `agentAsTool(config)` — mount agent as a tool
- `compositeTools(providers)` — combine multiple

## Adapters

```typescript
import { mock, createProvider, anthropic, openai, ollama, bedrock } from 'agentfootprint';

// Testing (deterministic, $0):
const provider = mock([{ content: 'response 1' }, { content: 'response 2' }]);

// Production:
const provider = createProvider(anthropic('claude-sonnet-4-20250514'));
const provider = createProvider(openai('gpt-4o'));
const provider = createProvider(ollama('llama3'));
const provider = createProvider(bedrock('anthropic.claude-3-sonnet'));

// Retrieval (testing):
const retriever = mockRetriever([{ chunks: [{ content: 'doc', score: 0.9 }] }]);
```

## Recorder System

Attach via `.recorder(rec)` on any concept builder. All implement `AgentRecorder` interface with optional hooks: `onTurnStart`, `onLLMCall`, `onToolCall`, `onTurnComplete`, `onError`.

Available recorders:

| Recorder | Tracks | Key method |
|---|---|---|
| `TokenRecorder` | Token usage per LLM call | `getStats()` |
| `CostRecorder` | USD cost per LLM call | `getTotalCost()`, `getEntries()` |
| `TurnRecorder` | Turn-level events | `getEntries()` |
| `ToolUsageRecorder` | Tool call frequency/latency | `getStats()` |
| `QualityRecorder` | Response quality scores | Requires `QualityJudge` |
| `GuardrailRecorder` | Safety/policy violations | Requires `GuardrailCheck` |
| `CompositeRecorder` | Bundles multiple recorders | Delegates to children |

```typescript
import { TokenRecorder, CostRecorder, CompositeRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
const costs = new CostRecorder({
  pricingTable: { 'claude-sonnet': { input: 3, output: 15 } },
});

const agent = Agent.create({ provider })
  .system('...')
  .recorder(tokens)
  .recorder(costs)
  .build();

await agent.run('Hello');

tokens.getStats();       // { totalCalls, totalInputTokens, totalOutputTokens, ... }
costs.getTotalCost();    // number (USD)
```

## Compositions (Resilience)

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';

const resilient = withRetry(provider, { maxRetries: 3 });
const fallback = withFallback([primaryProvider, backupProvider]);
const breaker = withCircuitBreaker(provider, { failureThreshold: 5 });
```

## Anti-Patterns

These are CRITICAL — using the wrong API will cause errors or produce incorrect results:

- **Never use the old functional API** (`LLMCall({...})`, `Agent({...})`) — always use `LLMCall.create({...})` builder pattern
- **Never use `CostRecorderV2`** — use `CostRecorder` (V2 is a deprecated alias)
- **Never pass recorders via constructor options** — use `.recorder()` builder method
- **Don't use `name`/`parameters` on `defineTool`** — use `id`/`inputSchema`
- **Don't use `tokens.stats()`** — use `tokens.getStats()`
- **Don't use `costs.totalCost()`** — use `costs.getTotalCost()`
- **Don't post-process the execution tree** — use recorders to collect data during traversal
- **Don't put infrastructure concerns in input** — use footprintjs `getEnv()` for signal/traceId

## Build & Test

```bash
npm run build    # tsc (CJS) + tsc -p tsconfig.esm.json (ESM)
npm test         # vitest — 610+ tests
```

Dual output: CommonJS (`dist/`) + ESM (`dist/esm/`) + types (`dist/types/`)
