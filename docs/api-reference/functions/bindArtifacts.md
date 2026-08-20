[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / bindArtifacts

# Function: bindArtifacts()

> **bindArtifacts**(`store`, `scope`, `options?`): [`ToolArtifacts`](/agentfootprint/api/generated/interfaces/ToolArtifacts.md)

Defined in: [src/artifacts/capability.ts:113](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L113)

Bind a store to one run's scope — the framework's move, made where the
scope is known and a tool cannot reach.

## Parameters

### store

[`ArtifactStore`](/agentfootprint/api/generated/interfaces/ArtifactStore.md)

### scope

`MemoryIdentity`

### options?

[`BindArtifactsOptions`](/agentfootprint/api/generated/interfaces/BindArtifactsOptions.md) = `{}`

## Returns

[`ToolArtifacts`](/agentfootprint/api/generated/interfaces/ToolArtifacts.md)
