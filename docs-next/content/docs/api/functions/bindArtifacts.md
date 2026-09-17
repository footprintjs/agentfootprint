---
title: bindArtifacts
---

# Function: bindArtifacts()

> **bindArtifacts**(`store`, `scope`, `options?`): [`ToolArtifacts`](/docs/api/interfaces/ToolArtifacts)

Defined in: [src/artifacts/capability.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L113)

Bind a store to one run's scope — the framework's move, made where the
scope is known and a tool cannot reach.

## Parameters

### store

[`ArtifactStore`](/docs/api/interfaces/ArtifactStore)

### scope

`MemoryIdentity`

### options?

[`BindArtifactsOptions`](/docs/api/interfaces/BindArtifactsOptions) = `{}`

## Returns

[`ToolArtifacts`](/docs/api/interfaces/ToolArtifacts)
