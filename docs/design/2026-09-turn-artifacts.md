# The turn's artifact hand-over — one owner of the request scope

**Status:** built, unreleased (2026-09-25), revised twice after a security review
and a code review the same day (fix round 1: awaited + revoked + session-stamped
door facts; fix round 2: bounded, door ownership, late facts own their run, the
failure event). Code: `src/hosting/standingAgent.ts` ·
`sessionArtifactScope` / `offerTurnArtifacts` / `emitArtifactFact`;
`src/hosting/turnArtifacts.ts` · `openTurnArtifacts`; `src/bridge/eventMeta.ts` ·
`eventBelongsToRun`. Types: `src/hosting/types.ts` · `HostReply.turnArtifacts` /
`TurnArtifacts`. Tests: `test/hosting/turn-artifacts.test.ts` (behaviour + known
edges), `test/hosting/turn-artifacts-attacks.test.ts` (round-1 attacks),
`test/hosting/turn-artifacts-round2.test.ts` (round-2 attacks + the bound),
`test/hosting/turn-artifacts-process.test.ts` (a held binding in a real Node
process).

## The problem

`standingAgent` composes each request's artifact scope — with an identity
verifier, `{ tenant?, principal: <verified user>, conversationId }`
(`identityForRequest`) — and `artifact-get` re-composes the same tuple to
redeem. A host that files ITS OWN per-turn artifacts had no way to get that
tuple, so it re-derived one. The field app put its story and interaction
tickets under `{ conversationId: sessionId }`: right at an open door, wrong at a
signed-in one (`_/_/s` vs `_/u/s` in `identityNamespace`), so every signed-in user
got a 404.

## The ruling

The host must never compose a scope. The library hands the host, for the request
it is serving, the store already bound to the scope the library composed — the
same composition `artifact-get` / `head` redeem under.

## The seam: an optional, AWAITED, BOUNDED member on `HostReply`

`turnArtifacts?(turn: TurnArtifacts): void | Promise<void>` — called once per
turn and awaited while the session's lane is held, immediately before
`complete` or `awaiting`, within a bound.

Why the reply:

- **It is the one object that is per-request AND reaches host code.** The host
  hands the composer a `HostReply` for every request; a host that files for a
  turn already wraps it. The composer knows the scope only after hydrate and the
  ownership check, deep inside the lane — the reply is already there.
- **It has a precedent for optional, feature-detected members** (`awaiting`,
  `artifact`, `sessions`, `emit`); a host without the member is served as before,
  and the ingress wrapper forwards it by presence like the others.
- **The binding is a closure, not data.** The five `ctx.artifacts` verbs take no
  scope, so a binding reaches this request's scope and no other, and the tuple is
  never exposed — a tuple a host can read is one it can copy, edit and put under.

Why not the alternatives:

- **An exported `scopeForRequest(request)`.** It would still be the host
  composing: the function must take a user id and a session id, and a function
  that takes a user id can be handed somebody else's. It also could not know the
  stored tenant/namespace without a second hydrate.
- **The scope on an event.** Events are data sinks serialize; a scope there is a
  tuple any listener can copy, and an event is not per-request.
- **A field on `HostRequest`.** The request is the host's object going IN; the
  composer's enriched copy never reaches the host.

Why awaited: the first cut (a sync hook whose binding "outlived the call") let a
late filing on `{ agent }` land in ANOTHER person's run recording, crashed the
process on a floating `put` rejection, and let a throwing hook decide the
terminal. Why bounded: awaited alone, one host's hung store or hook held the
lane forever — every other session on `{ agent }`, a pooled lane past
`maxActiveSessions` (six agents built against a bound of two), and `close()` on
the SIGTERM path (`httpHost.close()` drains in-flight requests). The bound is no
longer what keeps a filing out of another person's record — the membership rule
below does that — so holding the lane longer bought nothing.

**The bound.** One deadline covers the hook AND the drain:
`turnArtifactsTimeoutMs`, default `TURN_ARTIFACTS_TIMEOUT_MS` = **5 000 ms**,
the `TOOL_TEARDOWN_TIMEOUT_MS` precedent (`toolSessions.ts · withTimeout`) and
for the same reason — both sit on the shutdown path, where an unbounded wait
turns a container stop into a wait for SIGKILL — while leaving a store room for
a few ordinary writes. The request's own `signal` ends it earlier (a caller who
hung up). The timer is unref'd. On expiry or abort: revoke, never cancel what
is in flight (there is nothing to cancel a store's write with; it may still
land, attributed to its own session and run), report, deliver the terminal,
release the lane. A non-positive or non-finite value is refused at
construction — a bound that can never fire is not a bound. The steady-state
cost, stated: in the shared shape every turn's hook I/O is added to every other
session's wait.

