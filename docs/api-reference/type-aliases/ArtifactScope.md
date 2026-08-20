[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactScope

# Type Alias: ArtifactScope

> **ArtifactScope** = `MemoryIdentity`

Defined in: [src/artifacts/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/types.ts#L55)

The isolation tuple every artifact call presents — the SAME tuple memory
scopes on (`{ tenant?, principal?, conversationId }`), under a name that
says what it does here. One type, not a structural twin: two spellings of
one scoping rule could disagree, and this one cannot.

The framework composes it from the run's identity/session (an anonymous run
scopes to its own runId; a session-bound run to its sessionId; an
identity-carrying run to the caller's tenant/principal tuple). A tool never
supplies it — `ctx.artifacts` is already bound.
