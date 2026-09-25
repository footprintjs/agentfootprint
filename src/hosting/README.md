**Support** — the ports between an agent and the place it runs: call me, talk to
me, outlive the request — plus local adapters that prove the ports work.

## What it reads / what it writes
- Reads a request and a session; hands the runner a run.
- Writes sessions through `SessionLifecycle`. One genuine record surface lives
  here: `ingressRecord.ts` keeps one row per request the door refused BEFORE a
  run existed, and states honestly that an empty bundle is not evidence that
  nobody was turned away.

## The one law here
Admission, ownership and retention are decided once, here, so no store can get
them slightly differently. Deliberately vendor-neutral — a test greps for it.

## Files
- `types.ts` — the three ports.
- `httpHost.ts`, `nodeHost.ts`, `standingAgent.ts` — the hosts.
- `admission.ts` — refuse before it costs anything.
- `ingressRecord.ts` — what the door decided for requests that never ran.
- `turnArtifacts.ts` — the artifact hand-over a turn gives its host, and its
  lifetime (live only while its turn is, bounded).
- `sessionOwnership.ts`, `sessionRetention.ts`, `sessionWire.ts`,
  `artifactWire.ts`, `wireOps.ts`, `envelope.ts`, `headers.ts`, `errors.ts`.
- `memorySessions.ts`, `sqliteSessions.ts` — reference session stores.
- `browserSession.ts`, `webSocketConversation.ts`, `webSocketFrames.ts`,
  `identityVerification.ts`, `durability.ts`.

## Filing for a turn — the host never composes a scope

A request's artifact scope has ONE owner: `standingAgent`. The artifact door
(`artifact-head` / `artifact-get`) and the turn's hand-over
(`reply.turnArtifacts`) both take it from `sessionArtifactScope` in
`standingAgent.ts`, so what a host files for a turn lands where the door
redeems for the same caller. A host that re-derives the tuple itself gets the
open door right and the signed-in door wrong; that was a real field bug.

The hook is optional and not a terminal. The composer calls it once per turn
and AWAITS it while the session's lane is held, then ends the reply
(`complete` or `awaiting`). Four rules:

- **File inside the hook.** The binding is live only while the hand-over is:
  the composer waits for every operation the hook started, then revokes it; a
  verb called later rejects with `TurnArtifactsExpiredError` — already handled,
  so a floating late call cannot crash the process.
- **Bounded.** The hook plus the operations it started must settle within
  `turnArtifactsTimeoutMs` (default `TURN_ARTIFACTS_TIMEOUT_MS`, 5 s, the
  teardown precedent) and before the request's `signal` aborts. Whichever ends
  the wait: revoke, never cancel what is in flight, report, deliver the
  terminal, release the lane. In the shared `{ agent }` shape every session
  waits behind a turn's hook, so keep it to filing. If the store is slower
  than the ceiling, the ticket pattern below returns the reply WITHOUT its
  ticket: the artifact is still filed when the write lands, and the timeout
  is reported (`hand_over_failed { cause: 'timeout' }`).
- **Never decides the reply, never silent.** A hook throw, a failed operation
  (awaited or floating), the bound, the abort and a late call each land on the
  serving agent's stream as `agentfootprint.artifacts.hand_over_failed { cause,
  op?, errorClass?, errorCode? }` (class only, stamped with the session), and
  the first of them on the ingress record (`turnArtifactsFailure`).
- **Nothing to bind is said by type:** `{ bound: false, reason: 'no-session' |
  'no-store' }`. The scope is never on the value — a tuple a host can read is a
  tuple it can copy and edit.

```ts
const wrapped: HostReply = {
  complete: (output) => reply.complete(output),
  fail: (error) => reply.fail(error),
  // Optional members forwarded BY PRESENCE — the composer feature-detects each.
  ...(reply.awaiting && { awaiting: (pending) => reply.awaiting?.(pending) }),
  ...(reply.artifact && { artifact: (result) => reply.artifact?.(result) }),
  ...(reply.sessions && { sessions: (result) => reply.sessions?.(result) }),
  ...(reply.emit && { emit: (chunk) => reply.emit?.(chunk) }),
  turnArtifacts: async (turn) => {
    if (!turn.bound) return;
    const story = await turn.artifacts.put({ kind: 'story/turn', mediaType: 'application/json', data });
    ticketForThisReply = story.ref; // exists before `complete` composes the body
  },
};
await handler(request, wrapped);
```

Awaiting another turn of the same standing agent from inside the hook can
never finish (that turn queues behind this one) — the bound ends the wait.
`serveConversations` (WebSocket conversations) is not a composer turn and
hands nothing over.

**Where it does NOT meet the run's own recording.** The hand-over follows the
DOOR. The run's recording follows the identity the run was SEEDED with
(`scope.runIdentity`, set once by the seed stage), and the conversation's
stored identity — what both later read — is written by `Agent.checkpoint()`
from `Agent.lastRunIdentity`. Three sources; they agree at a verifying door and
at an open one whose conversation carries no identity of its own. Pinned as
KNOWN EDGES in `test/hosting/turn-artifacts.test.ts`: an unverified door where
the conversation carries an identity (an app-seeded tenant, or a user an
earlier turn claimed) while this request names nobody, and a pause that named
nobody resumed by a claimed user — the recording is filed where no redemption
by that caller looks. Separately, `Agent.resume` does not refresh
`lastRunIdentity`, so after a resume on a shared or rebuilt instance the
stored identity can name another session's caller — which moves the door and
the hand-over together (a follow-up packet).

**Door facts carry their session — and the door checks who is asking.**
Everything the door produces — a redemption's `resolved`/`refused`, a filing's
`minted`/`expired`, a `hand_over_failed` — is stamped with the session it was
produced for (`meta.sessionId`), a filing also with the run it was filed for
(captured when its binding was built). The run's recording and its
self-explain event tail keep only what belongs to their run
(`bridge/eventMeta.ts · eventBelongsToRun`: an event that names a run belongs
to that run; one of no run, to runs of its session). Because that stamp is the
session a request NAMED, the artifact door refuses a `ref` that is not a ref
(`isArtifactRef`, in the wire readers and in `answerArtifact`) and, at a
verifying door, answers a session the caller cannot open (`mayOpenSession`, or
for a first turn still in flight, the caller it is serving) with the one
not-found — nothing emitted, no lane built. At a door with no verifier the
session id is the key, by law. Redemptions stay lane-free.

Typed input pauses use the existing `decision` transport for `{requestId,
values}` and expose `PendingAsk.awaitingInput`. Partial replies persist the
updated pause without a run. `session-pending` reloads that question under the
same ownership rule as invoke. An explicit `{requestId, cancel:true}` closes
only an input pause, settles unanswered call messages and preserves history;
it never approves a consent gate or executes remaining work.
