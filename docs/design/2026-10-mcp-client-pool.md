# A per-conversation MCP client pool

**Design for review. Not approved to implement.** Nothing in this page is built.
Approval to review it is not approval to implement it. Written 2026-10-28 from the
revised E4 requirement. Its seven decisions are taken as given; this page designs the
details. Revised 2026-10-29 after Codex's review of the first draft: tool definitions are
now per client unless the app declares a context the pool can check before anything opens;
every tool re-checks its binding after each wait and at the send boundary; endings run in
a bounded set, and a local cap is no longer claimed to bound remote sessions; a handle this
process lost is no longer reported as a server expiry. Revised again the same day after the
second review: an abort no longer frees capacity before the work under it settles, and a
per-client list belongs to one client incarnation, so a replacement client lists again.
After the third review, a pool-wide operation budget bounds outstanding work on any
client, and no release returns capacity before that work settles. After the fourth, an
ending reserves its slots before a client leaves the open set, the accounting unit is
named, and the note says what the budgets do not bound. The build follows in its own PR,
after the owner's and Codex's review.

Code is cited as `file` · `symbol`, under `src/`. A name marked † does not exist yet: it
is this page's proposal, and the build may rename it. Facts about the MCP SDK were read
from the installed `@modelcontextprotocol/sdk` 1.32.1; facts about AgentCore from
`@aws-sdk/client-bedrock-agentcore` and `@aws-sdk/client-bedrock-agentcore-control`
3.1159.0 and from AWS's pages on
[runtime sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html),
[lifecycle settings](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html),
[stopping a session](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-stop-session.html)
and the
[MCP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp-protocol-contract.html),
read 2026-10-29.

## For the owner

1. **The problem.** `agentCoreRuntimeMcpTransport` reaches an MCP server deployed to
   AgentCore Runtime. Its default session strategy, `'per-call'`, gives every request a
   runtime session of its own. That is safe to share between users, but every call pays
   the session's start-up (about 2.5 s, up to about 3.4 s, by the transport's own notes).
   `'reuse'` keeps one runtime session per `mcpClient`, and the docs say to build a client
   per conversation and never share one between users. Nothing builds, finds, bounds or
   ends those clients. And `close()` ends only the local side.
2. **What this page proposes.**
   - `mcpClientPool()`†, one per MCP server: one client per authenticated conversation,
     keyed by the library's identity encoding. An agent gets its conversation's tools from
     `pool.toolProvider()`†.
   - One open per key at a time, with a timeout. A failure is not cached.
   - A client in use holds a lease and is never evicted or closed. A full pool moves its
     least recently used idle client into a bounded set of endings, or refuses at once with
     `PoolFullError`†. A pool-wide operation budget bounds every open, listing, call and
     ending outstanding on any client, and each stays charged until its work has settled,
     not merely until it was aborted.
   - Tool definitions are per client by default, and belong to one client incarnation: a
     replacement client lists again. They are shared only when the app names the
     configuration and the authorization they depend on, and the pool has checked, before
     any client opens, the configuration it can see. Every tool is bound to that list and
     its generation, and re-checks the binding after each wait and at the send boundary.
   - `terminate`† ends the remote session through the transport and reports what the
     remote side answered, including when nothing could be confirmed. On AgentCore Runtime
     it is `StopRuntimeSession`. `close()` stays local.
   - Two failures that look alike stay two: a server's 404 for the session it issued is
     `SessionExpiredError`†; a handle this process lost is `LocalSessionHandleLostError`†,
     with the remote session's fate unknown.
3. **What it does not do.** It repeats no call (E3 owns repeats), shares nothing across
   processes, bounds no remote session it could not end, and cannot make a server enforce
   per-user permissions.

## 1. Why

### 1.1 The gap

`mcp/mcpClient.ts` · `mcpClient` opens one connection. `tools()` lists the server's tools
once and wraps each in an `execute` that closes over that connection
(`mcp/mcpClient.ts` · `wrapMcpTool`); the list is cached until `refresh()`.

Under `'reuse'` (`adapters/mcp/agentcoreRuntime/session.ts` · `sessionStrategy`), a
client's `initialize` opens a runtime session with a fresh id. The transport hands the
client a random handle in place of the server's `Mcp-Session-Id`, remembers at most
`MAX_CONNECTIONS` (256) connections, forgets the least recently used past that, and forgets
a handle on a `DELETE`. No library code sends one. `mcpClient.close()` calls the SDK's
`close()`, and in SDK 1.32.1 `StreamableHTTPClientTransport.close` only aborts in-flight
requests; `terminateSession()` is the one method that sends `DELETE`. On the SigV4 path a
`DELETE` would be answered 405 locally anyway
(`adapters/mcp/agentcoreRuntime/invoke.ts` · `invokeFetch`). So the runtime session's
compute runs until the platform's idle timeout, 900 s by default. The comment in
`session.ts` that calls a client's `DELETE` "its `close()`" is corrected by the build.

An app that wants warm sessions therefore has to do seven things itself: key one client
per conversation without crossing users; open each once when two calls race; bound how
many are open and how many are being ended; never close one in use; end remote sessions
and say when it could not; tell a server's expiry from a handle it lost; and decide
whether conversations may share a tool list. Each is easy to get wrong.

### 1.2 Why the obvious fixes are wrong

- **One `'reuse'` client for the process.** One runtime session — one microVM, one server
  state — for every user. The transport's own docs forbid it.
- **An app-side `Map<sessionId, McpClient>`.** It is keyed by caller data:
  `tools/tools.ts` · `ToolExecutionContext` says of `sessionId` that "anyone who can reach
  the host can put any string here, including someone else's". It is unbounded, blind to
  calls in flight, and nothing ends the remote sessions. The header of
  `core/codeRunnerTool.ts` records the same failure for code sandboxes.
- **A client per run.** The cold start every turn, which is `'per-call'` with extra steps,
  and a session left behind whenever a run throws.
- **One client's `Tool[]` given to every conversation.** Each `Tool` closes over its
  connection, so every conversation's calls land in the first conversation's session.
- **The agent's tool-session tier as the pool.** `tools/toolSessions.ts` ·
  `ToolSessionTier` is per runner and keyed per tool name. Its LRU closes the coldest
  registration whether or not a call is in flight. It also fires on instance events:
  `hosting/standingAgent.ts` retires an evicted lane with
  `closeToolSessions({ reason: 'evicted' })`, an eviction the person never sees. Ending a
  remote session there would drop server state the conversation still needs. The pool
  keeps the tier's laws but not its instance (§ 7).

## 2. What exists, and what this design builds on

| Today | Where | What this design does with it |
|---|---|---|
| One connection; one list, cached until `refresh()`; a local `close()` | `mcp/mcpClient.ts` · `mcpClient`; `mcp/types.ts` · `McpClient` | The pool's clients are ordinary `mcpClient`s. `terminate` is an optional capability on `McpClient`, detected by `canTerminate`† (§ 7). |
| Feature detection rather than a new required member | `provider-contract/types.ts` · `canStageCodeInputs` | How `terminate` is detected (§ 7). |
| Each listed tool wrapped with an `execute` that closes over the connection; provenance in `source`; declarations read from `_meta`; the client's construction-time `signal` passed to every call, never the run's | `mcp/mcpClient.ts` · `wrapMcpTool`; `mcp/toolExtras.ts` · `readToolExtras` | One wrapper for both; a pool-bound tool closes over its binding, not a connection, and passes the run's signal (§ 6.3). |
| One retry series per request; a rule joins it instead of wrapping it | `mcp/throttleRetry.ts` · `retryingFetchFor`, `joinableRetry` | The send gate joins the series (§ 6.3). |
| `'per-call'` and `'reuse'`; a random handle per client; 256 connections remembered, the least recently used forgotten; a forgotten handle answered with a 404 the transport makes itself; GET and `DELETE` answered 405 on SigV4 | `adapters/mcp/agentcoreRuntime/session.ts` · `sessionStrategy`, `MAX_CONNECTIONS`, `sessionNotFound`; `adapters/mcp/agentcoreRuntime/invoke.ts` · `invokeFetch` | A forgotten handle becomes `LocalSessionHandleLostError` (§ 5.5); under `'reuse'` a `DELETE` becomes `StopRuntimeSession` (§ 7). |
| The SDK's `close()` aborts and fires `onclose`; `terminateSession()` sends `DELETE` and treats 405 as success; a request times out after 60 s by default (`DEFAULT_REQUEST_TIMEOUT_MSEC`); a `listChanged` handler is installed only when the server advertises `tools.listChanged`; `send()` awaits its own headers before `fetch` | `@modelcontextprotocol/sdk` 1.32.1 | `terminate()` reads the status itself (§ 7); the caller's wait is bounded by the timeout, while the lease lives until the work settles (§ 5.2); pool clients subscribe (§ 6.2); the last check is at the send boundary (§ 6.3). |
| `StopRuntimeSessionCommand`: `POST /runtimes/{agentRuntimeArn}/stopruntimesession`, the runtime session id in its header; idle timeout 900 s and lifetime 28,800 s by default; a stopped session resumes on new compute under the same id | `@aws-sdk/client-bedrock-agentcore`, `-control` 3.1159.0; AWS's runtime pages | Termination (§ 7) and the platform's lifecycle (§ 5.4). |
| The identity tuple and its injective encoding, "the TENANT BOUNDARY" | `memory/identity/types.ts` · `MemoryIdentity`, `identityNamespace`; `memory/identity/encode.ts` · `encodeIdentityField` | The client key (§ 4). |
| Session keys from the same encoder; a short digest for the wire (SHA-256, 12 hex characters, where `node:crypto` resolves); the teardown tier and its seven laws | `tools/toolSessions.ts` · `toolSessionKey`, `hashSessionKey`, `ToolSessionTier`, `TOOL_TEARDOWN_TIMEOUT_MS` | `keyHash` on the record (§ 8); the laws for ending a client (§ 7). |
| The provider seam, asked every iteration; its `ctx.identity` is the run's identity, derived when no caller named one | `tools/toolProvider.ts` · `ToolProvider`, `ToolDispatchContext`; `core/slots/buildToolsSlot.ts` | `ToolDispatchContext` gains `callerIdentity`† (§ 4). |
| A tool's `ctx.identity` is the identity the caller named, absent otherwise | `tools/tools.ts` · `ToolExecutionContext`; `core/agent/callerIdentity.ts` | The identity check every bound tool makes (§ 6.3). |
| One session per key, opened once when calls race; facts taken by the dispatch loop after `execute` | `core/codeRunnerTool.ts` · `codeRunnerTool`, `CODE_RUNS`, `codeRunsOf` | The pattern for one open (§ 5.1) and for the record (§ 8). |
| Verify the caller, then compose `{ tenant, principal, conversationId }` | `hosting/identityVerification.ts`; `hosting/standingAgent.ts` · `identityForRequest` | Where the key's principal must come from (§ 4). |
| Per-caller limits before a run | `hosting/admission.ts` · `AdmissionPolicy` | The layer above the pool's own caps (§ 9). |

