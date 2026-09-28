---
title: RunConfigFn
---

# Type Alias: RunConfigFn

> **RunConfigFn** = (`ctx`) => [`RunConfig`](/docs/api/interfaces/RunConfig) \| `undefined`

Defined in: [src/core/agent/types.ts:1188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1188)

Per-run configuration resolver — see `AgentBuilder.configure`. Called
exactly once per run, synchronously, at the start of the run.

## Parameters

### ctx

[`RunConfigContext`](/docs/api/interfaces/RunConfigContext)

## Returns

[`RunConfig`](/docs/api/interfaces/RunConfig) \| `undefined`
