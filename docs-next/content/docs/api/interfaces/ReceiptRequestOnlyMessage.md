---
title: ReceiptRequestOnlyMessage
---

# Interface: ReceiptRequestOnlyMessage

Defined in: [src/core/agent/receipt/receipt.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L226)

A line that existed on the request only and was never written to history.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L228)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L230)

Which library mechanism composed it. `'staged-refs-nudge'` or `'time-window-line'` (step T6b).

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/core/agent/receipt/receipt.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L227)
