[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / unconfiguredArtifacts

# Function: unconfiguredArtifacts()

> **unconfiguredArtifacts**(`onEvent?`): [`ToolArtifacts`](/agentfootprint/api/generated/interfaces/ToolArtifacts.md)

Defined in: [src/artifacts/capability.ts:202](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L202)

The fail-closed capability used when NO store is attached. Every verb
throws the same teaching refusal — loud, named, and on the record — so
`ctx.artifacts` is never `undefined` and a missing store can never read as
an empty one. Branch on `ctx.hasArtifacts` for an intentional no-store
mode. (The `unconfiguredCredentialProvider` law, verb for verb.)

## Parameters

### onEvent?

[`ArtifactEventSink`](/agentfootprint/api/generated/type-aliases/ArtifactEventSink.md)

## Returns

[`ToolArtifacts`](/agentfootprint/api/generated/interfaces/ToolArtifacts.md)
