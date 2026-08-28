# Adapters

> **Like:** power-plug adapters for traveling between countries — same device, different socket. The agent code doesn't change when you switch from Anthropic to OpenAI to a local model.

Adapters bridge external systems to agentfootprint's interfaces. There are two categories:

1. **LLM Adapters** — implement `LLMProvider` to connect to LLM APIs
2. **Protocol Adapters** — bridge external protocols (MCP) to agentfootprint's `ToolProvider`

> **Resilience adapters** (`withRetry`, `withFallback`, `fallbackProvider`, `withCircuitBreaker`) wrap one or more `LLMProvider`s into a more robust one. They live in the `agentfootprint/resilience` subpath and pair with `gatedTools` for production hardening — see [security.md](security.md). They do *not* require special adapter code.

---

## LLM Adapters

The vendor-SDK providers live in the `agentfootprint/providers` subpath — they
lazy-load their respective SDKs as peer dependencies. The browser-safe and mock
providers are also re-exported from the top-level `agentfootprint` barrel.

### Supported providers

| Provider | Factory | Subpath | Peer SDK | Auth |
|---|---|---|---|---|
| Anthropic (Claude) | `anthropic()` | `agentfootprint/providers` | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` |
| OpenAI (GPT) | `openai()` | `agentfootprint/providers` | `openai` | `OPENAI_API_KEY` |
| **Azure OpenAI** | **`azureOpenai()`** | `agentfootprint/providers` | `openai` (+ optional `@azure/identity`) | `api-key`, **or keyless Entra via `credential`** |
| **Microsoft Foundry** (project endpoint) | **`foundry()`** | `agentfootprint/providers` | `openai` (+ optional `@azure/identity`) | Entra `Bearer` — a `credential`, an `apiKey` (string or callback), or `DefaultAzureCredential` when neither is given |
| **Foundry Local** (on-device) | **`foundryLocal()`** | `agentfootprint/providers` | none — `fetch` only | none (no key exists on this wire) |
| OpenAI-compatible (Together, Groq, OpenRouter, vLLM, LM Studio, LiteLLM gateway, …) | `openai({ baseURL })` | `agentfootprint/providers` | `openai` | `Bearer` |
| OpenAI-compatible behind a **short-lived token** (Vertex AI, Entra / managed identity, any OAuth gateway) | `openai({ baseURL, apiKey: async () => token })` | `agentfootprint/providers` | `openai` | `Bearer`, re-read per request |
| Ollama (local) | `ollama()` | `agentfootprint/providers` | `openai` | none |
| AWS Bedrock | `bedrock()` | `agentfootprint/providers` | `@aws-sdk/client-bedrock-runtime` | AWS IAM |
| Anthropic via `fetch` (browser/edge) | `browserAnthropic()` | `agentfootprint` (main) | none | key |
| OpenAI via `fetch` (browser/edge) | `browserOpenai()` | `agentfootprint` (main) | none | key |
| **Azure OpenAI** via `fetch` (browser/edge) | **`browserAzureOpenai()`** | `agentfootprint` (main) | none | `api-key` (Azure) |
| Mock (tests, no network) | `mock()` | `agentfootprint` (main) | none | none |

> **Don't want to pick by hand? Let the env decide.** `providerFromEnv()` reads
> your `.env` and returns the right provider — no `if`/`switch` in your code. See
> [Env-driven: `providerFromEnv()`](#env-driven-providerfromenv) below. Ideal when
> "many small companies show up with an API key" — they fill in `.env`, you ship
> one code path.

**Connecting a company endpoint** — five buckets:
1. **OpenAI-compatible** (a base URL + key + `Bearer`): most gateways and "we expose
   an OpenAI-compatible API" setups → `openai({ baseURL, apiKey })`. No new code.
2. **Azure OpenAI** (`*.openai.azure.com`, `api-key` header, `api-version`,
   deployment-as-model): → `azureOpenai({ endpoint, apiVersion, deployment })` with
   either `apiKey` (a string) **or** `credential` (keyless Entra ID) — never both.
3. **Microsoft Foundry project**
   (`https://{account}.services.ai.azure.com/api/projects/{project}`): →
   `foundry({ projectEndpoint, deployment, credential })`. No `api-version`, and
   inside a hosted Foundry container `foundry()` with no arguments is the whole
   configuration — see [foundry.md](foundry.md).
