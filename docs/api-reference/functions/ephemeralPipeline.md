[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ephemeralPipeline

# Function: ephemeralPipeline()

> **ephemeralPipeline**(`config`): `MemoryPipeline`

Defined in: [src/memory/pipeline/ephemeral.ts:69](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/memory/pipeline/ephemeral.ts#L69)

Build an ephemeral (read-only) pipeline. The returned object has
`write: undefined`; wire helpers no-op on it.

## Parameters

### config

`EphemeralPipelineConfig`

## Returns

`MemoryPipeline`
