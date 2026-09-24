[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ColumnViolation

# Interface: ColumnViolation

Defined in: [src/integrity/column-types/check.ts:140](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/integrity/column-types/check.ts#L140)

One declared column the rows disagreed with.

## Properties

### column

> `readonly` **column**: `string`

Defined in: [src/integrity/column-types/check.ts:141](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/integrity/column-types/check.ts#L141)

***

### declared

> `readonly` **declared**: [`ColumnType`](/agentfootprint/api/generated/type-aliases/ColumnType.md)

Defined in: [src/integrity/column-types/check.ts:142](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/integrity/column-types/check.ts#L142)

***

### got

> `readonly` **got**: `string`

Defined in: [src/integrity/column-types/check.ts:150](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/integrity/column-types/check.ts#L150)

What that first offending value actually is (`string`, `null`, `missing`, …).

***

### ofRows

> `readonly` **ofRows**: `number`

Defined in: [src/integrity/column-types/check.ts:146](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/integrity/column-types/check.ts#L146)

Total rows read, so a reader can see 3-of-4 rather than a bare 3.

***

### rows

> `readonly` **rows**: `number`

Defined in: [src/integrity/column-types/check.ts:144](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/integrity/column-types/check.ts#L144)

How many rows hold something that is not the declared type.

***

### sample

> `readonly` **sample**: `string`

Defined in: [src/integrity/column-types/check.ts:148](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/integrity/column-types/check.ts#L148)

The first offending value, rendered and clipped — what a person recognizes.
