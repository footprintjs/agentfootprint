# Adapters

> **Like:** power-plug adapters for traveling between countries — same device, different socket. The agent code doesn't change when you switch from Anthropic to OpenAI to a local model.

Adapters bridge external systems to agentfootprint's interfaces. There are two categories:

1. **LLM Adapters** — implement `LLMProvider` to connect to LLM APIs
2. **Protocol Adapters** — bridge external protocols (MCP) to agentfootprint's `ToolProvider`

> **Resilience adapters** (`withRetry`, `withFallback`, `fallbackProvider`, `withCircuitBreaker`) wrap one or more `LLMProvider`s into a more robust one. They live in the `agentfootprint/resilience` subpath and pair with `gatedTools` for production hardening — see [security.md](security.md). They do *not* require special adapter code.

---

## LLM Adapters

The vendor-SDK providers live in the `agentfootprint/llm-providers` subpath — they
lazy-load their respective SDKs as peer dependencies. The browser-safe and mock
providers are also re-exported from the top-level `agentfootprint` barrel.

### Supported providers

| Provider | Factory | Subpath | Peer SDK | Auth |
|---|---|---|---|---|
| Anthropic (Claude) | `anthropic()` | `agentfootprint/llm-providers` | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` |
| OpenAI (GPT) | `openai()` | `agentfootprint/llm-providers` | `openai` | `OPENAI_API_KEY` |
| **Azure OpenAI** | **`azureOpenai()`** | `agentfootprint/llm-providers` | `openai` | `api-key` (Azure) |
| OpenAI-compatible (Together, Groq, OpenRouter, vLLM, LM Studio, LiteLLM gateway, …) | `openai({ baseURL })` | `agentfootprint/llm-providers` | `openai` | `Bearer` |
| Ollama (local) | `ollama()` | `agentfootprint/llm-providers` | `openai` | none |
| AWS Bedrock | `bedrock()` | `agentfootprint/llm-providers` | `@aws-sdk/client-bedrock-runtime` | AWS IAM |
| Anthropic via `fetch` (browser/edge) | `browserAnthropic()` | `agentfootprint` (main) | none | key |
| OpenAI via `fetch` (browser/edge) | `browserOpenai()` | `agentfootprint` (main) | none | key |
| **Azure OpenAI** via `fetch` (browser/edge) | **`browserAzureOpenai()`** | `agentfootprint` (main) | none | `api-key` (Azure) |
| Mock (tests, no network) | `mock()` | `agentfootprint` (main) | none | none |

> **Don't want to pick by hand? Let the env decide.** `providerFromEnv()` reads
> your `.env` and returns the right provider — no `if`/`switch` in your code. See
> [Env-driven: `providerFromEnv()`](#env-driven-providerfromenv) below. Ideal when
> "many small companies show up with an API key" — they fill in `.env`, you ship
> one code path.

**Connecting a company endpoint** — three buckets:
1. **OpenAI-compatible** (a base URL + key + `Bearer`): most gateways and "we expose
   an OpenAI-compatible API" setups → `openai({ baseURL, apiKey })`. No new code.
2. **Azure OpenAI** (`*.openai.azure.com`, `api-key` header, `api-version`,
   deployment-as-model): → `azureOpenai({ endpoint, apiKey, apiVersion, deployment })`.
3. **Anything else** → implement the `LLMProvider` interface (below) — ~30 lines.

### Provider Factories

Each provider has a lowercase factory that takes an options object:

```typescript
import { anthropic, openai, azureOpenai, ollama, bedrock } from 'agentfootprint/llm-providers';

// Anthropic Claude
const claude = anthropic({ model: 'claude-sonnet-4-20250514', apiKey: process.env.ANTHROPIC_API_KEY });

// OpenAI GPT-4o
const gpt = openai({ model: 'gpt-4o', apiKey: process.env.OPENAI_API_KEY });

// Azure OpenAI — a company resource. The request's `model` is the DEPLOYMENT name;
// the shorthand 'azure' resolves to the configured `deployment`.
const azure = azureOpenai({
  endpoint: process.env.OPENAI_BASE_URL,            // https://my-co.openai.azure.com
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION, // e.g. 2024-12-01-preview
  deployment: process.env.MODEL_NAME,               // e.g. gpt-4o-128k
});
// Agent.create({ provider: azure, model: 'azure' })

