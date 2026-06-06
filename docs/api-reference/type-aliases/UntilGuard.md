[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / UntilGuard

# Type Alias: UntilGuard

> **UntilGuard** = (`ctx`) => `boolean`

Defined in: [src/core-flow/Loop.ts:69](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core-flow/Loop.ts#L69)

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
