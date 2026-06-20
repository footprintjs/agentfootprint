---
title: defaultPipeline
---

# Function: defaultPipeline()

> **defaultPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/default.ts:116](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/pipeline/default.ts#L116)

Build the default read + write pipelines sharing a single store.
Returns two FlowChart subflows ready to be mounted by the wire layer.

## Parameters

### config

`DefaultPipelineConfig`

## Returns

`MemoryPipeline`
