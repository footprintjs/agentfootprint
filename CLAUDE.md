# agentfootprint — AI Coding Instructions

This is the agentfootprint library — the explainable agent framework. Build AI agents you can explain, audit, and trust. Built on footprintjs.

## Core Principles

- **Adapter-swap testing.** Every concept uses `LLMProvider` — swap `mock([...])` for `createProvider(anthropic(...))` with zero code changes. $0 test runs, deterministic assertions.
- **Concept ladder.** Five concepts, each a flowchart: LLMCall < RAG < Agent < FlowChart < Swarm. Each adds exactly one capability.
- **Built-in recorders.** Observe tokens, cost, tool usage, quality, guardrails — all via `.recorder()` on the builder. Never shape behavior, only observe.
- **Collect during traversal.** Inherited from footprintjs — all data collection happens as side effects of the single DFS traversal pass. Never post-process.

## Architecture — Library of Libraries

```
src/
├── core/        → AgentLoopConfig, AgentRecorder interface, PromptProvider/ToolProvider interfaces
├── concepts/    → 5 builders + runners (LLMCall, Agent, RAG, FlowChart, Swarm)
├── adapters/    → LLMProvider implementations (mock, anthropic, openai, bedrock, mcp, a2a)
├── models/      → ModelConfig factories (anthropic(), openai(), ollama(), bedrock())
├── providers/   → Strategy implementations (prompt/, messages/, tools/)
├── recorders/   → AgentRecorder impls: Evaluation (Explain), Metrics (Token, Cost, Tool, Turn), Safety (Guardrail, Permission, Quality), Export (OTel), Composition (Composite, agentObservability)
├── tools/       → ToolRegistry + defineTool
├── stages/      → Reusable flowchart stages (seedScope, callLLM, parseResponse, etc.)
├── scope/       → AgentScope paths + helpers
├── memory/      → Message utilities (appendMessage, lastMessage, lastAssistantMessage)
├── executor/    → agentLoop (core ReAct loop)
├── compositions/→ withRetry, withFallback, withCircuitBreaker
├── streaming/   → StreamEmitter, SSEFormatter, AgentStreamEvent
├── lib/         → Instructions (agentInstruction, InstructionsToLLM subflow), narrative (agentRenderer), loop (buildAgentLoop), slots, call stages
└── types/       → All type definitions (messages, llm, tools, content blocks)
```

Single entry point: `import { ... } from 'agentfootprint'`

## Five Concepts (Builder API)

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

## Provider System

Three provider interfaces — active strategies that shape what the LLM sees:

- **PromptProvider** — resolves system prompt per turn: `staticPrompt()`, `templatePrompt()`, `skillBasedPrompt()`, `compositePrompt()`
- **MessageStrategy** — prepares message array: `fullHistory()`, `slidingWindow()`, `charBudget()`, `summaryStrategy()`, `persistentHistory()`
- **ToolProvider** — resolves available tools: `staticTools()`, `dynamicTools()`, `noTools()`, `agentAsTool()`, `compositeTools()`

## Adapters (LLMProvider implementations)

```typescript
import { mock, createProvider, anthropic, openai, ollama, bedrock } from 'agentfootprint';

// Testing (deterministic, $0):
const provider = mock([{ content: 'response 1' }, { content: 'response 2' }]);

// Production:
const provider = createProvider(anthropic('claude-sonnet-4-20250514'));
const provider = createProvider(openai('gpt-4o'));
const provider = createProvider(ollama('llama3'));
const provider = createProvider(bedrock('anthropic.claude-3-sonnet'));
```

## Recorder System

Attach via `.recorder(rec)` on any builder. All implement `AgentRecorder` interface.

```typescript
import {
  TokenRecorder,
  CostRecorder,
  TurnRecorder,
  ToolUsageRecorder,
  QualityRecorder,
  GuardrailRecorder,
  CompositeRecorder,
} from 'agentfootprint';

const tokens = new TokenRecorder();
const costs = new CostRecorder({ pricingTable: { 'claude-sonnet': { input: 3, output: 15 } } });
const turns = new TurnRecorder();
const toolUsage = new ToolUsageRecorder();

const agent = Agent.create({ provider })
  .system('...')
  .recorder(tokens)
  .recorder(costs)
  .build();

await agent.run('Hello');

tokens.getStats();       // { totalCalls, totalInputTokens, totalOutputTokens, ... }
costs.getTotalCost();    // number (USD)
costs.getEntries();      // CostEntry[]
turns.getEntries();      // TurnEntry[]
toolUsage.getStats();    // ToolUsageStats
```

