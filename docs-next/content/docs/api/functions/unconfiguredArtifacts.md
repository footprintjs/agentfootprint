---
title: unconfiguredArtifacts
---

# Function: unconfiguredArtifacts()

> **unconfiguredArtifacts**(`onEvent?`): [`ToolArtifacts`](/docs/api/interfaces/ToolArtifacts)

Defined in: [src/artifacts/capability.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L202)

The fail-closed capability used when NO store is attached. Every verb
throws the same teaching refusal — loud, named, and on the record — so
`ctx.artifacts` is never `undefined` and a missing store can never read as
an empty one. Branch on `ctx.hasArtifacts` for an intentional no-store
mode. (The `unconfiguredCredentialProvider` law, verb for verb.)

## Parameters

### onEvent?

[`ArtifactEventSink`](/docs/api/type-aliases/ArtifactEventSink)

## Returns

[`ToolArtifacts`](/docs/api/interfaces/ToolArtifacts)
