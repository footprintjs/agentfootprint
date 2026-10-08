---
title: transformHashOf
---

# Function: transformHashOf()

> **transformHashOf**(`runId`, `request`): `string`

Defined in: [src/lib/time-travel/receipt.ts:798](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L798)

The fingerprint a receipt records as `cache.transformHash` for the request a
cache strategy handed back — recompute it from that request to verify a
receipt's claim.

The scheme, so a verifier in any language can follow it (every `H` below is
[receiptHash](/docs/api/functions/receiptHash) with the receipt's `basis.runId`):

```text
link₀  = H("agentfootprint.transform.chain.v1")
dᵢ     = H(stableJson([messageᵢ]))          — each message, as one array element
linkᵢ  = H(linkᵢ₋₁ + "\u001F" + dᵢ)          — in request order
head   = stableJson(request without "messages")   (the whole request when it
                                                   carries no messages array)
hash   = "chain-v1:" + H(linkₙ + "\u001F" + head)
```

A value `stableJson` cannot produce is recorded as UNSERIALIZABLE in
its place, never as an empty string. A request that cannot be read at all (a
property that throws when read) is `"chain-v1:" + H(link₀ + "\u001F" +
UNSERIALIZABLE)` — the function never throws. A receipt minted before the
prefix existed carries a bare 16-hex value: verify that one with
`receiptHash(runId, stableJson(request))`.

## Parameters

### runId

`string`

### request

`unknown`

## Returns

`string`

## Example

```ts
import { receiptAt, transformHashOf } from 'agentfootprint';

const receipt = receiptAt(snapshot, 3)!;
// `prepared` — the request your provider decorator saw at call 3
transformHashOf(receipt.basis.runId, prepared) === receipt.cache.transformHash; // true
```
