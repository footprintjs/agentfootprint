**Support** — per-provider extended-thinking handlers, each auto-wrapped in its
own subflow so reasoning blocks appear on the record under their own
`runtimeStageId`; and the request side's vocabulary — what a model accepts.

## What it reads / what it writes
- Reads a vendor's reasoning shape; returns the framework's `ThinkingBlock[]`.
- Writes those blocks into the record. What a model is re-served differs from
  what the audit log keeps, deliberately — that split is owned by
  `src/security/thinkingRedaction.ts`, and its reasons are documented there.

## The one law here
Normalize, never interpret. A handler translates a vendor's shape; the decision
about who may read which bytes is made in `src/security/`.

`dispatch.ts` shares one data-only `{ answeredBy, raw }` envelope between
fallback pairs and configured reliability providers. The answering provider's
handler decodes its own raw shape; normalization still occurs in the existing
thinking subflow, with its existing parse-failure isolation. An explicit handler
override receives the unwrapped raw value, and explicit `null` keeps normalization
off. No handler function is placed in recorded state.

Opting out does not grant permission to discard required active-turn thinking.
If a later tool continuation needs blocks that `thinkingHandler(null)` discarded,
the adapter raises `UnsafeThinkingReplayError` before transport. Keep the declared
handler enabled for such tool turns. A terminal response that needs no continuation
still permits the opt-out; the framework never recreates missing signed reasoning.

## The request side: the provider declares what each model takes
`.thinking({ budget })` is an intent. Which shape reaches the wire is the
model's business, so the adapter declares it per model —
`LLMProvider.thinkingMode(model)` → `ThinkingMode` (`'budget'` | `'adaptive'` |
`'none'`) — and the agent reads it at build through `thinkingModeFor.ts` (a
malformed declaration is refused, never read as "no claim"). `'none'` is refused
with `UnsupportedThinkingError` (`errors.ts`), the one error for a thinking
request a model cannot take; the Anthropic adapters raise it too, before sending.
The table itself is the adapter's (`adapters/llm/anthropicThinkingWire.ts`).

```ts
const provider = withRetry(anthropic()); // the declaration is forwarded
provider.thinkingMode?.('claude-3-haiku-20240307'); // 'none'
Agent.create({ provider, model: 'claude-3-haiku-20240307' }).thinking({ budget: 2000 }).build();
// → UnsupportedThinkingError: [anthropic+retry] thinking on 'claude-3-haiku-20240307': …
```

## Files
- `replay.ts` — JSON replay evidence, metadata-only omission reports and the
  typed unsafe-replay refusal. The Anthropic adapter owns the judgement, not
  this shared carrier.
- `replayHistory.ts` — one identity rule for applying explicit thinking
  retirements to live history, retry requests and checkpoints. Checkpoint
  patches retain no second conversation or failed-stage tool/output state.
- `AnthropicThinkingHandler.ts`, `OpenAIThinkingHandler.ts`,
  `OllamaThinkingHandler.ts`, `MockThinkingHandler.ts` — one shape each.
- `registry.ts` — the auto-wire source of truth and the shared contract test.
- `thinkingHandlerFor.ts`, `thinkingModeFor.ts` — the agent's two readers of
  what a provider declares (the response handler, the request mode).
- `errors.ts` — `UnsupportedThinkingError`.
- `dispatch.ts` — the shared response-side handler routing rule.
- `types.ts`, `index.ts`.
