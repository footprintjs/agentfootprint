---
type: fixed
bump: minor
---
**Thinking on Claude 4.7+/5 models no longer fails with 400.** `.thinking({ budget })` sent
`thinking: { type: 'enabled', budget_tokens }` to every Claude model, and Claude Opus 4.7 and
later (Opus 4.8, 5, 5.5, Sonnet 5 and 5.5, Haiku 5.5, Fable, Mythos 5 and 5.1) reject that with
HTTP 400 — every call of every agent that asked to think failed. `anthropic()`, `browserAnthropic()`
and `invokeModelGateway()` now send the shape the MODEL takes, from one table:
`{ type: 'adaptive', display: 'summarized' }` on those models and on Mythos Preview,
`budget_tokens` on Opus 4.6, Sonnet 4.6 and earlier (bytes unchanged there), and an
`UnsupportedThinkingError` at `build()` for the Claude 3 models that cannot think. Platform ids
(Bedrock `us.anthropic.…-v1:0`, Vertex `…@date`) and dotted aliases (`claude-sonnet-4.5`) resolve
like the Claude API id.

A model id the table does not know is read as adaptive — what every Claude model since 4.7 takes —
so a new model thinks instead of failing. That is a change for an id that does not say which model
it serves (a gateway alias, an application-inference-profile ARN, a deployment name): it used to get
a budget. If such an id serves a model that needs one (Claude 4.5 and earlier), declare it with the
adapter's new `thinkingMode` option, e.g.
`invokeModelGateway({ …, thinkingMode: (id) => (id === 'haiku-fast' ? 'budget' : undefined) })`; the
same option makes Opus 4.6 adaptive, which in budget mode does not think between tool calls.

Adaptive thinking takes no budget: the budget is not sent (dev mode says so once per model) and
only keeps `max_tokens` above itself, as before. These combinations, which the API rejects, are now
refused before anything is sent, with the fix in the message: a temperature other than 1 while
thinking, and — on a budget model — a budget below 1024 or a forced tool choice. `withFallback`
does not move such a refused call to its other side, and `withCircuitBreaker` does not count it.

New: `LLMProvider.thinkingMode(model)` → `ThinkingMode` (`'budget'`, `'adaptive'`, `'none'`), the
per-model declaration the Anthropic adapters make — from the same function they build the request
with — and the agent reads at build; `UnsupportedThinkingError` (from `agentfootprint/providers`).
`withRetry` and `withCircuitBreaker` forward the declaration, and `withFallback` hands each side the
same request so each sends its own model's shape, answering the least either side promises — a
fallback that cannot think is refused at build. The mock provider is unchanged. A custom wrapper
should forward `thinkingMode` like `thinkingHandler`.
