# adapters/

Infrastructure choices — plug in your LLM provider, memory store, and protocol.

The interface is stable. Community adds adapters; core doesn't change.

## LLM Providers

| Adapter | Import | SDK |
|---------|--------|-----|
| `AnthropicAdapter` | `agentfootprint/providers` | `@anthropic-ai/sdk` (peer dep) |
| `OpenAIAdapter` | `agentfootprint/providers` | `openai` (peer dep) |
| `BedrockAdapter` | `agentfootprint/providers` | `@aws-sdk/client-bedrock-runtime` (peer dep) |
| `BrowserAnthropicAdapter` | `agentfootprint/providers` | None — fetch-based, browser-safe |
| `BrowserOpenAIAdapter` | `agentfootprint/providers` | None — fetch-based, browser-safe |
| `BrowserAnthropicAdapter` | `agentfootprint/providers` | None — fetch-based, browser-safe |
| `BrowserOpenAIAdapter` | `agentfootprint/providers` | None — fetch-based, browser-safe |
| `mock()` | `agentfootprint` | None — deterministic, $0 testing |

```typescript
// Testing — deterministic, $0
const agent = Agent.create({ provider: mock([{ content: 'Hello!' }]) });

// Production — swap one line
import { anthropic, createProvider } from 'agentfootprint/providers';
const agent = Agent.create({ provider: createProvider(anthropic('claude-sonnet-4-20250514')) });
```

All adapters implement the `LLMProvider` interface: `chat(messages, options?) → LLMResponse`.

## Memory Stores

Memory stores live under `agentfootprint/memory` (not this `adapters/`
directory). See `../memory/README.md` for the `MemoryStore` interface
and the reference `InMemoryStore` impl. Consumer-facing API:

```typescript
import { Agent } from 'agentfootprint';
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';

const pipeline = defaultPipeline({ store: new InMemoryStore() });
const agent = Agent.create({ provider }).memoryPipeline(pipeline).build();
```

## Protocol Adapters

| Adapter | What |
|---------|------|
| `mcpToolProvider()` | Connects to MCP tool servers — tools appear as native agent tools |
| `a2aRunner()` | Agent-to-Agent protocol — call remote agents as if local |

## Provider Composition

| Function | Import | What |
|----------|--------|------|
| `fallbackProvider()` | `agentfootprint/resilience` | Try provider A, fall back to B on failure |
| `resilientProvider()` | `agentfootprint/resilience` | Automatic retries with backoff |
| `createProvider()` | `agentfootprint/providers` | Create provider from ModelConfig |

## Adding Your Own Adapter

Implement `LLMProvider`:

```typescript
const myAdapter: LLMProvider = {
  chat: async (messages, options?) => ({
    content: 'response text',
    model: 'my-model',
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 20 },
  }),
};
```

That's it. Pass it to any builder: `Agent.create({ provider: myAdapter })`.
