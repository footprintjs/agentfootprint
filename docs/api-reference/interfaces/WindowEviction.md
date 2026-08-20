[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowEviction

# Interface: WindowEviction

Defined in: [src/core/agent/window/strategy.ts:49](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/strategy.ts#L49)

One message leaving the window, with the facts an eviction event needs.

## Properties

### index

> `readonly` **index**: `number`

Defined in: [src/core/agent/window/strategy.ts:51](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/strategy.ts#L51)

Index in the PRE-change window — the index the content hash was built on.

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: [src/core/agent/window/strategy.ts:53](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/strategy.ts#L53)

How long it lived in the window. Exact; 0 when its birth is unknown.
