[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / semanticPipeline

# Function: semanticPipeline()

> **semanticPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/semantic.ts:98](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/memory/pipeline/semantic.ts#L98)

Build the semantic read + write pipelines sharing a single store.
Returns `{ read, write }` ready to pass to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`SemanticPipelineConfig`

## Returns

`MemoryPipeline`
