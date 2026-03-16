---
name: agentfootprint
description: Use when building AI agents with agentfootprint — LLM calls, ReAct agents, RAG pipelines, multi-agent flowcharts, swarm orchestration, tools, recorders, providers, adapters, and testing. Also use when someone asks how agentfootprint works or wants to understand the framework.
---

# agentfootprint — The Explainable Agent Framework

agentfootprint builds AI agents you can explain, audit, and trust. Every agent is a footprintjs flowchart — every LLM call, tool use, and decision auto-generates a causal trace.

**Core principle:** Every concept is a flowchart. Collect during traversal, never post-process.

```bash
npm install agentfootprint footprintjs
```

---

## 5 Concepts — The Concept Ladder

Each concept builds on footprintjs flowcharts. Each has a builder (`.create()`) and a runner (`.build()`).

### 1. LLMCall — Single LLM Call (No Tools, No Loop)

Flowchart: `SeedScope → CallLLM → ParseResponse → Finalize`

```typescript
import { LLMCall, mock } from 'agentfootprint';

const caller = LLMCall.create({ provider: mock([{ content: 'Hello!' }]) })
  .system('You are helpful.')
  .build();

const result = await caller.run('Hi');
// result.content === 'Hello!'
// result.messages — full message history
```

**Builder API:**
- `LLMCall.create({ provider })` — create with an LLM provider
- `.system(prompt)` — set system prompt
- `.recorder(rec)` — attach an AgentRecorder
- `.build()` — returns `LLMCallRunner`

**Runner API:**
- `runner.run(message, { signal?, timeoutMs? })` — execute
- `runner.getNarrative()` — causal trace from last run
- `runner.getSnapshot()` — full memory state
- `runner.getSpec()` — flowchart spec for visualization
- `runner.toFlowChart()` — expose for subflow composition

### 2. Agent — ReAct Agent (Tools + Loop)

Flowchart: `SeedScope → PromptAssembly → CallLLM → ParseResponse → HandleResponse → loopTo('call-llm')`

```typescript
import { Agent, defineTool, mock } from 'agentfootprint';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  handler: async (args) => `Results for: ${args.query}`,
});

const agent = Agent.create({ provider: mock([
  { content: '', toolCalls: [{ id: 'tc1', name: 'search', args: { query: 'AI' } }] },
  { content: 'AI is artificial intelligence.' },
]), name: 'researcher' })
  .system('You are a research assistant.')
  .tool(searchTool)
  .maxIterations(5)
  .build();

const result = await agent.run('What is AI?');
// result.content — final answer
// result.messages — full conversation
// result.iterations — number of ReAct loops
```

**Builder API:**
- `Agent.create({ provider, name? })` — create with LLM provider
- `.system(prompt)` — set system prompt
- `.tool(toolDef)` — register a single tool
- `.tools(toolDefs)` — register multiple tools
- `.maxIterations(n)` — set max ReAct loop iterations (default: 10)
- `.recorder(rec)` — attach an AgentRecorder
- `.build()` — returns `AgentRunner`

**Runner API:**
- `runner.run(message, { signal?, timeoutMs? })` — execute
- `runner.getNarrative()` / `runner.getNarrativeEntries()` — causal trace
- `runner.getSnapshot()` — full memory state
- `runner.getSpec()` — flowchart spec
- `runner.toFlowChart()` — expose for subflow composition
- `runner.getMessages()` — conversation history
- `runner.resetConversation()` — clear conversation state

### 3. RAG — Retrieve-Augment-Generate

Flowchart: `SeedScope → Retrieve → AugmentPrompt → CallLLM → ParseResponse → Finalize`

```typescript
import { RAG, mock, mockRetriever } from 'agentfootprint';

const rag = RAG.create({
  provider: mock([{ content: 'Based on the documents...' }]),
  retriever: mockRetriever([
    { chunks: [{ content: 'AI was invented...', score: 0.95, metadata: {} }] },
  ]),
})
  .system('Answer based on provided context only.')
  .topK(5)
  .minScore(0.7)
  .build();

const result = await rag.run('What is AI?');
// result.content — generated answer
// result.chunks — retrieved chunks
// result.query — the query used for retrieval
```

**Builder API:**
- `RAG.create({ provider, retriever })` — create with LLM + retriever
- `.system(prompt)` — set system prompt
- `.topK(n)` — number of chunks to retrieve
- `.minScore(score)` — minimum relevance threshold
- `.recorder(rec)` — attach an AgentRecorder
- `.build()` — returns `RAGRunner`

