---
title: servedAt
---

# Function: servedAt()

> **servedAt**(`source`, `epoch`): [`ServedView`](/docs/api/interfaces/ServedView) \| `undefined`

Defined in: src/lib/time-travel/servedView.ts:1041

Rebuild what the model was SERVED on epoch `k`, from the run's committed
pieces alone.

Works on a live snapshot and on a recording read back from JSON, in both
chart shapes, on a run whose conversation lives in `messagesInjections`
rather than `history` (`LLMCall`, the message-API charts), on a resumed run
(every read folds from the checkpoint the run was seeded with), on a
redacted run (the pieces are read exactly as the run committed them — a
redacted piece rebuilds to its redacted bytes, which is what the record says
a reader is allowed to see) and on a recording made before the receipt
existed.

It returns `undefined` for ONE reason only: the run has no such epoch.
Anything it cannot prove about an epoch that DOES exist comes back as a
named entry in `gaps`, never as a missing view and never as a confident
empty one.

## Parameters

### source

`unknown`

a runner (`Agent`, `LLMCall`) or a snapshot. On `LLMCall` and
  the message-API charts the rebuild is complete but UNCHECKED: those charts
  mint no receipt, so `basis` is absent and `gaps` carries
  `no-receipt-on-chart` saying so.

### epoch

`number`

the iteration number, 1-based — the run's own count.

## Returns

[`ServedView`](/docs/api/interfaces/ServedView) \| `undefined`

## Example

```ts
import { receiptAt, receiptHash, servedAt } from 'agentfootprint';

const snapshot = agent.getSnapshot()!;
const view = servedAt(snapshot, 1)!;
const receipt = receiptAt(snapshot, 1)!;
receiptHash(receipt.basis.runId, view.system.text) === receipt.system.hash; // true
```