4. **OpenAI-compatible, but the credential expires** (Vertex AI, any OAuth-fronted
   gateway): → `openai({ baseURL, apiKey: async () => token })`. Pass a
   **function**, not a string — see
   [Rotating credentials](#rotating-credentials-a-token-that-expires) below.
5. **Anything else** → implement the `LLMProvider` interface (below) — ~30 lines.

### Provider Factories

Each provider has a lowercase factory that takes an options object:

```typescript
import { anthropic, openai, azureOpenai, foundry, foundryLocal, ollama, bedrock } from 'agentfootprint/providers';
import { DefaultAzureCredential } from '@azure/identity';   // optional peer — only for the keyless doors

// Anthropic Claude
const claude = anthropic({ model: 'claude-sonnet-4-20250514', apiKey: process.env.ANTHROPIC_API_KEY });

// OpenAI GPT-4o
const gpt = openai({ model: 'gpt-4o', apiKey: process.env.OPENAI_API_KEY });

// Azure OpenAI — a company resource. The request's `model` is the DEPLOYMENT name;
// the shorthand 'azure' resolves to the configured `deployment`.
const azure = azureOpenai({
  // The resource ROOT. `OPENAI_BASE_URL` and `AZURE_OPENAI_ENDPOINT` are two
  // names for it and reach the identical URL; a trailing slash, or a value that
  // already ends in `/openai`, is handled.
  endpoint: process.env.OPENAI_BASE_URL,            // https://my-co.openai.azure.com
  // A STRING key — or drop this line and pass `credential: new DefaultAzureCredential()`
  // for keyless Entra auth. Both together are refused by name.
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION, // e.g. 2024-12-01-preview
  deployment: process.env.MODEL_NAME,               // e.g. gpt-4o-128k
});
// Agent.create({ provider: azure, model: 'azure' })

// Microsoft Foundry — a PROJECT endpoint over the api-version-free v1 route.
// The request's `model` is the DEPLOYMENT; the shorthand 'foundry' resolves to it.
// Inside a hosted Foundry container, `foundry()` with no arguments is complete:
// the endpoint is injected and the managed identity signs. Everywhere else:
const foundryProject = foundry({
  projectEndpoint: process.env.FOUNDRY_PROJECT_ENDPOINT,   // https://…/api/projects/…
  deployment: process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME,  // then MODEL_NAME
  credential: new DefaultAzureCredential(),                // or `apiKey`, never both
});
// Agent.create({ provider: foundryProject, model: 'foundry' })

// Foundry Local — on-device, free, no key. The port is DYNAMIC: `foundry server status`
// prints the live URL, and `endpoint` (or FOUNDRY_LOCAL_ENDPOINT) is how you pass it.
const local = foundryLocal('qwen2.5-0.5b');

// OpenAI-compatible (Together, Groq, OpenRouter, vLLM, LiteLLM gateway, …)
const groq = openai({ baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, defaultModel: 'llama-3.3-70b-versatile' });

// Ollama (local, OpenAI-compatible)
const llama = ollama({ model: 'llama3' });

// AWS Bedrock
const bedrockClaude = bedrock({ model: 'anthropic.claude-3-sonnet-20240229-v1:0' });
```

> **A deployment-scoped Azure URL is not OpenAI-compatible.** Don't point
> `openai({ baseURL })` at an `*.openai.azure.com` **deployment** path — that
> surface uses a deployment-scoped route, `api-key` header auth, and an
> `api-version` param. Use `azureOpenai(...)`, which wraps the SDK's `AzureOpenAI`
> client and reuses the same completion/streaming/tool logic.
>
> This is about the **URL shape, not the vendor** — and each shape now has its own
> door. A classic `*.openai.azure.com` resource is `azureOpenai()`, with a key or
> with `credential` for Entra. A **Foundry project endpoint** is `foundry()`, which
> derives the `/openai/v1` route and signs with an Entra token. Only reach for
> `openai({ baseURL, legacyEndpoint: false, apiKey: async () => token })` when the
> route is OpenAI-compatible and neither factory owns its spelling. Verify which
> route your resource actually serves before choosing.

### Rotating credentials: a token that expires

`apiKey` accepts **a function as well as a string** on `openai()`, `gemini()` and
`foundry()`. That is what makes an adapter usable in front of an endpoint whose
credential is a short-lived OAuth or Entra token rather than a durable key —
Vertex AI's OpenAI-compatible endpoint being the case that forced it in 9.29.0.

`anthropic()`, `ollama()`, `foundryLocal()` and the browser providers take a plain
`string` (`foundryLocal()` takes no key at all — none exists on that wire). The
two Azure-shaped factories have their own keyless door instead of a callback:
`azureOpenai({ credential })` and `foundry({ credential })` take an
`@azure/identity` credential and mint a token before **every** request.

```typescript
import { openai } from 'agentfootprint/providers';

const provider = openai({
  baseURL: 'https://…/openapi',
  // A CALLBACK, not a string. A one-hour token refreshes without anyone
  // rebuilding the provider — or finding out it didn't, at 3am.
  apiKey: async () => (await credential.getToken(scope)).token,
});
```

The boundary, stated so nobody has to guess:

- called **once per request**, before the request is built;
- the SDK client is rebuilt **only when the returned string changed**, so a cached
  token costs one function call;
- **a stream keeps the key it started with** — nothing can re-authenticate a
  socket that is already open;
- **what expiry means is the callback's business.** This adapter does not inspect,
  decode, or schedule anything; it asks every time and uses what it is given.

Worked example: [`examples/features/60-gemini-field-truths.ts`](../../examples/features/60-gemini-field-truths.ts).

**For an Azure-shaped endpoint, prefer the credential door over a callback.**
`azureOpenai({ credential })` and `foundry({ credential })` hand the token
provider to the client itself, so the token is minted per request with MSAL's
cache doing the pacing, and there is no callback of yours to keep correct. The
`apiKey` callback stays the right answer for an endpoint neither factory owns.

Each factory returns an `LLMProvider` directly — ready to pass to
`Agent.create({ provider })` or `LLMCall.create({ provider })`.

### Config-driven: `createProvider()`

When the provider is chosen at runtime (env var, feature flag, tenant
preference), use `createProvider()` with a tagged options object. The `kind`
field selects the adapter; the rest of the object is the provider's options:

```typescript
import { createProvider } from 'agentfootprint';

const provider = createProvider({
  kind: process.env.LLM_PROVIDER ?? 'mock',   // 'mock' | 'anthropic' | 'openai' | 'ollama' | 'foundry' | 'foundry-local' | 'bedrock' | 'gemini' | 'browser-anthropic' | 'browser-openai'
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
| `OLLAMA_MODEL` (+ optional `OLLAMA_HOST`) | `ollama()` | `OLLAMA_MODEL` |
| `FOUNDRY_LOCAL_MODEL` (+ optional `FOUNDRY_LOCAL_ENDPOINT` \| `FOUNDRY_LOCAL_BASE_URL`) | `foundryLocal()` | `FOUNDRY_LOCAL_MODEL` |
| `FOUNDRY_PROJECT_ENDPOINT` + (`AZURE_AI_MODEL_DEPLOYMENT_NAME` \| `MODEL_NAME`) | `foundry()` | the deployment you named |
| `AZURE_OPENAI_API_KEY` + (`AZURE_OPENAI_ENDPOINT` \| `OPENAI_BASE_URL`) | `azureOpenai()` | the deployment (`AZURE_OPENAI_DEPLOYMENT` ?? `MODEL_NAME`) |
| `ANTHROPIC_API_KEY` | `anthropic()` | `LLM_MODEL` ?? `'anthropic'` |
| `OPENAI_API_KEY` | `openai()` | `LLM_MODEL` ?? `'openai'` |
| *(none)* | throws — or the mock with `{ fallbackToMock: true }` | `'mock'` |

The env vars, one line each:

| Variable | Read by | What it carries |
|---|---|---|
| `OLLAMA_MODEL` / `OLLAMA_HOST` | `ollama()` | The local model name; the host when the daemon isn't on localhost |
| `FOUNDRY_LOCAL_MODEL` | `foundryLocal()` | The on-device model — an alias (`qwen2.5-0.5b`) or a full variant id |
| `FOUNDRY_LOCAL_ENDPOINT` / `FOUNDRY_LOCAL_BASE_URL` | `foundryLocal()` | Where the service is listening. Two spellings of one thing, first present wins. The port is **dynamic** per `foundry server start`; `foundry server status` prints the live URL |
| `FOUNDRY_PROJECT_ENDPOINT` | `foundry()` | The Foundry project endpoint. **Auto-injected** inside a hosted Foundry container |
| `AZURE_AI_MODEL_DEPLOYMENT_NAME` ?? `MODEL_NAME` | `foundry()` | The deployment — Foundry's name for the model. The first spelling is the `azd` scaffolding convention |
| `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` \| `OPENAI_BASE_URL`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT` ?? `MODEL_NAME` | `azureOpenai()` | Key, resource root, api-version, deployment |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (+ optional `LLM_MODEL`) | `anthropic()` / `openai()` | The vendor key, and the model to name in the run |

**The local models go first on purpose.** Every credential arm triggers on a
credential, and credentials linger in a shell by accident — a key exported in
`.zshrc` two months ago for something else. `OLLAMA_MODEL` and
`FOUNDRY_LOCAL_MODEL` trigger on a **name you had to choose and type**, so their
presence is a declaration rather than a leftover. (An endpoint variable alone is
never a trigger: people export `OLLAMA_HOST` or `FOUNDRY_LOCAL_ENDPOINT` just to
run the service, and it must not hijack an app that never asked for a local
model.)

**And the Foundry project endpoint sits between the names and the keys.**
`FOUNDRY_PROJECT_ENDPOINT` is a product-specific spelling nobody exports by
accident — and the one the hosted platform injects — so where it is present
Foundry is the declared destination and it outranks a lingering Azure or vendor
key. It still yields to the two local-model arms: *because* the platform can
inject it, it must never beat a model name a person typed for this run. Naming
the endpoint without naming a deployment is refused, not guessed — Foundry routes
by deployment and has no default.

**No probing, ever.** `providerFromEnv()` reads environment variables and nothing
else; it never opens a socket to see whether a daemon is up. The answer is
deterministic and identical on a laptop and in CI, and a service that is down
reports itself from the call, with the fix (`ollama serve`,
`foundry server start`) in the message.

For Azure it also reads `AZURE_OPENAI_API_VERSION` and `AZURE_OPENAI_DEPLOYMENT`
(or `MODEL_NAME` as the deployment). **`AZURE_OPENAI_ENDPOINT` and
`OPENAI_BASE_URL` are two spellings of the same resource root** — either works,
both reach the identical URL, and setting both is fine. Azure routes by
deployment and has no default, so a run with Azure credentials and no deployment
named is refused rather than guessed. A typical company `.env`:

```bash
OPENAI_BASE_URL=https://your-co.openai.azure.com    # or AZURE_OPENAI_ENDPOINT — same thing
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_API_VERSION=2024-12-01-preview
MODEL_NAME=gpt-4o-128k          # the Azure DEPLOYMENT name — and the `model` you get back
```

A Foundry project instead — no key and no api-version, because the deployment's
own identity signs:

```bash
FOUNDRY_PROJECT_ENDPOINT=https://your-acct.services.ai.azure.com/api/projects/your-proj
AZURE_AI_MODEL_DEPLOYMENT_NAME=gpt-4o-128k   # or MODEL_NAME — and the `model` you get back
```

…or a model on this machine, which needs neither:

```bash
FOUNDRY_LOCAL_MODEL=qwen2.5-0.5b
# FOUNDRY_LOCAL_ENDPOINT=http://127.0.0.1:57127   # only when `foundry server status` shows another port
```

`providerFromEnv()` is **Node-only** (it reads `process.env`); it lazy-loads only
the SDK for the detected provider, so the others stay optional. In the browser,
read `import.meta.env` yourself and call `browserAzureOpenai()` /
`browserAnthropic()` directly. Returns `{ provider, model, kind }` where `kind` is
`'ollama' | 'foundry-local' | 'foundry' | 'azure-openai' | 'anthropic' | 'openai' | 'mock'`. See
[examples/features/16-providers.ts](../../examples/features/16-providers.ts).

### Direct Class Construction

For advanced use cases, construct the provider classes directly:

```typescript
import { AnthropicProvider, OpenAIProvider, BedrockProvider } from 'agentfootprint/providers';

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
| `FoundryLocalProvider` | `foundryLocal()` | none — `fetch` only |

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
register them on any agent. The adapter goes both ways: `mcpClient` consumes
someone else's server, `mcpServe` exposes your own `Tool[]` as one.

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

**Declarations travel with the tool.** A served tool's `argumentsFrom`,
`resultKind`, `owner`, `resultClass` and `resultCeiling` ride in MCP's own
`_meta` bag under one namespaced key (`MCP_TOOL_EXTRAS_KEY`), so a tool that
arrived over MCP arms the integrity checks, the placement mint and the identity
joins exactly as a local `defineTool` does. Execution-side fields — `needs`,
`checkIn`, the session hooks — never travel: they govern how the tool runs, and
it runs on the server. Ingest is defensive and **never throws**: a malformed
declaration is warned about once (naming the server, tool, field and rule) and
dropped, and the tool still registers. A server that sends no bag registers
exactly what it always did.

For development and tests, `mockMcpClient` gives an in-memory server with the
same `McpClient` shape — and takes the same `_meta` bag, so a rail armed by a
remote declaration is testable before the real server exists:

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
`agentfootprint/providers`):

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
import { anthropic, openai } from 'agentfootprint/providers';

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
detection driven by the agent runner), see the `agentfootprint/resilience`
subpath and [orchestration.md](orchestration.md).
