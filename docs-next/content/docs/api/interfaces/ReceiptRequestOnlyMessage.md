---
title: ReceiptRequestOnlyMessage
---

# Interface: ReceiptRequestOnlyMessage

Defined in: [src/core/agent/receipt/receipt.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L236)

A line that existed on the request only and was never written to history.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L238)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L240)

Which library mechanism composed it. `'staged-refs-nudge'` or `'time-window-line'` (step T6b).

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/core/agent/receipt/receipt.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L237)
