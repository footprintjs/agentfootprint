# Hosted artifacts

`access.ts` binds the request seam and revokes bindings on retirement or close.
`wire.ts` handles head, get and answer-account operations. Both receive the same
operation counter and lane pool from the facade. `facts.ts` owns fact attribution
and reply capability checks; `handOver.ts` bounds and expires a turn's hand-over.
No artifact path creates a session lane. Tests hold a store read while another
session arrives and pin revocation and shared admission limits.
