<p align="center">
  <h1 align="center">agentfootprint</h1>
  <p align="center">
    <strong>The explainable agent framework &mdash; build AI agents you can explain, audit, and trust.</strong>
  </p>
</p>

<p align="center">
  <a href="https://github.com/footprintjs/agentfootprint/actions"><img src="https://github.com/footprintjs/agentfootprint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/agentfootprint"><img src="https://img.shields.io/npm/v/agentfootprint.svg?style=flat" alt="npm version"></a>
  <a href="https://github.com/footprintjs/agentfootprint/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<br>

Most agent frameworks are black boxes. You wire up an LLM, add tools, hit run — and get a result with no visibility into what happened or why. **agentfootprint makes every decision traceable.**

```bash
npm install agentfootprint
```

---

## Why agentfootprint?

| Feature | agentfootprint | LangGraph | Strands (AWS) |
|---------|---------------|-----------|---------------|
| **Testing story** | `mock()` → `anthropic()`, $0 deterministic tests | LangSmith (paid SaaS) | None |
| **Observability** | Built-in recorders (tokens, cost, quality, guardrails) | Requires LangSmith | CloudWatch |
| **Visualization** | Flowchart UI + time-travel debugging | LangGraph Studio (separate app) | None |
| **Composition** | Concept ladder: simple → complex | Graphs from day 1 | Flat, no composition |
| **Provider lock-in** | None — Anthropic, OpenAI, Bedrock, Ollama | OpenAI-biased | Bedrock-biased |
| **Learning curve** | Start with LLMCall, compose up | Learn graph DSL upfront | Simple but limited |

**Three things no one else has:**

1. **Adapter-swap testing** — Write tests with `mock()`, deploy with `anthropic()`. Same code. Zero changes. Full coverage at $0.
2. **Concept ladder** — Start simple, compose up: `LLMCall → Agent → RAG → FlowChart → Swarm`. No upfront graph DSL.
3. **Built-in explainability** — Causal traces, narrative, time-travel, flowchart visualization. Not a paid add-on. Built into the library.

---

## Quick Start

### Simple LLM Call

```typescript
import { LLMCall, mock } from 'agentfootprint';

const call = LLMCall.create({ provider: mock([{ content: 'Paris.' }]) })
  .system('You are a geography expert.')
  .build();

const result = await call.run('What is the capital of France?');
console.log(result.content); // "Paris."

// Every run produces a human-readable trace
console.log(call.getNarrative());
```

### Agent with Tools

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

const searchTool = defineTool({
  id: 'web_search',
  description: 'Search the web for information.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  handler: async (input) => ({
    content: `Results for "${input.query}": AI is transforming industries.`,
  }),
});

const agent = Agent.create({
  provider: mock([
    {
      content: 'Let me search.',
      toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'AI trends' } }],
    },
    { content: 'Based on my research, AI is transforming multiple industries.' },
  ]),
})
  .system('You are a research assistant.')
  .tool(searchTool)
  .build();

const result = await agent.run('What are the AI trends?');
```

### RAG (Retrieval-Augmented Generation)

```typescript
import { RAG, mock, mockRetriever } from 'agentfootprint';

const rag = RAG.create({
  provider: mock([{ content: 'You get 20 days PTO and can work remotely 3 days/week.' }]),
  retriever: mockRetriever([{
    query: 'company policy',
    chunks: [
      { content: 'Employees get 20 days PTO per year.', score: 0.95 },
      { content: 'Remote work is allowed 3 days per week.', score: 0.88 },
    ],
  }]),
})
  .system('Answer based on retrieved context.')
  .build();

const result = await rag.run('What is our PTO policy?');
```

### FlowChart — Sequential Pipeline

```typescript
import { FlowChart, Agent, LLMCall, mock } from 'agentfootprint';

const researcher = Agent.create({
  provider: mock([{ content: 'AI is growing in healthcare.' }]),
  name: 'researcher',
})
  .system('Research the given topic.')
  .build();

const writer = LLMCall.create({
  provider: mock([{ content: 'Article: AI in Healthcare.' }]),
})
  .system('Write an article based on the research.')
  .build();

const pipeline = FlowChart.create()
  .agent('research', 'Research', researcher)
  .agent('write', 'Write', writer)
  .build();

const result = await pipeline.run('AI trends 2025');
// Pipeline supports narrative, snapshot, subflow drill-down
console.log(pipeline.getNarrative());
```

### Swarm — LLM-Driven Delegation

```typescript
import { Swarm, mock } from 'agentfootprint';
import type { RunnerLike } from 'agentfootprint';

const researcher: RunnerLike = {
  run: async (msg) => ({ content: `Research: ${msg}` }),
};
const coder: RunnerLike = {
  run: async (msg) => ({ content: `Code: ${msg}` }),
};