## The hand-over's lifetime (`turnArtifacts.ts`)

Live exactly as long as its turn — footprintjs's `ScopeFacade · assertLive` law,
"a handle held past its stage is refused", applied to the turn:

1. `openTurnArtifacts` binds the store (or states `no-session` / `no-store`),
   `origin` = the turn's run, captured now.
2. Every verb is tracked; its rejection is handled the moment it is created, so
   a floating `put` cannot become an unhandled rejection, while a host that
   awaits it still receives the error. Every failed operation is reported.
3. The composer awaits the hook, then `drain()` — both inside the bound. A hook
   throw is reported unless it merely re-threw an operation's own failure
   (`reported(err)`), so one failure counts once.
4. In `finally`, `revoke()`. A later call rejects with
   `TurnArtifactsExpiredError` — a rejection already handled (the round-2 crash
   was exactly this path) — and is reported as `'expired'`.

**Failure record: the stream AND the census.** Round 1 recorded a hook failure
on the ingress record only; the review overruled it — the default deployment
keeps no `onIngressDecision` sink, a floating operation's failure reached
nothing at all, and the swallow is the library's decision, so the visibility is
its duty (`toolSessions.ts` law 5, "never throws into the run — but never
silent either"). Now every failure — `hook`, `operation`, `timeout`, `abort`,
`expired` — is one `agentfootprint.artifacts.hand_over_failed { cause, op?,
errorClass?, errorCode? }` on the serving agent, on the existing (bridged,
wildcarded) `artifacts.` prefix, class only (a host error can carry anything),
stamped with the session and run it was for; the FIRST failure also lands on
`IngressRecord.turnArtifactsFailure` in the same shape, as the per-request
census; dev mode also logs.

## The root under the cross-user leak: which run an event belongs to

The hand-over's leak had older siblings the lifetime cannot fix: the wire
redemption (`artifact-head` / `artifact-get`) deliberately bypasses the lane (a
click must not wait behind somebody else's turn), so on a shared agent its facts
entered whichever person's run was in flight; and a tool's floating
`ctx.artifacts.put` that landed during a LATER run was stamped by the emit
bridge with the live run's session and principal.

The cause: a per-run collector (`recordRun` as the `recordings` dial uses it; the
self-explain event tail) subscribes to the whole dispatcher and keeps whatever
arrives while its run is in flight, and nothing but timing decided membership.

One owner: **`bridge/eventMeta.ts · eventBelongsToRun(meta, run)`**, next to
`buildEventMeta`, the one builder of run meta. Two clauses, in order: **an event
that names a run belongs to that run and no other; an event of no run
(`CONSUMER_SCOPE_RUN_ID`) belongs to runs of the session it was produced for —
or, naming none, to whatever run is in flight.** Three halves:

- **Stamp the door.** Every door fact goes through `emitArtifactFact(agent, fact,
  attribution)` → `RunnerBase.emitAttributed` (`@internal`): consumer-scope meta
  plus `sessionId`, and `runId` when the fact was produced FOR a run (a host's
  filing names the turn's run).
- **The binding owns "whose run".** A tool's `ctx.artifacts` captures its run
  context when it is built; a fact that lands after that run ended goes out
  through the Agent's late door (`emitForRun` → `buildEventMeta` with the
  captured context, pseudo-stage `'artifact-late#0'`, the teardown precedent),
  never through the emit bridge's live context. A fact landing while its own run
  is still live takes the ordinary scope channel, byte-identical.
- **Ask.** `Agent.ownsEvent` (`@internal`) applies the rule against the agent's
  run context; both per-run collectors ask it — the recording (`recordRunWhere`,
  internal) and the self-explain event source in `AgentBuilder`.

What it deliberately does NOT change: delivery (every listener still receives
every fact); a run's own events; consumer custom emits; the public
`recordRun(agent)`, which records everything as it always has; a same-session
redemption during that session's own run (still that run's record). One
consequence of clause 1, stated: a tool-session teardown report of an EARLIER
run's registration, swept idle during a later run, names the earlier run and so
belongs to it, not to the later run's recording.

**The door checks who is asking.** Because the stamp is the session the request
NAMED, round 2 found a stranger could choose it: write free text into another
signed-in person's live recording as a refused "ref", or flood it until its own
events were evicted (the tail keeps 10 000). So `answerArtifact` now (1) refuses
a `ref` that fails `isArtifactRef` — as do the wire readers
(`readArtifactWireOp`, `400 ERR_INVALID_WIRE_OP`, text never echoed); (2) at a
verifying door asks ownership BEFORE emitting anything or building a lane: the
turn door's own `mayOpenSession` for a stored conversation, and for one whose
first turn is still in flight only the caller that turn serves (the new
`Lane.activeOwner`); anyone else gets the one not-found, nothing emitted, no
pooled lane built (which also closes the lane-churn attack at verifying doors).
At a door with no verifier the session id is the key, by law.

## What the value says

`TurnArtifacts = { bound: true, artifacts } | { bound: false, reason:
'no-session' | 'no-store' }`, `no-session` winning when both apply. An anonymous
request is told by type there is nothing to bind — its run scoped its artifacts
to its own run id, a name no later request can present — rather than handed an
invented scope.

## One owner of the tuple — and the three identity sources

`sessionArtifactScope(userId, sessionId, storedIdentity)` =
`identityForRequest(...) ?? { conversationId: sessionId }` is the ONE
composition the door and the hand-over share. But three sources decide where
things land:

| | source | decides |
|---|---|---|
| R | the run's `scope.runIdentity`, written ONCE by the seed stage (a resume never re-seeds) | the run's own recording and every tool's `ctx.artifacts` |
| S | `sessionArtifactScope(userId, sessionId, stored)` | the door's redemption and the hand-over |
| C | `Agent.checkpoint()` → `conversationOwner()` = `Agent.lastRunIdentity` — set by `run()` from the call, and (since Follow-up A) by `resume()` from the call or the paused run's own record (`core/agent/callerIdentity.ts · callerIdentityOf`) | the STORED identity every later R and S read |

| case | R vs S |
|---|---|
| fresh turn, a user named (verified or claimed) | agree — same call, same inputs |
| fresh turn, no user, no stored identity | agree — the session rung |
| resume by the same verified user as the pause | agree |
| **KNOWN EDGE** — no user, the conversation carries an identity (an app-seeded tenant; a user an earlier turn claimed at an open door) | R = the stored identity, S = the session rung: the recording 404s at the door, the hand-over's filing redeems |
| open door, a pause that named nobody resumed by a claimed user (or the claimed user changes) | REFUSED since the round-4 recheck (RS2): `ResumeIdentityConflictError` — one run, one identity; may be relaxed later only behind an explicit opt-in |
| after a resume on a shared agent, or on a pooled instance rebuilt after eviction | FIXED (Follow-up A): C is the resumed run's own caller, so the stored identity no longer names another session's caller or none |
| a resume that names a DIFFERENT identity from the paused run's caller (a direct host) | REFUSED (`ResumeIdentityConflictError`): R is fixed in the checkpoint, so honouring the call would split one run between two identities (review S3) |

Where S and C agree, the hand-over and the door agree for the same caller.

A host that needs S OUTSIDE a turn (a read by ref before the run, an app-owned
route) asks `handle.artifactsForRequest(request)` — the redemption door's own
verifier, ownership rule and composer, handed back as bound verbs or a reason;
it never composes S itself.

## Record and origin

A host's filing lands as `agentfootprint.artifacts.minted` on the serving agent,
no `tool` field (the payload types now say `tool?` for minted/expired, the 9.23.0
precedent), `meta.sessionId` / `meta.runId` = the session and run it was filed
for (so it belongs to no other run's recording). `origin: { runId }` is the
run the turn executed, read from the snapshot the composer already takes to
persist — no extra snapshot on any path. A turn that executed none (a partial
answer to an input request, its cancellation) stamps none; reading "the agent's
last run" there could name another session's run. A caller's own `origin` is
dropped on every path (`bindArtifacts · put` — a PUBLIC behaviour change: a
binding created without an `origin` option now drops an input's own, e.g. what
`recordingPutInput(…, { runId })` sets). A **paused** turn's run files no
recording (a pause is not a finished run; the resumed run records under its own
id), so a reader joining on that run id must say "paused, no recording", not
"missing".

## Follow-ups (named, not in this packet)

- **A — FIXED: `Agent.resume` never updated `lastRunIdentity`** (row C above).
  After a resume the persisted conversation carried the identity of the
  instance's last `run()`: an ownership conflict after an approved tool ran
  (shared agent, verifier), an ownerless session re-homed into another
  conversation's namespace under another principal (open door), and an evicted
  owner locked out (pooled). `resume()` now sets it from `options.identity ??`
  the paused run's caller, read off the flowchart checkpoint
  (`callerIdentityOf`, the inverse of seed's rungs; the per-run default is
  recognised by shape, `RunnerBase.ts · isMintedRunId`, because the checkpoint
  does not carry the paused run's id). Pinned by
  `test/hosting/resume-identity.test.ts`.
- **B — what a no-user (or changed-claimed-user) request on a conversation that
  carries an identity MEANS** (the KNOWN EDGE rows). Every fix moves an existing
  deployment's memory namespace or redemption reach; awaits the owner's ruling.
- **R2-11 — FIXED: self-explain on a shared agent read another person's
  run.** `SelfExplainBinding` now keeps evidence PER CONVERSATION (keyed by the
  run's session, or for a hosted sessionless request its `#anonymous-N` latch —
  review B1; `core/agent/servingConversation.ts`; bounded LRU) and serves the
  asking run's conversation only; the tools' inner-run records carry their
  outer run id, are keyed by run AND call id, and are served through
  `innerRunsOfConversation` to the conversation whose runs made them. Pinned by the flipped test in
  `turn-artifacts-round2.test.ts` and the seeded property tests in
  `test/hosting/self-explain-isolation.test.ts`. The original entry: `SelfExplainBinding` captures "the previous completed run" per
  INSTANCE; on `standingAgent({ agent })` that is whoever ran last, so Bob's
  why-question reads Alice's snapshot and narrative (the devil's round-2 repro:
  Alice's "my secret is PINEAPPLE-42" returned to Bob's model by
  `read_narrative`; `scratchpad/packets/devil-runscope/test/hosting/devil-round2.test.ts`
  · R2-11, pinned here as an `it.fails` in `turn-artifacts-round2.test.ts`). This
  packet's event filter cannot help — the snapshot and narrative halves are
  unfiltered. Fix in its own packet: key the capture by the run's session and
  serve only the asking run's session, or refuse `.selfExplain()` under
  `{ agent }`. Until then: do not combine them.
- **R2-12 — FIXED: the artifact door built and evicted pooled lanes for any
  named session.** A redemption and `artifactsForRequest` now go through
  `standingAgent.ts · redeemerFor`: the live lane, else the one not-found when
  nothing is stored, else a single reader instance outside the pool. Pinned by
  `test/hosting/redemption-lanes.test.ts`.
- **Late non-artifact emits.** Only facts emitted through an artifact binding
  own their run now; any other emit that outlives its run (a tool's floating
  `ctx.progress`, a late `typedEmit`) is still stamped by the emit bridge with
  whichever run is live. The general fix is a per-executor run context.
- **The recording's own `store.put` is unbounded.** `Agent.fileRunRecording`
  awaits it inside `run()`; a hung store already wedges the lane when
  `recordings` is on. The hand-over's bound does not cover it.
- **Export the membership rule for public `recordRun` users.** A consumer that
  records each turn of a shared agent with `recordRun` still keeps every door
  fact; the facts now carry `meta.sessionId`/`meta.runId`, but no filter is
  exported (`recordRun(runner, { thisRunOnly })` or `eventBelongsToRun`).
- **R2-12 at an open door.** A redemption naming any session id builds a pooled
  lane (and may evict an idle one); closed at verifying doors by the ownership
  check, still open where the session id is the key.
- **F7 — `delete` / `list` put nothing on the record** (pre-existing in
  `bindArtifacts`; newly handed to host code). Either report a `deleted` fact or
  hand the host a narrower capability.
- The tool-less mint's commentary reads "The app itself (not a tool)" — exact for
  a host's filing, approximate for the recordings dial's own mint.
