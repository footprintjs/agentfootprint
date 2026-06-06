[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / UntilGuard

# Type Alias: UntilGuard

> **UntilGuard** = (`ctx`) => `boolean`

Defined in: [src/core-flow/Loop.ts:69](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core-flow/Loop.ts#L69)

Predicate evaluated AFTER each body iteration. Return true to exit the loop.

## Parameters

### ctx

#### iteration

`number`

#### latestOutput

`string`

#### startMs

`number`

## Returns

`boolean`
