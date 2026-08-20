[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PresentedResult

# Interface: PresentedResult

Defined in: [src/artifacts/present.ts:54](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/present.ts#L54)

The one result shape a successful `present` returns (stringified onto the
 `role: 'tool'` message — a reload walks history for exactly this).

## Properties

### as

> `readonly` **as**: `string`

Defined in: [src/artifacts/present.ts:60](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/present.ts#L60)

The consumer vocabulary the model chose — stored as data (the component
 registry that would validate it is a later phase).

***

### presented

> `readonly` **presented**: `true`

Defined in: [src/artifacts/present.ts:56](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/present.ts#L56)

Always `true`. The field a transcript walker branches on.

***

### ref

> `readonly` **ref**: `string`

Defined in: [src/artifacts/present.ts:57](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/present.ts#L57)

***

### snapshot

> `readonly` **snapshot**: [`PresentSnapshot`](/agentfootprint/api/generated/interfaces/PresentSnapshot.md)

Defined in: [src/artifacts/present.ts:61](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/present.ts#L61)
