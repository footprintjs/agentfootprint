[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / narrativePipeline

# Function: narrativePipeline()

> **narrativePipeline**(`config`): `MemoryPipeline`

Defined in: [agentfootprint/src/memory/pipeline/narrative.ts:103](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/pipeline/narrative.ts#L103)

Build the narrative read + write pipelines sharing a single store.
Returns `{ read, write }` ready to be passed to `Agent.memory()` via the appropriate `defineMemory` config (or used directly via `mountMemoryRead`/`mountMemoryWrite`).

## Parameters

### config

`NarrativePipelineConfig`

## Returns

`MemoryPipeline`
