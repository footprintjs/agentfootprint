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

## Who is calling — one strategy, chosen by config

A deployment proves who is calling with ONE strategy, picked once at boot by
`identityFromConfig` (`agentfootprint/security`). Its answer is the
`identity` option every door takes; `verifyRequestIdentity` stays the one
funnel.

- **Production names its strategy, even `open`.** `production` is an input the
  app gives; the library never guesses it. Unset in production refuses to boot.
- **A typo is never `open`.** An unknown strategy, an unknown `IDENTITY_*`
  key, or a key a later release reads refuses by name. Keys set with no
  strategy refuse; keys set beside an explicit `open` print a warning.
- **Config errors refuse at boot; outages answer 503.** `oidc-token` reads the
  issuer's discovery document at boot: a 404, a body that is not JSON, or a
  document naming another issuer — or a redirect — refuses; an unreachable IdP
  starts, says so in the banner, and every request answers 503 (a fixed
  sentence) until discovery succeeds. After such a boot, a later misconfigured
  answer is logged once and retried, never final.
- **`IDENTITY_ALLOWED_CLIENTS=any` refuses in production**, and every listed
  client must have service accounts / client credentials turned off.
- **Only a person's token is a person.** `oidc-token` refuses an application's
  own token (`not-a-user-token`) and a token from an unlisted client
  (`wrong-client`). These, and `roles-unknown`, are new `IdentityFailureClass`
  words: the ingress record carries them like the others.
- **The banner never carries a secret.** Print every line at boot.
- This release starts `open`, `oidc-token` (bearer access tokens, plus
  browser sign-in — pending independent review) and `local-password`
  (development only; refused in production). `proxy-token` and
  `directory-password` are named and refused as "not in this release".
- **`GET /auth/config` in every mode.** The sign-in door answers it in
  `password` and `redirect` mode; for `open` and `token-only` there is no door,
  and the app answers `{ mode: choice.mode }` itself — the page learns from it
  whether to show a sign-in.

```ts
const choice = await identityFromConfig(identityConfigFromEnv(process.env), {
  production: process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production',
});
for (const line of choice.banner) console.log(line);
await standingAgent({ agent, sessions, host: nodeHost({ port: 8080 }), identity: choice.identity });
```

### The credential seam — a sign-in cookie never reaches a handler

A host built with `signIn` carries a sign-in cookie. These rules hold at both
doors (requests and conversations):

1. **Proved, never read.** A `userId` comes only from a strategy's `verify`, or
   from a sign-in the server keeps. A header, body field or cookie value is
   never read as a person.
2. **Refuse, never downgrade.** A request that cannot prove who it is is
   refused — never run as anonymous, never under the name it claimed.
3. **One strategy per deployment**, chosen by `identityFromConfig`.
4. **One verification path.** Every credential ends in
   `verifyRequestIdentity`: a bearer token in the strategy's `verify`, a
   sign-in in the `signIn` source.
