---
name: LLMCall — one-shot LLM primitive
group: v2-core
guide: ../../README.md#core
defaultInput: Weather in SF?
---

# LLMCall — one-shot LLM primitive

`LLMCall` is the atomic "ask the model once" primitive. Use it when you
want the raw ergonomics of a single round trip — a system prompt, a
message, a response.

## When to use

- **One-shot queries** — summarize this text, classify this intent,
  extract structured JSON.
- **A step in a larger composition** — as a `Sequence.step()`, a
  `Parallel.branch()`, or a `Conditional` branch.
- **Probes** — quickest way to validate a provider configuration.

## Key API

```ts
const llm = LLMCall.create({ provider, model })
  .system('...')
  .build();

const answer = await llm.run({ message: 'question' });
```

## What it emits

- `agentfootprint.stream.llm_start` — right before `provider.complete()`
- `agentfootprint.stream.llm_end` — with `usage`, `stopReason`, `durationMs`
- `agentfootprint.context.*` — from the 3-slot pipeline (system-prompt /
  messages / tools)

## Related

- **[Agent](../core/02-agent-with-tools.md)** — LLMCall + tools + ReAct loop
- **[Sequence](../core-flow/01-sequence.md)** — chain multiple LLMCalls
