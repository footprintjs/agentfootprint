[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / bindArtifacts

# Function: bindArtifacts()

> **bindArtifacts**(`store`, `scope`, `options?`): [`ToolArtifacts`](/agentfootprint/api/generated/interfaces/ToolArtifacts.md)

Defined in: [src/artifacts/capability.ts:113](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/capability.ts#L113)

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