## 3. The API

### 3.1 Construction

```ts
import { agentCoreRuntimeMcpTransport, mcpClientPool } from 'agentfootprint/providers';

const orders = mcpClientPool({        // † one pool per MCP server
  name: 'orders',                      // the server's name: Tool.source, and the record
  // Called before a client opens, and again for every replacement, with the identity it is
  // for. A transport per client is preferred: each client then has a session map of its own.
  transport: () =>
    agentCoreRuntimeMcpTransport({ agentRuntimeArn, region, session: 'reuse', client: aws }),
  maxClients: 64,                // open clients, busy or idle
  maxClientsPerPrincipal: 8,     // one principal cannot take the pool
  maxEnding: 8,                  // clients being ended at once; when full, room is refused
  maxOperations: 256,            // opens, listings, calls and endings outstanding, until each settles
  initTimeoutMs: 30_000,         // one open per key, under this ceiling
  idleMs: 600_000,               // end a client idle this long (the platform's default is 900 s)
  definitions: 'per-client',     // the default; sharing is declared (§ 6.1)
  onEvent: (report) => log.info(report),  // what happens outside a run: ids and outcomes only
});
```

The pool also takes the `mcpClient` options that shape one connection (`resultMode`,
`clientInfo`, `retryOnThrottle`, `sdk`) and passes them to every client it opens. Three
more are proposed: `requirePrincipal`† (default `true`) and `requireTenant`† (default
`false`), both in § 4, and `maxLeaseMs`† (§ 5.2). It does not take `connection`: the pool
must build the transport, to end its session, to hear the tools-changed notice and to
place the send gate.

`transport` is one `McpTransport` shared by every client, or a function of the identity.
The function is how per-user credentials work: a provider that vends THAT user's token.
The runtime transport refuses a user-delegated bearer for exactly this reason
(`adapters/mcp/agentcoreRuntime/transport.ts` · `AgentCoreRuntimeBearerAuth`, `mode`). It
is also the preferred shape for the runtime transport: a session map of one per client,
so a client cannot even name another client's handle, and the transport's 256-entry LRU
never forgets a live one. Pass one AWS `client`, built with `maxAttempts: 1`, to all of
them. With one shared `'reuse'` transport, `maxClients + maxEnding` must stay at or below
its `MAX_CONNECTIONS` (256); past that the transport forgets live handles, which is
reported as § 5.5 says, never hidden.

### 3.2 The agent path

```ts
const agent = Agent.create({ provider, model })
  .toolProvider(orders.toolProvider())   // † a ToolProvider with id 'mcp-pool:orders'
  .build();

await agent.run({ message, identity: { tenant, principal, conversationId } });
```

On every iteration, `list(ctx)` takes the caller's identity (§ 4) and that conversation's
definitions (§ 6), and returns tools bound to the conversation's key. A bound tool's
`execute` takes a lease on the key's client for one call, opening the client first when
the key has none. Nothing is held between calls. An agent takes one `.toolProvider()`, so
several servers are several pools whose providers, `a` and `b`, are composed in one:
`list: async (ctx) => [...(await a.list(ctx)), ...(await b.list(ctx))]`.

A paused run holds nothing. Its resume finds the same client by the same key, or opens a
new one; a checkpoint carries no live handle (law 7 of `tools/toolSessions.ts`).

### 3.3 Leases by hand

```ts
const lease = await orders.acquire(identity, { signal });  // † opens or reuses the client
try {
  const tools = await lease.tools();    // this conversation's bound tools
  // …
} finally {
  lease.release();                      // idempotent; `await using lease = …` works too
}
```

`acquire` is for code that drives a sequence itself. A host that must keep a conversation's
client from eviction for a whole turn holds one around `agent.run()`; the provider then
finds the same client. This explicit, bounded lease is the only way to protect a client
between calls; there is no hidden grace period for recent use. `acquire` throws what
opening throws (`PoolFullError`, `McpPoolRefusedError`†).

### 3.4 Ending, and the app's signals

```ts
await orders.terminate({ tenant, principal, conversationId });  // † one conversation ended
await orders.terminate({ tenant, principal });                   // † every conversation of a principal
await orders.close();                                            // † shutdown
await orders.settled();                                          // † charged work has settled
orders.permissionsChanged({ tenant, principal });                // † § 6.2
orders.toolsChanged();                                           // † § 6.2: the server was redeployed
orders.sweep();                                                  // † the lazy idle sweep, now
orders.stats();                                                  // † counts only, never keys
```

The composition root calls `terminate` where it already calls
`agent.closeToolSessions({ sessionId })`. `terminate` and `close` resolve with one
`McpTerminateOutcome`† per client they ended, each saying whether the remote ending was
confirmed (§ 7).

## 4. The identity key

The key is the identity tuple through the library's one encoding:
`memory/identity/types.ts` · `identityNamespace`, each field through
`memory/identity/encode.ts` · `encodeIdentityField`. The module's README calls it "the
TENANT BOUNDARY: every storage call in the library is scoped through it". It is injective:
tenant `acme/hr` with principal `alice` and tenant `acme` with principal `hr/alice` are two
keys, and an absent field and a field named `_` are two keys.
`tools/toolSessions.ts` · `toolSessionKey` composes code-session keys from the same encoder.
A pool is one server, so the key needs no server segment, and two pools never share a
client or a definition.

**Where the identity comes from.** Two doors, and nothing else:

- **The agent path:** the identity the CALLER named in `run({ identity })`. Today
  `ToolDispatchContext.identity` is the run's internal identity
  (`core/slots/buildToolsSlot.ts` reads `runIdentity` from scope). When no caller named
  one, that falls back to `{ conversationId: sessionId }` or `{ conversationId: runId }`
  (`core/agent/callerIdentity.ts`). A derived tuple is not an authenticated identity: the
  session id is caller data. So `ToolDispatchContext` gains `callerIdentity`†, filled from
  the same run facts `ToolExecutionContext.identity` reads
  (`core/agent/stages/toolCalls.ts` · `runFactsOf`), and absent when the identity was
  derived. The pool reads only that field.
- **`acquire` and `terminate`:** the identity the app passes, which it took from its
  verified door.

The pool never takes a key from tool arguments, model output, the person's message, a
request body, or a `sessionId` alone. There is no key function to supply.

**Refused by name, before anything is opened** (`McpPoolRefusedError`†, by `reason`):

