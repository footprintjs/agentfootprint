---
title: TRANSFORM_HASH_PREFIX
---

# Variable: TRANSFORM\_HASH\_PREFIX

> `const` **TRANSFORM\_HASH\_PREFIX**: `"chain-v1:"` = `'chain-v1:'`

Defined in: [src/lib/time-travel/receipt.ts:754](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L754)

The prefix a chained [Receipt.cache.transformHash](/docs/api/interfaces/Receipt#cache) carries — the NAME of
the scheme that produced it, inside the value, so a verifier can tell the two
schemes apart without a second field:

- `'chain-v1:<16 hex>'` — [transformHashOf](/docs/api/functions/transformHashOf): each message of the
  returned request digested on its own and chained in order, then the rest
  of the request. Minted since this prefix existed.
- a bare `<16 hex>` — the older WHOLE-REQUEST scheme,
  `receiptHash(runId, stableJson(request))`. Every receipt minted before the
  prefix carries this form, and it still verifies with that formula.

WHY THE SCHEME CHANGED. The whole-request digest could not be extended: the
strategy's markers sort to the front of the canonical JSON and move on every
call, so call k's preimage shared no prefix with call k−1's and every byte of
the history was hashed again — measured, the larger half of the receipt's
SHA-256 input under a caching provider. A chain over per-message digests is
extended by the messages a call added and nothing else.