// OpenAI-compatible (Together, Groq, OpenRouter, vLLM, LiteLLM gateway, …)
const groq = openai({ baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, defaultModel: 'llama-3.3-70b-versatile' });

// Ollama (local, OpenAI-compatible)
const llama = ollama({ model: 'llama3' });

// AWS Bedrock
const bedrockClaude = bedrock({ model: 'anthropic.claude-3-sonnet-20240229-v1:0' });
```

> **Azure ≠ OpenAI-compatible.** Don't point `openai({ baseURL })` at an
> `*.openai.azure.com` URL — Azure uses a deployment-scoped path, `api-key` header
> auth, and an `api-version` param. Use `azureOpenai(...)`, which wraps the SDK's
> `AzureOpenAI` client and reuses the same completion/streaming/tool logic.

Each factory returns an `LLMProvider` directly — ready to pass to
`Agent.create({ provider })` or `LLMCall.create({ provider })`.

### Config-driven: `createProvider()`

When the provider is chosen at runtime (env var, feature flag, tenant
preference), use `createProvider()` with a tagged options object. The `kind`
field selects the adapter; the rest of the object is the provider's options:

```typescript
import { createProvider } from 'agentfootprint';

const provider = createProvider({
  kind: process.env.LLM_PROVIDER ?? 'mock',   // 'mock' | 'anthropic' | 'openai' | 'ollama' | 'bedrock' | 'browser-anthropic' | 'browser-openai'
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL,
});
```

`createProvider` deliberately exposes only the common subset of options. For
provider-specific keys (Bedrock region, Ollama host, browser `apiUrl`), call the
underlying factory directly.

### Env-driven: `providerFromEnv()`

The fastest path when the credentials live in a `.env` file (a company hands you
an API key + endpoint, or a teammate runs the app on their own keys).
`providerFromEnv()` **reads the environment, detects which provider is configured,
and returns it** — your code has no branching:

```typescript
import { Agent, providerFromEnv } from 'agentfootprint';

const { provider, model } = providerFromEnv({ fallbackToMock: true });
const agent = Agent.create({ provider, model }).build();
```

Detection order (first match wins):

| If these env vars are set | Resolves to | `model` returned |
|---|---|---|
| `AZURE_OPENAI_API_KEY` + (`AZURE_OPENAI_ENDPOINT` \| `OPENAI_BASE_URL`) | `azureOpenai()` | `'azure'` (→ the deployment) |
| `ANTHROPIC_API_KEY` | `anthropic()` | `LLM_MODEL` ?? `'anthropic'` |
| `OPENAI_API_KEY` | `openai()` | `LLM_MODEL` ?? `'openai'` |
| *(none)* | throws — or the mock with `{ fallbackToMock: true }` | `'mock'` |

For Azure it also reads `AZURE_OPENAI_API_VERSION` and `AZURE_OPENAI_DEPLOYMENT`
(or `MODEL_NAME` as the deployment). A typical company `.env`:

```bash
OPENAI_BASE_URL=https://your-co.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_API_VERSION=2024-12-01-preview
MODEL_NAME=gpt-4o-128k          # the Azure DEPLOYMENT name
```

`providerFromEnv()` is **Node-only** (it reads `process.env`); it lazy-loads only
the SDK for the detected provider, so the others stay optional. In the browser,
read `import.meta.env` yourself and call `browserAzureOpenai()` /
`browserAnthropic()` directly. Returns `{ provider, model, kind }` where `kind` is
`'azure-openai' | 'anthropic' | 'openai' | 'mock'`. See
[examples/features/16-providers.ts](../../examples/features/16-providers.ts).

### Direct Class Construction

For advanced use cases, construct the provider classes directly:

```typescript
import { AnthropicProvider, OpenAIProvider, BedrockProvider } from 'agentfootprint/llm-providers';

