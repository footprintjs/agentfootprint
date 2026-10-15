---
type: added
---
**Serve any agent to AG-UI frontends with one handler — `streamHandler({ agent, adapter: agUi(), threads, sessions })`.**
`streamHandler` (on `agentfootprint/hosting`) is a framework-agnostic Fetch-API
handler, `(request: Request) => Promise<Response>`, that mounts in Next.js, Hono,
Bun, Deno or Workers. It treats every request as untrusted browser input and
shares nothing between requests: it builds a FRESH runner per request from your
factory (a factory that hands back the same runner twice is refused), binds the
thread a request names to the caller YOUR code authenticates (`threads`, a
`ThreadBinder` — the named id is format-checked and never a key), keeps the
conversation and any paused run on the server under that binding (`sessions`,
any session store), and allows one turn at a time per thread. It keeps
`httpHost`'s laws: the door guard first, a body ceiling, refusals as JSON with
their own status and code, a 500 that quotes nothing, an SSE keep-alive, a caller
who hangs up cutting the run. A paused run is stored BEFORE the caller is told.
`agUi()` (on `agentfootprint/ag-ui`) is the AG-UI `ProtocolAdapter`. Only the
newest USER message is taken as conversation — a page's assistant and tool
messages are its own copy and are never read, and a system or developer message
is refused. An answer is taken only for the pause the server keeps, matched to the
ids it handed out (a `resume` entry for its interrupt, or the tool message for the
frontend tool it waits on). Frontend tools run only when the app allow-lists them
by name with its own description and schema (`frontendTools`) — they run in the
page, hold no server privilege and never shadow a server tool. `state` and
`context` reach the agent only through the app's validators (`accept`). Identity,
credentials and redaction never come from a request. Everything a page may not
decide is refused by name. The official `@ag-ui/client` runs agents through it end
to end in the tests — a second turn from the server's copy, a frontend tool round
trip, an interrupt answered — and two users' requests running at once each see
only their own run. The hosting refusal statuses are now one table
(`refusalStatus.ts`) shared by every HTTP door, and a stored paused run may carry
the wire's own record of it (`PausedRun.wire`).
