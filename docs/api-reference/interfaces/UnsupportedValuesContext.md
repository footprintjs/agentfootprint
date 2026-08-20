[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / UnsupportedValuesContext

# Interface: UnsupportedValuesContext

Defined in: [src/core/agent/evidence/errors.ts:41](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/evidence/errors.ts#L41)

## Properties

### candidates

> `readonly` **candidates**: `number`

Defined in: [src/core/agent/evidence/errors.ts:45](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/evidence/errors.ts#L45)

How many distinct values the answer had to ground in total.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/evidence/errors.ts:49](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/evidence/errors.ts#L49)

The full teaching sentence, including what would satisfy the check.

***

### revised

> `readonly` **revised**: `boolean`

Defined in: [src/core/agent/evidence/errors.ts:47](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/evidence/errors.ts#L47)

True when a revision was asked for and the values survived it.

***

### values

> `readonly` **values**: readonly [`UnsupportedValue`](/agentfootprint/api/generated/interfaces/UnsupportedValue.md)[]

Defined in: [src/core/agent/evidence/errors.ts:43](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/evidence/errors.ts#L43)

The flagged values, normalized and truncated.
