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
