**Support** — the transports that put an agent behind somebody else's wire
protocol, and the session stores that keep conversations where a fleet can share
them.

## What it reads / what it writes
Reads a request in a foreign dialect and hands the host a run; writes sessions
through the `SessionLifecycle` port. Refusals made before a run exists are
recorded by `src/hosting/ingressRecord.ts`, not here.

## The one law here
The dialect is the adapter's business; admission, ownership and retention rules
belong to `src/hosting/` so four stores cannot each get them slightly wrong.

## Files
- `a2aWire.ts`, `responsesWire.ts` — two protocols, each as an `HttpWire`.
- `agentcore.ts`, `agentCoreA2A.ts`, `foundryResponses.ts`,
  `googleAgentEngine.ts` — hosted-runtime adapters.
- `firestoreSessions.ts` — conversations in a shared document store.
- `agentEngineOwner.ts` — who signed an Agent Engine conversation (a write-once
  state key, so an anonymous turn cannot erase the owner) and which id a listing
  may hand out for an old row (only one that opens it). Example: anonymous,
  then alice, then anonymous, then bob — bob is refused, alice still owns it.
