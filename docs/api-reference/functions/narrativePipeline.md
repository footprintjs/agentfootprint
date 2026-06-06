[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / narrativePipeline

# Function: narrativePipeline()

> **narrativePipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/narrative.ts:103](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/memory/pipeline/narrative.ts#L103)

Build the narrative read + write pipelines sharing a single store.
Returns `{ read, write }` ready to be passed to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`NarrativePipelineConfig`

## Returns

`MemoryPipeline`
