[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / narrativePipeline

# Function: narrativePipeline()

> **narrativePipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/narrative.ts:103](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/memory/pipeline/narrative.ts#L103)

Build the narrative read + write pipelines sharing a single store.
Returns `{ read, write }` ready to be passed to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`NarrativePipelineConfig`

## Returns

`MemoryPipeline`
