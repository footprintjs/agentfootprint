[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunConfigFn

# Type Alias: RunConfigFn

> **RunConfigFn** = (`ctx`) => [`RunConfig`](/agentfootprint/api/generated/interfaces/RunConfig.md) \| `undefined`

Defined in: [src/core/agent/types.ts:1147](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/types.ts#L1147)

Per-run configuration resolver — see `AgentBuilder.configure`. Called
exactly once per run, synchronously, at the start of the run.

## Parameters

### ctx

[`RunConfigContext`](/agentfootprint/api/generated/interfaces/RunConfigContext.md)

## Returns

[`RunConfig`](/agentfootprint/api/generated/interfaces/RunConfig.md) \| `undefined`