const swarm = Swarm.create({
  provider: mock([
    {
      content: 'This needs research.',
      toolCalls: [{ id: 'tc1', name: 'research', arguments: { message: 'quantum computing' } }],
    },
    { content: 'Here are the findings on quantum computing.' },
  ]),
})
  .system('You are a project manager. Delegate to specialists.')
  .specialist('research', 'Deep research on any topic.', researcher)
  .specialist('code', 'Write code to solve problems.', coder)
  .build();

const result = await swarm.run('Explain quantum computing');
```

---

## Concept Ladder

Each concept builds on the previous, adding one capability:

| Concept | What it adds | Use case |
|---------|-------------|----------|
| **LLMCall** | Single LLM invocation | Summarization, classification |
| **Agent** | + Tool use loop (ReAct) | Research, code generation |
| **RAG** | + Retrieval | Q&A over documents |
| **FlowChart** | + Sequential/branching pipeline | Approval flows, ETL, content pipelines |
| **Swarm** | + Dynamic LLM-driven routing | Customer support, triage |

All five share the same interface: `.build()` → runner with `.run()`, `.getNarrative()`, `.getSnapshot()`, `.getSpec()`.

---

## Real LLM Providers

```typescript
import { LLMCall, createProvider, anthropic, openai, ollama, bedrock } from 'agentfootprint';

// Anthropic Claude
const claude = createProvider(anthropic('claude-sonnet-4-20250514'));

// OpenAI GPT-4o
const gpt = createProvider(openai('gpt-4o'));

// Ollama (local, OpenAI-compatible)
const llama = createProvider(ollama('llama3'));

// AWS Bedrock
const bedrockClaude = createProvider(bedrock('anthropic.claude-3-sonnet-20240229-v1:0'));

// Same code — only the provider changes
const call = LLMCall.create({ provider: claude })
  .system('You are helpful.')
  .build();

const result = await call.run('Hello!');
```

---

## Adapter-Swap Testing

The killer feature: write tests with `mock()`, deploy with real providers. Zero code changes.

```typescript
// test.ts — $0, instant, deterministic
const provider = mock([{ content: 'Paris is the capital of France.' }]);

// production.ts — swap one line
const provider = createProvider(anthropic('claude-sonnet-4-20250514'));

// Same agent code, same tools, same flowchart. Only the provider changes.
const agent = Agent.create({ provider })
  .system('You are a geography expert.')
  .tool(searchTool)
  .build();
