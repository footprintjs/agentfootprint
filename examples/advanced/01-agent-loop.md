---
name: agentLoop() — the engine layer
group: advanced
guide: ../../docs/guides/concepts.md
defaultInput: ''
---

# agentLoop() — the engine layer

The lowest-level API. Wire the providers and recorders manually — no builders, no defaults, full control. **Agent, FlowChart, Swarm, RAG are all built on top of this.** Reach for it only when the high-level builders don't express the shape you need.

## When to use

- You need a shape the high-level builders don't support (custom routing, custom subflow mounting, etc.).
- You're building a new high-level concept on top.
- You want to understand exactly what the builders are doing under the hood.

## When NOT to use

- For 95% of agent use cases — `Agent.create({...}).build()` is less to get wrong.
- The convenience defaults the builders provide (`agentObservability`, `staticPrompt`, `noTools`) are usually what you want.

## What you'll see

Three configurations run in sequence — basic, with-tool, observed:

```
{
  basic:    { content: 'Hello! How can I help?', iterations: 1 },
  withTool: { content: 'San Francisco is 72F and sunny!', iterations: 2 },
  observed: { turns: 1, calls: 1 },
}
```

Each is `agentLoop({ promptProvider, messageStrategy, toolProvider, llmProvider, ... }, message)`.

## Key API

- `agentLoop(config, message)` — the function.
- `AgentLoopConfig`: `{ promptProvider, messageStrategy, toolProvider, llmProvider, maxIterations, recorders, name }`.
- All providers are required — `noTools()`, `fullHistory()`, `staticPrompt('...')` for the trivial cases.

## Related

- [concepts/02-agent](../concepts/02-agent.md) — the high-level wrapper most users want.
- [providers guide](../../docs/guides/providers.md) — the strategy slots `agentLoop` consumes.
