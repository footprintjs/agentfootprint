[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / semanticPipeline

# Function: semanticPipeline()

> **semanticPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/semantic.ts:98](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/memory/pipeline/semantic.ts#L98)

Build the semantic read + write pipelines sharing a single store.
Returns `{ read, write }` ready to pass to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`SemanticPipelineConfig`

## Returns

`MemoryPipeline`