Use `CompositeRecorder` to bundle multiple recorders:

```typescript
const composite = new CompositeRecorder([tokens, costs, turns]);
agent.recorder(composite);
```

## Compositions (Resilience Wrappers)

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';

const resilient = withRetry(provider, { maxRetries: 3 });
const fallback = withFallback([primaryProvider, backupProvider]);
const breaker = withCircuitBreaker(provider, { failureThreshold: 5 });
```

## Instructions — Conditional Context Injection

```typescript
import { defineInstruction, Agent, AgentPattern } from 'agentfootprint';

const refund = defineInstruction<MyDecision>({
  id: 'refund-handling',
  activeWhen: (d) => d.orderStatus === 'denied',
  prompt: 'Handle denied orders with empathy.',
  tools: [processRefund],
  onToolResult: [{ id: 'empathy', text: 'Do NOT promise reversal.' }],
});

const agent = Agent.create({ provider })
  .tool(lookupOrder)
  .instruction(refund)
  .decision<MyDecision>({ orderStatus: null })
  .pattern(AgentPattern.Dynamic)
  .build();
```

Builder methods: `.instruction(instr)`, `.instructions([...])`, `.decision<T>({...})`, `.verbose()`

Three naming conventions:
- `activeWhen(decision)` — agent-level, reads Decision Scope
- `when(ctx)` — tool-level, reads tool result context
- `decide(decision, ctx)` — bridges tool results to Decision Scope

## Streaming — AgentStreamEvent

```typescript
const result = await agent.run('hello', {
  onEvent: (event) => {
    switch (event.type) {
      case 'token': process.stdout.write(event.content); break;
      case 'tool_start': console.log(`Running ${event.toolName}...`); break;
      case 'tool_end': console.log(`Done (${event.latencyMs}ms)`); break;
      case 'llm_end': console.log(`[${event.model}, ${event.latencyMs}ms]`); break;
    }
  },
});
```

9 events: `turn_start`, `llm_start`, `thinking`, `token`, `llm_end`, `tool_start`, `tool_end`, `turn_end`, `error`.
Tool lifecycle fires without `.streaming(true)`. Only `token`/`thinking` require streaming.
`onToken` is deprecated — use `onEvent`.

## Grounding Analysis

```typescript
import { ExplainRecorder } from 'agentfootprint/explain';

const explain = new ExplainRecorder();
const agent = Agent.create({ provider }).recorder(explain).build();
await agent.run('Check order');

const report = explain.explain();
report.sources;   // tool results (sources of truth)
report.claims;    // LLM output (to verify)
report.decisions; // tool calls the LLM chose to make
report.summary;   // human-readable summary
```

Collects during traversal via recorder hooks — no post-processing of narrative entries.

## Anti-Patterns

- Never use the old functional API (`LLMCall({...})`, `Agent({...})`) — always use `LLMCall.create({...})` builder pattern
- Never pass recorders via constructor options — use `.recorder()` builder method
- Don't use `name`/`parameters` on `defineTool` — use `id`/`inputSchema`
- Don't use `tokens.stats()` — use `tokens.getStats()`
- Don't use `costs.totalCost()` — use `costs.getTotalCost()`
- Don't post-process the execution tree — use recorders
- Don't put infrastructure concerns in input — use footprintjs `getEnv()` for signal/traceId
- Don't pass functions through scope — they get stripped. Use closure captures (InstructionConfig pattern)
- Don't use `onToken` — use `onEvent` (onToken is deprecated, ignored when onEvent is set)
- Don't match grounding helpers on `entry.text` — use `entry.key` with `AgentScopeKey` enum

## Build & Test

```bash
npm run build    # tsc (CJS) + tsc -p tsconfig.esm.json (ESM)
npm test         # vitest — 1295+ tests
```

Dual output: CommonJS (`dist/`) + ESM (`dist/esm/`) + types (`dist/types/`)
