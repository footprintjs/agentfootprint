[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defaultPipeline

# Function: defaultPipeline()

> **defaultPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/default.ts:116](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/memory/pipeline/default.ts#L116)

Build the default read + write pipelines sharing a single store.
Returns two FlowChart subflows ready to be mounted by the wire layer.

## Parameters

### config

`DefaultPipelineConfig`

## Returns

`MemoryPipeline`
