---
title: RECEIPT_BOUNDARY
---

# Variable: RECEIPT\_BOUNDARY

> `const` **RECEIPT\_BOUNDARY**: `string`

Defined in: src/lib/time-travel/receipt.ts:154

The boundary every receipt field is true at, in one sentence — exported so a
renderer prints the library's own wording instead of inferring a stronger
claim from a `null`.

WHY IT IS A CONSTANT AND NOT A COMMENT. A reader who sees
`cache.transform: 'unchanged'` will conclude "this request was not rewritten"
unless something on the screen says otherwise, and the person who reads the
screen is rarely the person who read the source. Print it beside the record.

── THE MECHANISM, WHICH THE PRINTED SENTENCE NO LONGER NAMES (9.88.0) ─────
`buildReceipt` is called from `stages/callLLM.ts` with the request about to
be passed to `LLMProvider.complete` — the PORT, this library's last sight of
it. Three things sit downstream of that call and none of them is on the
record: a provider decorated by the consumer (`complete()` wrapping
`complete()`), a vendor adapter's own serializer, and the vendor's
server-side defaults. `test/lib/time-travel/receipt-conformance.test.ts`
reproduces the first of those — a decorator that appends a system suffix and
a ghost tool after the mint, with `cache.transform` still reading
`'unchanged'`, correctly.

The sentence below used to say all of that, and it was PRINTED beside a
trace by renderers that append it to a gap. A printed sentence names no
module, function or call: it says which fields, what they mean here, and
what to do — the rule in `test/helpers/gapProseClaims.ts`. So the mechanism
lives in this comment, where a maintainer reads it and review catches its
rot, and the constant says only the thing a reader must not get wrong.

## Example

```ts
import { RECEIPT_BOUNDARY, receiptAt } from 'agentfootprint';

const receipt = receiptAt(agent.getSnapshot()!, 1)!;
if (receipt.cache.transform === 'unchanged') {
  console.log(`the cache strategy changed nothing. ${RECEIPT_BOUNDARY}`);
}
```