### 4. FlowChart — Sequential Multi-Agent Composition

Run agents in order, each feeding into the next. Agents with `toFlowChart()` are mounted as subflows (enables UI drill-down).

```typescript
import { FlowChart, Agent, mock, CostRecorder } from 'agentfootprint';

const researcher = Agent.create({ provider: mock([{ content: 'Research findings...' }]), name: 'researcher' })
  .system('You are a researcher.')
  .build();

const writer = Agent.create({ provider: mock([{ content: 'Final article...' }]), name: 'writer' })
  .system('You are a writer.')
  .build();

const costRecorder = new CostRecorder();

const pipeline = FlowChart.create()
  .agent('researcher', 'Research', researcher)
  .agent('writer', 'Write', writer)
  .recorder(costRecorder)
  .build();

const result = await pipeline.run('Write about AI');
// result.content — final output
// result.agents — per-agent results [{ id, name, content, latencyMs }]
// result.totalLatencyMs — end-to-end timing
```

**Builder API:**
- `FlowChart.create()` — create empty pipeline
- `.agent(id, name, runner, { inputMapper?, outputMapper? }?)` — add a runner
- `.recorder(rec)` — attach an AgentRecorder
- `.build()` — returns `FlowChartRunner`

### 5. Swarm — LLM-Routed Multi-Agent

An orchestrator agent delegates to specialist agents as tools. The LLM decides routing dynamically.

```typescript
import { Swarm, Agent, mock } from 'agentfootprint';

const researcher = Agent.create({ provider: mock([{ content: 'Research done.' }]), name: 'researcher' })
  .system('You research topics.')
  .build();

const writer = Agent.create({ provider: mock([{ content: 'Article written.' }]), name: 'writer' })
  .system('You write articles.')
  .build();

const swarm = Swarm.create({ provider: mock([
  { content: '', toolCalls: [{ id: 'tc1', name: 'research', args: { message: 'AI' } }] },
  { content: 'Here is the article about AI.' },
]) })
  .system('You are a router. Delegate to the right specialist.')
  .specialist('research', 'Research a topic in depth.', researcher)
  .specialist('write', 'Write polished content.', writer)
  .maxIterations(10)
  .build();

const result = await swarm.run('Write about AI');
// result.content — orchestrator's final response
// result.agents — which specialists were invoked
// result.totalLatencyMs
```

**Builder API:**
- `Swarm.create({ provider, name? })` — create with orchestrator LLM
- `.system(prompt)` — orchestrator system prompt
- `.specialist(id, description, runner, { inputMapper? }?)` — register specialist
- `.tool(toolDef)` — register non-agent tool for orchestrator
- `.maxIterations(n)` — max ReAct iterations
- `.recorder(rec)` — attach an AgentRecorder
- `.build()` — returns `SwarmRunner`

---

## Tools — `defineTool()`

```typescript
import { defineTool } from 'agentfootprint';

const calculator = defineTool({
  id: 'calculate',
  description: 'Evaluate a math expression',
  inputSchema: {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  handler: async (args) => {
    return String(eval(args.expression));
  },
});

// Register with agent
agent.tool(calculator);
```

**Fields:** `id` (unique), `description` (sent to LLM), `inputSchema` (JSON Schema), `handler` (async function returning string).

---

## Recorder System — Observe Without Changing Behavior

All recorders implement the `AgentRecorder` interface with optional hooks:
`onTurnStart`, `onLLMCall`, `onToolCall`, `onTurnComplete`, `onError`, `clear`.

### Built-in Recorders

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

// Token tracking
const tokens = new TokenRecorder();

// Cost tracking (needs model pricing)
const cost = new CostRecorder();

// Turn-by-turn history
const turns = new TurnRecorder();

// Tool usage statistics
const toolUsage = new ToolUsageRecorder();

// Quality evaluation (with custom judge)
const quality = new QualityRecorder(async (content) => ({
  score: 0.9,
  dimension: 'relevance',
}));

// Guardrail checks
const guardrail = new GuardrailRecorder([
  async (content) => ({ passed: true, checkName: 'no-pii' }),
]);

// Compose multiple recorders into one
const composite = new CompositeRecorder([tokens, cost, turns]);
```

### Attach to Any Concept

```typescript
// On builders
const agent = Agent.create({ provider })
  .system('...')
  .recorder(tokens)
  .recorder(cost)
  .build();

// Or use CompositeRecorder
const agent = Agent.create({ provider })
  .recorder(new CompositeRecorder([tokens, cost, turns]))
  .build();
