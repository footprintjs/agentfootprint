---
title: isEngineeredSource
---

# Function: isEngineeredSource()

> **isEngineeredSource**(`source`): `boolean`

Defined in: src/recorders/core/contextEngineering.ts:98

Pure classifier: given a `ContextSource`, is it engineered?

Useful for ad-hoc filtering on a raw `agent.on('agentfootprint.context.injected', ...)`
subscription when you don't need the wrapper helper.

## Parameters

### source

`ContextSource`

## Returns

`boolean`
