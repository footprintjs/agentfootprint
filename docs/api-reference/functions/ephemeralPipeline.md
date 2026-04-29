[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ephemeralPipeline

# Function: ephemeralPipeline()

> **ephemeralPipeline**(`config`): `MemoryPipeline`

Defined in: [agentfootprint/src/memory/pipeline/ephemeral.ts:69](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/pipeline/ephemeral.ts#L69)

Build an ephemeral (read-only) pipeline. The returned object has
`write: undefined`; wire helpers no-op on it.

## Parameters

### config

`EphemeralPipelineConfig`

## Returns

`MemoryPipeline`
