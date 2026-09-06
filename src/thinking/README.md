**Support** — per-provider extended-thinking handlers, each auto-wrapped in its
own subflow so reasoning blocks appear on the record under their own
`runtimeStageId`.

## What it reads / what it writes
- Reads a vendor's reasoning shape; returns the framework's `ThinkingBlock[]`.
- Writes those blocks into the record. What a model is re-served differs from
  what the audit log keeps, deliberately — that split is owned by
  `src/security/thinkingRedaction.ts`, and its reasons are documented there.

## The one law here
Normalize, never interpret. A handler translates a vendor's shape; the decision
about who may read which bytes is made in `src/security/`.

## Files
- `AnthropicThinkingHandler.ts`, `OpenAIThinkingHandler.ts`,
  `OllamaThinkingHandler.ts`, `MockThinkingHandler.ts` — one shape each.
- `registry.ts` — the auto-wire source of truth and the shared contract test.
- `types.ts`, `index.ts`.
