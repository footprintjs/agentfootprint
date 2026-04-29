[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / semanticPipeline

# Function: semanticPipeline()

> **semanticPipeline**(`config`): `MemoryPipeline`

Defined in: [agentfootprint/src/memory/pipeline/semantic.ts:98](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/pipeline/semantic.ts#L98)

Build the semantic read + write pipelines sharing a single store.
Returns `{ read, write }` ready to pass to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`SemanticPipelineConfig`

## Returns

`MemoryPipeline`
