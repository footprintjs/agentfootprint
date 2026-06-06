[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defaultPipeline

# Function: defaultPipeline()

> **defaultPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/default.ts:116](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/memory/pipeline/default.ts#L116)

Build the default read + write pipelines sharing a single store.
Returns two FlowChart subflows ready to be mounted by the wire layer.

## Parameters

### config

`DefaultPipelineConfig`

## Returns

`MemoryPipeline`
