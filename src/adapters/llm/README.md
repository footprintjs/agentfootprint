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

## Files
- `AnthropicProvider.ts`, `OpenAIProvider.ts`, `BedrockProvider.ts`,
  `GeminiProvider.ts`, `OllamaProvider.ts`, `FoundryProvider.ts`,
  `FoundryLocalProvider.ts`, `MockProvider.ts` — one vendor each.
- `BrowserAnthropicProvider.ts`, `BrowserOpenAIProvider.ts` — zero-dependency
  browser variants.
- `contextWindow.ts` — `ContextWindowExceededError`: the budget refusal, named.
- `anthropicCacheWire.ts`, `azureUrl.ts`, `googleGenAI.ts`, `createProvider.ts`,
  `wireManifest.ts` — shared client/URL/cache helpers and the read-back of what
  actually crossed the wire.
