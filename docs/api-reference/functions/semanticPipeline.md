[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / semanticPipeline

# Function: semanticPipeline()

> **semanticPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/semantic.ts:98](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/memory/pipeline/semantic.ts#L98)

Build the semantic read + write pipelines sharing a single store.
Returns `{ read, write }` ready to pass to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`SemanticPipelineConfig`

## Returns

`MemoryPipeline`
