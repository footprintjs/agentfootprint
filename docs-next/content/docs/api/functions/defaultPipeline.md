---
title: defaultPipeline
---

# Function: defaultPipeline()

> **defaultPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/default.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/pipeline/default.ts#L116)

Build the default read + write pipelines sharing a single store.
Returns two FlowChart subflows ready to be mounted by the wire layer.

## Parameters

### config

`DefaultPipelineConfig`

## Returns

`MemoryPipeline`
