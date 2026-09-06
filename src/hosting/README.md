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
- `sessionOwnership.ts`, `sessionRetention.ts`, `sessionWire.ts`,
  `artifactWire.ts`, `wireOps.ts`, `envelope.ts`, `headers.ts`, `errors.ts`.
- `memorySessions.ts`, `sqliteSessions.ts` — reference session stores.
- `browserSession.ts`, `webSocketConversation.ts`, `webSocketFrames.ts`,
  `identityVerification.ts`, `durability.ts`.
