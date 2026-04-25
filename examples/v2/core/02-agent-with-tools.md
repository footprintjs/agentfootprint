---
name: Agent + tools (ReAct)
group: v2-core
guide: ../../README.md#core
defaultInput: Weather in SF?
---

# Agent + tools (ReAct)

`Agent` is the full ReAct primitive. Each iteration runs one LLM call,
routes based on the LLM's response, and either runs tool calls and
loops, or returns a final answer.

## When to use

- **Any flow that needs tool use** — the Agent's tool-call stage
  handles every hand-off (unknown tool, tool-throwing error, pause)
  without you writing a loop.
- **ReAct-style reasoning** — the LLM sees its past tool results and
  can iterate until it's ready to answer.

## Key API

```ts
const agent = Agent.create({ provider, model, maxIterations: 10 })
  .system('…')
  .tool({ schema, execute })
  .build();

await agent.run({ message: '…' });
```

## What it emits

- `agent.turn_start / turn_end` — bookend events with token totals
- `agent.iteration_start / iteration_end` — one pair per ReAct iteration
- `agent.route_decided` — every routing decision with a human rationale
- `stream.tool_start / tool_end` — per tool invocation
- Plus every `LLMCall` event for each iteration's model call

## Related

- **[LLMCall](./01-llm-call.md)** — the primitive an Agent runs internally
- **[Pause / Resume](../features/01-pause-resume.md)** — tools can call
  `pauseHere()` to request human input mid-loop
- **[Permissions](../features/03-permissions.md)** — gate tool calls by policy
