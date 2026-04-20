---
name: AgentStreamEvent — lifecycle events
group: runtime-features
guide: ../../../docs/guides/streaming.md
defaultInput: What is the weather in SF?
---

# AgentStreamEvent — lifecycle events

Subscribe to the agent's lifecycle in real time via `onEvent`. The 9-event discriminated union covers turn boundaries, LLM call boundaries, tool call boundaries, token streaming, and errors. Build a CLI status indicator, a web SSE stream, or a mobile chat UI from the same events.

## When to use

- Building real-time UX (streaming chat, live status, tool-call indicators).
- Logging agent execution to an external system on a per-event basis.
- Debugging — see exactly when each phase starts and ends.

## What you'll see

A 2-iteration agent fires this sequence:

```
turn_start
llm_start (iteration 1)
llm_end   (iteration 1, with toolCallCount: 1)
tool_start (search)
tool_end   (search)
llm_start (iteration 2)
llm_end   (iteration 2, with toolCallCount: 0)
turn_end
```

Result: `{ eventTypes: [...], totalEvents: 7 }`.

## Key API

- `agent.run(input, { onEvent: (e) => ... })` — subscribe.
- `e.type` — discriminator. Switch on it for type-narrowed access.
- `.streaming(true)` on the builder — enables `token` and `thinking` events. Tool/turn events fire regardless.

## Related

- [streaming guide](../../../docs/guides/streaming.md) — full event reference + SSE format.
- [observability/01-recorders](../../observability/01-recorders.md) — push-style alternative for accumulating data.