- `no-identity` — the run has no caller identity; a derived one counts as none.
- `incomplete-identity` — no `conversationId`; no `principal` while `requirePrincipal` is
  on (the default); or no `tenant` while `requireTenant` is on. Without a principal, the
  conversation id is the whole key, and anyone who can name it lands in its session.
  `requirePrincipal: false` states that the deployment has one principal, the doctrine
  `toolSessionKey` already follows ("a deployment that has no principal is thereby STATING
  it is single-principal"). `requireTenant: true` is for multitenant hosts, where an
  identity without a tenant is a bug in the door.
- `identity-mismatch` — at `execute`, the calling run's caller identity does not encode to
  the key the tool was bound for (§ 6.3).

The pool cannot tell a verified principal from a claimed one, and it takes no flag from a
caller that claims verification. Verification is established at the host boundary:
`hosting/identityVerification.ts` checks the badge before
`hosting/standingAgent.ts` · `identityForRequest` composes `{ tenant, principal,
conversationId }`.

No identity value is ever written to an error message, an event or a report. The wire
carries `keyHash`, the `tools/toolSessions.ts` · `hashSessionKey` digest of the key: enough
to join two rows, not enough to name anyone.

## 5. Clients

### 5.1 One open per key

A client is opened by `mcpClient()` itself: connect, then the MCP `initialize`. It is
opened from a **plan**: the transport the factory returns for this identity, resolved at
that moment and kept unchanged for the client's life (§ 6.1). At most one open is in flight
per key. A second caller for the same key joins it (the `starting` map of
`core/codeRunnerTool.ts` · `codeRunnerTool`). The open:

- runs under the pool's own signal and `initTimeoutMs`, never a caller's. One caller's
  cancelled run detaches that caller only; the open goes on for the others.
- holds a lease while it runs and counts toward `maxClients`.
- on timeout, is aborted, and every waiter gets `McpPoolRefusedError` (`init-timeout`) at
  once. The open stays charged to the open set until its own work settles: an abort is a
  signal, not proof that the work stopped (§ 5.3). Until it settles, the key cannot open
  again: an acquire for it meanwhile is refused at once with the same reason, so one key
  never has two opens. If, once settled, the open turns out to have opened a session, that
  client is ended under the ending rule of § 5.3: its slots are reserved first, and
  otherwise it is kept, counted and reported as deferred.
- on failure, hands the same refusal (`init-failed`, the original error kept as `cause`
  for the app and never composed into the message) to every current waiter. The failure
  is not cached: the next acquire opens again.

The default ceiling, 30 s, sits above the runtime transport's session-busy retry: up to
10 s of waiting (`SESSION_BUSY_RETRY_DEFAULTS`) plus the requests themselves.

### 5.2 Leases

A client is **busy** while any lease is open and **idle** otherwise. Two kinds of lease:

- **The library's**, for exactly one operation (an open, a `tools/list`, a `tools/call`).
  Each answers its caller in bounded time: an open by `initTimeoutMs`; a list or a call by
  the run's `ctx.signal` and by the SDK's request timeout (60 s by default). Today
  `wrapMcpTool` never passes the run's signal; a bound tool does. Each lease is one
  operation admitted against `maxOperations` (§ 5.3), and it is released only when the
  operation has settled: its logical request has its response or its error, and every
  piece of work under it (the wrapped `send()`, a credential vend, the `fetch`) has
  settled too. `send()` completing is not a protocol response: for a streamed answer it
  returns once the stream starts, and the response arrives later. A caller's timeout is
  not settlement either.
- **The app's**, through `acquire`, held until `release()`. Bounded by `maxLeaseMs`† (15
  minutes by default). Past it, the lease is revoked at the next pool interaction and
  reported. Its next use throws (`lease-expired`), and calls already in flight keep their
  own leases until they settle.

A busy client is never evicted, closed for idleness, or terminated. `terminate` and
`close` wait for in-flight work (§ 7).

### 5.3 A full pool: clients, endings and operations

The pool keeps three budgets:

- **Open** clients — opening, busy or idle — at most `maxClients`, and at most
  `maxClientsPerPrincipal` for one principal.
- **Ending** clients — from the decision to end a client until the work of ending it has
  settled — at most `maxEnding`†.
- **Operations** — every open, listing, call and ending, on any client, from its
  admission until its work has settled (§ 5.2) — at most `maxOperations`†, pool-wide.
  A later call on a client that already exists is admitted against this budget too.

A client leaves the open set only into the ending set, and only when it holds no lease.
The one exception is a lost handle (§ 5.5): there is nothing to send, so it leaves at once
and its ending is recorded unresolved.

**Ending a client reserves two slots first.** An ending is an operation (§ 5.2), so moving a
client into the ending set reserves both an ending slot (`maxEnding`) and an operation slot
(`maxOperations`) before the client leaves the open set. If either is full, the client
stays in the open set, still counted, and is reported as deferred (§ 8); the pool never
reports a cleanup as done before it has run. This one rule covers every way a client
ends: eviction to make room, the idle sweep, `terminate`, `close`, and an abandoned open
that turns out to have opened a session.

**Admission.** Every operation is admitted against `maxOperations` before anything is
sent. When that budget is full: `PoolFullError`, `limit: 'operations'`, and the open, the
listing or the `tools/call` never starts. That holds for the tenth call on one existing
client as much as for a new conversation. With `maxClients: 1` and `maxOperations: 20`,
one conversation whose calls keep timing out in a stalled credential vend has at most
twenty outstanding; the twenty-first is refused before it is sent.

**The accounting unit is the admitted logical operation.** A `tools/call`, a listing (one
`list(ctx)` for one conversation), an `acquire` and an ending each take exactly one
operation slot, at admission. Setup an operation performs for itself runs inside that slot
and is never charged again: the open of its key's client, and the revalidating
`tools/list` a call performs on a replacement client (§ 6.3). Opens and listings stay one
at a time per key; an operation that joins one waits inside its own slot. A held app lease
is not an operation: it is bounded by `maxLeaseMs` and pins a client that `maxClients`
counts, and the `acquire` that opened it was the operation. An ending is never nested
setup, because it ends a client on its own schedule, so it always takes its own slot. At
each interaction the lazy idle sweep reserves its endings before the new operation is
admitted. So a cold call, or a call that meets a replacement, needs one slot, and at
`maxOperations: 1` work still completes one operation at a time, although making room by
eviction then waits for the idle sweep. Endings and other work share `maxOperations`;
`maxEnding` caps the endings' share, and a deployment sizes `maxOperations` above
`maxEnding` so that endings alone never fill it (the defaults, 8 and 256, do). The build
pins this unit with tests at `maxOperations: 1` (§ 10).

Then, when a key with no client needs one:

1. If the principal already holds `maxClientsPerPrincipal` clients, its least recently
   used idle client moves to the ending set. If none of them is idle: `PoolFullError`†,
   `limit: 'principal'`.
2. If the pool holds `maxClients`, its least recently used idle client moves to the ending
   set. If none is idle: `PoolFullError`, `limit: 'pool'`.
3. Either move reserves an ending slot and an operation slot first. If the ending set is
   full: `PoolFullError`, `limit: 'ending'`; if the operation budget is full: `limit:
   'operations'`.

The refusal comes at once; there is no queue. "Used" means the last lease taken or
released. The idle sweep, `terminate`, `close` and an abandoned open also move clients
into the ending set only once both slots are reserved; the rest stay in the open set,
still counted and reported deferred, until slots free. So the pool holds at most `maxClients + maxEnding` client objects and
has at most `maxEnding` endings charged, past their deadline or not, however fast
conversations churn. With `maxClients: 1` and `maxEnding: 1`, a hundred short
conversations hold at most two clients and one ending; while an ending has not settled,
every arrival that needs room is refused (`limit: 'ending'`), not queued and not admitted
past the cap.

**An abort is not settlement.** Each ending answers its caller by
`TOOL_TEARDOWN_TIMEOUT_MS` (5 s): at that deadline its request is aborted and `terminate()`
resolves with `timed-out`. The slot is not freed then. It stays charged until the ending's
own work settles, because an abort only asks: `mcp/gatewayTransport.ts` ·
`createVendingFetch` awaits `getCredential` with no signal, and an app's own `fetch` may
ignore one. The same rule covers an abandoned open (§ 5.1) and calls: a client whose call
has not settled stays busy, so it can be neither evicted nor ended, even after the SDK's
own timeout has failed the call. Work that never settles keeps its charge against
`maxOperations`, and against its client or ending slot; once a budget is full, new work is
refused rather than admitted against room that does not exist. `stats().unsettled`†
reports the charged work past its deadline, by kind, and a late settlement is reported;
the report is not the limit, the budgets are. That is what makes the bound real for this
process. It does not bound the remote side (§ 7).

**No request after its deadline.** The send gate (§ 6.3) also refuses any request whose
operation was aborted or timed out. On the vending path it runs after the credential
arrives and before the request is handed on, so a credential that arrives late sends
nothing. The credential request carries the signal too (`CredentialRequest.signal`†), so a
provider that honours it settles at the abort; one that does not stays charged until it
settles.

`PoolFullError` reaches the model as the call's error, so its message is one fixed
sentence: "The connection pool for this server was full, so the tool call was not sent." Its
scope is the `tools/call`, as with `sent: false` (§ 6.3). A refused listing never reaches the
model as a tool result: it fails that iteration's tool discovery
(`agentfootprint.tools.discovery_failed`), as any failing `ToolProvider` does. The counts
(`limit`, `max`, `busy`, `ending`, `operations`) ride typed fields the app reads, never the
message.

**What the budgets bound, and what they do not.** They bound client objects
(`maxClients + maxEnding`), endings (`maxEnding`) and admitted operations
(`maxOperations`). They do not bound the bytes of a response: `src/mcp/README.md` states
that its structured-result limits apply after the transport has received the response.
Nor do they bound a caller's own allocations, waiters joined on work already admitted (a
second `terminate` for the same conversation, `settled()`, `close()`), or the process's
total memory. The build documents those limits separately, and never folds them into these
counts.

