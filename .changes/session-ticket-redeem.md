---
type: fixed
---
**A ticket filed for a session nobody has chatted in yet now redeems on a pooled door, as it does on a shared one.**
At a door with no verifier, a pooled `standingAgent` (`agentFactory`) answered
`artifact-head` / `artifact-get` — and `handle.artifactsForRequest` — with the
one not-found for any session that had no live instance and no stored
conversation, without asking the artifact store. Two things the library itself
does land tickets under exactly such a session: an app-owned route filing a
guide through `artifactsForRequest` before the first chat turn (the seam
answered `'not-found'`, so it could not file at all), and a tool minting during
a first turn that then threw (a thrown run persists nothing, so once the
instance was evicted the ticket the store still held became unredeemable). The
shared shape (`agent`) redeemed the same filings, so the answer depended on the
deployment's shape.

Whether a ticket exists is now the artifact store's answer under the session's
own scope. A session with no live instance is served by the pool's one reader
(outside the pool, built once, stopped at `close()`), and `artifactsForRequest`
binds for it. The protection against made-up session ids is kept: the wire
first asks the store silently whether the scope holds the ref, so a flood of
made-up ids is still the one 404 with nothing emitted, builds no pooled
instance, evicts nobody, and now reads the session store not at all (a
session-only redemption at an open door no longer calls `hydrate` or
`onWake(…, 'artifact')`). A lane-less not-found or no-store answer from the
reader emits no `artifacts.refused` fact. A verifying door is unchanged: it
still asks ownership first, and a session whose first turn has not persisted is
nobody's to open.
