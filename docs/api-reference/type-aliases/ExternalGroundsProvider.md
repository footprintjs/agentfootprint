[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ExternalGroundsProvider

# Type Alias: ExternalGroundsProvider

> **ExternalGroundsProvider** = () => readonly [`ExternalGround`](/agentfootprint/api/generated/interfaces/ExternalGround.md)[]

Defined in: [src/core/agent/types.ts:77](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/types.ts#L77)

The app's external-ground door for the choice-seam integrity check
(9.72.0) — see [AgentOptions.externalGrounds](/agentfootprint/api/generated/interfaces/AgentOptions.md#externalgrounds). Yields the entries the
app currently vouches for; consulted once per LLM response that contains an
armed call. Must be synchronous: the values are things the app already
verified and holds (a clicked selection), never something to go fetch.

## Returns

readonly [`ExternalGround`](/agentfootprint/api/generated/interfaces/ExternalGround.md)[]
