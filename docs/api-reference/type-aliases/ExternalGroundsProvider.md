[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ExternalGroundsProvider

# Type Alias: ExternalGroundsProvider

> **ExternalGroundsProvider** = () => readonly [`ExternalGround`](/agentfootprint/api/generated/interfaces/ExternalGround.md)[]

Defined in: [src/core/agent/types.ts:77](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/types.ts#L77)

The app's external-ground door for the choice-seam integrity check
(9.72.0) — see [AgentOptions.externalGrounds](/agentfootprint/api/generated/interfaces/AgentOptions.md#externalgrounds). Yields the entries the
app currently vouches for; consulted once per LLM response that contains an
armed call. Must be synchronous: the values are things the app already
verified and holds (a clicked selection), never something to go fetch.

## Returns

readonly [`ExternalGround`](/agentfootprint/api/generated/interfaces/ExternalGround.md)[]
