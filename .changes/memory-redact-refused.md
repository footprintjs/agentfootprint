---
type: fixed
---
**`defineMemory({ redact })` is refused instead of accepted and ignored.** The option took a
`MemoryRedactionPolicy` "reserved for a future release", stored it on the definition, and nothing
ever scrubbed anything because of it — a store kept the real values while the declaration read as if
it did not. It is not built, because a memory is working state: what a store keeps is what the
agent's next run recalls and sends to the model, and the redaction law never covers what the agent
computes on. The agent's own `redact` (`Agent.create({ redact })`) is what keeps the RECORD of the
memory stages — snapshot, events, recordings — free of what it names; the store keeps what you
write. `defineMemory` and `defineRAG` now throw, naming the definition, on any `redact` — for
JavaScript callers and casts too — and the option and its type are gone, so TypeScript reports it at
the keystroke.

Migration: remove `redact` from `defineMemory(...)` / `defineRAG(...)`, and the
`MemoryRedactionPolicy` import (from `agentfootprint/memory`). It never changed what a store kept. To
keep values out of a store, leave them out before the write (an extractor that drops them), or mount
the memory `readOnly: true`; to keep them out of the agent's records, name them in
`Agent.create({ redact })` — `conversationRedaction()` from `agentfootprint/security` already names
the memory pipeline's keys.
