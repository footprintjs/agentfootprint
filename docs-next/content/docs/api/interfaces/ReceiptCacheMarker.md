---
title: ReceiptCacheMarker
---

# Interface: ReceiptCacheMarker

Defined in: [src/lib/time-travel/receipt.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L222)

One `cache_control` breakpoint the cache strategy actually APPLIED — three
scalars, no bytes.

`cache.transformHash` collapses a whole rewrite into one bit ("something
changed"), and a digest over the whole prepared request is not comparable
across epochs. The question that decides an Anthropic bill is narrower and
concrete: *did the breakpoints move between call 3 and call 4?* Two receipts'
`markersApplied` answer it by inspection.

APPLIED, not offered: `scope.cacheMarkers` holds the CANDIDATES the strategy
was given, and a strategy clamps them to what the provider allows. The
candidates are on the record; which survived is not, which is why they ride
here.

## Example

**did the breakpoints move between two turns?**

```ts
import { receiptAt } from 'agentfootprint';

const at = (k: number) =>
  JSON.stringify(receiptAt(agent.getSnapshot()!, k)?.cache.markersApplied);
at(3) === at(4); // false ⇒ the cached prefix moved, and the bill with it
```

## Properties

### boundaryIndex

> `readonly` **boundaryIndex**: `number`

Defined in: [src/lib/time-travel/receipt.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L224)

***

### field

> `readonly` **field**: `"system"` \| `"messages"` \| `"tools"`

Defined in: [src/lib/time-travel/receipt.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L223)

***

### ttl

> `readonly` **ttl**: `"short"` \| `"long"`

Defined in: [src/lib/time-travel/receipt.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L225)
