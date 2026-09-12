---
title: receiptAt
---

# Function: receiptAt()

> **receiptAt**(`source`, `epoch`): [`StoredReceipt`](/docs/api/type-aliases/StoredReceipt) \| `undefined`

Defined in: [src/lib/time-travel/servedView.ts:1187](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L1187)

The receipt epoch `k`'s call left behind, or `undefined`.

What comes back is a [StoredReceipt](/docs/api/type-aliases/StoredReceipt): the receipt AS STORED, written
by the release that minted it. A recording is older than the reader that
opens it, so a container a later release added (`cache.strategy`, 9.93.0)
may be absent — and it is handed back absent, not repaired, because the
narrowing checks the basis and promises nothing past it. A reader reads the
receipt it is handed; a missing container is a fact about the vintage,
never a throw.

`undefined` means one of two things on the record, and the same epoch's
`servedAt(...)` view carries which: its `no-receipt-on-chart` gap has a
[ServedGapCause](/docs/api/type-aliases/ServedGapCause). Either nothing was committed under the receipt key —
a recording made before the receipt existed, a chart whose LLM stage mints
none, a run with `recordReceipt: false`, all of which leave that same record
— or something WAS committed there and `readReceipt` refused it, because it
is not a non-null object with a number at `basis.epoch`, and handing back a
half-object a caller reads `.basis.runId` off is worse than saying no.

It also returns `undefined` when the run has no epoch `k` at all, which is
the answer `epochAt` gives and is not a fact about receipts; ask
`servedAt(source, k)` if you need to tell a missing epoch from a missing
receipt, because that one returns `undefined` for the missing epoch only.

`servedAt` still rebuilds the view of an epoch that exists in every one of
these cases, which is what makes an old recording readable instead of
unreadable.

The receipt comes back DEEP-FROZEN and is the same object every caller gets
for this epoch: it is a value folded out of the log, and a fold's answers are
detached (`keyedFold.ts` · `freezeDeep`). Copy it if you need to edit one.

## Parameters

### source

`unknown`

### epoch

`number`

## Returns

[`StoredReceipt`](/docs/api/type-aliases/StoredReceipt) \| `undefined`

## Example

```ts
import { receiptAt } from 'agentfootprint';

receiptAt(agent.getSnapshot()!, 3)?.tools.withheld; // 'wrap-up' on a wrap-up call
```
