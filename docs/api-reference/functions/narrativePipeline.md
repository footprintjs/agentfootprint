[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / narrativePipeline

# Function: narrativePipeline()

> **narrativePipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/narrative.ts:103](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/memory/pipeline/narrative.ts#L103)

Build the narrative read + write pipelines sharing a single store.
Returns `{ read, write }` ready to be passed to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`NarrativePipelineConfig`

## Returns

`MemoryPipeline`
