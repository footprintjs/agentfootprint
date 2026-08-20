[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RemovalFacts

# Interface: RemovalFacts

Defined in: [src/core/agent/window/strategy.ts:57](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/strategy.ts#L57)

The provenance of a set of removed messages, as the ledger needs it.

## Properties

### evictions

> `readonly` **evictions**: readonly [`WindowEviction`](/agentfootprint/api/generated/interfaces/WindowEviction.md)[]

Defined in: [src/core/agent/window/strategy.ts:61](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/strategy.ts#L61)

One eviction per message, with its measured lifetime.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/strategy.ts:59](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/strategy.ts#L59)

`runtimeStageId`s of the stages that appended those messages, in order.
