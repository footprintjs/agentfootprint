---
name: MemoryPipeline — shared across sessions
group: runtime-features
guide: ../../../docs/guides/concepts.md#agent
defaultInput: ''
---

# MemoryPipeline — shared across sessions

Build the memory pipeline ONCE at application startup; mount it on as many agents as you want. Each conversation is isolated by `identity.conversationId` passed at run time — same agent, same store, different sessions stay separate.

## When to use

- Multi-turn agents where the same user comes back across runs.
- Multi-tenant servers serving N independent users from one store.
- Anywhere you want memory persistence to be **infrastructure**, not per-agent state.

## What you'll see

Two sessions share the same store but stay isolated:

```
{
  alice: { turn1: 'Nice to meet you, Alice!',
           turn2: 'You live in San Francisco, Alice.',
           entries: 4 },
  bob:   { turn1: "I don't know yet.",
           entries: 2 },
}
```

Alice's session has 4 entries (2 turns × 2 messages); Bob's has 2 (1 turn). Inspecting the store directly shows Bob never sees Alice's data.

## Key API

- `defaultPipeline({ store, loadCount? })` — the 90%-use-case preset.
- `.memoryPipeline(pipeline)` on the agent builder.
- `agent.run(msg, { identity: { conversationId } })` — required per call when memory is enabled.
- `store.forget({ conversationId })` — wipe one session's namespace.

## Failure modes

- Forgetting to pass `identity` → pipeline writes to a default namespace, sessions bleed together.
- Sharing one InMemoryStore across processes → memory isn't actually persistent (use Redis/Postgres adapter for that).

## Related

- [concepts/02-agent](../../concepts/02-agent.md) — the loop memory wraps.
- [providers/02-message](../../providers/02-message.md) — `MessageStrategy` is the in-prompt window; memory is the out-of-prompt store.
