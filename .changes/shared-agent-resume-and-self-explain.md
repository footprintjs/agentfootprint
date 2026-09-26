---
type: security
bump: minor
---
**One agent serving many people: a resume belongs to the person whose run it resumes, and self-explain reads only the asking conversation.** These fixes apply to `standingAgent({ agent })` (one agent, many sessions), to pooled agents, and to direct hosts. There is also one new door.

- **`Agent.resume` knows who the run is for, and a run has one identity.** A resume used to inherit the identity of whatever the instance ran last. That identity was what `checkpoint()` stored, what every event's `EventMeta.principal` carried and what a tool's `ctx.identity` saw. On a shared agent, bob's resume failed with `ERR_SESSION_OWNERSHIP_CONFLICT` after his approved tool had already run. At an open door, an ownerless session was moved under another person's principal. On a pooled agent, an owner whose instance was evicted between the pause and the resume was locked out.
  - A resume now takes the identity the paused run's caller named, read from the checkpoint. An identity the library derived (a session's, or the per-run default) is never promoted to a person, and one a caller named is never dropped.
  - One run, one identity, fail closed. A resume that names an identity must name exactly the one the run's memory namespace and credentials are restored with, because a resume never re-seeds them. Otherwise it is refused before anything runs, with `ResumeIdentityConflictError` (`ERR_SESSION_OWNERSHIP_CONFLICT`). That includes a different person, an ownerless pause (one that named nobody) resumed by a named person, and a checkpoint whose own fields disagree. The ownerless case may later be relaxed behind an explicit opt-in, never by default.
  - A resume that names no session takes the session the paused run recorded in its own state (`runSessionId`, now written on every session-bound run, and `null` on a named run with no session). A checkpoint written before that key existed is never filed as sessionless: its session is recovered from the session rung, or from the named identity's `conversationId`.
  - An identity that is not one (a field that is not a string, or no field at all) is refused with a `TypeError` when the run begins, not at a resume that could never succeed.
  - A checkpoint names who it is for, but it is not proof. A host that lets checkpoints leave its trust boundary must sign them, or keep them server-side, and pass the identity it verified.
- **Self-explain keeps evidence per conversation.** `.selfExplain()` used to serve "the previous completed run" of the INSTANCE. On a shared agent, bob's why-question was answered from alice's snapshot and narrative, her message text included.
  - Evidence is now kept under the conversation each turn ran for, in key spaces no client string can enter: a session's key is namespaced, whatever its id.
  - A request `standingAgent` serves without a session, signed in or not, is its own conversation, keyed by a random UUID that no later request can name. Those one-shot conversations are kept on their own small shelf, so a flood of them never evicts a session's evidence. Only a direct, unhosted run with no session shares the no-session key. The composer's own lane and latch keys are namespaced the same way, so a session id spelled like one of them is just a session.
  - A tool's retained inner runs (`flowchartAsTool` / `runbookAsTool` with `keepRecord: true`) are keyed by run and call id. They are served only to the conversation whose runs made them, including a run that paused or failed.
- **New: `handle.artifactsForRequest(request)`.** The handle `standingAgent` returns can now hand a host the artifact store bound to the scope a redemption by the same caller would read. This covers paths that are not a turn, such as a read by ref before the run or filing from an app-owned route.
  - It runs the redemption door's own verifier, session-id check, ownership rule and scope composer, and never builds or evicts an instance.
  - "The caller" means what the door knows: the person the token proves, or at a door with no verifier, the session id and the claimed user.
  - It answers `{ bound: true, artifacts }` or a reason: `'unverified'` (including a repeated `authorization` header), `'unavailable'` (the identity provider is down), `'no-session'`, `'invalid-session'`, `'not-found'` or `'no-store'`.
  - The verbs count against `artifactOpsPerSession`. A call started after the binding's instance is retired, or after the host closes, is refused with `RequestArtifactsRevokedError`.

```ts
const STATUS: Record<string, number> = { unverified: 401, unavailable: 503, 'invalid-session': 400 };
const scoped = await handle.artifactsForRequest({ sessionId, headers: req.headers });
if (!scoped.bound) return res.status(STATUS[scoped.reason] ?? 404).end();
const payload = await scoped.artifacts.get(ref); // null: missing, expired or not yours
```