One consequence, named: when the pool is saturated, an idle client can be ended between
two calls of one turn. Its next call opens a new client, and the record says `previous:
'evicted'`. A host that must keep a turn's client holds `acquire` around the run (§ 3.3).

### 5.4 What AgentCore Runtime does with a session

From AWS's runtime-sessions, lifecycle-settings and stop-session pages:

- A session's compute (a microVM) stops after `idleRuntimeSessionTimeout` (900 s by
  default, reset by each invocation), at `maxLifetime` (28,800 s by default, counted from
  when that compute started, never reset), on `StopRuntimeSession`, or when health checks
  fail.
- The session id stays valid until the runtime is deleted. The next invocation with it
  provisions new compute, under the same lifecycle settings.
- Memory and local disk go with the compute. Configured session storage persists across
  stop and resume.
- While the platform starts or stops a session, a second operation on it gets the
  retryable "Session operation in progress" refusal that the transport already retries.

So neither timeout makes the next request fail, and neither proves the session's state is
gone. A stateless MCP server, the platform's recommended default, answers the next
request on new compute after a cold start. A stateful one, on new compute, no longer holds
the MCP session and answers as § 5.5 describes. The pool reads neither timeout as an
expiry, and never reads a cold start as continuity of state.

| | The platform | The pool |
|---|---|---|
| Idle | `idleRuntimeSessionTimeout`, 900 s by default, configurable per runtime | `idleMs`, 600 s by default |
| Lifetime | `maxLifetime`, 28,800 s by default | not tracked; no replacement on an assumed lifetime |
| What it ends | the compute; the session id stays valid | the client, through `terminate()` (§ 7) |
| What the next use sees | a cold start on new compute; a stateful server's 404 (§ 5.5) | a new client with a fresh session id; the record says `previous: 'idle'` |

The pool's default is shorter, so the common end is one the pool chose, asked for and
reported. The pool never resumes a session id it ended: a replacement client always opens
a fresh one. It cannot read a runtime's lifecycle configuration, which is a control-plane
read it has no business making; a runtime configured with a shorter timeout needs a
shorter `idleMs`, and the docs say so.

