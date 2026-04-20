---
name: LLMCall — single invocation
group: concepts
guide: ../../docs/guides/concepts.md#llmcall
defaultInput: Explain AI safety in one sentence.
---

# LLMCall — single invocation

The simplest concept: one prompt in, one response out. **No tools, no loops, no retrieval.** Every other concept in the library adds something to this shape.

## When to use

- Summarization, classification, extraction.
- Anything where the LLM has all the context it needs in the prompt.
- The "hello world" of agentfootprint — start here when first learning the library.

## What you'll see in the trace

When this runs, the narrative is short — one stage, one LLM call, one response:

```
Entered SeedScope.
Entered CallLLM.
  → llm.tokens: { input: 12, output: 9 }
Entered ParseResponse.
Entered Finalize.
```

`agentObservability()` captures token counts, tool usage (none here), and cost — visible in the returned object.

## Key API

- `LLMCall.create({ provider })` — the builder. `provider` is any `LLMProvider` (mock, anthropic, openai, …).
- `.system(prompt)` — set the system prompt.
- `.recorder(rec)` — attach an observer (here: `agentObservability()`).
- `.build()` — freeze into a runnable.
- `runner.run(input)` — invoke. Returns `{ content, messages }`.

## Related concepts

- **[Agent](./02-agent.md)** — same shape + a tool-use loop. Next rung up.
- **[RAG](./03-rag.md)** — same shape + retrieval before generation.
- **[Concepts guide](../../docs/guides/concepts.md)** — the full ladder explained.
