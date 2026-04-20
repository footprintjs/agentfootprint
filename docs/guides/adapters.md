# Adapters

> **Like:** power-plug adapters for traveling between countries — same device, different socket. The agent code doesn't change when you switch from Anthropic to OpenAI to a local model.

Adapters bridge external systems to agentfootprint's interfaces. There are two categories:

1. **LLM Adapters** — implement `LLMProvider` to connect to LLM APIs
2. **Protocol Adapters** — bridge external protocols (MCP, A2A) to agentfootprint's ToolProvider/RunnerLike

> **Resilience adapters** (`fallbackProvider`, `resilientProvider`) wrap one or more `LLMProvider`s into a more robust one. They live with the security primitives because they pair with `gatedTools` for production hardening — see [security.md](security.md). They do *not* require special adapter code.

---

## LLM Adapters

### Provider Factory Pattern

The recommended way to create providers is via model config factories + `createProvider()`:

```typescript
import { createProvider, anthropic, openai, ollama, bedrock } from 'agentfootprint';

// Anthropic Claude
const claude = createProvider(anthropic('claude-sonnet-4-20250514'));

// OpenAI GPT-4o
const gpt = createProvider(openai('gpt-4o'));

// Ollama (local, OpenAI-compatible)
const llama = createProvider(ollama('llama3'));

// AWS Bedrock
const bedrockClaude = createProvider(bedrock('anthropic.claude-3-sonnet-20240229-v1:0'));
```

### Model Config Factories

| Factory | Provider | Options |
|---------|----------|---------|
| `anthropic(modelId, options?)` | Anthropic | `apiKey?`, `maxTokens?` |
| `openai(modelId, options?)` | OpenAI | `apiKey?`, `baseUrl?`, `maxTokens?` |
| `ollama(modelId, options?)` | Ollama | `baseUrl?` (default: `http://localhost:11434`), `maxTokens?` |
| `bedrock(modelId, options?)` | AWS Bedrock | `maxTokens?` |

All return a `ModelConfig` that `createProvider()` resolves to the correct adapter.

### With Options

```typescript
// Custom API key
const provider = createProvider(anthropic('claude-sonnet-4-20250514', { apiKey: 'sk-...' }));

// Custom base URL (e.g., proxy)
const provider = createProvider(openai('gpt-4o', { baseUrl: 'https://my-proxy.com/v1' }));

// Max tokens
const provider = createProvider(anthropic('claude-sonnet-4-20250514', { maxTokens: 2048 }));
```

### Direct Adapter Construction

For advanced use cases, construct adapters directly:

```typescript
import { AnthropicAdapter, OpenAIAdapter, BedrockAdapter } from 'agentfootprint';

const adapter = new AnthropicAdapter({
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 4096,
});
```

| Adapter | Required SDK |
|---------|-------------|
| `AnthropicAdapter` | `@anthropic-ai/sdk` |
| `OpenAIAdapter` | `openai` |
| `BedrockAdapter` | `@aws-sdk/client-bedrock-runtime` |

### Mock Adapter

For testing. Returns deterministic responses with no network calls.

```typescript
import { mock } from 'agentfootprint';

// Simple responses
const provider = mock([
  { content: 'First response.' },
  { content: 'Second response.' },
]);

// With tool calls
const provider = mock([
  {
    content: 'Let me search.',
    toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test' } }],
  },
  { content: 'Based on search results...' },
]);
```

Responses are consumed in order. If the mock runs out of responses, it throws.

### MockRetriever

For testing RAG concepts:

```typescript
import { mockRetriever } from 'agentfootprint';

const retriever = mockRetriever([
  {
    query: 'company policy',
    chunks: [
      { content: '20 days PTO per year.', score: 0.95 },
      { content: 'Remote work 3 days/week.', score: 0.88 },
    ],
  },
]);
```

### LLMProvider Interface

All adapters implement this interface:

