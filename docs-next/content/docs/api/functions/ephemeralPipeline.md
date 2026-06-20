---
title: ephemeralPipeline
---

# Function: ephemeralPipeline()

> **ephemeralPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/ephemeral.ts:69](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/pipeline/ephemeral.ts#L69)

Build an ephemeral (read-only) pipeline. The returned object has
`write: undefined`; wire helpers no-op on it.

## Parameters

### config

`EphemeralPipelineConfig`

## Returns

`MemoryPipeline`
