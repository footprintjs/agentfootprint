[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowEviction

# Interface: WindowEviction

Defined in: [src/core/agent/window/strategy.ts:50](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/strategy.ts#L50)

One message leaving the window, with the facts an eviction event needs.

## Properties

### index

> `readonly` **index**: `number`

Defined in: [src/core/agent/window/strategy.ts:52](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/strategy.ts#L52)

Index in the PRE-change window — the index the content hash was built on.

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: [src/core/agent/window/strategy.ts:54](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/window/strategy.ts#L54)

How long it lived in the window. Exact; 0 when its birth is unknown.
