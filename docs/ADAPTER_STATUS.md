# Adapter status

Every hosting/session adapter this library ships, and how strong the evidence
behind its current status actually is.

## The rungs

Three rungs, in order of strength. An adapter earns the next rung up only when
there is a specific fact backing it — otherwise it stays where it is.

1. **`contract-shaped and tested`** — the adapter passes the shipped conformance
   battery (`sessionLifecycleConformance` for a `SessionLifecycle` store, the
   host conformance suite for an `AgentHost`/`ConversationHost`) run against a
   double, an injected fake, or — for a plain-HTTP host — a real local socket.
   This is the floor every shipped adapter must clear, and it is also the
   default: an adapter with no field evidence sits here honestly rather than
   being described as more than it's shown to be.
2. **`field-validated`** — the same battery (or the specific claim under test)
   has been run against the *real* service, by a real deployment, and passed.
3. **`field-corrected`** — a real defect was found by exercising the adapter
   against the real service, and it was fixed. This is the strongest rung
   precisely because it is evidence of the adapter having been *wrong* once and
   caught — not just unexercised.

**The rule: a status above the first rung must cite the issue or release that
earned it.** No adjective without a link. If this document says
`field-validated` or `field-corrected` and doesn't point at something you can
open and read, that's a bug in this document — file it.

When nobody has run an adapter's specific claim against the real backend it
targets, the honest status is the first rung, full stop, regardless of how much
injected-fake test coverage exists. A double can prove a store matches the
*port's* contract; only the real service can prove the store matches the real
service.

## The ledger

| Adapter | Status | Evidence | Not covered |
|---|---|---|---|
| `firestoreSessions` | `field-validated` | [Adapter trial issue #2](https://github.com/footprintjs/agentfootprint/issues/2) — 13/13 live `SessionLifecycle` conformance cases passed against a real Firestore collection. | This adapter declares no conformance limitations — every applicable case passed, live. What the battery does not reach: behaviour under Firestore security rules, composite-index configuration, and multi-region replication are all outside what a `SessionLifecycle` battery can assert about a store. |
| `agentEngineSessions` | `contract-shaped and tested` | Passes `sessionLifecycleConformance` against an injected double (`test/hosting/session-lifecycle-conformance.test.ts`). A field trial ([issue #2](https://github.com/footprintjs/agentfootprint/issues/2)) additionally exercised create, event-append, hydrate, corruption refusal, listing, pagination, awkward ids, and deletion live against the real service, all passing. | Declares one limitation the battery reports by name: a listing is ordered by the service’s own immutable `update_time`, which this adapter also reports as `savedAt`, so a timestamp carried inside the envelope cannot influence the order (the two coincide whenever a session is written because it changed). Separately — and more seriously — **ownership conformance under concurrent/interleaved real-service writes is NOT established and is under investigation.** The same field trial found a security-sensitive ownership invariant that did not hold under repeated live interleavings; the finding is tracked privately (not a public issue) pending resolution. Until that is closed, this adapter should not be described as fully ownership-conformant, and the status here deliberately stays at the first rung rather than being promoted on the strength of the cases that did pass. |
| `agentCoreSessions` | `field-corrected` | `{ store: 'memory' }`: a real deployment found that an envelope written as a raw object round-tripped through AgentCore Memory as an unparseable string — a silent, undetected data loss on every hydrate. Found and fixed in [`CHANGELOG.md`, `[7.23.0]`](../CHANGELOG.md) (the shim now writes JSON text and refuses an undecodable blob by name instead of returning `undefined`). `{ store: 'session-storage' }` was confirmed behaving as documented against the real service in the same release, closing an item open since `[7.15.0]`. | The `safeSessionId` collision logged in [`CHANGELOG.md`, `[9.42.0]`](../CHANGELOG.md) under "Known, not fixed" is now **fixed**: the id mapping is injective by construction and pinned both by the shipped battery's `awkward-session-ids-round-trip` case and by dedicated tests in `test/hosting/agentcore-sessions.test.ts`. Still not covered: ownership conformance under concurrent/interleaved real-service writes has never been exercised live for this store — no field trial has targeted it the way [issue #2](https://github.com/footprintjs/agentfootprint/issues/2) targeted the Google adapters. |
| `agentCoreRuntimeHost` | `field-corrected` | Passes the host conformance suite (`test/hosting/host-contract.test.ts`, the same suite `nodeHost` runs, over a real socket). Beyond that, real deployments have found and this library has fixed three real defects: a shared-port conflict when the host was asked to coexist with the caller's own listener ([`CHANGELOG.md`, `[7.22.0]`](../CHANGELOG.md)); an uncaught exception that took the whole container down when an unrelated co-listener set chunk encoding on the same socket ([`CHANGELOG.md`, `[7.27.0]`](../CHANGELOG.md)); and a `/ws` bearer-subprotocol mismatch that no browser could actually produce ([`CHANGELOG.md`, `[7.27.1]`](../CHANGELOG.md)). | These fixes come from real deployments distinct from the Google Cloud trial in [issue #2](https://github.com/footprintjs/agentfootprint/issues/2) — no adapter-trial issue exists for this one yet, so there's no single citable report, only the CHANGELOG entries above. Nothing has re-run the host conformance suite against the real AgentCore Runtime control plane *since* `[7.27.1]`; a regression between that fix and today would not yet be visible here. |

## Filing new evidence

Use the [Adapter Field Trial issue form](../.github/ISSUE_TEMPLATE/adapter_trial.yml) to
report a real trial of any adapter in this table (or one not yet in it). A
declared provider limitation is a first-class, useful outcome — it is not a
failure and doesn't need a workaround to be worth reporting. Security-sensitive
findings go to [private advisory reporting](https://github.com/footprintjs/agentfootprint/security/advisories/new),
never to a public issue.
