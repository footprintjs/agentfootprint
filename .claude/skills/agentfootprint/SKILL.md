---
name: agentfootprint
description: Use when building AI agents with agentfootprint — LLMCall, Agent, RAG, FlowChart, Swarm concepts, mock/anthropic/openai adapters, tools, recorders, compositions, and streaming. Also use when someone asks how agentfootprint works or wants to understand the framework.
---

# agentfootprint — The Explainable Agent Framework

agentfootprint structures AI agents as composable flowcharts with adapter-swap testing. Every concept uses `LLMProvider` — swap `mock([...])` for `createProvider(anthropic(...))` with zero code changes.

**Core principles:**
- Adapter-swap testing ($0 test runs, deterministic assertions)
- Concept ladder: LLMCall < RAG < Agent < FlowChart < Swarm
- Built-in recorders for tokens, cost, tool usage, quality, guardrails
- Collect during traversal (inherited from footprintjs)

```bash
npm install agentfootprint
```

---

## Five Concepts (Builder API)

### LLMCall — Single LLM call, no tools

```typescript
import { LLMCall, mock } from 'agentfootprint';

const caller = LLMCall.create({ provider: mock([{ content: 'Hello!' }]) })
  .system('You are helpful.')
  .recorder(tokens)
  .build();

const result = await caller.run('Hi');
```

### Agent — Full ReAct agent with tools

```typescript
import { Agent, defineTool, mock } from 'agentfootprint';

const agent = Agent.create({ provider: mock([...]), name: 'my-agent' })
  .system('You are a research assistant.')
  .tool(searchTool)
  .maxIterations(5)
  .recorder(tokens)
  .build();

const result = await agent.run('Find info about AI');
```

### RAG — Retrieve-Augment-Generate

```typescript
import { RAG, mock, mockRetriever } from 'agentfootprint';

const rag = RAG.create({
  provider: mock([{ content: 'Answer.' }]),
  retriever: mockRetriever([{ chunks: [{ content: 'doc', score: 0.9 }] }]),
})
  .system('Answer using context.')
  .topK(5)
  .build();
```

### FlowChart — Sequential multi-agent composition

```typescript
import { FlowChart } from 'agentfootprint';

const pipeline = FlowChart.create()
  .agent('researcher', 'Research', researchRunner)
  .agent('writer', 'Write', writerRunner)
  .build();
```

### Swarm — LLM-routed multi-agent handoff

```typescript
import { Swarm, createProvider, anthropic } from 'agentfootprint';

const swarm = Swarm.create({ provider: createProvider(anthropic('claude-sonnet-4-20250514')) })
  .system('Route to specialists.')
  .specialist('research', 'Research.', researchRunner)
  .specialist('write', 'Write.', writerRunner)
  .build();
```

---

## Provider System

- **LLMProvider** — `mock([...])`, `createProvider(anthropic(...))`, `createProvider(openai(...))`
- **PromptProvider** — `staticPrompt()`, `templatePrompt()`, `skillBasedPrompt()`, `compositePrompt()`
- **MessageStrategy** — `fullHistory()`, `slidingWindow()`, `charBudget()`
- **ToolProvider** — `staticTools()`, `dynamicTools()`, `agentAsTool()`

## Tools

```typescript
import { defineTool } from 'agentfootprint';

const tool = defineTool({
  id: 'calculator',
  description: 'Perform arithmetic',
  inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
  handler: async (input) => ({ content: String(eval(input.expression)) }),
});
```

## Recorders

```typescript
import { TokenRecorder, CostRecorder, TurnRecorder, ToolUsageRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
agent.recorder(tokens);
await agent.run('Hello');
tokens.getStats(); // { totalCalls, totalInputTokens, totalOutputTokens }
```

## Compositions (Resilience)

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';

const resilient = withRetry(provider, { maxRetries: 3 });
const fallback = withFallback([primaryProvider, backupProvider]);
```

## Anti-Patterns

- Never use functional API — always use `.create({...})` builder pattern
- Never pass recorders via constructor — use `.recorder()` builder method
- Don't use `name`/`parameters` on defineTool — use `id`/`inputSchema`
- Don't post-process execution — use recorders

## Build & Test

```bash
npm run build    # tsc (CJS) + tsc -p tsconfig.esm.json (ESM)
npm test         # vitest — 610+ tests
```
