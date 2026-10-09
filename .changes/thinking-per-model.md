---
type: fixed
bump: minor
---
**Thinking on Claude 4.7+/5 models no longer fails with 400.** `.thinking({ budget })` sent
`thinking: { type: 'enabled', budget_tokens }` to every Claude model, and Claude Opus 4.7 and
later (Opus 4.8, 5, 5.5, Sonnet 5 and 5.5, Haiku 5.5, Fable, Mythos 5 and 5.1) reject that with
HTTP 400 — every call of every agent that asked to think failed. `anthropic()`, `browserAnthropic()`
and `invokeModelGateway()` now send the shape the MODEL takes, from one table:
`{ type: 'adaptive', display: 'summarized' }` on those models, `budget_tokens` on Claude 4.6 and
earlier, and an `UnsupportedThinkingError` at `build()` for the Claude 3 models that cannot think. A
model id the table does not know gets adaptive thinking, the current behaviour, so a new model
thinks instead of failing. Platform ids (Bedrock `us.anthropic.…-v1:0`, Vertex `…@date`) resolve
like the Claude API id.

Adaptive thinking takes no budget: the budget is not sent (dev mode says so once per model) and
only keeps `max_tokens` above itself, as before. On every model a thinking request the API would
reject is refused before anything is sent, with the fix in the message: a non-default
`temperature`, and — on a budget model — a budget below 1024 or a forced tool choice.

New: `LLMProvider.thinkingMode(model)` → `ThinkingMode` (`'budget'`, `'adaptive'`, `'none'`), the
per-model declaration the Anthropic adapters make and the agent reads at build;
`UnsupportedThinkingError` (from `agentfootprint/providers`). `withRetry` and `withCircuitBreaker`
forward the declaration, and `withFallback` hands each side the same request so each sends its own
model's shape, answering the least either side promises — a fallback that cannot think is refused
at build. The mock provider is unchanged. A custom wrapper should forward `thinkingMode` like
`thinkingHandler`.
