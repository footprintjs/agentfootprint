[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ephemeralPipeline

# Function: ephemeralPipeline()

> **ephemeralPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/ephemeral.ts:69](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/memory/pipeline/ephemeral.ts#L69)

Build an ephemeral (read-only) pipeline. The returned object has
`write: undefined`; wire helpers no-op on it.

## Parameters

### config

`EphemeralPipelineConfig`

## Returns

`MemoryPipeline`
