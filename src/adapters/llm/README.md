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
`anthropic()` (the SDK adapter) builds its whole body through the same
`buildMessagesBody` — it once kept a private copy of the messages mapping, and a
fix to one missed the other; a private copy of the body would have done the same
to the thinking rule below.

## Thinking: one shape per MODEL, declared in one table
Claude models disagree about a thinking request, and the wrong shape is a 400 on
every call: 4.7 and later reject `{ type: 'enabled', budget_tokens }`, 4.5 and
earlier reject `{ type: 'adaptive' }`, the 4.6 models take both, and Claude 3
before 3.7 cannot think. `anthropicThinkingWire.ts` holds the ONE table
(`ANTHROPIC_THINKING_MODES`, keyed by model family) and the one translation
(`anthropicThinkingPlan`), called by `buildMessagesBody`; each Anthropic adapter
declares `thinkingMode(model)` from the same table, so the agent can refuse at
build. A request names an INTENT (`thinking: { budget }`) and the adapter sends
the shape — which is also why `withFallback` needs no thinking logic: each side
maps the same intent to its own model.

- `'budget'` → `{ type: 'enabled', budget_tokens }`, the budget a whole number ≥ 1024.
- `'adaptive'` → `{ type: 'adaptive', display: 'summarized' }`, no budget (it
  only keeps `max_tokens` above itself). Also the answer for an UNKNOWN id: every
  Claude model since 4.7 is adaptive, so a new one thinks instead of failing.
- `'none'`, a non-default `temperature`, a forced tool choice with a budget →
  `UnsupportedThinkingError` before anything is sent, `retryable: false`.

Ids are read from their `claude-` onward and a family claims only a date,
`-0`, `-latest`, `-v1:0`, `@date` or `[…]` after it — never a version number,
so `claude-opus-4` does not claim `claude-opus-4-5`. A new model is one row.

```ts
anthropicThinkingMode('us.anthropic.claude-sonnet-4-5-20250929-v1:0'); // 'budget'
anthropicThinkingMode('claude-opus-5-5'); // 'adaptive'
anthropic().thinkingMode?.('anthropic'); // its default model's mode
```

## An empty assistant turn never reaches the wire
`anthropicMessagesWire.ts` · `toAnthropicMessages` DROPS an assistant turn with
no thinking, no text and no tool calls (index map `-1`, like a system message).
The API accepts empty content only on a final prefill; mid-history it is a 400
that no retry can mend. The library sends no prefill. The neighbours may now
share a role — the API combines consecutive same-role turns.

```ts
toAnthropicMessages([
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: '' }, // dropped
  { role: 'user', content: 'still there?' },
]); // → two user turns, no `content: ''`
```

## The adapter declares the stated wait; resilience never parses
A throttled response states how long to wait. The adapter that can see it puts
it on its error as `retryAfterMs` — `retryAfter.ts` · `retryAfterMsFromError`
reads `retry-after-ms` / `Retry-After` for `anthropic()`, `openai()` and
`bedrock()`; `invokeModelGateway()` also reads its gateway's "Try again in N
seconds" body. `withRetry` waits at least that long (resilience/README.md).

## `invokeModelGateway({ timeoutMs })` — a deadline per wait
Bounds the response headers, a `complete()` body, and EACH stream read (first
chunk, then every gap — a stream that keeps talking is never cut off). A miss
aborts the request and raises `reason: 'timeout'`, `retryable: true`; the
caller's `req.signal` still wins. Omitted: the fetch gets exactly `req.signal`,
as before.

```ts
invokeModelGateway({ baseUrl, apiKeyHeader: 'api-key', apiKey, model, timeoutMs: 30_000 });
```

## Files
- `AnthropicProvider.ts`, `OpenAIProvider.ts`, `BedrockProvider.ts`,
  `GeminiProvider.ts`, `OllamaProvider.ts`, `FoundryProvider.ts`,
  `FoundryLocalProvider.ts`, `MockProvider.ts` — one vendor each.
- `BrowserAnthropicProvider.ts`, `BrowserOpenAIProvider.ts` — zero-dependency
  browser variants.
- `InvokeModelGatewayProvider.ts` — Anthropic models behind a gateway that
  forwards the Bedrock InvokeModel operation with an API-key header (fetch, no SDK).
- `anthropicMessagesWire.ts` — the Anthropic Messages body, response mapping and
  stream assembly, shared by the two fetch adapters above (and the body by
  `anthropic()`).
- `anthropicThinkingWire.ts` — which thinking request each Claude model takes
  (the one table) and the translation of `LLMRequest.thinking` onto the body.
- `retryAfter.ts` — the one reader of `retry-after-ms` / `Retry-After`, for the
  `retryAfterMs` an adapter declares.
- `contextWindow.ts` — `ContextWindowExceededError`: the budget refusal, named.
- `anthropicCacheWire.ts`, `azureUrl.ts`, `googleGenAI.ts`, `createProvider.ts`,
  `wireManifest.ts` — shared client/URL/cache helpers and the read-back of what
  actually crossed the wire.
