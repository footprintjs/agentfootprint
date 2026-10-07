---
type: added
---
**The receipt mint costs what each call added, not the whole conversation again — and `cache.transformHash` is a chain you can recompute with `transformHashOf`.**
Every model call mints a receipt, and the mint used to hash and measure the whole request again on
every call: on an agent run with 1,000-row tool results the hashing grew with the square of the
iteration count — 30 MB of SHA-256 input at 40 iterations, 120 MB at 80, the mint 45–50% of the
run's CPU. A per-run memo now keeps, for each message object, its entry hash, its digest and its
request measurement (counts and JSON size, never a copy of its text) — and its strings for two calls
only, so a system prompt that changes every call is not held for the run — so each call does work in
proportion to the messages it added: 1.5 MB at 40 iterations, 3 MB at 80, the same ~37 KB on every
call. Every receipt field except one is byte-identical to before, memo or no memo; the request
measurement equals the whole-request walk, limits included.

The one field whose VALUE changed is `cache.transformHash` (non-null only when a cache strategy
rewrote the request). The whole-request digest could not be extended — the strategy's markers sort
to the front of the canonical JSON, so call k shared nothing with call k−1 — so it is now a chain:
each message digested on its own, in order, then the rest of the request. The value names its
scheme: `'chain-v1:<16 hex>'`, recomputed by the new `transformHashOf(runId, request)` (the formula
is on its TSDoc). A receipt minted before carries a bare `<16 hex>` value, which still verifies as
`receiptHash(runId, stableJson(request))`. `TRANSFORM_HASH_PREFIX` is exported beside it. Model
request bodies and answers are unchanged.