```

### Read Results After Execution

```typescript
await agent.run('Hello');

tokens.getStats();      // { totalInput: 50, totalOutput: 30, ... }
cost.getEntries();      // [{ model, inputTokens, outputTokens, cost }]
cost.getTotalCost();    // 0.0042
turns.getEntries();     // [{ message, content, messageCount, ... }]
toolUsage.getStats();   // { totalCalls: 3, tools: { search: { calls: 2, ... } } }
```

### Custom Recorder

```typescript
import type { AgentRecorder } from 'agentfootprint';

const myRecorder: AgentRecorder = {
  id: 'my-recorder',
  onLLMCall(event) {
    console.log(`Model: ${event.model}, tokens: ${event.usage?.totalTokens}`);
  },
  onToolCall(event) {
    console.log(`Tool: ${event.toolName}, latency: ${event.latencyMs}ms`);
  },
  clear() { /* reset state */ },
};
```

---

## Providers & Adapters

### Mock Provider (Testing)

```typescript
import { mock, mockRetriever } from 'agentfootprint';

// Mock LLM responses (consumed in order)
const provider = mock([
  { content: 'First response' },
  { content: '', toolCalls: [{ id: 'tc1', name: 'search', args: { query: 'AI' } }] },
  { content: 'Final answer' },
]);

// Mock retriever
const retriever = mockRetriever([
  { chunks: [{ content: 'doc text', score: 0.9, metadata: {} }] },
]);
```

### Real Providers

```typescript
import { createProvider, anthropic, openai, bedrock } from 'agentfootprint';

// Anthropic Claude
const claude = createProvider(anthropic({
  modelId: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY,
}));

// OpenAI
const gpt = createProvider(openai({
  modelId: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
}));

// AWS Bedrock
const bedrockLLM = createProvider(bedrock({
  modelId: 'anthropic.claude-3-sonnet',
  region: 'us-east-1',
}));
```

### Protocol Adapters

```typescript
import { mcpToolProvider, a2aRunner } from 'agentfootprint';

// MCP — connect to external tool servers
const mcpTools = mcpToolProvider({ client: mcpClient });

