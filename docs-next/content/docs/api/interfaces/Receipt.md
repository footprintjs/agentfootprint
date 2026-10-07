---
title: Receipt
---

# Interface: Receipt

Defined in: [src/lib/time-travel/receipt.ts:322](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L322)

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

Defined in: [src/lib/time-travel/receipt.ts:411](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L411)

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

Defined in: [src/lib/time-travel/receipt.ts:344](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L344)

#### markersApplied

> `readonly` **markersApplied**: readonly [`ReceiptCacheMarker`](/docs/api/interfaces/ReceiptCacheMarker)[]

The breakpoints the strategy actually applied, in the order it applied
 them — see [ReceiptCacheMarker](/docs/api/interfaces/ReceiptCacheMarker). Empty when it applied none.

#### strategy

> `readonly` **strategy**: `string` \| `null`

WHICH strategy stood between assembly and the port, or `null` when none
did (9.93.0). The value is the strategy's `name`: for the built-ins,
the caching the provider declared (`'breakpoints'`, `'automatic'`,
`'none'`); older receipts carry the old registry key (`'anthropic'`,
`'openai'`, `'*'`).

`null` is a FACT, not an absence: `LLMCall` and the two message-API
charts hand the port the request assembly built, with nothing in
between, and say so here. `transform` alone could not — `'unchanged'` is
the honest verdict both when a strategy returned what it was given and
when there was no strategy to return anything — which is why the served
view raised `cache-transform` on every view until this field existed.
Now it raises that gap only where a strategy could have rewritten the
request: where this is not `null`, or where no receipt can say.

A receipt minted before 9.93.0 has no key here; a reader treats that as
"cannot say", never as `null` — [StoredReceipt](/docs/api/type-aliases/StoredReceipt) is the shape that
says so, and the one every reader is handed.

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

Fingerprint of the request the cache strategy handed back, when it
differed from the one it was given; `null` otherwise. Recompute it with
[transformHashOf](/docs/api/functions/transformHashOf). The value names its scheme: `'chain-v1:…'`
(see [TRANSFORM\_HASH\_PREFIX](/docs/api/variables/TRANSFORM_HASH_PREFIX)), or a bare 16-hex value on a receipt
minted before the prefix existed, which verifies as
`receiptHash(runId, stableJson(request))`.

***

### messages

> `readonly` **messages**: `object`

Defined in: [src/lib/time-travel/receipt.ts:331](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L331)

#### count

> `readonly` **count**: `number`

#### entries

> `readonly` **entries**: readonly [`ReceiptMessage`](/docs/api/interfaces/ReceiptMessage)[]

#### requestOnly

> `readonly` **requestOnly**: readonly [`ReceiptRequestOnlyMessage`](/docs/api/interfaces/ReceiptRequestOnlyMessage)[]

***

### omittedForAttention?

> `readonly` `optional` **omittedForAttention?**: `ReceiptAttentionOmission`

Defined in: [src/lib/time-travel/receipt.ts:410](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L410)

What left the window for budget at this iteration's head, before this
request was composed — one hash per evicted turn, each the turn's own
`messages.entries[].hash` as an earlier receipt served it.

Absent when nothing was dropped before this call. Since 9.93.0 that is a
claim and not a shrug: the agent chart's window stage is the one shipped
mechanism that drops for attention and it files every eviction here; the
built-in slots drop nothing; `LLMCall` and the message-API charts have no
window. It is named by the `no-receipt-on-chart` entry of `servedView.ts` ·
`SERVED_GAPS` — the one gap that can lose it, by losing the receipt — and it sat in
`UNGAPPED_FIELDS` until this release, when its absence was universal and
meant only that nobody had recorded a drop.

***

### params

> `readonly` **params**: [`ReceiptParams`](/docs/api/interfaces/ReceiptParams)

Defined in: [src/lib/time-travel/receipt.ts:395](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L395)

The sampling knobs the call went out with — see [ReceiptParams](/docs/api/interfaces/ReceiptParams).

***

### requestMeasurement?

> `readonly` `optional` **requestMeasurement?**: [`RequestMeasurement`](/docs/api/type-aliases/RequestMeasurement)

Defined in: [src/lib/time-travel/receipt.ts:325](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L325)

Counts of the initial prepared canonical request, including full schemas.
Older recordings have no measurement. No payload, tokens or retry totals.

***

### system

> `readonly` **system**: `object`

Defined in: [src/lib/time-travel/receipt.ts:326](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L326)

#### chars

> `readonly` **chars**: `number`

#### hash

> `readonly` **hash**: `string`

#### pieces

> `readonly` **pieces**: readonly [`ReceiptPiece`](/docs/api/interfaces/ReceiptPiece)[]

***

### tools

> `readonly` **tools**: `object`

Defined in: [src/lib/time-travel/receipt.ts:336](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L336)

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