The sweep is lazy: it runs on the next acquire, list, call or release, or on
`pool.sweep()`. The pool installs no interval. That is the tier's rule
(`tools/toolSessions.ts` · `ToolSessionTier`, `sweepIdle`: "a library that installs an
interval keeps the host process alive"). A pool nobody touches leaves its idle sessions to
the platform's own timeout.

### 5.5 A server's expiry, and a lost handle

Two failures that arrive alike stay two:

| | `SessionExpiredError`† | `LocalSessionHandleLostError`† |
|---|---|---|
| Evidence | the MCP server answered HTTP 404 to a request that carried the session id it issued: the Streamable HTTP rule for a session the server ended | the runtime transport no longer holds the handle: its 256-entry LRU forgot it (`sessionStrategy`); nothing was sent |
| Today | `StreamableHTTPError`, code 404 | a 404 the transport makes itself (`sessionNotFound`), indistinguishable from the server's |
| The remote side | the MCP session is gone; the compute that answered may still run | unknown: the runtime session may still be alive, and it can no longer be stopped from here, because its id went with the handle |
| The ending | through `terminate()`, like any other (§ 7) | none possible: an unresolved ending, counted (§ 7) |
| The record | `previous: 'expired'`, `evidence: 'server-404'` | `previous: 'handle-lost'`, `evidence: 'transport-forgot-handle'`, `remote: 'unknown'` |

The transport's local answer becomes the typed error, thrown from its `fetch`. The SDK
rejects the call with that same object, so no 404 is invented for a request that never
left. This changes what a direct `mcpClient` user of a shared `'reuse'` transport past 256
clients sees, and the fragment names it.

On AgentCore Runtime the evidence comes from the adapter, which already names the error
type it hands on (`x-amzn-errortype`). A hosted server's own 404 arrives as type `Unknown`,
carrying that server's JSON-RPC error (`invoke.ts`; pinned by the test "P4 a hosted
server’s 404 reaches the MCP client as a 404 with ITS JSON-RPC error"). The platform's own
errors arrive as HTTP 200 JSON-RPC errors under the MCP contract, or under their own type
on SigV4. So a platform `ResourceNotFoundException` (a missing runtime or endpoint) is a
failure, never an expiry, and a compute restart under a stateless server is no failure at
all. Anything else is a failure too, never a silent rebuild: a 404 to `initialize` is a
wrong address, and a 5xx may be the record of work that ran.

In both columns the call fails with one fixed sentence — "The server had ended this
conversation's session before this call." for an expiry, "This conversation's session
could not be reached from here, so the call was not sent." for a lost handle — and is not
repeated: whether a call may be repeated is E3's decision, made by the app. The client
leaves the key at once, and the next use opens the next client under the SAME key: never
another key's client, never a borrowed one. Both errors keep their evidence and, as
`cause`, the original error for the app.

The pool prevents a lost handle for its own clients: a transport per client holds one
handle, and a shared transport needs `maxClients + maxEnding` at or below
`MAX_CONNECTIONS`. It can still happen when code outside the pool shares the transport.

`SessionExpiredError` lives in `tools/toolSessions.ts`, beside the rest of the
tool-session vocabulary, so E2's expired code sessions raise the same class, under the
same rule: only documented evidence of an expiry raises it.

## 6. Tool definitions

### 6.1 Per client by default; shared only in a declared, checked context

A definition is what one `tools/list` entry says: `name`, `description`, `inputSchema`,
and the declarations its `_meta` carries (read by `mcp/toolExtras.ts` · `readToolExtras`).
The executable half (`execute`, the connection) is never shared.

**The default is `'per-client'`.** A conversation's definitions are listed on its own
client, and the list belongs to that client incarnation alone: a replacement client, even
one opened from the same plan for the same conversation, is a new session whose list may
differ, so it lists again (§ 6.3). It is the one mode whose correctness the pool can check
for itself. It costs one `tools/list` per client, and a new conversation opens its client
before its first model call. Reusing a list across incarnations needs the app's sharing
contract below.

**Sharing is declared by the app, and checked by the pool.** An app that knows what a
server's tool list depends on says so:

```ts
definitions: {
  // † Asked before any client opens. Return both names, or undefined to keep this
  //   conversation's list to itself.
  share: (identity) => ({ configuration: 'orders-runtime@v7', authorization: roleOf(identity) }),
},
```

Before serving a shared list, the pool resolves the conversation's plan — it calls
`transport(identity)` and `share(identity)` — and computes the context from it, without
opening anything:

| Part of the context | Who vouches for it |
|---|---|
| `configHash`† of the transport's comparable data (§ 6.2) | the pool, from the plan the factory returns; a client opened later must match it (§ 6.3) |
| `configuration`: what the transport hides in its code — a signer's role, the credentials of an AWS client, the auth strategy inside the runtime transport's `fetch` | the app's name |
| the tenant segment | the identity key; always present |
| `authorization`: what the server's tool visibility depends on, such as a role and a policy version | the app's name |

Conversations share a list only when all four are equal. `share` returning `undefined`
means per client: the pool never shares a list whose context it could not establish
before opening.

The rules:

- **The tenant is always in the context.** The app's names widen sharing across
  principals, never across tenants, so a wrong name cannot leak one tenant's visibility to
  another.
- **The app's names are its declaration.** `share` is synchronous and reads what the app
  already holds. Its values are hashed into the context and never recorded.
- **Sharing assumes the list does not depend on the session's own state.** A server whose
  list changes within a session (it unlocks tools, or filters by something the session
  did) must stay per client. Protecting the connection does not protect this: the
  definitions are a second channel between conversations, so they get a context of their
  own.
- **A listing runs on the client of the conversation that needs it.** It never runs in
  another conversation's session, even one in the same context.

**What changed on review.** The first draft shared definitions per principal by default.
That rested on an assumption the pool could not check: that two conversations of one
principal open the same configuration with the same permissions. A factory may choose a
different URL, qualifier or credential for each conversation. The default is now per
client, and sharing needs both declared names and a matching `configHash` (adopted from
review, owner to confirm).

### 6.2 Invalidation

A list stops being served in four ways, plus a time limit. The rules apply to a shared
entry and to a client's own list alike.

1. **The configuration.** `configHash`† is SHA-256 (`lib/sha256.ts` · `sha256Hex`) over a
   canonical encoding (`lib/canonicalJson.ts` · `canonicalJson`) of the plan's comparable
   data: the pool name; the transport kind and URL (a runtime URL already carries the ARN,
   region, qualifier and account); header names and a digest of their values; a gateway's
   `service`, `scopes`, `mode` and credential provider `id`; stdio's command, args and
   working directory; `resultMode` and `clientInfo`. A function (a `fetch`, an AWS client)
   cannot be compared; the app's `configuration` name covers it. Where a library-built
   transport keeps comparable settings inside its `fetch` (the runtime transport's auth
   strategy and session mode), the build exposes them as data for the hash
   (`McpHttpTransport.settings`†), so the app's name covers only its own code. The hash is
   computed from the plan before the client opens, never after; it never leaves the
   process.
2. **The tools-changed notice.** Every pool client subscribes to
   `notifications/tools/list_changed`, through the SDK client's `listChanged.tools` option
   (installed only when the server advertises `tools.listChanged`). A notice on any client
   drops that client's bound tools and invalidates the list its definitions came from. A
   notice can only cause a new listing; it never writes a definition. A server with no
   standalone stream to carry the notice is covered by 3, 4 and the time limit: the
   runtime's SigV4 path answers a GET with 405.
3. **The app's permission signal.** `pool.permissionsChanged({ tenant, principal? })`
   invalidates every list in that scope. An `authorization` name that carries a version
   (`@policy-7`, then `@policy-8`) reaches a new entry without the call. The pool is per
   process: a fleet sends the signal to every process, or relies on the versioned name and
   the time limit.
4. **The server changed.** `pool.toolsChanged()` invalidates every list: a deploy hook. An
   unpinned runtime endpoint moves to the new version without its URL changing. Pinning
   `qualifier` turns a deploy into a configuration change instead.

**The time limit.** `definitionTtlMs`† (600 s by default). A lapsed list is listed again
at the next list. Its generation moves only if the new list differs.

**Generations.** A generation counts within one list: a shared entry's, or one client
incarnation's. Invalidation moves it; a new configuration is a new context; a replacement
client starts a list and a count of its own, so no number from an old incarnation can
match, or revive, a binding to the new one. A listing still in flight when the generation
moved is discarded, not written.

**Entries.** Each list is a frozen plain-data copy, made under the reading law of
`mcp/plainData.ts` · `copyJsonObject`, written once per context and generation, by one
listing at a time. The shared cache is bounded: at most `MAX_DEFINITION_ENTRIES`† (256)
entries, and a list longer than `MAX_SHARED_TOOLS`† (512) tools is used by its own client
and not shared. One known limit carries over: `mcp/mcpClient.ts`'s listing reads one page,
and `nextCursor` is not followed.

### 6.3 Bound tools, and the checks after every wait

A bound tool carries its **binding**: the key it was listed for; the context it was listed
in (§ 6.1; per client, the key and the `configHash`); the list it came from (per client, the
client incarnation, `clientId`; shared, the entry); and that list's generation. It has the
shape `wrapMcpTool` builds (`schema`, `source` set to the pool's name, the declarations),
and the build factors that wrapper into one function both use. Its `execute`:

1. checks that `ToolExecutionContext.identity` encodes to its key; if not,
   `identity-mismatch`, and nothing is sent;
2. checks its binding against the current context and generation; if not current,
   `stale-tools`, and nothing is sent;
3. takes a lease on its key's client, opening one when the key has none. A new client is
   opened from a plan resolved now. If that plan's context differs from the binding
   (the factory now chooses another configuration, or another credential), the tool
   refuses with `binding-changed`† and nothing is sent; the new client stays for the
   conversation's next list. If the client is not the incarnation the tool was listed
   from, the tool is revalidated. Per client, the replacement's own fresh list is taken
   (one `tools/list`, which also serves the conversation's next list), and the call goes on
   only if that list holds the same definition, compared as canonical JSON; otherwise
   `stale-tools`, and nothing is sent. Under the app's sharing contract, a replacement
   whose context matches uses the shared entry as it stands;
4. after that wait, and after every other wait, checks step 2 again. A `permissionsChanged`
   that landed during a cold open is refused here;
5. sends through the send gate below, classifies the outcome (§ 5.5), files its facts
   (§ 8), and releases the lease once the request's own work has settled (§ 5.2).

Every refusal happens before the `tools/call` is sent, and says so (`sent: false`†) for
E3's record of what that attempt did. `sent: false` describes the `tools/call` attempt
only: control requests made on the way, such as the `initialize` that opened a replacement
client or the `tools/list` that revalidated it, may already have reached the server.

**The send gate.** The SDK itself waits between `callTool` and the network: `send()` awaits
its own headers, and a gateway transport awaits the credential it vends inside `fetch`. So
the last check cannot live in the tool. The pool wraps the SDK transport it built. At
`send()`, it moves the call's binding from a library-private `_meta` marker into a map
keyed by the request's JSON-RPC `id`, and removes the marker, so the server receives
today's bytes. The gate is a synchronous check of that binding and of the operation's
abort and deadline. It joins the transport's one retry series the way `mcpClient`'s 429
rule does (`mcp/throttleRetry.ts` · `joinableRetry`) and is asked before every attempt;
it is asked last at the latest boundary the library controls, after all asynchronous
credential and signing work and before the network handoff. On the vending path that is
after the credential arrives and before the base `fetch`, or the app's own. On SigV4 it is
a step on each command's own AWS SDK middleware stack, after the request is signed and
before the request handler sends it; a step on the command, not the client, so an AWS
client the app passed is not changed. A binding that went stale, or an operation that was
aborted or timed out, is refused there, and nothing is sent. On a transport with no
series, the gate is a pass-through `fetch`. stdio has no `fetch`, and its `send()` writes
without waiting, so the check at `send()` is the last. What no gate can recall is a
request already handed on: to the network, or to the app's own `fetch` (§ 9, threat 4).

**Never another conversation's connection.** The binding is to the KEY. A replacement
client for the same key serves an old bound tool only after step 3 found the same
definition in that client's own fresh list, or, under the app's sharing contract, in the
shared entry for a matching context. A client of any other key never serves it, and a tool
handed to another conversation's run is refused at step 1.

## 7. Termination

`terminate` is a capability, not a new required member of `McpClient`. It is an optional
`terminate?()`, detected by `canTerminate(client)`†, under the feature-detection law of
`provider-contract/types.ts` · `canStageCodeInputs` ("read the member, never assume it").
`mcpClient()` and `mockMcpClient()` provide it, and a hand-written `McpClient` keeps
compiling. The pool builds its own clients, so every pool client has it.

`terminate()`:

1. issues the transport's own session termination, the SDK transport's
   `terminateSession()`: HTTP `DELETE` with `Mcp-Session-Id`;
2. reads the remote answer through a pass-through `fetch` the library installs on every
   transport it builds, which changes no request (the SDK treats 405 as success and would
   hide it);
3. closes locally, whatever happened.

```ts
interface McpTerminateOutcome {   // †
  readonly remote:
    | 'terminated'     // 2xx: the remote side ended the session it held
    | 'already-gone'   // 404: it no longer held it
    | 'no-session'     // nothing to end: no session id was ever issued ('per-call', a server that issues none, stdio)
    | 'not-offered'    // 405: the server does not end sessions on request
    | 'failed'         // the request failed
    | 'timed-out'      // the local wait ended first, and the request was aborted
    | 'handle-lost'    // this process no longer holds the handle (§ 5.5)
    | 'unavailable';   // the `connection` arm: the library did not build this transport
  readonly resolved: boolean;      // true only for 'terminated', 'already-gone' and 'no-session'
  readonly status?: number;        // the HTTP status, when one was read
  readonly errorClass?: string;    // a failure's class name, never its message
  readonly durationMs: number;
}
```

**A local cap is not a remote cap.** The caller's wait is bounded: by 5 s it has its
answer and the request is aborted, while the slot stays charged until the local work
settles (§ 5.3). The remote session is bounded by neither. After `not-offered`, `failed`,
`timed-out`, `handle-lost` or `unavailable`, the remote session may live until the
platform's own timeout (900 s idle on AgentCore by default), and nothing in this process
can shorten that. Such an ending is `resolved: false`. The pool counts it
(`stats().unresolvedEndings`†) and reports each one. No number in this design bounds
remote sessions whose ending was not confirmed.

**On AgentCore Runtime.** Under `'reuse'`, the runtime transport turns a `DELETE` for a
handle it holds into `StopRuntimeSession` for that connection's runtime session id. On
SigV4 that is `StopRuntimeSessionCommand`; on bearer it is `POST
/runtimes/{agentRuntimeArn}/stopruntimesession` with a vended token. The transport forgets
the handle first, then answers the `DELETE` with 204 (stopped), with 404
(`ResourceNotFoundException`, "session not found or already terminated"), or with the safe
failure (`adapters/mcp/agentcoreRuntime/safeAnswer.ts` · `safeAnswer`). A 409
`RetryableConflictException` while the platform starts or stops the session is retried in
the transport's series, like the session-busy refusal. A `terminated` outcome here means
the compute is stopped. By AWS's own account the session id stays valid and configured
session storage persists; the pool never resumes that id, and `terminated` does not mean
stored data was deleted. Under `'per-call'` the client never holds a session id, so the
outcome is `no-session`. The pool and `mcpClient` never learn that AgentCore exists: the
one port is the Streamable HTTP `DELETE`, as `adapters/mcp/README.md` requires
("`mcpClient` never special-cases a vendor"). `StopRuntimeSessionCommand` joins the AWS
command pin (`test/adapters/aws/awsCommandPin.ts`). The existing test that pins 405 for a
GET or a `DELETE` runs under `'per-call'`, where nothing changes; new cases pin the
`'reuse'` mapping.

**`close()`** keeps its meaning: it ends the local transport only. The doc comment on
`McpClient.close`, `src/mcp/README.md` and the runtime transport's README say so in one
sentence: "`close()` does not end the remote session; `terminate()` does, and says whether
it did."

**In the pool**, every end goes through `terminate()`, inside the ending set (§ 5.3): idle,
eviction, an abandoned open, `pool.terminate`, `close`, and an expiry, whose answering
compute may still run. The exception is a lost handle: nothing can be sent, so the ending
is recorded unresolved. The tier's laws hold: each client is ended at most once, the caller's
wait is bounded, nothing is thrown into a run, every end is reported, and "already gone" is
an outcome, not an incident. The tier's bounded-wait helper (`withTimeout`, module-private
in `tools/toolSessions.ts` today) is exported and shared, not copied. In addition:

- **`pool.terminate(scope)`** stops new leases on the matching clients at once; the next
  acquire for that key opens a new client. It waits for in-flight work, up to 5 s, then
  moves each client into the ending set once an ending slot and an operation slot are
  reserved for it (§ 5.3). A client still leased by then, or one whose slots cannot be
  reserved yet, is reported `deferred`, never as ended, and is ended when it can be.
- **`pool.close()`** refuses new work, revokes app leases, and aborts in-flight calls
  through the pool's own signal. Their leases are released as they settle. Then it ends
  every client as slots can be reserved, at most `maxEnding` at a time. It resolves after
  a bounded wait and reports the clients it could not end yet as deferred, and the work
  still unsettled by count, never as done; that work stays charged until it settles.

The pool does not register with an agent's tool-session tier (§ 1.2): it has one owner,
the composition root that built it.

## 8. The record

The record holds ids and outcomes. It never holds identity values, remote session ids or
handles, header values, tool arguments, results, definitions, or a server's error text.

**In a run**, every pool use files one event, `agentfootprint.tools.mcp_client`†. It rides
the existing `agentfootprint.tools.` prefix; the `tools.session_*` note in
`events/payloads.ts` explains why a new domain would need a new bridge and wildcard. The
event is filed by the library stage that called the pool:

- the dispatch loop, after a bound tool's `execute`, keyed by `toolCallId` (the precedent
  is `core/codeRunnerTool.ts` · `CODE_RUNS`, read through `codeRunsOf`, behind
  `agentfootprint.tools.code_run`);
- the tools slot, after `list(ctx)`, keyed by the `ctx` object it passed.

```ts
interface ToolsMcpClientPayload {   // † events/payloads.ts
  readonly server: string;              // the pool's name, which Tool.source also carries
  readonly at: 'list' | 'call';
  readonly toolCallId?: string;         // at 'call'
  readonly keyHash: string;             // hashSessionKey(key)
  readonly clientId?: string;           // the pool's own random id; absent when no client was touched
  readonly generation?: number;         // 1 = the key's first client, 2 = its first replacement, …
  readonly client:
    | 'opened' | 'joined' | 'reused' | 'not-needed' | 'refused' | 'expired' | 'handle-lost';
  readonly previous?: 'idle' | 'evicted' | 'expired' | 'handle-lost' | 'terminated';
  readonly evidence?: 'server-404' | 'transport-forgot-handle';  // with 'expired' or 'handle-lost'
  readonly refusal?:
    | 'pool-full' | 'principal-full' | 'ending-full' | 'init-timeout' | 'init-failed'
    | 'no-identity' | 'incomplete-identity' | 'identity-mismatch' | 'stale-tools'
    | 'binding-changed' | 'lease-expired' | 'operations-full' | 'closed';
  readonly initMs?: number;             // opened or joined: how long the open took
  readonly definitions?: 'shared' | 'listed';  // at 'list'
  readonly definitionsAgeMs?: number;   // when shared
  readonly revalidated?: 'kept' | 'refused';  // at 'call': met a replacement client (§ 6.3)
}
```

`client: 'not-needed'` is a list served from shared definitions, touching no client. The
call's own `stream.tool_start` and `tool_end` are unchanged.

**Outside a run**, idle ends, evictions, terminations, revoked leases, deferred ends and
work that settled after its deadline happen when no run exists. They reach `onEvent` as an
`McpPoolReport`†: `{ kind, server, clientId, keyHash, reason, remote, resolved, status?,
errorClass?, durationMs }`, where a late settlement is `kind: 'settled-late'`. The
precedent is the tier's `report` option (`tools/toolSessions.ts` ·
`ToolSessionTierOptions`). A throwing `onEvent` is swallowed and changes nothing.
`pool.stats()` returns counts, never keys: open, busy, idle, opening, ending, operations,
entries; `unsettled`, the charged work past its deadline that has not settled, by kind
(open, listing, call, ending); and `unresolvedEndings`, the endings whose remote outcome
was not confirmed. They report; the budgets of § 5.3 enforce. Local settlement and remote
resolution are different facts: an ending can settle locally and stay unresolved
remotely, and neither implies the other.

