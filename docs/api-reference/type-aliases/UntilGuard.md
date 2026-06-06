[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / UntilGuard

# Type Alias: UntilGuard

> **UntilGuard** = (`ctx`) => `boolean`

Defined in: [src/core-flow/Loop.ts:69](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Loop.ts#L69)

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
