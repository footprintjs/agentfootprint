---
type: fixed
bump: minor
---
**Refuse unsupported thinking and forced tool choice before sending a request.**
The current Bedrock Converse adapter now refuses thinking intent instead of
silently omitting it; this does not claim that Bedrock itself lacks thinking.
Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1 refuse forced tool choice
through the SDK, browser, InvokeModel gateway and Converse adapters. Supported
models retain their existing wire format.

The existing boolean `carriesForcedToolChoice` remains compatible. Providers
can additionally declare `supportsForcedToolChoice(model)`, read through
`forcedToolChoiceFor`; wrappers preserve it and fallback pairs intersect it.
Explicit forced-output requests fail clearly with `UnsupportedToolChoiceError`;
internal constrained classifiers use their existing strict text parser instead.
The default resilience policies do not retry or hide these capability refusals.

**Keep thinking replay faithful and make omissions visible.** Anthropic SDK,
browser and InvokeModel gateway adapters preserve assistant content order,
including interleaved text, tool calls and signed/redacted thinking. Locally
known unsafe thinking in an unfinished tool turn raises
`UnsafeThinkingReplayError` before transport. Eligible completed-turn thinking
may be omitted, with one `agentfootprint.agent.thinking_omitted` event per block
before transport and durable retirement in conversation history. No beta or
server-side drop policy is enabled; unfamiliar or legacy provenance is not
treated as proof that a signature is invalid.

`LLMMessage.replay` is optional JSON replay evidence, not signature authentication
or a second copy of content. It survives checkpoints, including a final reply
without thinking. Standalone callers can observe `onReplayPrepared` and successful
`replayOmissions` diagnostics. Receipts remain provider-port evidence; the new
`thinking-replay` gap identifies downstream omissions without claiming what the
vendor accepted. There are no paid calls in the regression tests.

The existing `provider-defaults` diagnostic now clarifies that later preparation
notes cannot prove what was sent or accepted. Its saved-reader expectations
change only that explanation sentence; the recorded requests and commit logs stay
unchanged.

**Reliability failover now calls the provider it selects.** `retry-other` previously
changed its bookkeeping while still calling the original transport. Each configured
attempt now uses its selected provider/model for transport, forced-choice checks,
thinking normalization and returned-usage cost/provenance. Build-time thinking and
injected-message role checks cover the configured provider list, not an unused
default; existing skill-brain checks remain. Runtime-only recall is checked before
delivery against every declared retry target. Without a provider list, existing
single-provider behavior is unchanged. A consumer `fallback` callback remains
opaque: these attribution guarantees do not identify which model, if any, its
implementation calls, or establish that callback's actual cost.

Unsupported thinking, forced-choice and unsafe-replay refusals remain terminal
through reliability. Approved replay retirements survive retries, feedback repair,
stream-to-complete fallback and crash checkpoints. An explicit
`thinkingHandler(null)` remains valid for terminal replies, but cannot discard
signed thinking needed by a later tool continuation; that continuation refuses
rather than recreating missing reasoning.
