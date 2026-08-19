[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / bindArtifacts

# Function: bindArtifacts()

> **bindArtifacts**(`store`, `scope`, `options?`): [`ToolArtifacts`](/agentfootprint/api/generated/interfaces/ToolArtifacts.md)

Defined in: [src/artifacts/capability.ts:113](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/capability.ts#L113)

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
