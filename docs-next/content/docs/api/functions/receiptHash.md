---
title: receiptHash
---

# Function: receiptHash()

> **receiptHash**(`runId`, `content`): `string`

Defined in: [src/lib/time-travel/receipt.ts:419](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L419)

The receipt's hash: run-salted SHA-256, first RECEIPT\_HASH\_CHARS hex
characters. Exported because it is half of the conformance law — a reader
that rebuilds a served view proves the rebuild by hashing it the same way.

## Parameters

### runId

`string`

### content

`string`

## Returns

`string`

## Example

```ts
import { receiptAt, receiptHash, servedAt } from 'agentfootprint';

const view = servedAt(agent.getSnapshot()!, 1)!;
const receipt = receiptAt(agent.getSnapshot()!, 1)!;
receiptHash(receipt.basis.runId, view.system.text) === receipt.system.hash; // true
```
