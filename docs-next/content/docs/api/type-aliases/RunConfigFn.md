---
title: RunConfigFn
---

# Type Alias: RunConfigFn

> **RunConfigFn** = (`ctx`) => [`RunConfig`](/docs/api/interfaces/RunConfig) \| `undefined`

Defined in: [src/core/agent/types/configuration.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L37)

Per-run configuration resolver — see `AgentBuilder.configure`. Called
exactly once per run, synchronously, at the start of the run.

## Parameters

### ctx

[`RunConfigContext`](/docs/api/interfaces/RunConfigContext)

## Returns

[`RunConfig`](/docs/api/interfaces/RunConfig) \| `undefined`