const provider = new AnthropicProvider({
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 4096,
});
```

| Class | Factory | Required peer SDK |
|---------|---------|-------------|
| `AnthropicProvider` | `anthropic()` | `@anthropic-ai/sdk` |
| `OpenAIProvider` | `openai()` / `ollama()` / `azureOpenai()` | `openai` |
| `BedrockProvider` | `bedrock()` | `@aws-sdk/client-bedrock-runtime` |

> **Browser providers:** `browserAnthropic()` / `browserOpenai()` /
> `browserAzureOpenai()` (and their `BrowserAnthropicProvider` /
> `BrowserOpenAIProvider` / `BrowserAzureOpenAIProvider` classes) talk to the
> vendor REST APIs over `fetch` with no Node SDK dependency — use them in
> browser/edge runtimes. They are re-exported from the top-level barrel.
> `browserAzureOpenai({ endpoint, apiKey, apiVersion, deployment })` builds the
> deployment-scoped Azure URL and uses the `api-key` header. **CORS:** browsers
> block direct calls to many vendor APIs — point `endpoint`/`apiUrl` at a
> same-origin proxy (e.g. a Vite dev proxy) when the browser blocks the call.

### Mock Adapter

For testing. Returns deterministic responses with no network calls. `mock()`
takes a `MockProviderOptions` object — not an array.

```typescript
import { mock } from 'agentfootprint';

// Single fixed reply
const provider = mock({ reply: 'hello' });

// Scripted multi-turn replies — consumed in order, one per LLM call
const provider = mock({
  replies: [
    'First response.',
    'Second response.',
  ],
});

// With tool calls (note the arg field is `args`, not `arguments`)
const provider = mock({
  replies: [
    {
      content: 'Let me search.',
      toolCalls: [{ id: 'tc1', name: 'search', args: { query: 'test' } }],
    },
    { content: 'Based on search results...' },
  ],
});

// Build the response from the request
const provider = mock({ respond: (req) => `echo: ${req.messages.at(-1)?.content}` });
```

Each entry in `replies` is either a string (plain text content) or a
`Partial<LLMResponse>` (so you can inject `toolCalls`, `usage`, `stopReason`).
Replies are consumed in order; if the agent calls the LLM more times than there
are replies, `complete()` / `stream()` throw a clear exhaustion error. Use
`provider.resetReplies()` to rewind the cursor across test scenarios, or
`MockProvider.realistic()` for a preset with 3–8 s thinking + word-by-word
streaming.

### LLMProvider Interface

All adapters implement this interface (`name` + `complete()`, with an optional
`stream()`):

```typescript
interface LLMProvider {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
  stream?(req: LLMRequest): AsyncIterable<LLMChunk>;
}

interface LLMRequest {
  readonly systemPrompt?: string;
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly LLMToolSchema[];
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stop?: readonly string[];
  readonly signal?: AbortSignal;
  readonly thinking?: { readonly budget: number };
}

interface LLMResponse {
  readonly content: string;
  readonly toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[];
  readonly usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number; thinking?: number };
  readonly stopReason: string;
  readonly providerRef?: string;
  readonly rawThinking?: unknown;
}
```

To bring your own provider (Cohere, on-prem, fine-tuned), implement this
interface — `complete()` is required, `stream()` is optional. The `MockProvider`
source is the canonical reference.

---

## Protocol Adapters

### MCP (Model Context Protocol)

Connect to an MCP server, snapshot its tools as agentfootprint `Tool[]`, then
register them on any agent. agentfootprint's MCP adapter is **client-only** — it
consumes MCP servers.

```typescript
import { mcpClient } from 'agentfootprint';

const slack = await mcpClient({
  name: 'slack-mcp',
  transport: { transport: 'stdio', command: 'npx', args: ['-y', 'slack-mcp-server'] },
  // or HTTP: { transport: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer ...' } }
});

const slackTools = await slack.tools();   // Promise<readonly Tool[]>
```

The returned `McpClient` is `tools()` / `refresh()` / `close()`:

```typescript
interface McpClient {
  readonly name: string;
  tools(): Promise<readonly Tool[]>;     // snapshot the server's tools
  refresh(): Promise<readonly Tool[]>;   // re-fetch after the server changes its tool set
  close(): Promise<void>;                // close the transport
}
```

For development and tests, `mockMcpClient` gives an in-memory server with the
same `McpClient` shape — swap it for `mcpClient` once the real server is ready:

```typescript
import { mockMcpClient } from 'agentfootprint';