// A2A — call remote agents
const remoteAgent = a2aRunner({ client: a2aClient, agentId: 'remote-1' });
```

---

## Prompt Providers

```typescript
import { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from 'agentfootprint';

// Static string
const p1 = staticPrompt('You are helpful.');

// Template with variables
const p2 = templatePrompt('You are a {role} assistant.');

// Skill-based (select instructions by context)
const p3 = skillBasedPrompt({
  skills: [
    { id: 'search', instruction: 'Use search tool for factual queries.' },
    { id: 'math', instruction: 'Use calculator for math questions.' },
  ],
  selector: (ctx) => ctx.message.includes('calculate') ? ['math'] : ['search'],
});

// Compose providers
const p4 = compositePrompt({ providers: [p1, p3] });
```

---

## Tool Providers

```typescript
import { agentAsTool, compositeTools, defineTool } from 'agentfootprint';

// Wrap an agent as a tool (for Swarm pattern)
const agentTool = agentAsTool({
  id: 'researcher',
  description: 'Research a topic',
  runner: researchAgent,
});

// Combine tool sets
const allTools = compositeTools([staticTools, mcpTools]);
```

---

## Compositions (Resilience)

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';

// Retry with exponential backoff
const resilient = withRetry(agent, { maxRetries: 3, delayMs: 1000 });

// Fallback to cheaper model
const withFb = withFallback(primaryAgent, fallbackAgent);

// Circuit breaker
const breaker = withCircuitBreaker(agent, {
  failureThreshold: 5,
  resetTimeMs: 30000,
});
```

---

## Streaming

```typescript
import { StreamEmitter, SSEFormatter } from 'agentfootprint';

const emitter = new StreamEmitter();
emitter.on('chunk', (chunk) => process.stdout.write(chunk.text));

const formatter = new SSEFormatter();
// Convert stream events to SSE format for HTTP responses
```

---

## Testing Patterns

Every concept uses `mock([...])` for deterministic testing — no API keys needed.

```typescript
import { Agent, defineTool, mock, TokenRecorder, CostRecorder } from 'agentfootprint';

// 1. Define tools
const searchTool = defineTool({
  id: 'search',
  description: 'Search',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  handler: async (args) => `Found: ${args.q}`,
});

// 2. Mock provider with scripted responses
const provider = mock([
  { content: '', toolCalls: [{ id: 'tc1', name: 'search', args: { q: 'test' } }] },
  { content: 'The answer is 42.' },
]);

// 3. Build with recorders
const tokens = new TokenRecorder();
const cost = new CostRecorder();

const agent = Agent.create({ provider, name: 'test-agent' })
  .system('You are helpful.')
  .tool(searchTool)
  .recorder(tokens)
  .recorder(cost)
  .build();

// 4. Run and assert
const result = await agent.run('What is the answer?');
expect(result.content).toBe('The answer is 42.');
expect(result.iterations).toBe(2);

// 5. Inspect narrative (causal trace)
const narrative = agent.getNarrative();
// Verify the execution path
expect(narrative.some(line => line.includes('CallLLM'))).toBe(true);
```

---

## Architecture

```
src/
├── types/        → Content blocks, messages, LLM types, tool types, agent types
├── models/       → Model configs (anthropic, openai, ollama, bedrock)
├── adapters/     → Mock, Anthropic, OpenAI, Bedrock, MCP, A2A, createProvider
├── tools/        → ToolRegistry, defineTool
├── memory/       → Message helpers (appendMessage, slidingWindow, truncate)
├── scope/        → AgentScope (typed paths into footprintjs ScopeFacade)
├── stages/       → Reusable stage functions (seedScope, callLLM, parseResponse, etc.)
├── core/         → AgentRecorder, PromptProvider, ToolProvider, AgentLoopConfig
├── concepts/     → LLMCall, Agent, RAG, FlowChart, Swarm (builders + runners)
├── recorders/    → Scope-level + AgentRecorder implementations
│   └── v2/       → TokenRecorder, CostRecorder, TurnRecorder, ToolUsageRecorder, etc.
├── providers/    → Prompt providers, tool providers (agentAsTool, compositeTools)
├── compositions/ → withRetry, withFallback, withCircuitBreaker
├── streaming/    → StreamEmitter, SSEFormatter
└── executor/     → agentLoop (low-level loop runner)
```

Single entry point: `import { ... } from 'agentfootprint'`

---

## Anti-Patterns to Avoid

1. **Never use `CostRecorderV2`** — it's deprecated. Use `CostRecorder`.
2. **Never post-process the flowchart** — use recorders to collect data during traversal.
3. **Never build agents without `mock()`** in tests — no API keys in test suites.
4. **Don't skip `.recorder(rec)`** — always attach recorders to observe execution.
5. **Don't use raw footprintjs stages** for agent logic — use concept builders (`Agent.create()`, `LLMCall.create()`, etc.).
6. **Don't create flat stages for multi-agent** — use `FlowChart.create().agent(...)` or `Swarm.create().specialist(...)` so the UI gets drill-down.
7. **Don't manually call `agentLoop()`** unless building a custom concept — use the 5 concept builders.
8. **Don't mix `mock()` and real providers** in the same builder — pick one.

---

## Concept Ladder Summary

| Concept | Pattern | Tools | Loop | Multi-Agent |
|---------|---------|-------|------|-------------|
| `LLMCall` | Single call | No | No | No |
| `Agent` | ReAct | Yes | Yes | No |
| `RAG` | Retrieve + Generate | No | No | No |
| `FlowChart` | Sequential pipeline | Via agents | Via agents | Yes |
| `Swarm` | LLM-routed handoff | Yes + agents | Yes | Yes |

---

## Common Patterns

### Agent with tools and cost tracking

```typescript
const cost = new CostRecorder();
const agent = Agent.create({ provider: createProvider(anthropic({ modelId: 'claude-sonnet-4-20250514' })) })
  .system('You are a helpful assistant.')
  .tool(searchTool)
  .tool(calculatorTool)
  .recorder(cost)
  .build();

await agent.run('Calculate 2+2 and search for AI');
console.log(`Total cost: $${cost.getTotalCost()}`);
```

### Multi-agent pipeline with narrative

```typescript
const pipeline = FlowChart.create()
  .agent('planner', 'Plan', plannerAgent)
  .agent('executor', 'Execute', executorAgent)
  .agent('reviewer', 'Review', reviewerAgent)
  .build();

const result = await pipeline.run('Build a website');
console.log(pipeline.getNarrative()); // Full causal trace across all agents
```

### Swarm with specialist routing

```typescript
const swarm = Swarm.create({ provider })
  .system('Route to the best specialist for the task.')
  .specialist('coder', 'Write and debug code.', coderAgent)
  .specialist('writer', 'Write documentation and articles.', writerAgent)
  .specialist('analyst', 'Analyze data and produce reports.', analystAgent)
  .build();

await swarm.run('Write unit tests for the auth module');
```
