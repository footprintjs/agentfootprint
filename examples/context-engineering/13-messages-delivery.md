---
name: Messages delivery — declared content, delivered into the window
group: context-engineering
guide: ../../src/lib/injection-engine/README.md
defaultInput: where is my refund?
---

# Messages delivery — putting a declaration INTO the conversation

`slot: 'messages'` appends your content to `scope.history` itself — the same
window the window strategies govern and the request is built from. There is no
second list spliced in at send time, so the trace, the slot projection, the
token count and the wire all describe one conversation.

```ts
defineFact({
  id: 'tier',
  data: 'Account tier: gold (refunds under $200 are pre-approved).',
  slot: 'messages',
  role: 'assistant', // required — no default
});
```

## `role` is required, and that is the point

Before 7.19.1 this option existed with `role` defaulting to `'system'` — the one
value that reached the model on OpenAI-family providers and silently vanished on
Anthropic-family ones, because the Anthropic wire has no system role *inside*
the message list (system rides a separate top-level field). The default was the
bug, so there is no default now: who appears to speak is a meaning your app owns.

Each provider declares what it carries, and a role it cannot carry is **refused
when the run starts**, naming the provider and its roles. Your role is never
rewritten to one that happens to fit.

| provider | carries inside `messages` |
| --- | --- |
| `openai`, `azure-openai`, `ollama`, `browser-openai` | `system`, `user`, `assistant` |
| `anthropic`, `bedrock`, `browser-anthropic` | `user`, `assistant` |
| a third-party adapter that declares nothing | `user`, `assistant` (the floor) |

## Where it sits, and when it waits

A delivered message goes at the **END** of the window the iteration assembled,
and providers reject two turns of the same role in a row. If yours would collide,
it is **deferred** to the next boundary — never dropped, never reordered, and
never inserted between a tool call and its result.

Run this example and both halves show up on one turn:

```
Delivered:
  ✓ tier as assistant at message 1
Deferred:
  … nudge deferred (role-collision)
     'nudge' was held back this iteration: it would land as `user` immediately
     after a `user` turn, and providers reject two turns of the same role in a
     row. …
```

Which one waits is not about the flavor — it is about what the window already
ends with. **Inside a tool-using loop the window ends on the user's turn (first
iteration) or on tool results (every one after), and tool results count as a user
turn on the strictest wire — so a `role: 'user'` injection will typically never
deliver.** Use `'assistant'`, use `'system'` on a provider that carries it, or
return the words from the tool whose result they are about.

Sequencing is judged the same way on every provider, on purpose. Judging it
per-provider would deliver on one wire and defer on another with nothing in the
recording to tell the two apart — which is the falsehood this whole feature was
built to end.

## Reading the record

`messagesDelivery` is committed state, so it is in the commit log and in
`snapshot.sharedState` with nothing new to subscribe to. It is the answer to
"why is my declaration not on the wire?":

```ts
const delivery = agent.getSnapshot()?.sharedState.messagesDelivery;
delivery.delivered; // [{ injectionId, flavor, role, wireIndex, contentHash }]
delivery.deferred;  // [{ injectionId, reason, note }]
```

Once delivered, a message is not re-appended every iteration, and a window
strategy that later drops it does not have it handed back at the next boundary —
the strategy's decision stands.

## What it emits

- `agentfootprint.context.evaluated` — the engine reports the active set
- `agentfootprint.context.injected` — `slot: 'messages'`, `source: 'fact'`,
  `sourceId: 'tier'`, one record per message on the wire
- `agentfootprint.context.evicted` — if a window strategy later removes it,
  under the same content hash it was injected with

## Related

- **[Instruction](./01-instruction.md)** — the same slot choice, for rules
- **[Fact](./04-fact.md)** — the same slot choice, for data
- **[Window strategies](./12-window-strategies.ts)** — what governs the window a
  delivery joins