5. **Secrets never travel (rule 10).** The transport strips the sign-in
   cookie from `HostRequest.headers` and `HostConversation.headers` and passes
   its key (`signInKey`, the value's SHA-256) instead. `withoutCredentials`
   is for anything that logs.
6. **Sign-in stays out of the record (rule 11).** The ingress record carries
   the proven `userId` and the failure class, never the cookie or its key.
7. **One credential per request (rule 13).** A token and a sign-in together
   are refused as `two-credentials`.
8. **A socket's sign-in is checked before the 101, re-checked before every
   inbound frame, and sign-out closes the socket (rule 21).** An ended
   sign-in closes it with 1008; a store that cannot answer closes it with
   1011 — an outage, never a sign-out.

A sign-in that ended, expired, went idle or never existed is one answer,
`expired`. A sign-in store that cannot answer is 503. Without `signIn` on the
host and on `identity`, nothing about either door changes.

```ts
const signIns = signInSource({ store, idleMinutes: 60 });
const identity = { signIn: signIns };          // or { verify, signIn } for both
await standingAgent({
  agent,
  sessions,
  host: nodeHost({ port: 8080, allowedHosts: ['neo.corp.example'], signIn: { identity } }),
  identity,
});
await signIns.end(key); // sign-out: every socket carrying it closes
```

### The sign-in door — `/auth`, a cookie, no IdP token

`signInDoor` (`signin/door.ts`) serves `/auth/config`, `/auth/me`,
`/auth/login` and `/auth/logout`; mount it in front of your routes. With
`IDENTITY_STRATEGY=local-password`, `identityFromConfig` builds it for you
(`choice.signInDoor`, `choice.hostSignIn`, `choice.identity`).

- **The browser holds no IdP token (rule 16).** It holds a random value in an
  `HttpOnly` cookie; the server keeps the sign-in by the value's SHA-256.
- **A password door (rule 18)** runs the door guard on every login, reads
  JSON only, answers a bad body with a fixed sentence, refuses an empty
  password before any check, gives every wrong credential one answer after a
  minimum time, and ends a sign-in already present. **An attempt is counted
  when it STARTS**, one check per name is in flight at a time, and at most 4
  checks run door-wide (32 wait; beyond that 503 with `Retry-After`) — so a
  parallel burst cannot get more guesses than the per-name budget. That is
  what protects Active Directory's own lockout threshold once
  `directory-password` rides this limiter.
- **The per-name budget refuses; the per-address budget only delays.** Behind
  a proxy or a shared NAT everyone can arrive from one address, and a hard
  address budget would let anybody lock the whole company out of sign-in. List
  the proxy in `trustedProxies` (IPs or CIDR ranges) so each person is their
  own address; the door warns once if forwarding headers arrive and none is
  trusted. IPv6 clients are counted per /64.
- **Server-side state is bounded, and per process (rule 19).** The banner
  says: run one replica, or pin each browser to one, or use a shared store.
  One person can never sign anybody else out: each account keeps at most 10
  live sign-ins (its oldest ends), expired rows are swept first, and a full
  store refuses a NEW sign-in (503) instead of evicting someone else's.
- **Every end is announced (rule 21).** Sign-out, the per-account cap and the
  sweep all reach `onEnd`, and a socket carrying that sign-in closes. A socket
  that only RECEIVES learns of a sign-in that simply ran out of time on its
  next inbound frame; there is no timer.
- Sign-ins last 8 hours, 60 idle minutes under a password.

```ts
const choice = await identityFromConfig(identityConfigFromEnv(process.env), { production: false });
const door = choice.signInDoor!;
const host = nodeHost({
  port: 5350,
  hostname: '127.0.0.1',
  signIn: choice.hostSignIn,
  onUnhandled: (req, res) => void door.handle(req, res).then((ok) => ok || res.writeHead(404).end()),
});
await standingAgent({ agent, sessions, host, identity: choice.identity });
```

**Browser sign-in for `oidc-token`** (`GET /auth/login` → the IdP →
`GET /auth/callback`) is built and tested and **pending independent review**:
see `signin/README.md`. `returnTo` never leaves the public origin (rule 20),
the transaction is sealed into the browser, and the person comes from an
access token through the strategy's own `verify` (rule 4).

The rules for the verifiers themselves are in `src/adapters/identity/README.md`.

## Files
- `types.ts` — the three ports.
- `httpHost.ts`, `nodeHost.ts`, `standingAgent.ts` — the hosts.
- `doorGuard.ts` — what a request has to be before any handler sees it.
- `signin/` — the sign-in cookie, the seam that strips it, the lifetimes.
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
a KNOWN EDGE in `test/hosting/turn-artifacts.test.ts`: an unverified door where
the conversation carries an identity (an app-seeded tenant, or a user an
earlier turn claimed) while this request names nobody — the recording is filed
where no redemption by that caller looks. (A pause that named nobody, resumed
by a claimed user, is no longer an edge: it is refused — one run, one
identity, below.)

**A resumed run is for the person whose run it resumes — one run, one
identity.** `Agent.resume` takes the caller identity (`Agent.lastRunIdentity`:
what `checkpoint()` stores, what `EventMeta.principal` and a tool's
`ctx.identity` carry) from the PAUSED run's own record on the checkpoint
(`core/agent/callerIdentity.ts · callerIdentityOf`) — never from whatever the
instance ran last. The law: never drop an identity a caller named, never
promote one the library derived (the session rung, the per-run default).

- **One run, one identity, fail closed.** A resume that names an identity must
  name exactly the one the run's memory namespace and credentials are
  restored with (`scope.runIdentity` on the checkpoint, WHATEVER its source) —
  a resume never re-seeds, so any other identity would split the run. Refused
  before anything runs, with `ResumeIdentityConflictError` (code
  `ERR_SESSION_OWNERSHIP_CONFLICT`, naming neither person):
  - a DIFFERENT named person;
  - an OWNERLESS pause (it named nobody: the per-run default or the session
    rung) resumed by a named person — the fail-closed reading of an open
    question; a later release may relax it behind an explicit opt-in, never by
    default;
  - a checkpoint whose own fields disagree (a session-rung marker on an
    identity that carries a person), with or without a named identity.
- A resume that names no session takes the one the paused run recorded in its
  own state — ONE source, no instance memory — so its evidence, events and tool
  teardown stay with that session. Seed writes `runSessionId` on every
  session-bound run, and `null` on a run a caller named an identity for that
  had no session. A checkpoint written BEFORE that key existed is never filed
  as sessionless: the session rung gives it, and a caller-named identity gives
  its `conversationId` (what `standingAgent` composed it from; an app that
  seeded a different conversation id passes `sessionId` on the resume).
- An identity that is not one — a field that is not a string, or no field at
  all — is refused with a `TypeError` when the RUN begins, not at a resume
  that could then never succeed.
- **A checkpoint names who it is for; it is not proof.** A resume that names no
  identity trusts the checkpoint's identity and session. A host that lets
  checkpoints leave its trust boundary (held by a browser, say) signs them or
  keeps them server-side, and passes the identity it verified — then any edit
  to the identity is refused. `standingAgent` keeps checkpoints server-side,
  gates every resume on ownership and passes the verified identity.
- The one stated edge: the per-run default is not recorded, so a caller-named
  identity that is exactly `{ conversationId: 'run-<digits>-<digits>' }`,
  resumed BARE on another instance — or on the same instance once anyone else
  has run in between — and matching no receipt, is read as derived. Pass
  `identity` on `resume` to keep such a name.

```ts
// No host: the checkpoint carries who the paused run was for.
const paused = await agent.run({ message: 'refund me', identity: xavier }, { sessionId: 's-x' });
agent.abandonPause();
await agent.run({ message: 'hi', identity: yara });                 // somebody else, same instance
await agent.resume(paused.checkpoint, 'yes', { sessionId: 's-x' }); // for xavier, in xavier's session
agent.checkpoint()?.identity;                                        // → xavier
await agent.resume(paused.checkpoint, 'yes', { identity: yara });   // throws ResumeIdentityConflictError
const nobody = await agent.run({ message: 'refund me' });            // names nobody
await agent.resume(nobody.checkpoint, 'yes', { identity: yara });   // throws: an ownerless run is not claimed
```

**One agent, many people: self-explain reads only the asking conversation.**
`.selfExplain()` keeps each finished turn's evidence (snapshot, narrative,
event tail) under the CONVERSATION it ran for, and a why-question is answered
from the previous completed turn of the asking run's own conversation — never
the instance's last run, which on `standingAgent({ agent })` is somebody
else's. The keys live in spaces no client string can enter
(`core/agent/servingConversation.ts`): a run with a session is keyed
`session:<id>` — whatever the id, `#` and all — and a request `standingAgent`
serves WITHOUT a session (signed in or not, shared or pooled) is keyed
`hosted:<a random UUID minted for that request>`, so no later request can
name it. Only a direct, unhosted run with no session shares the no-session
key: the single-user path. (The composer's own lane and latch keys are
namespaced the same way, so a session id spelled `anonymous` or `#anonymous-1`
is just a session.) A run joins its conversation when it STARTS, so the
records its tools filed stay its conversation's even when it pauses or fails.
Sessionless (one-shot) conversations are kept on their own shelf of 8, so a
flood of sessionless requests never evicts a session's evidence.
A tool's retained inner runs
(`flowchartAsTool` / `runbookAsTool` with `keepRecord: true`) are keyed by run
AND call id and served only to the conversation whose runs made them: another
conversation's record is not found, not listed, not counted — and a record that
names no run (a third-party producer) is served only on the direct no-session
path. Evidence for the 64 most recently completed conversations is kept per
agent; an older one answers "no completed run".

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
session id is the key, by law.

