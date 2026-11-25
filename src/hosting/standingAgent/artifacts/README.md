**Mixed** — hosted artifacts.
`access.ts`, `wire.ts` and `handOver.ts` supply Support for scoped store access;
`facts.ts` carries Trace by attributing artifact events to their admitted run.

# Hosted artifacts

`access.ts` binds the request seam and revokes bindings on retirement or close.
`wire.ts` handles head, get and answer-account operations; `accountParts.ts`
explains a recording saved in parts from the whole recording read back
(`readWhole`, bounded by `maxRecordingBytes`), never from its base alone: under
`dynamic-grouped` the account's omission witness reads the subflow results.
Before the cache, every part is head-checked against the index, so an account
is never served for a recording that is no longer whole in the store; a hit
costs N + 2 calls (the index's head and get, one head per part). On a miss the
door facts are one `artifacts.resolved` per part read, naming the PART's ref,
not the index ref the caller asked for. Both receive the same
operation counter and lane pool from the facade. `facts.ts` owns fact attribution
and reply capability checks; `handOver.ts` bounds and expires a turn's hand-over.
No artifact path creates a session lane. Tests hold a store read while another
session arrives and pin revocation and shared admission limits.
