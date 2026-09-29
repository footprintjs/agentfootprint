**Support** — the last hop of the wire: each provider serializes the
already-composed system prompt, messages and tool list into one vendor's request
shape. The transport of the Lens, not the composition of it.

## What it reads / what it writes
Reads the request `callLLM` assembled
(`src/core/agent/stages/callLLM.ts` · `buildCallLLMStage`);
returns content, tool calls, thinking blocks and usage. It adds no clause and
removes none.

## The one law here
No adapter may narrow what the model is shown. If a request does not fit, that
is a refusal a human reads, and `contextWindow.ts` owns its words — an attention
omission, which must be visible.

## Adapters make one attempt
An adapter makes ONE attempt per call and never carries its own retry loop.
What it owes the caller is a typed error carrying the two fields `withRetry`'s
default predicate reads: `status` when there was one (429 and 5xx retried, other
4xx not), and `retryable: false` on a failure with no status that asking again
cannot mend — a refusal raised before any request (no key, no model), or a 2xx
answer it could not read, where a re-send may run and bill the model again. The
default predicate retries every error with no status, so an adapter that omits
`retryable: false` gets those repeated. Retry policy is composed, so it is one
policy the app can see and tune:

```ts
import { invokeModelGateway } from 'agentfootprint/providers';
import { withRetry } from 'agentfootprint/resilience';

const provider = withRetry(
  invokeModelGateway({
    baseUrl: 'https://llm-gateway.example.com/bedrock',
    apiKeyHeader: 'api-key',
    apiKey: { 'us.anthropic.claude-haiku-4-5-20251001-v1:0': haikuKey },
    model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  }),
);
```

## One body, several transports
The Anthropic Messages body (`system` top-level, content blocks, `tool_use` /
`tool_result`, thinking, cache markers) and its SSE event assembly have ONE owner:
`anthropicMessagesWire.ts`. An adapter that puts that body on another transport
adds only its framing (URL, headers, `model` field or path, SSE line format) and
decides what a malformed streamed tool argument becomes — `browserAnthropic` keeps
`{}`, `invokeModelGateway` refuses. Pinned byte for byte by
`test/adapters/unit/BrowserAnthropic.sharedWire.byte-identity.test.ts`.

## Files
- `AnthropicProvider.ts`, `OpenAIProvider.ts`, `BedrockProvider.ts`,
  `GeminiProvider.ts`, `OllamaProvider.ts`, `FoundryProvider.ts`,
  `FoundryLocalProvider.ts`, `MockProvider.ts` — one vendor each.
- `BrowserAnthropicProvider.ts`, `BrowserOpenAIProvider.ts` — zero-dependency
  browser variants.
- `InvokeModelGatewayProvider.ts` — Anthropic models behind a gateway that
  forwards the Bedrock InvokeModel operation with an API-key header (fetch, no SDK).
- `anthropicMessagesWire.ts` — the Anthropic Messages body, response mapping and
  stream assembly, shared by the two fetch adapters above.
- `contextWindow.ts` — `ContextWindowExceededError`: the budget refusal, named.
- `anthropicCacheWire.ts`, `azureUrl.ts`, `googleGenAI.ts`, `createProvider.ts`,
  `wireManifest.ts` — shared client/URL/cache helpers and the read-back of what
  actually crossed the wire.
