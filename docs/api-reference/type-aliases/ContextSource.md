[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSource

# Type Alias: ContextSource

> **ContextSource** = `"rag"` \| `"skill"` \| `"memory"` \| `"instructions"` \| `"steering"` \| `"fact"` \| `"custom"` \| `"user"` \| `"tool-result"` \| `"assistant"` \| `"base"` \| `"registry"`

Defined in: [agentfootprint/src/events/types.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L32)

The origin / flavor of a context injection.

BASELINE sources (regular LLM-API flow — NOT context engineering):
  - `user`        → the user's message (current turn or history replay)
  - `tool-result` → tool return for a tool call (current or history)
  - `assistant`   → prior-turn assistant output replayed as history
  - `base`        → static system prompt configured at build time
  - `registry`    → static tool registry configured at build time

ENGINEERED sources (context engineering flavors — the teaching layer):
  - `rag`          → retrieval-augmented injection
  - `skill`        → skill activation (LLM-guided via read_skill)
  - `memory`       → memory strategy re-injection
  - `instructions` → rule-based behavior guidance
  - `steering`     → always-on policy / persona / format rule
  - `fact`         → developer-supplied data (user profile, env, …)
  - `custom`       → consumer-defined (anything bespoke)

Adding a new source is NOT a breaking change; removing one IS.