**A read never takes a person's instance away.** A redemption and
`handle.artifactsForRequest` never build a pooled lane and never evict one —
before, anybody naming made-up session ids at an open door built an instance
per id and retired the least recently used idle session, closing its tool
sessions as `'evicted'`. The store that answers (`redeemerFor`):

| the session has | answered by |
|---|---|
| a live lane (the shared agent, or its pooled instance) | that instance's store |
| no live lane and no stored conversation | the one not-found — nothing built, nothing emitted (nothing could have been minted there: a first turn still in flight HAS a lane) |
| no live lane, a stored conversation (its instance was evicted) | the READER: one instance from `agentFactory`, held outside the pool, built on first need, stopped at `close()` — it never counts toward `maxActiveSessions` |

The reader answers from the factory's store, so a pooled deployment whose
artifacts must outlive an instance hands every instance ONE store — which was
already true: an instance with a store of its own takes its artifacts with it
when it is evicted.

```ts
const store = sqliteArtifacts({ file: './artifacts.db' }); // shared by every instance
await standingAgent({ agentFactory: () => Agent.create({ provider, model, artifacts: store }).build(), sessions, host });
``` Redemptions stay lane-free — and are therefore
BOUNDED per session instead: `artifact-head`, `artifact-get` and
`answer-account` count together against `artifactOpsPerSession` (default
`DEFAULT_ARTIFACT_OPS_PER_SESSION`, 8), counted after the ownership check, and
the next one is refused with `ArtifactOpsBusyError` (429) while every other
session is served. Turn admission never sees these ops, so this is their only
bound.