The new payloads carry no field a redaction policy selects by name. They join the
vocabulary canary (`test/redaction/agent-redaction.vocabulary.test.ts`) as payload-free.

## 9. Threat model

| # | Threat | What happens | Residual |
|---|---|---|---|
| 1 | **Cross-tenant leakage.** A client, a list, a lease or a record row crosses tenants. | Client keys are the injective encoding: the tenant is a segment, and its absence is a segment of its own. Every definitions context carries the tenant, whatever the app names. A bound tool refuses a caller whose key differs. Records carry `keyHash`; errors and reports carry no ids. A transport per client gives each client a session map of one. `requireTenant` refuses a tenantless identity on a multitenant host. | An app that omits `tenant` without `requireTenant` merges tenants whose principal ids coincide. One tenant's demand can end another tenant's idle clients: state is lost, nothing is disclosed. `keyHash` is the existing unsalted digest: a reader of the record who can guess a whole tuple can confirm the guess. |
| 2 | **A confused deputy.** The pool or a tool acts with one conversation's client for another caller, or a credential is vended for whoever is calling. | The provider keys only on the identity the caller named. Every `execute` checks the calling run's identity against its key before anything is sent, so a cached or handed-on tool cannot run under another conversation. A replacement client is checked against the tool's binding. A transport factory is called with the identity its client is for. The runtime transport already refuses a user-delegated bearer it would send for whoever calls. | On a shared machine credential (SigV4's role), every client acts with the process's authority, and the server can tell users apart only by session. Per-user authority needs per-user credentials; the pool cannot add it. |
| 3 | **A key derived from model input.** | Two doors only: `callerIdentity`, from `run({ identity })`, and the identity app code passes to `acquire` and `terminate`. There is no key function. Arguments, model output, the message, a request body and a `sessionId` alone are never read. A derived identity is refused, and so is a missing principal by default. No caller flag claims verification. | The pool cannot tell a verified principal from a claimed one; the host door verifies (`hosting/identityVerification.ts`). An app that builds `run({ identity })` from a request body has moved the problem, not solved it. |
| 4 | **Stale or poisoned definitions.** One conversation's listing changes what another conversation's model sees, or a tool listed before a revocation, a reconfiguration or a replacement is still sent. | Per client by default. Sharing needs the app's two names and a `configHash` computed from the plan before anything opens, with the tenant always in the context. Lists are written by one listing at a time, as frozen plain-data copies, with declarations judged field by field by `readToolExtras`; a listing that races an invalidation is discarded; a notice can only invalidate. Every tool re-checks its binding after each wait and at the send gate, before every attempt and last after credential and signing work. A per-client list belongs to one client incarnation: a replacement lists again, and an old tool is sent only if the fresh list holds the same definition; generations never carry across incarnations. | A server that serves a malicious list serves it to every client anyway: sharing adds no new source. Wrong names (a server whose list follows the session, declared shared) let one session's list reach the rest of its context; the docs name it, and per client is the fix. A request already handed on, to the network or to the app's own `fetch`, cannot be recalled. |
| 5 | **Pool exhaustion as a denial of service.** Many conversations, slow calls, slow endings or work that ignores its abort fill the pool, or leave work and remote sessions behind. | Open clients are capped globally and per principal; endings by `maxEnding`; and every outstanding open, listing, call and ending, on any client, by `maxOperations`, so repeated calls on one existing client are bounded too. Each stays charged until its work settles, not until its abort, so at most `maxClients + maxEnding` clients are held and at most `maxEnding` endings and `maxOperations` operations are charged, however fast conversations churn and whatever ignores an abort. Ending a client reserves an ending slot and an operation slot first; otherwise the client is kept, counted and reported deferred. Callers get their answer by the deadline; the gate sends nothing after it, and the vending path checks again after the credential arrives. There is no queue: `PoolFullError` (`pool`, `principal`, `ending` or `operations`) comes at once, before anything is sent. A failed open frees its slot once it has settled. | Work that never settles (a credential provider that never answers, a `fetch` that ignores its abort) holds its charge until it settles, or until the process, or an isolated worker running it, ends. There is no release that returns capacity sooner; once a budget is full, new work is refused. `stats().unsettled` reports it; the budgets enforce. The budgets bound client objects, endings and admitted operations; they do not bound response bytes, caller allocations, waiters joined on admitted work, or total process memory. At a very small `maxOperations`, making room by eviction waits for the idle sweep. A local cap is not a remote cap. A remote session whose ending was not confirmed (`not-offered`, `failed`, `timed-out`, `handle-lost`) lives until the platform's own timeout; the pool counts these as `unresolvedEndings` and cannot bound them. A principal can fill its own share, and many principals of one tenant can fill the pool: there is no per-tenant share. Per-caller limits belong at the door (`hosting/admission.ts` · `AdmissionPolicy`). With no negative cache, a failing server is opened again at each acquire, one open per key at a time. |
| 6 | **A leaked lease.** App code acquires and never releases, or a call never settles. | Library leases are `try`/`finally` around one operation. An app lease is revoked after `maxLeaseMs` and reported; its next use throws, and its in-flight calls keep their own leases. `release()` is idempotent, and `Symbol.asyncDispose` makes `await using` work. | A call whose request never settles keeps its client busy until it does. The SDK's request timeout (60 s by default) and the run's signal answer the caller sooner; the charge stays until settlement. |
| 7 | **Remote session ids as capabilities, and what outlives an ending.** A runtime session id, plus permission to invoke the runtime, lands a request in that session; a stopped session can be resumed. | The runtime session id and the server's `Mcp-Session-Id` stay inside the transport; the client sees a random handle (`session.ts`). Neither appears in the record, a report, an error or `stats()`. The pool never resumes a session id it ended. | A stopped AgentCore session's id stays valid until the runtime is deleted, and configured session storage persists: anyone holding the id and the permission can resume it, and its stored files outlive `terminated`. Deleting stored data is the runtime's configuration, not the pool's. |

