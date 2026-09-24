[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ReceiptRequestOnlyMessage

# Interface: ReceiptRequestOnlyMessage

Defined in: [src/lib/time-travel/receipt.ts:218](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/receipt.ts#L218)

A line that existed on the request only and was never written to history.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:220](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/receipt.ts#L220)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/lib/time-travel/receipt.ts:222](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/receipt.ts#L222)

Which library mechanism composed it. `'staged-refs-nudge'` today.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:219](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/receipt.ts#L219)