```typescript
interface LLMProvider {
  call(options: LLMCallOptions): Promise<LLMResponse>;
}

interface LLMCallOptions {
  messages: Message[];
  tools?: LLMToolDescription[];
  signal?: AbortSignal;
  maxTokens?: number;
}

interface LLMResponse {
  content: MessageContent;
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'tool_use' | 'length' | 'content_filter';
  usage?: TokenUsage;
  model?: string;
}
```

---

## Protocol Adapters

### MCP (Model Context Protocol)

Wraps an MCP server as a `ToolProvider`. MCP tools become available to any agent.

```typescript
import { mcpToolProvider } from 'agentfootprint';

const tools = mcpToolProvider({
  client: myMCPClient,    // You provide the MCP client implementation
  prefix: 'mcp_',         // Optional: prefix tool names to avoid collisions
});
```

The `MCPClient` interface is minimal — bring your own transport:

```typescript
interface MCPClient {
  listTools(): Promise<MCPToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;
}
```

Use with compositeTools to mix MCP tools with local tools:

```typescript
import { compositeTools, staticTools, mcpToolProvider } from 'agentfootprint';

const allTools = compositeTools([
  staticTools([localSearchTool]),
  mcpToolProvider({ client: mcpClient }),
]);
```

### A2A (Agent-to-Agent)

Wraps an external A2A endpoint as a `RunnerLike`. The remote agent becomes composable in FlowChart, Swarm, or agentAsTool.

```typescript
import { a2aRunner } from 'agentfootprint';

const remoteAgent = a2aRunner({
  client: myA2AClient,
  agentId: 'translator-agent',
});

// Use in a FlowChart
const pipeline = FlowChart.create()
  .agent('translate', 'Translate', remoteAgent)
  .build();

// Or as a Swarm specialist
const swarm = Swarm.create({ provider })
  .specialist('translate', 'Translate to Spanish.', remoteAgent)
  .build();
```

The `A2AClient` interface:

```typescript
interface A2AClient {
  sendMessage(
    agentId: string,
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<A2AResponse>;
}

interface A2AResponse {
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}
```

---

## Provider Semantic Differences

Adapters normalize most things, but a few provider-specific behaviors leak through. Be aware:

| Provider feature | Adapter handling |
|---|---|
| Anthropic extended thinking | Surfaces as `thinking` events when `.streaming(true)` |
| OpenAI parallel tool calls | Returned as `toolCalls[]` with multiple entries; agentfootprint executes them per `.parallelTools()` setting |
| Bedrock model IDs | Use the full ARN-style id (`anthropic.claude-3-sonnet-20240229-v1:0`) — Bedrock IDs differ from Anthropic API IDs |
| Token usage shape | Normalized to `{ inputTokens, outputTokens }`; Anthropic's cache token fields are NOT yet surfaced |
| Stop reasons | Normalized to `'stop' \| 'tool_use' \| 'length' \| 'content_filter'`; provider-specific reasons are mapped to the closest match |

If your code branches on provider behavior, don't — write against the normalized interface and report the gap.

## Error Handling

All adapters normalize errors to `LLMError`:

```typescript
import { LLMError } from 'agentfootprint';

// Uniform error codes across all providers
type LLMErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'context_length'
  | 'invalid_request'
  | 'server'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'unknown';

// Check if retryable
const error = new LLMError({ message: 'rate limited', code: 'rate_limit', provider: 'openai' });
error.retryable; // true (rate_limit, server, timeout, network are retryable)
```

**Adapters do NOT retry automatically.** A `rate_limit` error propagates immediately. Wrap with `withRetry` (or use `resilientProvider` from [security.md](security.md)) to add retry behavior.

Combine with [orchestration wrappers](orchestration.md) for automatic retry on retryable errors:

```typescript
import { withRetry, LLMError } from 'agentfootprint';

const reliable = withRetry(agent, {
  maxRetries: 3,
  backoffMs: 1000,
  shouldRetry: (err) => err instanceof LLMError && err.retryable,
});
```
