# Quick Start

## Installation

```bash
npm install agentfootprint
```

Install provider SDKs as needed (all optional peer dependencies):

```bash
npm install @anthropic-ai/sdk          # Anthropic Claude
npm install openai                      # OpenAI / Ollama
npm install @aws-sdk/client-bedrock-runtime  # AWS Bedrock
```

---

## Your First LLMCall

> **Like:** asking a question, getting an answer. No tools, no loops, no memory.

The simplest concept — a single LLM invocation with no tools or loops.

```typescript
import { LLMCall, mock } from 'agentfootprint';

const call = LLMCall.create({ provider: mock([{ content: 'Paris.' }]) })
  .system('You are a geography expert.')
  .build();

const result = await call.run('What is the capital of France?');
console.log(result.content); // "Paris."

// Every run produces a human-readable trace
console.log(call.getNarrative());
// ["Entered SeedScope.", "Entered CallLLM.", "Entered ParseResponse.", ...]
```

---

## Agent with Tools

> **Like:** a research assistant — you ask, it looks things up, then answers.

Add tools and the agent runs a **ReAct loop** (*reasoning + acting* interleaved — Yao et al. 2023, ICLR) — calling tools until it has enough information to respond.

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

// Deterministic tool — easy to verify the agent's grounding
const addTool = defineTool({
  id: 'add',
  description: 'Add two integers and return the sum.',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  handler: async ({ a, b }) => ({ content: String(a + b) }),
});

const agent = Agent.create({
  provider: mock([
    {
      content: 'Let me compute that.',
      toolCalls: [{ id: 'tc1', name: 'add', arguments: { a: 17, b: 25 } }],
    },
    { content: 'The sum of 17 and 25 is 42.' },
  ]),
})
  .system('You are a math assistant. Use the add tool for arithmetic.')
  .tool(addTool)
  .build();

const result = await agent.run('What is 17 + 25?');
console.log(result.content);    // "The sum of 17 and 25 is 42."
console.log(result.iterations); // 2 (one tool call + one final response)
```

---

## Adapter-Swap Testing

The killer feature: write tests with `mock()`, deploy with real providers. Zero code changes.

```typescript
import { Agent, mock, createProvider, anthropic, defineTool } from 'agentfootprint';

// Define tools once
const searchTool = defineTool({
  id: 'search',
  description: 'Search for information.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  handler: async ({ q }) => ({ content: `Results for: ${q}` }),
});

// test.ts — $0, instant, deterministic
const testProvider = mock([
  { content: 'Searching...', toolCalls: [{ id: 't1', name: 'search', arguments: { q: 'test' } }] },
  { content: 'Found it.' },
]);

// production.ts — swap one line
const prodProvider = createProvider(anthropic('claude-sonnet-4-20250514'));

// Same agent code — only the provider changes
function buildAgent(provider) {
  return Agent.create({ provider })
    .system('You are a research assistant.')
    .tool(searchTool)
    .build();
}
```

---

## Observability

Attach recorders to track tokens, cost, and turn lifecycle.

```typescript
import { Agent, mock, TokenRecorder, CostRecorder, CompositeRecorder } from 'agentfootprint';

const tokens = new TokenRecorder();
const cost = new CostRecorder();
const all = new CompositeRecorder([tokens, cost]);

const agent = Agent.create({ provider: mock([{ content: 'Hello!' }]) })
  .system('Be helpful.')
  .recorder(all)
  .build();

await agent.run('Hi');

console.log(tokens.getStats());   // { totalCalls: 1, totalInputTokens: ..., ... }
console.log(cost.getTotalCost()); // 0
```

See [Recorders Guide](recorders.md) for all 7 recorder types.

---

## Explainability

Every concept produces three outputs after execution:

| Method | Returns | Purpose |
|--------|---------|---------|
| `getNarrative()` | `string[]` | Human-readable trace of what happened |
| `getSnapshot()` | `RuntimeSnapshot` | Full execution state for time-travel debugging |
| `getSpec()` | Stage graph metadata | Flowchart visualization |

```typescript
const agent = Agent.create({ provider: mock([{ content: 'Done.' }]) })
  .system('Be helpful.')
  .build();

await agent.run('Hello');

// What happened (human-readable)
agent.getNarrative().forEach((line) => console.log(line));

// Full state (machine-readable)
const snapshot = agent.getSnapshot();
console.log(snapshot?.sharedState);

// Stage graph (for UI visualization)
const spec = agent.getSpec();
```

---

## Before You Ship

The examples above use `mock()` for clarity. Before deploying anything for real:

| Concern | What to add |
|---|---|
| **Real provider** | `createProvider(anthropic('claude-sonnet-4-20250514'))` instead of `mock()` |
| **Cost / token caps** | Pass `maxTokens` to the model factory; attach `TokenRecorder` + `CostRecorder` |
| **Cancellation** | Pass `signal: abortController.signal` to `.run()` so users can cancel |
| **Retry on rate limits** | Wrap the runner with `withRetry({ shouldRetry: (e) => e.retryable })` — see [orchestration.md](orchestration.md) |
| **Tool authorization** | Wrap tools with `gatedTools(...)` — see [security.md](security.md) |
| **Audit trail** | Attach `agentObservability()` for tokens + tools + cost + grounding in one call |

Treat the move from `mock()` to a real provider as a deployment milestone, not a one-line swap.

---

## Next Steps

- [Concepts](concepts.md) — understand the full concept ladder
- [Patterns](patterns.md) — Regular vs Dynamic ReAct + 4 composition patterns
- [Providers](providers.md) — customize prompts, messages, and tools
- [Recorders](recorders.md) — deep dive into all recorder types
- [Adapters](adapters.md) — connect to real LLMs
- [Orchestration](orchestration.md) — retry, fallback, circuit breaker
- [Security](security.md) — tool gating + provider resilience
