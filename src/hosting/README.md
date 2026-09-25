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

## The door guard (`doorGuard.ts`)
Every door `httpHost` serves checks a request before any handler sees it, with
or without an identity verifier. Being able to reach the port is not
permission: every browser inside the network can be steered by any page it
opens.

- A request that changes something (any method but GET/HEAD/OPTIONS) must say
  `content-type: application/json`, or it is refused with 415. A page on any
  site can make a browser send `text/plain`, a form, or no content type without
  a preflight; it cannot send JSON across origins without one, and this host
  never approves a preflight. The refused body is never parsed. If it is small
  (at most 1 MiB, within 2 s) it is drained first, so the sender reads the 415
  instead of a connection reset. `Expect: 100-continue` gets the 415, never a
  100.
- A browser `Origin` the door does not allow is refused with 403, on requests
  and on WebSocket handshakes. `Origin: null` is always refused. Unset
  `allowedOrigins` means "this door's own host" (`Host` or `X-Forwarded-Host`).
  A request the browser marked `Sec-Fetch-Site: cross-site` is refused unless
  its Origin is listed, and so is a WebSocket handshake with `Sec-Fetch-Site`
  but no `Origin`. A proxy must forward `Origin` and `Sec-Fetch-*` unchanged.
- With `allowedHosts`, a `Host` the door was not configured for is refused with
  421: the DNS-rebinding defence the default Origin rule cannot give (under
  rebinding the page's Origin and the request's Host both carry the attacker's
  name). Only the `Host` header counts, never `X-Forwarded-Host`. On a loopback
  bind, unset means `localhost`, `127.0.0.1` and `[::1]`, so a same-box reverse
  proxy that forwards the public name in `Host` must list that name (the 421
  says so). On any other bind, unset means one warning at boot. Health probes
  are never judged.
- A session id must be 1 to `MAX_SESSION_ID_LENGTH` (400) characters of
  visible ASCII (`!` to `~`), or it is refused with 400 at both doors, whichever
  field the dialect read it from. `nodeHost` caps a body at 1 MiB by default,
  so the check never waits on an unbounded read.
- Every refusal names the rule, never the value, and is recorded in the ingress
  record through the host's `onRefusal`.

```ts
nodeHost({ port: 8080, allowedHosts: ['neo.corp.example'] });

// An application route beside the door (on `onUnhandled`) keeps the same rule:
const guard = doorGuard({ name: 'sign-in', allowedHosts: ['neo.corp.example'] });
const refusal = guard.check(req); // IncomingMessage works as-is
if (refusal) return reply(refusal.status, { error: refusal.message, code: refusal.code });
```

The library never redirects a short host name to a canonical one. List every
name the door answers to in `allowedHosts`; redirecting belongs to the proxy or
the application. The hosted-runtime adapters (`agentCoreRuntimeHost`,
`agentCoreA2AHost`, `foundryResponsesHost`) leave the browser rules off unless
you set them, on a non-loopback bind: a platform's front door, which demands its
own credential, is the only way to their port. They print one line at boot when
the rules are off. On a loopback bind (a laptop) they keep every default. The
session-id bound applies to them too. See
`docs/design/2026-09-door-hardening.md`.

## Files
- `types.ts` — the three ports.
- `httpHost.ts`, `nodeHost.ts`, `standingAgent.ts` — the hosts.
- `doorGuard.ts` — what a request has to be before any handler sees it.
- `admission.ts` — refuse before it costs anything.
- `ingressRecord.ts` — what the door decided for requests that never ran.
- `turnArtifacts.ts` — the artifact hand-over a turn gives its host, and its
  lifetime (live only while its turn is, bounded).
- `answerAccounts.ts` — the `answer-account` op's cache, single-flight and
  the pure recording → `{ account, shown }` step (the op itself is a branch of
  `standingAgent.ts · answerArtifact`).
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

## Explain this answer — the `answer-account` op

`{ op: 'answer-account', ref }` returns one answer's plain-words account,
computed HERE from the recording the ref names, so a browser never downloads a
recording to explain an answer. Opt in with `standingAgent({ answerAccounts })`;
without it the op is the unknown-op refusal, before anything is read.

The rule: **it is `artifact-get`, narrowed.** It is a third branch inside
`standingAgent.ts · answerArtifact`, so it takes the same door guard, the same
`isArtifactRef`, the same ownership check (`mayRedeemFrom`) before any lane is
built, and it is lane-free (it never waits behind a run). Its output is a
derivative of bytes the same caller could already `artifact-get`, so it can
only narrow what leaves, never widen who sees it. After ownership, in order:

1. a SILENT head (a binding with no sink — emits nothing) — BEFORE the cache,
   so a swept or expired recording is "not available" even when its account
   is cached;
2. not a `recording/run` → the one not-found; over `maxRecordingBytes`
   (default 16 MiB) → `RecordingTooLargeForAccountError` (413), before a byte
   of the payload is read;
3. the cache (`(scope, ref, template-set version, declarations digest)`, 32
   entries and 8 MiB) — a hit reads and emits nothing more;
4. single-flight: one computation per key, joined by concurrent requests; its
   `get` goes through the sinked binding and emits the ONE
   `artifacts.resolved` fact (`via: 'get'`, stamped with the caller's
   session);
5. parse + `accountForAnswer` + show-me leaves — anything that cannot be
   explained is the one not-found. Failures are never cached.

Every failure is the ONE `ERR_ARTIFACT_NOT_FOUND` — missing, expired, another
person's, the wrong kind, unreadable — except the named size refusal (and the
caller/deployment gaps the siblings share: no session, not a ref, no store).
The declarations are the host's, validated at boot; a body key other than
`op`, `ref` and `sessionId` is refused by name. The reply is `{ account, shown }`
through `artifactWireBody`, so every dialect serves it; `shown` is keyed by
`answerAccountPointerKey(pointer)` (`agentfootprint/observe`), and the whole
reply is at most 192 KB. On the field recording (5.3 MB) the parse costs about
6 ms of event loop and the fold plus show-me under 1 ms warm (3.4 ms cold);
a miss answers over HTTP in about 18 ms and a hit in about 1 ms.

```ts
await standingAgent({
  agent,
  sessions,
  host: nodeHost({ port: 8080 }),
  answerAccounts: {
    declarations: { tools: { lookup_volumes: { rowsAt: 'volumes' } } },
  },
});

// The browser, one request per Explain:
const res = await fetch('/invoke', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
  body: JSON.stringify({ op: 'answer-account', ref: reasoning.ref }),
});
const { account, shown } = await res.json(); // 404 ERR_ARTIFACT_NOT_FOUND → "not available"
```
