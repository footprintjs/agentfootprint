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

| Store | Import | Backend |
|-------|--------|---------|
| `InMemoryStore` | `agentfootprint` | In-process Map (dev/testing) |
| `redisStore()` | `agentfootprint` | Redis (pass your client) |
| `postgresStore()` | `agentfootprint` | PostgreSQL (pass your client) |
| `dynamoStore()` | `agentfootprint` | AWS DynamoDB (pass your client) |

All stores implement `ConversationStore`: `load(id) → Message[]`, `save(id, messages) → void`.

```typescript
const agent = Agent.create({ provider })
  .memory({ store: redisStore({ client: redis }), conversationId: 'user-123' })
  .build();
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
