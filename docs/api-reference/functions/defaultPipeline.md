[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defaultPipeline

# Function: defaultPipeline()

> **defaultPipeline**(`config`): `MemoryPipeline`

Defined in: [agentfootprint/src/memory/pipeline/default.ts:116](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/pipeline/default.ts#L116)

Build the default read + write pipelines sharing a single store.
Returns two FlowChart subflows ready to be mounted by the wire layer.

## Parameters

### config

`DefaultPipelineConfig`

## Returns

`MemoryPipeline`
