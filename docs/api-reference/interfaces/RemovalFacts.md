[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RemovalFacts

# Interface: RemovalFacts

Defined in: [src/core/agent/window/strategy.ts:58](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L58)

The provenance of a set of removed messages, as the ledger needs it.

## Properties

### evictions

> `readonly` **evictions**: readonly [`WindowEviction`](/agentfootprint/api/generated/interfaces/WindowEviction.md)[]

Defined in: [src/core/agent/window/strategy.ts:62](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L62)

One eviction per message, with its measured lifetime.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/strategy.ts:60](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L60)

`runtimeStageId`s of the stages that appended those messages, in order.
