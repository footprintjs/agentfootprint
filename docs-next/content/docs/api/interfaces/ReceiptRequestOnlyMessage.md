---
title: ReceiptRequestOnlyMessage
---

# Interface: ReceiptRequestOnlyMessage

Defined in: [src/lib/time-travel/receipt.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L219)

A line that existed on the request only and was never written to history.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L221)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/lib/time-travel/receipt.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L223)

Which library mechanism composed it. `'staged-refs-nudge'` or `'time-window-line'` (step T6b).

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L220)
