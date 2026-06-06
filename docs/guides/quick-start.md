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

const call = LLMCall.create({
  provider: mock({ reply: 'Paris.' }),
  model: 'mock',
})
  .system('You are a geography expert.')
  .build();

// run() takes an input object; the result IS the answer string
const result = await call.run({ message: 'What is the capital of France?' });
console.log(result); // "Paris."

// Every run produces a footprintjs snapshot for time-travel + structured narrative entries
console.log(call.getSnapshot()?.sharedState);
```

---

## Agent with Tools

> **Like:** a research assistant — you ask, it looks things up, then answers.

Add tools and the agent runs a **ReAct loop** (*reasoning + acting* interleaved — Yao et al. 2023, ICLR) — calling tools until it has enough information to respond.

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

// Deterministic tool — easy to verify the agent's grounding
const addTool = defineTool<{ a: number; b: number }, string>({
  name: 'add',
  description: 'Add two integers and return the sum.',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  execute: async ({ a, b }) => String(a + b),
});

const agent = Agent.create({
  provider: mock({
    replies: [
      {
        content: 'Let me compute that.',
        toolCalls: [{ id: 'tc1', name: 'add', args: { a: 17, b: 25 } }],
      },
      { content: 'The sum of 17 and 25 is 42.' },
    ],
  }),
  model: 'mock',
})
  .system('You are a math assistant. Use the add tool for arithmetic.')
  .tool(addTool)
  .build();

const result = await agent.run({ message: 'What is 17 + 25?' });
console.log(result); // "The sum of 17 and 25 is 42." (the result IS the answer string)

// Iteration count + token totals arrive on the turn_end event
agent.on('agentfootprint.agent.turn_end', (e) =>
  console.log(`${e.payload.iterationCount} iterations`),
);
```

---

## Adapter-Swap Testing

The killer feature: write tests with `mock()`, deploy with real providers. Zero code changes.

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';
import { anthropic } from 'agentfootprint/llm-providers';

// Define tools once
const searchTool = defineTool<{ q: string }, string>({
  name: 'search',
  description: 'Search for information.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  execute: async ({ q }) => `Results for: ${q}`,
});

// test.ts — $0, instant, deterministic
const testProvider = mock({
  replies: [
    { content: 'Searching...', toolCalls: [{ id: 't1', name: 'search', args: { q: 'test' } }] },
    { content: 'Found it.' },
  ],
});

// production.ts — swap one line. The provider factory takes options;
// `model: 'anthropic'` resolves to the provider's `defaultModel`.
const prodProvider = anthropic({ defaultModel: 'claude-sonnet-4-5-20250929' });

// Same agent code — only the provider changes
function buildAgent(provider) {
  return Agent.create({ provider, model: 'anthropic' })
    .system('You are a research assistant.')
    .tool(searchTool)
    .build();
}
```

> `mock` / `createProvider` / `browserAnthropic` / `browserOpenai` are on the
> main barrel; the vendor-SDK factories (`anthropic`, `openai`, `ollama`,
> `bedrock`) live on the `agentfootprint/llm-providers` subpath.

---

## Observability

Track tokens, cost, and turn lifecycle by subscribing to typed events. Every
runner is an event emitter — call `.on(eventName, listener)`.

```typescript
import { Agent, mock } from 'agentfootprint';

const agent = Agent.create({ provider: mock({ reply: 'Hello!' }), model: 'mock' })
  .system('Be helpful.')
  .build();

// Subscribe to typed events — fully type-checked payloads
agent.on('agentfootprint.stream.llm_end', (e) =>
  console.log(`tokens: ${e.payload.usage.input + e.payload.usage.output}`),
);
agent.on('agentfootprint.agent.turn_end', (e) =>
  console.log(`${e.payload.iterationCount} iterations`),
);

await agent.run({ message: 'Hi' });
```

For richer, grouped observability there's the `enable.*` namespace — e.g.
`agent.enable.cost({ ... })`, `agent.enable.observability({ strategy })`,
`agent.enable.liveStatus({ ... })`. To plug in your own collector, implement a
footprintjs `CombinedRecorder` and attach it via `.recorder(rec)` (on the
builder) or `agent.attach(rec)` (post-build).

See [Recorders Guide](recorders.md) for the recorder interfaces and built-in
factory recorders (`costRecorder`, `agentRecorder`, `permissionRecorder`, …).

---

## Explainability

Every concept produces three outputs after execution:

| Method | Returns | Purpose |
|--------|---------|---------|
| `getLastNarrativeEntries()` | `readonly CombinedNarrativeEntry[]` | Structured trace of what happened |
| `getSnapshot()` | `RuntimeSnapshot \| undefined` | Full execution state for time-travel debugging |
| `getSpec()` | `FlowChart` | Stage graph metadata for flowchart visualization |

```typescript
const agent = Agent.create({ provider: mock({ reply: 'Done.' }), model: 'mock' })
  .system('Be helpful.')
  .build();

await agent.run({ message: 'Hello' });

// What happened (structured narrative entries)
agent.getLastNarrativeEntries().forEach((entry) => console.log(entry.text));

// Full state (machine-readable; undefined before the first run completes)
const snapshot = agent.getSnapshot();
console.log(snapshot?.sharedState);

// Stage graph (for UI visualization) — stable reference, built once
const spec = agent.getSpec();
```

---

## Before You Ship

The examples above use `mock()` for clarity. Before deploying anything for real:

| Concern | What to add |
|---|---|
| **Real provider** | `anthropic({ defaultModel: '...' })` (from `agentfootprint/llm-providers`) with `model: 'anthropic'` — or `createProvider({ kind: 'anthropic', defaultModel: '...' })` — instead of `mock()` |
| **Cost / token caps** | Pass `maxTokens` to `Agent.create({ ... })`; pass a `pricingTable` + `costBudget` to emit `agentfootprint.cost.*` events |
| **Cancellation** | Pass `env: { signal: abortController.signal }` to `.run()` so users can cancel |
| **Retry on rate limits** | Wrap the **provider** with `withRetry(provider, { shouldRetry })` (from `agentfootprint/resilience`) — see [orchestration.md](orchestration.md) |
| **Tool authorization** | Gate the tool source with `gatedTools(...)` (from `agentfootprint/tool-providers`) and wire it via `.toolProvider(...)` — see [security.md](security.md) |
| **Audit trail** | Subscribe to typed events, or use the `agent.enable.observability({ strategy })` grouped strategy |

Treat the move from `mock()` to a real provider as a deployment milestone, not a one-line swap.

---

## Next Steps

- [Concepts](concepts.md) — the 5-layer taxonomy (2 primitives, 3 compositions, N patterns, context engineering, features)
- [Patterns](patterns.md) — Regular vs Dynamic ReAct + 4 composition patterns
- [Providers](providers.md) — customize prompts, messages, and tools
- [Recorders](recorders.md) — deep dive into all recorder types
- [Adapters](adapters.md) — connect to real LLMs
- [Orchestration](orchestration.md) — retry, fallback, circuit breaker
- [Security](security.md) — tool gating + provider resilience
