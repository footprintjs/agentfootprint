# Trace — Trust boundary capture

`trustBoundaryRecorder()` is a typed observer. Subscribe it to a runner before
execution; it does not implement raw engine hooks, enforce policy, or reconstruct
facts from a finished snapshot. `toSnapshot()` returns one `TrustBoundaries`
recorder bundle with `meta.version: 1`.

The capture window crosses run, resume and composition IDs for events actually
supplied by its source. It does not add missing bridges: a parent composition
may not forward every child's policy events. An empty capture does not establish
absence of decisions; missing producer bridges remain outside this observer's scope.
`resetCapture()` is
the only reset: it starts a new capture ID and sequence, clears this observer's
tail/counters, and leaves its subscription and the engine untouched. One active
subscription is allowed. The returned unsubscribe is idempotent; re-subscription
does not reset a window. Unsubscribe prevents new admissions; an already admitted
synchronous projection still settles into its original capture window. Rows and
nested coordinates are owned/frozen, and every
snapshot has a detached frozen facts array.

## Admission

Seven real typed events are observed: `middleware.decision`, `permission.check`,
`permission.halt`, and `credential.requested`, `credential.acquired`,
`credential.authorization_required`, `credential.failed` (all prefixed by
`agentfootprint.`). Unrelated or unreadable event types are ignored: until an own
data `type` names one of these seven, membership is unknown. After membership is
established, malformed envelopes and malformed selected fields count as invalid.

Every retained row has `seq`, `eventType`, Agent `runId`, `runtimeStageId` and
`wallClockMs` from the typed event. Optional call ID/iteration are kept only when
present. Optional `sourcePosition` is validated and copied, including the
distinct `engineRunId`; no current commit count, root index, or inferred path is
substituted. An invalid supplied coordinate rejects the whole row. Placement is
absent when the event has none.

The closed payload whitelist is:

| Event | Fields beyond origin/call identity |
| --- | --- |
| middleware decision | middleware, moment, outcome, changed |
| permission check | capability, result, target?, policyRuleId? |
| permission halt | target, checkerId? |
| credential requested | service, mode? |
| credential acquired | service, kind |
| credential authorization required | service |
| credential failed | service, errorClass? |

Reasons, why/rationale/tellLLM, actors/principals/tenants, session IDs, URLs,
content, and extras are not read or retained. Only own data properties are
admitted; accessors are rejected without invoking them. Descriptor inspection
failures, including revoked/throwing proxies, are counted rather than escaping
the observer. Unlisted fields are neither enumerated nor serialized.

This is metadata minimization, **not universal secret scrubbing**. Names, IDs,
targets, credential kinds and error classes are bounded declared labels; a
caller can put sensitive text into those labels. An observed `allow` is not
proof of execution or complete policy coverage. `changed` reports a transform,
never that its value was redacted. Missing facts are not evidence of safety.

## Bounds and accounting

`maxFacts` is an integer from 1 to 10,000 (default 1,000). Admission is bounded
per row: each string is at most 512 UTF-16 code units, a coordinate has at most
32 runtime mount IDs, and its full serialized fact is at most 8,192 UTF-8 bytes.
Exceeding any bound rejects the row as oversized; identities are never clipped
or folded. Invalid fields and oversized fields are classified by the first
failed whitelist check.

The ring keeps the newest admitted facts with O(1) ordinary insertion/eviction.
A reentrant metadata Proxy may finish a later observation first; only that rare
out-of-order completion uses O(maxFacts) insertion of already-owned rows, with
no raw-event queue. Snapshots cost O(retained). Counters satisfy
`observed = retained + evicted + invalid + oversized + pending`.
`pending` counts a selected observation while its metadata is being inspected,
so a snapshot taken by reentrant code does not misreport it as retained or lost.
Reset fences every in-progress observation to its old capture epoch.
`observed` reserves the sequence before metadata admission, so rejected facts leave visible
gaps. Four nullable bounds identify the first/last observed and retained
sequences; counters and bounds remain meaningful when the tail is empty.

These limits apply only to this bundle. They do not change payloads or privacy
in a recording's general event timeline, execution snapshot, or other recorders.
