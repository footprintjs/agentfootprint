[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowEviction

# Interface: WindowEviction

Defined in: [src/core/agent/window/strategy.ts:46](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/agent/window/strategy.ts#L46)

One message leaving the window, with the facts an eviction event needs.

## Properties

### index

> `readonly` **index**: `number`

Defined in: [src/core/agent/window/strategy.ts:48](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/agent/window/strategy.ts#L48)

Index in the PRE-change window — the index the content hash was built on.

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: [src/core/agent/window/strategy.ts:50](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/agent/window/strategy.ts#L50)

How long it lived in the window. Exact; 0 when its birth is unknown.