## 10. The test plan

Every case below is a required test; the file names are proposed, under `test/mcp/pool/`
unless a path is given. A clock seam (`now`†, as `ToolSessionTierOptions` has) drives
time, and a client seam (`_open`†, like `McpClientOptions._client`) injects clients. The
`*.real.test.ts` files run the real SDK over a real socket
(`test/mcp/realTransportSupport.ts`). In every scenario below, the fake server records
which session served each request, and the test asserts that no request reached another
conversation's session.

- **`identity-key.test.ts`** — two principals never share a client; tenant `acme/hr` with
  principal `alice` and tenant `acme` with principal `hr/alice` get two clients, as do an
  absent tenant and a tenant named `_`; a derived identity is refused (`no-identity`); a
  missing principal is refused unless `requirePrincipal: false`; a missing tenant is
  refused under `requireTenant: true`; canary identity strings appear in no error, event
  or report.
- **`open-once.test.ts`** — ten concurrent first calls under one key open once (counted at
  the transport); a failed open refuses every waiter, caches nothing, and the next acquire
  opens again; an open past `initTimeoutMs` refuses every waiter at once and caches
  nothing, and until its work settles it still counts toward `maxClients` and an acquire
  for the same key is refused at once, so one key never has two opens; the next acquire
  opens again only after the prior open's work has settled; one waiter's abort detaches
  only that waiter.
- **`capacity.test.ts`** — a leased client is never evicted, idle-closed or terminated,
  even when it is the oldest; a full pool moves its least recently used idle client to the
  ending set, and that key's next open says `previous: 'evicted'`; all busy gives
  `PoolFullError` at once, with typed fields and the fixed sentence; the per-principal cap
  ends the principal's own idle client first; an app lease past `maxLeaseMs` is revoked
  while its in-flight call completes; `release()` twice is one release; `await using`
  releases; `terminate` on a leased client reports `deferred` and ends it at the last
  release.
- **`churn.test.ts`** — `maxClients: 1`, `maxEnding: 1`, and 100 short conversations whose
  terminations are fast, slow (past the local wait), failing (500 and 403), 405, stalled
  in a credential provider that never answers until released, and sent through an app
  `fetch` that ignores its abort. At every pool transition: at most two clients held and
  at most one ending charged, settled or not. While the hung provider or the
  abort-ignoring `fetch` holds its ending, every arrival that needs room gets
  `PoolFullError` (`limit: 'ending'`), counted, and `stats().unsettled` shows the charge;
  `terminate()` still answers its caller with `timed-out` at the deadline. When the
  provider is released after the deadline, the post-credential check sends nothing: the
  fake network sees no request after any timeout. The slot frees only at settlement, and a
  late settlement is reported. `unresolvedEndings` equals the number of slow, failing,
  405 and stalled endings exactly; resolved ones are not counted.
- **`operations.test.ts`** — repeated same-key timeouts: `maxClients: 1`,
  `maxOperations: 20`. Call A stalls in a credential vend and its caller times out; calls
  B, C, and on, on the same existing client, stall and time out the same way. Twenty are
  admitted; the twenty-first call, and a listing after it, get `PoolFullError` (`limit:
  'operations'`) before anything is sent, and the fake network sees no request for them.
  `stats()` shows twenty operations, all unsettled, with `open: 1` and `ending: 0`. When
  A's credential is released after its deadline, A sends nothing and settles, and exactly
  one new call is admitted. A streamed answer whose `send()` has returned keeps its
  operation charged until the response itself has arrived. The accounting unit, at
  `maxOperations: 1` and `maxEnding: 1`: a cold listing (open, list), a cold call (open,
  call) and a call that meets a replacement (open, revalidating list, call) each complete
  in one slot; a joiner waits inside its own slot; an idle client due for ending is ended
  before the next admission, and a conversation refused while the only slot was held
  succeeds once that ending settles. Ending admission: with the operation budget full, an
  eviction, an idle end, `terminate`, `close` and an abandoned open that opened a session
  each leave the client in the open set, counted and reported deferred, never as ended;
  once slots free, the client moves and ends.
- **`binding.test.ts`** — (a) two conversations of one principal, with `share` returning
  the same names, whose factory chooses another `qualifier` for the second: the hashes
  differ, the second lists on its own client and never sees the first's list; (b)
  `permissionsChanged` during a cold open: the revoked tool is refused after the open, and
  the fake server receives no `tools/call`; (c) the same during a credential vend, and
  during a session-busy wait: refused at the send gate, nothing sent; (d) a replacement
  client whose plan changed (another credential provider id, other scopes, another URL):
  the old bound tool refuses with `binding-changed` before sending, and the next list binds
  the new client; (e) a same-key, same-plan replacement, per client: the old session
  listed `status` and `unlocked_tool`, the fresh session lists only `status`; after the
  old client is evicted, the old binding's `unlocked_tool` is refused with `stale-tools`
  and never sent, while `status` is revalidated against the fresh list and sent; the old
  incarnation's generation numbers never match the new list's, even when they coincide.
- **`definitions.test.ts`** — per client by default: two conversations of one principal
  list twice; `share` with equal names and plans lists once; different names list twice;
  equal names in two tenants never share; a tools-changed notice invalidates and the next
  list lists again; `permissionsChanged` invalidates, and a bound tool from before refuses
  with `stale-tools`, not sent; a listing in flight during an invalidation is discarded;
  mutating a returned definition does not reach another conversation; a lapsed time limit
  over an unchanged list keeps the generation.
- **`expiry.test.ts`** — (a) a lost handle: a shared `'reuse'` transport past 256 handles
  gives the oldest client `LocalSessionHandleLostError`, not `SessionExpiredError`; the
  fake platform received no stop; one unresolved ending is counted, and the next open says
  `previous: 'handle-lost'`; (b) a failed stop: `StopRuntimeSession` answering 403 or 500
  gives `failed`, counted unresolved, with its class and never its message; (c) a real MCP
  session 404, from a real SDK server that ended a stateful session, gives
  `SessionExpiredError` with its evidence, then `terminate()`, then a new client under the
  same key; (d) an AgentCore compute restart: the fake platform stops the compute behind a
  runtime session id; with a stateless hosted server the next call succeeds and no expiry
  is claimed; with a stateful one, its 404 gives `SessionExpiredError`; (e) a platform
  `ResourceNotFoundException`, a 404 to `initialize`, a 500 and a network failure are not
  expiry.
- **`test/mcp/terminate.real.test.ts`** — against a real Streamable HTTP server: 204 gives
  `terminated`; 405 gives `not-offered`, although the SDK reports success; 404 gives
  `already-gone`; 500 gives `failed`; a server that issues no session id gives
  `no-session`; the `connection` arm gives `unavailable`; `close()` sends no `DELETE`,
  pinned so that an SDK that changes it is noticed; `canTerminate` is true for
  `mcpClient()` and `mockMcpClient()` and false for a hand-written client without it.