```ts
await standingAgent({ agent, sessions, host, artifactOpsPerSession: 4 });
// a 5th concurrent artifact op from one session → 429 ERR_ARTIFACT_OPS_BUSY
```

**A request's scope OUTSIDE a turn — `handle.artifactsForRequest`.**
`reply.turnArtifacts` arrives at the END of a turn. A path that is not a turn —
a panel reading a payload by ref before the run, an app-owned route that files
a guide beside a conversation — asks the handle `standingAgent` returned
instead. The rule: **the host never composes a scope.** The handle runs the
redemption door's own steps with the door's own instances: the configured
verifier, the session-id check the adapters apply (`checkSessionId`), the
stored conversation, the ownership rule (`mayRedeemFrom`), the ONE composer
(`sessionArtifactScope`), and the store of the instance serving that session —
never building or evicting one (`redeemerFor`). "The caller" is what the door
knows: with a verifier, the person the token proves; without one, the session
id and the `userId` claim are the key, as on the wire.

What comes back is the `TurnArtifacts` shape — five verbs, no scope on the
value, never the unscoped store — or a reason, in this order: `'unverified'`
(401), `'unavailable'` (the verifier could not answer — 503, never 401),
`'no-session'`, `'invalid-session'` (400), `'not-found'` (a session this caller
cannot open, or one with no live instance and nothing stored), `'no-store'`.
The verbs count against `artifactOpsPerSession` with the wire's redemptions
(`ArtifactOpsBusyError`), and the binding is REVOKED when its instance is
retired from the pool or the host closes: a call STARTED after that rejects
with `RequestArtifactsRevokedError` (already handled — ask again); an operation
already in flight completes. A call to `artifactsForRequest` that loses the
race to `close()` throws `HostClosedError`, as a call made after it does (and
as the wire answers): it binds nothing and builds nothing.
`headers` takes `IncomingHttpHeaders` as it is; a REPEATED `authorization` is
two credentials, refused as `'unverified'` rather than read as none. A ref filed through it is redeemed on the wire
by the same caller; another person's ref answers `null`, exactly like one that
never existed.

```ts
import type { Request, Response } from 'express';

const handle = await standingAgent({ agent, sessions, host, identity: { verify } });
const STATUS: Record<string, number> = { unverified: 401, unavailable: 503, 'invalid-session': 400 };

app.get('/panel/:sessionId/:ref', async (req: Request, res: Response) => {
  // `req.headers` goes in as it is (a repeated authorization is refused); the seam checks the session id itself.
  const scoped = await handle.artifactsForRequest({ sessionId: req.params.sessionId, headers: req.headers });
  if (!scoped.bound) return res.status(STATUS[scoped.reason] ?? 404).end();
  const payload = await scoped.artifacts.get(req.params.ref); // null: missing, expired or not yours
  return payload ? res.json(payload.data) : res.status(404).end();
});
```

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
   of the payload is read — and again on the payload's REAL size before any
   parse, since a store may under-report `bytes`;
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
