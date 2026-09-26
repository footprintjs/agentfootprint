---
type: security
bump: minor
---
**One agent serving many signed-in people: a resume now belongs to the person whose run it resumes, and self-explain reads only the asking conversation.** Three fixes and one new door for `standingAgent({ agent })` (one agent, many sessions) and pooled agents:

- **`Agent.resume` sets who the run is for.** It used to inherit the identity of whatever the instance ran last, which is what `checkpoint()` stored, what every event's `EventMeta.principal` carried and what a tool's `ctx.identity` saw. On a shared agent, bob's resume failed with `ERR_SESSION_OWNERSHIP_CONFLICT` after his approved tool had already run; at an open door an ownerless session was moved under another person's principal and conversation; on a pooled agent an owner whose instance was evicted between the pause and the resume was locked out (`ERR_SESSION_NOT_FOUND`). A resume now takes the identity the resuming call names, else the one the paused run's caller named, read from the checkpoint it is handed. An identity the library derived for the paused run (a session's, or the per-run default) is still never published as a person.
- **Self-explain keeps evidence per conversation.** `.selfExplain()` served "the previous completed run" of the INSTANCE, so on a shared agent bob's why-question was answered from alice's snapshot and narrative, her message text included. Evidence is now kept under the session each turn ran for and served only to that session (a run with no session reads the last run that had none). A tool's retained inner runs (`flowchartAsTool({ keepRecord: true })`, runbooks) now record their session and are served the same way: another session's call is not found and not listed.
- **New: `handle.artifactsForRequest(request)`.** The handle `standingAgent` returns can now hand a host the artifact store bound to a VERIFIED request's scope for paths that are not a turn, such as reading a payload by ref before the run or filing from an app-owned route. It runs the redemption door's own verifier, ownership rule and scope composer, so the host never composes a scope. It answers `{ bound: true, artifacts }` or a reason (`'unverified'`, `'no-session'`, `'not-found'`, `'no-store'`) and never falls back to the unscoped store.

```ts
const scoped = await handle.artifactsForRequest({ sessionId, headers: req.headers });
if (!scoped.bound) return res.status(scoped.reason === 'unverified' ? 401 : 404).end();
const payload = await scoped.artifacts.get(ref); // null: missing, expired or not yours
```
