---
title: Receipt
---

# Interface: Receipt

Defined in: [src/lib/time-travel/receipt.ts:291](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L291)

THE RECEIPT. One per composed request, committed at the call-llm stop.

## Example

```ts
import { receiptAt } from 'agentfootprint';

// Epochs are the run's OWN iteration numbers and start at 1.
const receipt = receiptAt(agent.getSnapshot()!, 1);
receipt?.tools.withheld;        // 'wrap-up' on the out-of-budget call
receipt?.messages.count;        // how many turns went out
receipt?.params.temperature;    // the dial this turn went out on
```

## Properties

### basis

> `readonly` **basis**: `object`

Defined in: [src/lib/time-travel/receipt.ts:344](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L344)

#### epoch

> `readonly` **epoch**: `number`

#### model

> `readonly` **model**: `string`

#### provider

> `readonly` **provider**: `string`

#### runId

> `readonly` **runId**: `string`

***

### cache

> `readonly` **cache**: `object`

Defined in: [src/lib/time-travel/receipt.ts:310](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L310)

#### markersApplied

> `readonly` **markersApplied**: readonly [`ReceiptCacheMarker`](/docs/api/interfaces/ReceiptCacheMarker)[]

The breakpoints the strategy actually applied, in the order it applied
 them — see [ReceiptCacheMarker](/docs/api/interfaces/ReceiptCacheMarker). Empty when it applied none.

#### transform

> `readonly` **transform**: `"unchanged"` \| `"rewritten"` \| `"unknown"`

What the comparison between the request handed TO the cache strategy and
the one it handed back could establish. BRANCH ON THIS, never on
`transformHash === null`:

- `'unchanged'` — the two serialize identically.
- `'rewritten'` — they do not, and `transformHash` fingerprints the
  result.
- `'unknown'`   — one of them could not be serialized at all, so the
  receipt refuses to claim either.

It scopes to the CACHE STRATEGY and to nothing else — see
[RECEIPT\_BOUNDARY](/docs/api/variables/RECEIPT_BOUNDARY).

#### transformHash

> `readonly` **transformHash**: `string` \| `null`

Hash of the request the cache strategy handed back, when it differed
 from the one it was given; `null` otherwise.

***

### messages

> `readonly` **messages**: `object`

Defined in: [src/lib/time-travel/receipt.ts:297](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L297)

#### count

> `readonly` **count**: `number`

#### entries

> `readonly` **entries**: readonly [`ReceiptMessage`](/docs/api/interfaces/ReceiptMessage)[]

#### requestOnly

> `readonly` **requestOnly**: readonly [`ReceiptRequestOnlyMessage`](/docs/api/interfaces/ReceiptRequestOnlyMessage)[]

***

### omittedForAttention?

> `readonly` `optional` **omittedForAttention?**: `ReceiptAttentionOmission`

Defined in: [src/lib/time-travel/receipt.ts:343](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L343)

Absent when no slot reported a drop — which, measured on 9.88.0, is EVERY
run in both chart shapes: no boundary bubbles `slotCompositions` out of the
slot subflow that writes it, so request assembly has nothing to pass. It is
a key of `servedView.ts` · `UNGAPPED_FIELDS` for that reason: its absence
is universal and says nothing about any particular recording. Absent means
nobody recorded a drop, never that nothing was dropped.

***

### params

> `readonly` **params**: [`ReceiptParams`](/docs/api/interfaces/ReceiptParams)

Defined in: [src/lib/time-travel/receipt.ts:334](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L334)

The sampling knobs the call went out with — see [ReceiptParams](/docs/api/interfaces/ReceiptParams).

***

### system

> `readonly` **system**: `object`

Defined in: [src/lib/time-travel/receipt.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L292)

#### chars

> `readonly` **chars**: `number`

#### hash

> `readonly` **hash**: `string`

#### pieces

> `readonly` **pieces**: readonly [`ReceiptPiece`](/docs/api/interfaces/ReceiptPiece)[]

***

### tools

> `readonly` **tools**: `object`

Defined in: [src/lib/time-travel/receipt.ts:302](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L302)

#### forced

> `readonly` **forced**: `string` \| `null`

The tool the model was forced to answer through, or `null`.

#### names

> `readonly` **names**: readonly `string`[]

#### schemaHashes

> `readonly` **schemaHashes**: `Readonly`\<`Record`\<`string`, `string`\>\>

#### withheld

> `readonly` **withheld**: `"wrap-up"` \| `null`

Why the tool list is empty when it would not otherwise be.
