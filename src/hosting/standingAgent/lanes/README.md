**Walker** — live instance ownership, admission and FIFO execution.

# Live lane ownership

`keys.ts` keeps client session keys disjoint from the anonymous pool key.
`pool.ts` owns instance construction, event and durability wiring, FIFO admission,
idle eviction and the lazy reader outside the pool. Artifact callers borrow a
live lane; they never create one. Closing is read lazily through the facade.
Tests pin queued and running work against eviction, reader reuse, and disjoint
keys. Artifact tests additionally hold a real store read during pool pressure.