```

---

## Observability — Recorders

Plug recorders into any concept via `.recorder()`:

```typescript
import { Agent, mock, TokenRecorder, CostRecorder, TurnRecorder, CompositeRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
const cost = new CostRecorder();
const turns = new TurnRecorder();
const all = new CompositeRecorder([tokens, cost, turns]);

const agent = Agent.create({ provider: mock([{ content: 'Hello!' }]) })
  .system('Be helpful.')
  .recorder(all)          // ← attach via builder
  .build();

await agent.run('Hi');

console.log(tokens.getStats());        // { totalCalls: 1, totalInput: 10, totalOutput: 5, ... }
console.log(cost.getTotalCost());      // 0.00045
console.log(turns.getCompletedCount()); // 1
```

| Recorder | What it tracks |
|----------|---------------|
| `TokenRecorder` | Input/output tokens per LLM call |
| `CostRecorder` | USD cost per model (configurable pricing) |
| `TurnRecorder` | Turn lifecycle (start → complete/error) |
| `ToolUsageRecorder` | Tool call counts, latency, errors |
| `QualityRecorder` | Score each response via custom judge function |
| `GuardrailRecorder` | Flag policy violations via custom check function |
| `CompositeRecorder` | Fan-out to multiple recorders at once |

---

## Orchestration — Reliability

```typescript
import { withRetry, withFallback, withCircuitBreaker } from 'agentfootprint';

// Retry on failure with backoff
const reliable = withRetry(agent, { maxRetries: 3, backoffMs: 1000 });

// Fall back to a cheaper model
const resilient = withFallback(expensiveAgent, cheapAgent);

// Fast-fail after repeated failures
const guarded = withCircuitBreaker(agent, {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

// Stack them — compose naturally
const production = withCircuitBreaker(
  withRetry(withFallback(primaryAgent, fallbackAgent), { maxRetries: 2 }),
  { failureThreshold: 3 },
);
```

---

## Error Handling

Normalized errors across all providers:

```typescript
import { LLMError } from 'agentfootprint';

// All provider errors become LLMError with uniform codes
// Codes: auth, rate_limit, context_length, invalid_request, server, timeout, aborted, network, unknown

const error = new LLMError({ message: 'rate limited', code: 'rate_limit', provider: 'openai' });
error.retryable; // true — rate_limit, server, timeout, network are retryable
```

---

## Protocol Adapters

### MCP (Model Context Protocol)

```typescript
import { mcpToolProvider } from 'agentfootprint';

// MCP server tools become agent tools automatically
const tools = mcpToolProvider({ client: myMCPClient });
```

### A2A (Agent-to-Agent)

```typescript
import { a2aRunner } from 'agentfootprint';

// External agents become RunnerLike — composable in flowcharts
const remote = a2aRunner({ client: myA2AClient, agentId: 'translator-es' });
```

---

## Multi-Modal Content

```typescript
import { userMessage, textBlock, base64Image, urlImage } from 'agentfootprint';

const msg = userMessage([
  textBlock('What is in this image?'),
  base64Image('image/png', base64Data),
]);
```

---

## Streaming

```typescript
import { StreamEmitter, SSEFormatter } from 'agentfootprint';

const emitter = new StreamEmitter();
emitter.on('token', (text) => process.stdout.write(text));
emitter.on('done', () => console.log('\n--- done ---'));
```

---

## Installation

```bash
npm install agentfootprint
```

Install provider SDKs as needed (all optional):

```bash
npm install @anthropic-ai/sdk   # Anthropic Claude
npm install openai               # OpenAI / Ollama
npm install @aws-sdk/client-bedrock-runtime  # AWS Bedrock
```

---

## Samples

The `test/samples/` directory contains 16 runnable examples:

| # | Sample | What it demonstrates |
|---|--------|---------------------|
| 01 | Simple LLM Call | `LLMCall.create().system().build()` |
| 02 | Agent with Tools | Tool use loop with `defineTool` |
| 03 | RAG Retrieval | Retriever + augmented generation |
| 04 | Prompt Strategies | Static, template, skill-based, composite prompts |
| 05 | Message Strategies | Sliding window, truncation, memory management |
| 06 | Tool Strategies | `agentAsTool`, `compositeTools`, `ToolRegistry` |
| 07 | FlowChart Sequential | Sequential pipeline with subflow drill-down |
| 08 | Swarm Delegation | Dynamic routing across specialists |
| 09 | Orchestration | `withRetry`, `withFallback`, `CircuitBreaker` |
| 10 | Recorders | `TokenRecorder`, `CostRecorder`, `.recorder()` API |
| 11 | Protocol Adapters | MCP tool provider, A2A runner |
| 12 | Agent Loop | Low-level `agentLoop()` control |
| 13 | Full Integration | End-to-end: RAG + tools + flowchart + recorders |
| 14 | Real Adapters | `AnthropicAdapter`, `OpenAIAdapter`, `BedrockAdapter` |
| 15 | Error Handling | `LLMError`, `wrapSDKError`, retry + error classification |
| 16 | Multi-modal | Image content with Anthropic and OpenAI |

---

## Architecture

```
src/
├── types/        → Content blocks, messages, LLM interfaces, errors
├── models/       → Provider config factories (anthropic, openai, ollama, bedrock)
├── adapters/     → LLM adapters (Anthropic, OpenAI, Bedrock, Mock) + protocol (MCP, A2A)
├── tools/        → ToolRegistry, defineTool
├── memory/       → Message history (sliding window, truncation)
├── scope/        → AgentScope + parsed response handling
├── providers/    → Prompt/tool/message providers (static, template, skill-based, composite)
├── stages/       → Pipeline stages (seed, prompt, LLM call, parse, handle, finalize)
├── concepts/     → High-level patterns (LLMCall, Agent, RAG, FlowChart, Swarm)
├── recorders/    → Scope recorders (V1) + AgentRecorders (V2: Token, Cost, Turn, Tool, Quality, Guardrail)
├── compositions/ → withRetry, withFallback, CircuitBreaker
├── streaming/    → StreamEmitter, SSEFormatter
├── executor/     → agentLoop — low-level agent execution
└── core/         → Shared interfaces (AgentLoopConfig, AgentRecorder, providers)
```

Built on [footprintjs](https://github.com/footprintjs/footPrint) — the flowchart pattern for backend code.

---

## AI Coding Tool Support

agentfootprint ships with built-in instructions for every major AI coding assistant:

```bash
npx agentfootprint-setup
```

| Tool | What gets installed |
|------|-------------------|
| **Claude Code** | `.claude/skills/agentfootprint/SKILL.md` + `CLAUDE.md` |
| **OpenAI Codex** | `AGENTS.md` |
| **GitHub Copilot** | `.github/copilot-instructions.md` |
| **Cursor** | `.cursor/rules/agentfootprint.md` |
| **Windsurf** | `.windsurfrules` |
| **Cline** | `.clinerules` |
| **Kiro** | `.kiro/rules/agentfootprint.md` |

---

[MIT](./LICENSE) &copy; [Sanjay Krishna Anbalagan](https://github.com/sanjay1909)