- **`test/mcp/agentcoreRuntime.test.ts`** gains cases: under `'reuse'`, a `DELETE` becomes
  `StopRuntimeSession` with that connection's runtime session id, on the SigV4 double and
  the bearer HTTPS path, and the handle is forgotten first; `ResourceNotFoundException`
  gives `already-gone`; `AccessDeniedException` gives `failed`; a 409 is retried in the
  series; under `'per-call'` the outcome is `no-session`; a GET is still 405; a forgotten
  handle throws `LocalSessionHandleLostError` and sends nothing; on SigV4 the gate step runs
  after signing and before the request handler, refusing a request whose binding went stale
  or whose deadline passed during signing, and an AWS client the app passed keeps its own
  middleware stack unchanged. The AWS pin gains `StopRuntimeSessionCommand`.
- **`record.test.ts`** — `tools.mcp_client` on list and call, with the fields of § 8 and
  nothing else; canary identities, session ids, headers, arguments and results appear in
  no event, report or `stats()`.
- **Properties (fast-check).** For random identity tuples (with `/`, `%`, `_` and empty
  strings), distinct tuples never share a client. For random interleavings of acquire,
  release, call, evict, sweep, terminate and invalidation: a busy client is never ended;
  held clients never exceed `maxClients + maxEnding`; running endings never exceed
  `maxEnding`; outstanding operations never exceed `maxOperations`, including calls on an
  existing client; no charge is released before its work settles; no request is handed on
  after its deadline; no `tools/call` is sent under a binding that was stale when it was
  sent; and every lease is released exactly once.

**The rest.** Byte identity: an agent without a pool emits the same events, the existing
MCP suites under `test/mcp/` are unchanged apart from the named transport changes, and
`callerIdentity` is additive. The event joins `events/registry.ts` and its pinned count
(`test/events/unit/registry.test.ts`). Each refusal sentence is registered in
`test/modelFacingSurfaces.test.ts` and found by `test/modelFacingScan.test.ts`.
`check:layering` passes for the new folder. An example,
`examples/features/<next>-mcp-client-pool.ts`†, runs on the mock: two principals with two
conversations each, per-client lists and one declared share, a full pool, an ending
budget, and the termination outcomes.

## 11. Not in this design

- A pool shared across processes, or invalidation across a fleet. Keeping a conversation on
  one process is the deployment's job.
- Repeating a call after an expiry, a lost handle or a refusal. That is E3.
- Resources and prompts. Only tools are pooled.
- Following `nextCursor` in `tools/list`.
- Reattaching a remote session by id after a restart, or resuming a session id the pool
  ended.
- An asynchronous `share`.
- A per-tenant share of the pool.
- Opening a client in the background when a list is served from shared definitions.
- Replacing a client before an assumed lifetime ends.
- Digests of remote session ids on the record.
- Tools-changed handling for a standalone `mcpClient`: a separate follow-up.
- Any change to what `close()` does.
- Any release that returns capacity before the work under it has settled (§ 12).

## 12. Answers to the open questions

The first draft asked ten questions. Codex's review proposed an answer to each. They are
adopted here as the design's proposed answers, **adopted from review, owner to confirm**:

1. **The default definitions mode** is `'per-client'`, with no sharing until the app
   explicitly declares a stable, equivalent configuration and authorization (§ 6.1).
2. **No background open** in v1.
3. **No hidden grace period** for a recently used client. A host that must keep a client
   holds the explicit, bounded app lease (§ 3.3).
4. **Tenant validation** is optional (`requireTenant`) for multitenant hosts. Verified
   identity is established at the host boundary, never by a caller-controlled boolean.
5. **Expiry** is raised only on documented protocol or adapter evidence; a local handle
   loss stays distinct (§ 5.5).
6. **No silent proactive replacement** on an assumed lifetime.
7. **No remote-session digests** on the record at first.
8. **`terminate` is an explicit, feature-detected capability** (`canTerminate`), not a new
   required member of `McpClient` (§ 7).
9. **Tools-changed handling for a standalone `mcpClient`** is a separate follow-up.
10. **The numeric defaults are provisional**: 64 clients, 8 per principal, 8 endings, 256
    outstanding operations, a 30 s open, a 5 s deadline for an ending's answer, 600 s
    idle, a 15-minute app lease, a 600 s definitions limit, 256 entries and 512 shared
    tools. The ending and operation budgets, charged until settlement (§ 5.3), are in place
    before any claim of bounded local resource use, and that claim covers client objects,
    endings and admitted operations only.

The second review answered the two questions this draft left open. Its proposals are
adopted the same way, **proposed, owner to confirm**:

11. **The transport's own LRU.** No silent, unbounded background `StopRuntimeSession` in
    the runtime transport's 256-entry LRU. Ending a forgotten session becomes an explicit,
    bounded lifecycle change with observable outcomes: when its cleanup budget is full, the
    transport keeps the handle, or refuses the new session, rather than lose a live handle.
    Until that change lands, a local loss stays `LocalSessionHandleLostError`, with the
    remote outcome unknown (§ 5.5).
12. **The last authorization check** runs at the latest boundary the library controls,
    after all asynchronous credential and signing work and before the network handoff: on
    SigV4, a step on each command's own AWS SDK middleware stack after signing (§ 6.3). The
    window after the handoff stays named: a request already sent cannot be recalled.

The third review decided the question this draft still left open, **decided by review,
owner to confirm**:

13. **No `release(id, reason)` in v1.** Recording a reason makes a bypass visible; it does
    not make the resource bound true, and a released charge whose work is still running is
    the unbounded backlog the budgets exist to prevent. Capacity returns only after proven
    local settlement, or after the isolated worker or process running the work is
    terminated. A future administrative detach may move an operation into a quarantined
    set, but only if that set sits inside a separate hard total budget that eventually
    refuses admission. Local and remote outcomes stay distinct throughout.

## 13. Decisions

1. One pool per MCP server, `mcpClientPool()`. The agent path is `pool.toolProvider()`; the
   hand path is `acquire`, `lease.tools()`, `release()`.
2. The key is `identityNamespace` of the identity the caller named, through
   `ToolDispatchContext.callerIdentity` or the app's own call. The principal is required by
   default, the tenant on request. Nothing else is read, and no caller flag claims
   verification.
3. One open per key, from a plan resolved at that moment, under the pool's own signal and
   `initTimeoutMs`. A failure reaches every waiter and is not cached.
4. A lease covers one operation (the library's) or a bounded hold (the app's). A busy client
   is never evicted, closed for idleness, or terminated.
5. Three budgets: open clients (`maxClients`, per principal), endings (`maxEnding`), and
   outstanding operations (`maxOperations`: every open, listing, call and ending, on any
   client). Every operation is admitted against the operation budget before anything is
   sent, and making room for a new client needs an idle client and a free ending slot.
   Otherwise `PoolFullError` comes at once, naming the budget. There is no queue. Ending a
   client reserves an ending slot and an operation slot before it leaves the open set;
   otherwise it is kept, counted and reported deferred, never as ended.
6. An abort is not settlement. Every operation stays charged until its logical request and
   all work under it have settled; its caller gets the answer by the deadline. Work that
   never settles keeps its charge, and there is no release in v1. The gate sends nothing
   after a deadline, and the vending path checks again after the credential arrives. The
   accounting unit is the admitted logical operation: its own setup runs inside its slot,
   and an ending always takes its own. The budgets bound client objects, endings and
   admitted operations, not response bytes, caller allocations, joined waiters or process
   memory.
7. Definitions are per client by default, and a per-client list belongs to one client
   incarnation. Sharing needs the app's `configuration` and `authorization` names and a
   `configHash` computed from the plan before anything opens; the tenant is always in the
   context.
8. Invalidation: the configuration is part of the context; the tools-changed notice,
   `permissionsChanged`, `toolsChanged` and a time limit move the generation. A generation
   counts within one list and never carries across incarnations.
9. Every tool carries its binding (key, context, list, generation). It re-checks after every
   wait and at the send gate, before every attempt and last after credential and signing
   work. A replacement client serves an old tool only after its own fresh list holds the
   same definition, or under the app's sharing contract. A tool never runs on another key's
   client.
10. `terminate` is a feature-detected capability. It issues the transport's termination and
    reports the remote answer, with `resolved` saying whether the ending was confirmed.
    Under `'reuse'`, the AgentCore Runtime transport maps it to `StopRuntimeSession`.
    `close()` stays local, and the docs say so.
11. A local cap is not a remote cap: endings whose remote outcome was not confirmed are
    counted and reported, never claimed bounded. Local settlement and remote resolution
    are reported apart.
12. Idle expiry is 600 s by default, below the platform's 900 s, and lazy. The pool does not
    track lifetime, never replaces a client on an assumed lifetime, and never resumes a
    session id it ended.
13. `SessionExpiredError` is raised only on documented evidence: an MCP server's 404 for the
    session id it issued. A handle this process lost is `LocalSessionHandleLostError`, with
    the remote outcome unknown and the ending unresolved. Neither call is repeated, and the
    next client opens under the same key.
14. The pool owns its lifecycle. It does not ride an agent's tool-session tier; it keeps the
    tier's laws.
15. The record is `agentfootprint.tools.mcp_client` for each list and call, and `onEvent`
    outside a run: ids, digests, evidence, outcomes and durations only.
