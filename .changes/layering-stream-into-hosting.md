---
type: internal
---
**`stream.ts` moves from the `src/` root into `hosting/`.** The server-sent-events stream (`toSSE`, `SSEFormatter`, `encodeSSE`) is what a host serves, so it now lives beside `httpHost`. `hosting` no longer imports a root module, and one upward edge leaves the layering allowance list. `agentfootprint/observe` exports the same names as before.
