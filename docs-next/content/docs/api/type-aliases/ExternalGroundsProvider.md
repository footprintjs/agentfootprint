---
title: ExternalGroundsProvider
---

# Type Alias: ExternalGroundsProvider

> **ExternalGroundsProvider** = () => readonly [`ExternalGround`](/docs/api/interfaces/ExternalGround)[]

Defined in: [src/core/agent/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L72)

The app's external-ground door for the choice-seam integrity check
(9.72.0) — see [AgentOptions.externalGrounds](/docs/api/interfaces/AgentOptions#externalgrounds). Yields the entries the
app currently vouches for; consulted once per LLM response that contains an
armed call. Must be synchronous: the values are things the app already
verified and holds (a clicked selection), never something to go fetch.

## Returns

readonly [`ExternalGround`](/docs/api/interfaces/ExternalGround)[]
