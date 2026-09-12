---
title: StoredReceipt
---

# Type Alias: StoredReceipt

> **StoredReceipt** = `Omit`\<[`Receipt`](/docs/api/interfaces/Receipt), `"cache"`\> & `object`

Defined in: [src/lib/time-travel/receipt.ts:434](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L434)

A receipt as a READER meets it — what `receiptAt` hands back, and the shape
every rebuild reads through (9.94.1).

[Receipt](/docs/api/interfaces/Receipt) is what a MINT writes, and a mint writes every container it
knows. But a recording is older than the reader that opens it: what a
reader is handed is what the MINTING release knew to write, and that has
grown — `cache` came with the receipt in 9.88.0 and gained `strategy` in
9.93.0; `omittedForAttention` has always been written only when something
was dropped. The narrowing that admits a stored value (`servedView.ts` ·
`readReceipt`) checks the basis and nothing past it, so this type says what
that check leaves open, and the compiler — not a throw on an older
recording — is what meets a reader that forgets.

THE VINTAGE LAW: a reader reads the receipt it is handed; a missing
container is a fact about the vintage, never a throw. Absence reads as
"cannot say" — `servedAt` raises `cache-transform` on a receipt with no
`cache.strategy` exactly as it does with no receipt at all — never as
`null`, and never as a fabricated `cache: {}`. The record is handed back as
it was stored.

## Type Declaration

### cache?

> `readonly` `optional` **cache?**: `Omit`\<[`Receipt`](/docs/api/interfaces/Receipt)\[`"cache"`\], `"strategy"`\> & `object`

#### Type Declaration

##### strategy?

> `readonly` `optional` **strategy?**: [`Receipt`](/docs/api/interfaces/Receipt)\[`"cache"`\]\[`"strategy"`\]

## Example

**a recording minted by 9.92, read by this release**

```ts
const receipt = receiptAt(olderRecording, 1)!;
receipt.cache?.strategy;                              // undefined — the mint predates the key
servedAt(olderRecording, 1)!.gaps.map((g) => g.gap);  // includes 'cache-transform': it cannot say
```