const slack = mockMcpClient({
  name: 'slack-mcp',
  tools: [
    {
      name: 'send_message',
      description: 'Post a message to a channel',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      handler: async ({ text }) => `Posted: ${text}`,
    },
  ],
});
```

Mix MCP tools with local tools by combining the resolved `Tool[]` and wrapping
with a `ToolProvider` (`staticTools` / `gatedTools` from
`agentfootprint/tool-providers`):

```typescript
import { staticTools, gatedTools } from 'agentfootprint';

const slackTools = await slack.tools();
const provider = gatedTools(
  staticTools([localSearchTool, ...slackTools]),
  (name) => allowed(name),   // permission gate over the combined set
);
```

### Composing remote / sub-agents as tools

There is no built-in A2A adapter. To make a sub-flow or sub-agent callable by an
agent's LLM, wrap any footprintjs `FlowChart` (including one produced by
`Agent.create(...).build()`) as a `Tool` with `flowchartAsTool`:

```typescript
import { flowchartAsTool } from 'agentfootprint';

const translateTool = flowchartAsTool({
  name: 'translate',
  description: 'Translate text to Spanish.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  flowchart: translatorChart,
  resultMapper: (snapshot) => String(snapshot.values.output),
});
```

For multi-agent handoff, use the `swarm(...)` pattern (from the patterns layer)
with a fixed agent roster and a `route` function — see [patterns.md](patterns.md).

---

## Provider Semantic Differences

Adapters normalize most things, but a few provider-specific behaviors leak through. Be aware:

| Provider feature | Adapter handling |
|---|---|
| Anthropic extended thinking | Enable via `Agent.create(...).thinking({ budget })`; normalized thinking lands on `LLMMessage.thinkingBlocks` and `LLMResponse.usage.thinking` |
| OpenAI parallel tool calls | Returned as `toolCalls[]` with multiple entries; the agent runner dispatches every entry returned in one turn |
| Bedrock model IDs | Use the full ARN-style id (`anthropic.claude-3-sonnet-20240229-v1:0`) — Bedrock IDs differ from Anthropic API IDs |
| Token usage shape | Normalized to `usage: { input, output, cacheRead?, cacheWrite?, thinking? }` on `LLMResponse` |
| Stop reasons | `LLMResponse.stopReason` is a normalized string (e.g. `'stop'`, `'tool_use'`); provider-specific reasons are mapped to the closest match |

If your code branches on provider behavior, don't — write against the normalized interface and report the gap.

## Error Handling

**Adapters do NOT retry automatically.** A provider error propagates immediately.
Add reliability by wrapping the provider with the decorators in
`agentfootprint/resilience` — each preserves the `LLMProvider` interface, so they
stack freely:

```typescript
import { withRetry, withFallback, fallbackProvider, withCircuitBreaker } from 'agentfootprint/resilience';
import { anthropic, openai } from 'agentfootprint/llm-providers';

// Retry the primary on transient failures (defaults: 3 attempts, exponential backoff)
const reliable = withRetry(anthropic({ apiKey: A }), {
  maxAttempts: 5,
  initialDelayMs: 1000,
  shouldRetry: (err, attempt) => attempt < 5,   // default skips AbortError + 4xx (except 429)
});

// Fall back to a second provider on error
const robust = withFallback(anthropic({ apiKey: A }), openai({ apiKey: O }));

// Chain N providers (sugar over repeated withFallback)
const chain = fallbackProvider(anthropic({ apiKey: A }), openai({ apiKey: O }));

// Open a circuit breaker after repeated failures
const guarded = withCircuitBreaker(anthropic({ apiKey: A }));
```

`withRetry` and `withFallback` wrap an **`LLMProvider`**, not an agent — pass the
wrapped provider to `Agent.create({ provider: reliable })`. `withCircuitBreaker`
throws a typed `CircuitOpenError` once the breaker trips.

For richer reliability policies (circuit breaker plus fallback plus stuck-loop
detection driven by the agent runner), see the `agentfootprint/reliability`
subpath and [orchestration.md](orchestration.md).
