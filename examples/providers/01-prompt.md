---
name: PromptProvider strategies
group: providers
guide: ../../docs/guides/providers.md#promptprovider
defaultInput: AI is transforming the world.
---

# PromptProvider strategies

Different system prompts shape the LLM's behavior even when the input is identical. A summarizer answers tersely; a translator returns French. Same input, two providers, two very different outputs.

## When to use

- You have multiple roles built on the same base provider — summarizer, translator, classifier — and want to swap the prompt without rebuilding the agent.
- You want to A/B test prompt variants on the same data.
- You want the prompt to be **a swappable strategy**, not a hardcoded string.

## What you'll see in the trace

Two LLMCalls fire sequentially with different system prompts:

```
Entered SeedScope (summarizer).
Entered CallLLM. → "This is a concise summary..."
...
Entered SeedScope (translator).
Entered CallLLM. → "Ceci est une traduction en francais."
```

The result object: `{ summary: '...', translation: '...' }`.

## Key API

- `LLMCall.create({ provider }).system(prompt).build()` — one prompt per builder.
- For *dynamic* prompts that change per turn, use a `PromptProvider` (`staticPrompt`, `templatePrompt`, `skillBasedPrompt`, `compositePrompt`) — see the [Providers guide](../../docs/guides/providers.md#promptprovider).

## Related

- [providers guide](../../docs/guides/providers.md) — the strategy slot system.
- [concepts/01-llm-call](../concepts/01-llm-call.md) — the runner this example wraps.
