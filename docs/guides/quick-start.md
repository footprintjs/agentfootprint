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

Add tools and the agent runs a ReAct loop — calling tools until it has enough information to respond.

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
      content: 'Let me search for that.',
      toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'AI trends' } }],
    },
    { content: 'Based on my research, AI is transforming multiple industries.' },
  ]),
})
  .system('You are a research assistant.')
  .tool(searchTool)
  .build();

const result = await agent.run('What are the AI trends?');
console.log(result.content);    // "Based on my research, AI is transforming multiple industries."
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

## Next Steps

- [Concepts](concepts.md) — understand the full concept ladder
- [Providers](providers.md) — customize prompts, messages, and tools
- [Recorders](recorders.md) — deep dive into all recorder types
- [Adapters](adapters.md) — connect to real LLMs
- [Orchestration](orchestration.md) — retry, fallback, circuit breaker
