[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / ReliabilityRetriedPayload

# Interface: ReliabilityRetriedPayload

Defined in: [src/events/payloads.ts:620](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L620)

Fired each time the rules loop decides to RETRY after a failed attempt
— `action` distinguishes a same-provider retry from a provider failover.

## Properties

### action

> `readonly` **action**: `"retry"` \| `"retry-other"`

Defined in: [src/events/payloads.ts:624](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L624)

`retry` = same provider again; `retry-other` = switch provider.

***

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/events/payloads.ts:622](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L622)

1-indexed counter of the attempt that just FAILED and is being retried.

***

### errorKind

> `readonly` **errorKind**: `string`

Defined in: [src/events/payloads.ts:626](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L626)

Classification of the failure being retried.

***

### errorMessage?

> `readonly` `optional` **errorMessage?**: `string`

Defined in: [src/events/payloads.ts:628](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L628)

Originating error message, when present.

***

### fromProvider

> `readonly` **fromProvider**: `string`

Defined in: [src/events/payloads.ts:630](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L630)

Provider that just failed.

***

### toProvider

> `readonly` **toProvider**: `string`

Defined in: [src/events/payloads.ts:632](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L632)

Provider the NEXT attempt will use (equals `fromProvider` for `retry`).
