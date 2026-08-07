[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RemovalFacts

# Interface: RemovalFacts

Defined in: [src/core/agent/window/strategy.ts:54](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/strategy.ts#L54)

The provenance of a set of removed messages, as the ledger needs it.

## Properties

### evictions

> `readonly` **evictions**: readonly [`WindowEviction`](/agentfootprint/api/generated/interfaces/WindowEviction.md)[]

Defined in: [src/core/agent/window/strategy.ts:58](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/strategy.ts#L58)

One eviction per message, with its measured lifetime.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/strategy.ts:56](https://github.com/footprintjs/agentfootprint/blob/748af7710d9294f3d459d9a2d042f65ccd396a5a/src/core/agent/window/strategy.ts#L56)

`runtimeStageId`s of the stages that appended those messages, in order.
