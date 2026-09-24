[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunConfigFn

# Type Alias: RunConfigFn

> **RunConfigFn** = (`ctx`) => [`RunConfig`](/agentfootprint/api/generated/interfaces/RunConfig.md) \| `undefined`

Defined in: [src/core/agent/types.ts:1147](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/types.ts#L1147)

Per-run configuration resolver — see `AgentBuilder.configure`. Called
exactly once per run, synchronously, at the start of the run.

## Parameters

### ctx

[`RunConfigContext`](/agentfootprint/api/generated/interfaces/RunConfigContext.md)

## Returns

[`RunConfig`](/agentfootprint/api/generated/interfaces/RunConfig.md) \| `undefined`
