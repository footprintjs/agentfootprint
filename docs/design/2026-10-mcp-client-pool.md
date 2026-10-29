# A per-conversation MCP client pool

**Design for review. Not approved to implement.** Nothing in this page is built.
Approval to review it is not approval to implement it. Written 2026-10-28 from the
revised E4 requirement. Its seven decisions are taken as given; this page designs the
details. The build follows in its own PR, after the owner's and Codex's review.

Code is cited as `file` · `symbol`, under `src/`. A name marked † does not exist yet: it
is this page's proposal, and the build may rename it. Facts about the MCP SDK were read
from the installed `@modelcontextprotocol/sdk` 1.32.1; facts about AgentCore from
`@aws-sdk/client-bedrock-agentcore` and `@aws-sdk/client-bedrock-agentcore-control`
3.1159.0.

## For the owner

1. **The problem.** `agentCoreRuntimeMcpTransport` reaches an MCP server deployed to
   AgentCore Runtime. Its default session strategy, `'per-call'`, gives every request a
   runtime session of its own. That is safe to share between users, but every call pays
   the session's start-up (about 2.5 s, up to about 3.4 s, by the transport's own notes).
   `'reuse'` keeps one runtime session per `mcpClient`, and the docs say to build a client
   per conversation and never share one between users. Nothing builds, finds, bounds or
   ends those clients. And `close()` ends only the local side: the remote session lives on
   until the platform's idle timeout.
2. **What this page proposes.**
   - `mcpClientPool()`†, one per MCP server: one client per authenticated conversation,
     keyed by the library's identity encoding. An agent gets its conversation's tools from
     `pool.toolProvider()`†.
   - One initialize per key at a time, with a timeout. A failure is not cached.
   - A client in use holds a lease and is never evicted or closed. A full pool evicts the
     least recently used idle client, or refuses at once with `PoolFullError`†.
   - Tool definitions are shared only inside a proven-equivalent authorization context: by
     default one principal, on one server, under one configuration. They are dropped when
     the configuration, the server's tool list or the app's permissions change. Executable
     tools are always bound to their own conversation's client.
   - `terminate()`† ends the remote session through the transport and says what the remote
     side answered. On AgentCore Runtime that is `StopRuntimeSession`. `close()` stays
     local, and the docs say so.
   - A server-side expiry is `SessionExpiredError`†. The next call opens a new client under
     the same key, never under another.
3. **What it does not do.** It repeats no call (E3 owns repeats), shares nothing across
   processes, and cannot make a server enforce per-user permissions.

## 1. Why

### 1.1 The gap

`mcp/mcpClient.ts` · `mcpClient` opens one connection. `tools()` lists the server's tools
once and wraps each in an `execute` that closes over that connection
(`mcp/mcpClient.ts` · `wrapMcpTool`); the list is cached until `refresh()`.

Under `'reuse'` (`adapters/mcp/agentcoreRuntime/session.ts` · `sessionStrategy`), a
client's `initialize` opens a runtime session with a fresh id. The transport hands the
client a random handle in place of the server's `Mcp-Session-Id`, remembers at most
`MAX_CONNECTIONS` (256) connections, and forgets a handle on a `DELETE`. No library code
sends one. `mcpClient.close()` calls the SDK's `close()`, and in SDK 1.32.1
`StreamableHTTPClientTransport.close` only aborts in-flight requests; `terminateSession()`
is the one method that sends `DELETE`. On the SigV4 path a `DELETE` would be answered 405
locally anyway (`adapters/mcp/agentcoreRuntime/invoke.ts` · `invokeFetch`). So the runtime
session lives until the platform's idle timeout, 900 s by default
(`LifecycleConfiguration.idleRuntimeSessionTimeout`). The comment in `session.ts` that
calls a client's `DELETE` "its `close()`" is corrected by the build.

An app that wants warm sessions therefore has to do seven things itself: key one client
per conversation without crossing users; open each once when two calls race; bound how
many are open; never close one in use; end remote sessions; notice when the platform ended
one; and decide whether conversations may share a tool list. Each is easy to get wrong.

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
| One connection; one list, cached until `refresh()`; a local `close()` | `mcp/mcpClient.ts` · `mcpClient`; `mcp/types.ts` · `McpClient` | The pool's clients are ordinary `mcpClient`s. `McpClient` gains `terminate()`† (§ 7). |
| Each listed tool wrapped with an `execute` that closes over the connection; provenance in `source`; declarations read from `_meta` | `mcp/mcpClient.ts` · `wrapMcpTool`; `mcp/toolExtras.ts` · `readToolExtras` | One wrapper for both; a pool-bound tool closes over its key, not a connection (§ 6.3). |
| `'per-call'` and `'reuse'`; a random handle per client; 256 connections remembered, least recently used forgotten; a `DELETE` forgets a handle; GET and `DELETE` answered 405 on SigV4 | `adapters/mcp/agentcoreRuntime/session.ts` · `sessionStrategy`, `MAX_CONNECTIONS`; `adapters/mcp/agentcoreRuntime/invoke.ts` · `invokeFetch` | Under `'reuse'`, a `DELETE` becomes `StopRuntimeSession` (§ 7). |
| The SDK's `close()` aborts and fires `onclose`; `terminateSession()` sends `DELETE` and treats 405 as success; a request times out after 60 s by default (`DEFAULT_REQUEST_TIMEOUT_MSEC`); a `listChanged` handler is installed only when the server advertises `tools.listChanged` | `@modelcontextprotocol/sdk` 1.32.1 | `terminate()` sends the `DELETE` and reads the status itself (§ 7); leases are bounded by the timeout (§ 5.2); pool clients subscribe (§ 6.2). |
| `StopRuntimeSessionCommand`: `POST /runtimes/{agentRuntimeArn}/stopruntimesession`, the runtime session id in its header; `LifecycleConfiguration`: idle timeout 900 s and lifetime 28,800 s by default | `@aws-sdk/client-bedrock-agentcore`, `-control` 3.1159.0 | Termination (§ 7) and the idle default (§ 5.4). |
| The identity tuple and its injective encoding, "the TENANT BOUNDARY" | `memory/identity/types.ts` · `MemoryIdentity`, `identityNamespace`; `memory/identity/encode.ts` · `encodeIdentityField` | The client key (§ 4). |
| Session keys from the same encoder; a short digest for the wire (SHA-256, 12 hex characters, where `node:crypto` resolves); the teardown tier and its seven laws | `tools/toolSessions.ts` · `toolSessionKey`, `hashSessionKey`, `ToolSessionTier`, `TOOL_TEARDOWN_TIMEOUT_MS` | `keyHash` on the record (§ 8); the laws for ending a client (§ 7). |
| The provider seam, asked every iteration; its `ctx.identity` is the run's identity, derived when no caller named one | `tools/toolProvider.ts` · `ToolProvider`, `ToolDispatchContext`; `core/slots/buildToolsSlot.ts` | `ToolDispatchContext` gains `callerIdentity`† (§ 4). |
| A tool's `ctx.identity` is the identity the caller named, absent otherwise | `tools/tools.ts` · `ToolExecutionContext`; `core/agent/callerIdentity.ts` | The check every bound tool makes before it sends (§ 6.3). |
| One session per key, opened once when calls race; facts taken by the dispatch loop after `execute` | `core/codeRunnerTool.ts` · `codeRunnerTool`, `CODE_RUNS`, `codeRunsOf` | The pattern for one initialize (§ 5.1) and for the record (§ 8). |
| Verify the caller, then compose `{ tenant, principal, conversationId }` | `hosting/identityVerification.ts`; `hosting/standingAgent.ts` · `identityForRequest` | Where the key's principal must come from (§ 4). |
| Per-caller limits before a run | `hosting/admission.ts` · `AdmissionPolicy` | The layer above the pool's own caps (§ 9). |

## 3. The API

### 3.1 Construction

```ts
import { agentCoreRuntimeMcpTransport, mcpClientPool } from 'agentfootprint/providers';

const orders = mcpClientPool({        // † one pool per MCP server
  name: 'orders',                      // the server's name: Tool.source, and the record
  // A transport per client (preferred): each client gets a session map of its own.
  // Called once for each new client, with the identity that client is for.
  transport: () =>
    agentCoreRuntimeMcpTransport({ agentRuntimeArn, region, session: 'reuse', client: aws }),
  maxClients: 64,                // live clients, busy or idle
  maxClientsPerPrincipal: 8,     // one principal cannot take the pool
  initTimeoutMs: 30_000,         // one initialize per key, under this ceiling
  idleMs: 600_000,               // end a client idle this long (the platform's default is 900 s)
  definitions: 'per-principal',  // | 'per-client' | { authorizationContext: (identity) => string | undefined }
  onEvent: (report) => log.info(report),  // what happens outside a run: ids and outcomes only
});
```

The pool also takes the `mcpClient` options that shape one connection (`resultMode`,
`clientInfo`, `retryOnThrottle`, `sdk`) and passes them to every client it opens. Three
more are proposed: `requirePrincipal`† (default `true`, § 4), `configVersion`† (§ 6.2) and
`maxLeaseMs`† (§ 5.2). It does not take `connection`: the pool must build the transport,
both to end its session and to hear the tools-changed notice.

`transport` is one `McpTransport` shared by every client, or a function of the identity.
The function is how per-user credentials work: a provider that vends THAT user's token.
The runtime transport refuses a user-delegated bearer for exactly this reason
(`adapters/mcp/agentcoreRuntime/transport.ts` · `AgentCoreRuntimeBearerAuth`, `mode`). It
is also the preferred shape for the runtime transport: a session map of one per client,
so a client cannot even name another client's handle. Pass one AWS `client`, built with
`maxAttempts: 1`, to all of them. With one shared `'reuse'` transport, `maxClients` must
stay at or below its `MAX_CONNECTIONS` (256), or the transport forgets live handles.

### 3.2 The agent path

```ts
const agent = Agent.create({ provider, model })
  .toolProvider(orders.toolProvider())   // † a ToolProvider with id 'mcp-pool:orders'
  .build();

await agent.run({ message, identity: { tenant, principal, conversationId } });
```

On every iteration, `list(ctx)` takes the caller's identity (§ 4) and that conversation's
definitions (§ 6), and returns tools bound to the conversation's client. A bound tool's
`execute` takes a lease on that client for one call, opening the client first when the key
has none. Nothing is held between calls. An agent takes one `.toolProvider()`, so several
servers are several pools whose providers, `a` and `b`, are composed in one:
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
finds the same client. `acquire` throws what opening throws (`PoolFullError`,
`McpPoolRefusedError`†).

### 3.4 Ending, and the app's signals

```ts
await orders.terminate({ tenant, principal, conversationId });  // † one conversation ended
await orders.terminate({ tenant, principal });                   // † every conversation of a principal
await orders.close();                                            // † shutdown
await orders.settled();                                          // † background ends have finished
orders.permissionsChanged({ tenant, principal });                // † § 6.2
orders.toolsChanged();                                           // † § 6.2: the server was redeployed
orders.sweep();                                                  // † the lazy idle sweep, now
orders.stats();                                                  // † counts only, never keys
```

The composition root calls `terminate` where it already calls
`agent.closeToolSessions({ sessionId })`. `terminate` and `close` resolve with one
`McpTerminateOutcome`† per client they ended (§ 7).

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
- `incomplete-identity` — no `conversationId`; or no `principal` while `requirePrincipal`
  is on, which is the default. Without a principal, the conversation id is the whole key,
  and anyone who can name it lands in its session. `requirePrincipal: false` states that
  the deployment has one principal, the doctrine `toolSessionKey` already follows ("a
  deployment that has no principal is thereby STATING it is single-principal").
- `identity-mismatch` — at `execute`, the calling run's caller identity does not encode to
  the key the tool was bound for (§ 6.3).

The pool cannot tell a verified principal from a claimed one. The door must verify:
`hosting/identityVerification.ts` checks the badge before
`hosting/standingAgent.ts` · `identityForRequest` composes `{ tenant, principal,
conversationId }`.

No identity value is ever written to an error message, an event or a report. The wire
carries `keyHash`, the `tools/toolSessions.ts` · `hashSessionKey` digest of the key: enough
to join two rows, not enough to name anyone.

## 5. Clients

### 5.1 One initialize per key

A client is opened by `mcpClient()` itself: connect, then the MCP `initialize`. At most one
open is in flight per key. A second caller for the same key joins it (the `starting` map
of `core/codeRunnerTool.ts` · `codeRunnerTool`). The open:

- runs under the pool's own signal and `initTimeoutMs`, never a caller's. One caller's
  cancelled run detaches that caller only; the open goes on for the others.
- holds a lease while it runs and counts toward `maxClients`.
- on timeout, is aborted. Every waiter gets `McpPoolRefusedError` (`init-timeout`) and the
  slot is freed. If the transport issued a session before the timeout, that session is
  terminated in the background and reported.
- on failure, hands the same refusal (`init-failed`, the original error kept as `cause`
  for the app and never composed into the message) to every current waiter. The failure
  is not cached: the next acquire opens again.

The default ceiling, 30 s, sits above the runtime transport's session-busy retry: up to
10 s of waiting (`SESSION_BUSY_RETRY_DEFAULTS`) plus the requests themselves.

### 5.2 Leases

A client is **busy** while any lease is open and **idle** otherwise. Two kinds of lease:

- **The library's**, for exactly one operation (an open, a `tools/list`, a `tools/call`),
  taken and released in `finally`. Each is bounded: an open by `initTimeoutMs`; a list or
  a call by the run's `ctx.signal` and by the SDK's request timeout (60 s by default).
  Today `wrapMcpTool` never passes the run's signal; a bound tool does, so a cancelled run
  releases its lease.
- **The app's**, through `acquire`, held until `release()`. Bounded by `maxLeaseMs`† (15
  minutes by default). Past it, the lease is revoked at the next pool interaction and
  reported. Its next use throws (`lease-expired`), and calls already in flight keep their
  own leases until they settle.

A busy client is never evicted, closed for idleness, or terminated. `terminate` and
`close` wait for in-flight work (§ 7).

### 5.3 A full pool

When a key with no client needs one:

1. If the principal already holds `maxClientsPerPrincipal` clients, its least recently
   used idle client is evicted. If none of them is idle: `PoolFullError`†, `limit:
   'principal'`.
2. If the pool holds `maxClients`, its least recently used idle client is evicted. If none
   is idle: `PoolFullError`, `limit: 'pool'`.

The refusal comes at once; there is no queue. "Used" means the last lease taken or
released. An evicted client leaves the count at once, and its termination runs detached,
bounded and reported (joinable with `pool.settled()`†). Remote sessions can therefore
exceed `maxClients` for at most the 5 s a termination may take. A client still draining
after `terminate` is busy, and counts until it ends.

`PoolFullError` reaches the model as the call's error, so its message is one fixed
sentence: "The connection pool for this server was full, so nothing was sent." The
counts (`limit`, `max`, `busy`) ride typed fields the app reads, never the message.

One consequence, named: when the pool is saturated, an idle client can be evicted between
two calls of one turn. Its next call opens a new client, and the record says `previous:
'evicted'`. A host that must keep a turn's client holds `acquire` around the run (§ 3.3).

### 5.4 Idle expiry, and the server's own

| | The platform | The pool |
|---|---|---|
| Idle | `idleRuntimeSessionTimeout`, 900 s by default, configurable per runtime | `idleMs`, 600 s by default |
| Lifetime | `maxLifetime`, 28,800 s by default, in use or not | not tracked |
| How it ends | server-side, unannounced | `terminate()` (on the runtime, `StopRuntimeSession`), reported |
| What the next use sees | a failed call (§ 5.5) | a new client; the record says `previous: 'idle'` |

The pool's default is shorter, so the common end is one the pool chose, ended explicitly
and reported, not one discovered on a failed call. The pool cannot read a runtime's
lifecycle configuration; that is a control-plane read it has no business making. A runtime
configured with a shorter timeout needs a shorter `idleMs`, and the docs say so.

The sweep is lazy: it runs on the next acquire, list, call or release, or on
`pool.sweep()`. The pool installs no interval. That is the tier's rule
(`tools/toolSessions.ts` · `ToolSessionTier`, `sweepIdle`: "a library that installs an
interval keeps the host process alive"). A pool nobody touches leaves its idle sessions to
the platform's own timeout.

### 5.5 A server-side expiry

`SessionExpiredError`† is raised when, and only when:

- the server answers HTTP 404 to a request that carried `Mcp-Session-Id`. That is the
  Streamable HTTP rule: the client must start a new session. The SDK throws
  `StreamableHTTPError` with code 404 and does not reinitialize by itself.
- or the runtime transport answers its own 404 "Session not found" for a handle it no
  longer holds (`adapters/mcp/agentcoreRuntime/session.ts` · `sessionNotFound`). That
  request was never sent.

Anything else is a failure, never a silent rebuild. A 404 to `initialize` is a wrong
address, and a 5xx may be the record of work that ran.

The call fails with `SessionExpiredError`, whose message is one fixed sentence: "The
server had ended this conversation's session before this call." The call is not repeated:
whether a call may be repeated is E3's decision, made by the app. The client is closed
locally and leaves the key at once. The next use opens the next client under the SAME key,
never another key's client and never a borrowed one, and the record says `previous:
'expired'`. Whatever the server held for the old session is gone; the record is where a
reader learns that.

The class lives in `tools/toolSessions.ts`, beside the rest of the tool-session
vocabulary, so E2's expired code sessions raise the same `SessionExpiredError`.

## 6. Shared tool definitions

### 6.1 The authorization-equivalence key

A definition is what one `tools/list` entry says: `name`, `description`, `inputSchema`,
and the declarations its `_meta` carries (read by `mcp/toolExtras.ts` · `readToolExtras`).
The executable half (`execute`, the connection) is never shared.

An entry's key is `configHash`† (§ 6.2), then the tenant segment, then a context segment:

| `definitions` | The context segment | Shared between |
|---|---|---|
| `'per-principal'` (default) | the principal | one principal's conversations |
| `'per-client'` | the client's whole key | nothing |
| `{ authorizationContext }` | the string the app returns; per principal when it returns `undefined` | principals of one tenant that the app names as equivalent |

The rules:

- **The tenant is always in the key.** An app's key widens sharing across principals,
  never across tenants, so a wrong app key cannot leak one tenant's visibility to
  another.
- **The app's key is the proof.** `authorizationContext(identity)` names what the server's
  tool visibility depends on, such as `analyst@policy-7`, and the pool shares only between
  identical names. It is synchronous and reads what the app already holds. Its value is
  hashed into the key and never recorded.
- **Per principal assumes the list does not depend on the session's own state.** A server
  commonly decides its list by who is calling. A server whose list changes within a
  session (it unlocks tools, or filters by something the session did) must run
  `'per-client'`. Protecting the connection does not protect this. The definitions are a
  second channel between conversations, so they get a key of their own.
- **A listing runs on the client of the conversation that needs it.** It never runs in
  another conversation's session, even one in the same authorization context.

**The proposal weighed.** "The app supplies an authorization-context key; without one,
the default is per principal with no sharing [across principals]." Adopted, with the
tenant pinned into every key and `'per-client'` added for servers whose list follows the
session. Per client as the default was weighed: it costs one `tools/list` per
conversation, and a new conversation must open its client before its first model call. Per
principal lets a returning principal's new conversation answer without opening a session
until it calls a tool. Open question 1 asks the owner to confirm the default.

### 6.2 Invalidation

An entry stops being served in four ways, plus a time limit.

1. **The configuration.** `configHash`† is SHA-256 (`lib/sha256.ts` · `sha256Hex`) over a
   canonical encoding (`lib/canonicalJson.ts` · `canonicalJson`) of the connection's
   declared data: the pool name; the transport kind and URL (a runtime URL already carries
   the ARN, region, qualifier and account); header names and a digest of their values; a
   gateway's `service`, `scopes`, `mode` and credential provider `id`; stdio's command,
   args and working directory; `resultMode`, `clientInfo` and `configVersion`†. A function
   (a `fetch`, a transport factory) cannot be compared: `configVersion` is the app's word
   that something inside one changed. The hash is computed for each client from the
   transport it was built with, so a client never reads definitions listed under another
   configuration, and nothing has to be flushed. The hash never leaves the process.
2. **The tools-changed notice.** Every pool client subscribes to
   `notifications/tools/list_changed`, through the SDK client's `listChanged.tools` option
   (installed only when the server advertises `tools.listChanged`). A notice on any client
   drops that client's bound tools and invalidates the entry its definitions came from. A
   notice can only cause a new listing; it never writes a definition. A server with no
   standalone stream to carry the notice is covered by 3, 4 and the time limit: the
   runtime's SigV4 path answers a GET with 405.
3. **The app's permission signal.** `pool.permissionsChanged({ tenant, principal? })`
   invalidates every entry in that scope. An app key that carries a version
   (`@policy-7`, then `@policy-8`) reaches a new entry without the call. The pool is per
   process: a fleet sends the signal to every process, or relies on the versioned key and
   the time limit.
4. **The server changed.** `pool.toolsChanged()` invalidates every entry: a deploy hook.
   An unpinned runtime endpoint moves to the new version without its URL changing. Pinning
   `qualifier` turns a deploy into a configuration change instead.

**The time limit.** `definitionTtlMs`† (600 s by default). A lapsed entry is listed again
at the next list. Its generation moves only if the new list differs.

**Generations.** Invalidation moves an entry's generation (a new configuration is a new
key). A listing still in flight when the generation moved is discarded, not written. Bound
tools from an older generation refuse at `execute` (`stale-tools`, not sent) until the
next iteration lists again. So a revoked tool cannot be called from a list the model saw
before the revocation, whatever the server enforces. A call already sent is not touched.

**Entries.** Each entry is a frozen plain-data copy, made under the reading law of
`mcp/plainData.ts` · `copyJsonObject`. It is written once per key and generation, by one
listing at a time. The cache is bounded: at most `MAX_DEFINITION_ENTRIES`† (256) entries,
and a list longer than `MAX_SHARED_TOOLS`† (512) tools is used by its own client and not
shared. One known limit carries over: `mcp/mcpClient.ts`'s listing reads one page, and
`nextCursor` is not followed.

### 6.3 Bound tools

A bound tool is one definition, plus the key it was listed for, plus the definitions
generation. It has the shape `wrapMcpTool` builds (`schema`, `source` set to the pool's
name, the declarations), and the build factors that wrapper into one function both use.
Its `execute`:

1. checks that `ToolExecutionContext.identity` encodes to its key; if not,
   `identity-mismatch`, and nothing is sent;
2. checks that its generation is current; if not, `stale-tools`, and nothing is sent;
3. takes a lease on its key's client, opening one when the key has none (§ 5.1, § 5.3);
4. sends `tools/call` with the run's `ctx.signal` and the call's time meta;
5. classifies an expiry (§ 5.5), releases the lease, and files its facts (§ 8).

The binding is to the KEY, not to one connection object. After a pool-side end (idle,
evicted), the same bound tool opens the key's next client. After an expiry, the call that
met it fails and the next call opens the next client. A bound tool never executes on
another key's client, and a tool handed to another conversation's run is refused by step 1.

Every refusal is raised before a request is built, and says so (`sent: false`†) for E3's
record of what an attempt did.

## 7. Termination

`McpClient.terminate()`†:

1. issues the transport's own session termination, the SDK transport's
   `terminateSession()`: HTTP `DELETE` with `Mcp-Session-Id`;
2. reads the remote answer through a pass-through `fetch` the library installs on every
   transport it builds, which changes no request (the SDK treats 405 as success and would
   hide it);
3. closes locally, whatever happened.

```ts
interface McpTerminateOutcome {   // †
  readonly remote:
    | 'terminated'     // 2xx: the remote session is ended
    | 'already-gone'   // 404: the server no longer had it
    | 'not-offered'    // 405: the server does not end sessions on request; it lives until its own timeout
    | 'no-session'     // nothing to end: no session id was ever issued ('per-call', stateless, stdio)
    | 'failed'         // the request failed; the session may still be alive
    | 'unavailable';   // the `connection` arm: the library did not build this transport
  readonly status?: number;       // the HTTP status, when one was read
  readonly errorClass?: string;   // a failure's class name, never its message
  readonly durationMs: number;
}
```

It is bounded by `TOOL_TEARDOWN_TIMEOUT_MS` (5 s). No answer in time is `failed`, with
`errorClass: 'ToolTeardownTimeoutError'`. `mockMcpClient` implements `terminate()` as
`no-session`.

**On AgentCore Runtime.** Under `'reuse'`, the runtime transport turns a `DELETE` for a
handle it holds into `StopRuntimeSession` for that connection's runtime session id. On
SigV4 that is `StopRuntimeSessionCommand`; on bearer it is `POST
/runtimes/{agentRuntimeArn}/stopruntimesession` with a vended token. The transport forgets
the handle first, then answers the `DELETE` with 204 (stopped), with 404
(`ResourceNotFoundException`), or with the safe failure
(`adapters/mcp/agentcoreRuntime/safeAnswer.ts` · `safeAnswer`).
Under `'per-call'` the client never holds a session id, so the outcome is `no-session`.
The pool and `mcpClient` never learn that AgentCore exists: the one port is the Streamable
HTTP `DELETE`, as `adapters/mcp/README.md` requires ("`mcpClient` never special-cases a
vendor"). `StopRuntimeSessionCommand` joins the AWS command pin
(`test/adapters/aws/awsCommandPin.ts`). The existing test that pins 405 for a GET or a
`DELETE` runs under `'per-call'`, where nothing changes; new cases pin the `'reuse'`
mapping.

**`close()`** keeps its meaning: it ends the local transport only. The doc comment on
`McpClient.close`, `src/mcp/README.md` and the runtime transport's README say so in one
sentence: "`close()` does not end the remote session; `terminate()` does, and says whether
it did."

**In the pool**, every end goes through `terminate()`: idle, eviction, `pool.terminate`,
`close`. The one exception is an expired client, which is only closed locally, because the
server has already ended it. The tier's laws hold: each client is ended at most once, the
end is bounded at 5 s, nothing is thrown into a run, every end is reported, and "already
gone" is an outcome, not an incident. The tier's bounded-wait helper (`withTimeout`,
module-private in `tools/toolSessions.ts` today) is exported and shared, not copied. In
addition:

- **`pool.terminate(scope)`** stops new leases on the matching clients at once; the next
  acquire for that key opens a new client. It waits for in-flight work, up to 5 s, then
  terminates. A client still leased by then is reported `deferred` and is terminated when
  its last lease is released.
- **`pool.close()`** refuses new work, revokes app leases, and aborts in-flight calls
  through the pool's own signal. Their leases are released as they settle. Then it
  terminates every client.

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
  readonly client: 'opened' | 'joined' | 'reused' | 'not-needed' | 'refused' | 'expired';
  readonly previous?: 'idle' | 'evicted' | 'expired' | 'terminated';  // when opened: why the last one ended
  readonly refusal?:
    | 'pool-full' | 'principal-full' | 'init-timeout' | 'init-failed' | 'no-identity'
    | 'incomplete-identity' | 'identity-mismatch' | 'stale-tools' | 'lease-expired' | 'closed';
  readonly initMs?: number;             // opened or joined: how long the open took
  readonly definitions?: 'shared' | 'listed';  // at 'list'
  readonly definitionsAgeMs?: number;   // when shared
}
```

`client: 'not-needed'` is a list served from shared definitions, touching no client. The
call's own `stream.tool_start` and `tool_end` are unchanged.

**Outside a run**, idle ends, evictions, terminations, revoked leases and deferred ends
happen when no run exists. They reach `onEvent` as an `McpPoolReport`†:
`{ kind, server, clientId, keyHash, reason, remote?, status?, errorClass?, durationMs }`.
The precedent is the tier's `report` option (`tools/toolSessions.ts` ·
`ToolSessionTierOptions`). A throwing `onEvent` is swallowed and changes nothing.
`pool.stats()` returns counts (open, busy, idle, opening, entries), never keys.

The new payloads carry no field a redaction policy selects by name. They join the
vocabulary canary (`test/redaction/agent-redaction.vocabulary.test.ts`) as payload-free.

## 9. Threat model

| # | Threat | What happens | Residual |
|---|---|---|---|
| 1 | **Cross-tenant leakage.** A client, a definitions entry, a lease or a record row crosses tenants. | Client keys are the injective encoding: the tenant is a segment, and its absence is a segment of its own. Definitions keys always carry the tenant, even under an app key. A bound tool refuses a caller whose key differs. Records carry `keyHash`; errors and reports carry no ids. A transport per client gives each client a session map of one. | An app that omits `tenant` in a multi-tenant deployment merges tenants whose principal ids coincide. One tenant's demand can evict another tenant's idle clients: state is lost, nothing is disclosed. `keyHash` is the existing unsalted digest: a reader of the record who can guess a whole tuple can confirm the guess. |
| 2 | **A confused deputy.** The pool or a tool acts with one conversation's client for another caller, or a credential is vended for whoever is calling. | The provider keys only on the identity the caller named. Every `execute` checks the calling run's identity against its key before anything is sent, so a cached or handed-on tool cannot run under another conversation. A transport factory is called with the identity its client is for. The runtime transport already refuses a user-delegated bearer it would send for whoever calls. | On a shared machine credential (SigV4's role), every client acts with the process's authority, and the server can tell users apart only by session. Per-user authority needs per-user credentials; the pool cannot add it. |
| 3 | **A key derived from model input.** | Two doors only: `callerIdentity`, from `run({ identity })`, and the identity app code passes to `acquire` and `terminate`. There is no key function. Arguments, model output, the message, a request body and a `sessionId` alone are never read. A derived identity is refused, and so is a missing principal by default. | The pool cannot tell a verified principal from a claimed one; the door verifies (`hosting/identityVerification.ts`). An app that builds `run({ identity })` from a request body has moved the problem, not solved it. |
| 4 | **Definition-cache poisoning.** One conversation's listing changes what another conversation's model sees or can call. | Entries are keyed by authorization context: per principal by default, the tenant always. They are written by one listing at a time, as frozen plain-data copies, with declarations judged field by field by `readToolExtras`. A listing that races an invalidation is discarded. A notice can only invalidate. Entries are bounded and time-limited, and stale bound tools refuse. | A server that serves a malicious list serves it to every client anyway: sharing adds no new source. A wrong assumption (per principal, or an app key, for a server whose list follows the session) lets one session's list reach the rest of its context. The docs name it, and `'per-client'` is the fix. |
| 5 | **Pool exhaustion as a denial of service.** Many conversations or slow calls fill the pool so others are refused. | Global and per-principal caps. A library lease covers one operation and each operation is bounded; an app lease is bounded by `maxLeaseMs`. There is no queue, so `PoolFullError` comes at once and nothing grows. A failed open frees its slot at once. Idle clients are evicted least recently used first. | A principal can fill its own share, and many principals of one tenant can fill the pool: there is no per-tenant share. Per-caller limits belong at the door (`hosting/admission.ts` · `AdmissionPolicy`). With no negative cache, a failing server is opened again at each acquire, one open per key at a time. |
| 6 | **A leaked lease.** App code acquires and never releases, or a call never settles. | Library leases are `try`/`finally` around one operation. An app lease is revoked after `maxLeaseMs` and reported; its next use throws, and its in-flight calls keep their own leases. `release()` is idempotent, and `Symbol.asyncDispose` makes `await using` work. | A call whose server holds the request open keeps its slot until the SDK's request timeout (60 s by default) or the run's signal. |
| 7 | **Remote session ids as capabilities.** A runtime session id, plus permission to invoke the runtime, lands a request in that session. | The runtime session id and the server's `Mcp-Session-Id` stay inside the transport; the client sees a random handle (`session.ts`). Neither appears in the record, a report, an error or `stats()`. | An operator who wants to match the platform's logs has no id to match on (open question 7). |

## 10. The test plan

Every case below is a required test; the file names are proposed, under `test/mcp/pool/`
unless a path is given. A clock seam (`now`†, as `ToolSessionTierOptions` has) drives
time, and a client seam (`_open`†, like `McpClientOptions._client`) injects clients. The
`*.real.test.ts` files run the real SDK over a real socket
(`test/mcp/realTransportSupport.ts`).

- **`identity-key.test.ts`** — two principals never share a client; tenant `acme/hr` with
  principal `alice` and tenant `acme` with principal `hr/alice` get two clients, as do an
  absent tenant and a tenant named `_`; a derived identity is refused (`no-identity`); a
  missing principal is refused unless `requirePrincipal: false`; canary identity strings
  appear in no error, event or report.
- **`open-once.test.ts`** — ten concurrent first calls under one key open once (counted at
  the transport); an open past `initTimeoutMs`, and a failed open, refuse every waiter,
  cache nothing, and the next acquire opens again; one waiter's abort detaches only that
  waiter.
- **`capacity.test.ts`** — a leased client is never evicted, idle-closed or terminated,
  even when it is the oldest; a full pool evicts its least recently used idle client, and
  that key's next open says `previous: 'evicted'`; all busy gives `PoolFullError` at once,
  with typed fields and the fixed sentence; the per-principal cap evicts the principal's
  own idle client first; an app lease past `maxLeaseMs` is revoked while its in-flight
  call completes; `release()` twice is one release; `await using` releases; `terminate` on
  a leased client reports `deferred` and ends it at the last release.
- **`definitions.test.ts`** — per principal: two conversations of one principal list once,
  two principals list twice; an app key shares across principals of one tenant and never
  across tenants; `'per-client'` never shares; a tools-changed notice invalidates and the
  next list lists again; `permissionsChanged` invalidates, and a bound tool from before
  refuses with `stale-tools`, not sent; a changed `qualifier` is a separate entry; a
  listing in flight during an invalidation is discarded; mutating a returned definition
  does not reach another conversation; a lapsed time limit over an unchanged list keeps the
  generation.
- **`bound-tools.test.ts`** — each conversation gets its own bound tools, and the fake
  server records which session served each call: never another conversation's;
  conversation A's tool run under conversation B's identity is refused before sending; the
  run's `ctx.signal` aborts an in-flight call and releases its lease.
- **`expiry.test.ts`** — a 404 to a request with a session id gives `SessionExpiredError`;
  the call is not repeated; the next call opens generation 2 under the same `keyHash`,
  never another key's client; a 404 to `initialize`, a 500 and a network failure are not
  expiry.
- **`test/mcp/terminate.real.test.ts`** — against a real Streamable HTTP server: 204 gives
  `terminated`; 405 gives `not-offered`, although the SDK reports success; 404 gives
  `already-gone`; 500 gives `failed`; a server that issues no session id gives
  `no-session`; the `connection` arm gives `unavailable`; `close()` sends no `DELETE`,
  pinned so that an SDK that changes it is noticed.
- **`test/mcp/agentcoreRuntime.test.ts`** gains cases: under `'reuse'`, a `DELETE` becomes
  `StopRuntimeSession` with that connection's runtime session id, on the SigV4 double and
  the bearer HTTPS path, and the handle is forgotten first; `ResourceNotFoundException`
  gives `already-gone`; `AccessDeniedException` gives `failed`, with its class and never
  its message; under `'per-call'` the outcome is `no-session`; a GET is still 405. The AWS
  pin gains `StopRuntimeSessionCommand`.
- **`record.test.ts`** — `tools.mcp_client` on list and call, with the fields of § 8 and
  nothing else; canary identities, session ids, headers, arguments and results appear in no
  event, report or `stats()`.
- **Properties (fast-check).** For random identity tuples (with `/`, `%`, `_` and empty
  strings), distinct tuples never share a client. For random interleavings of acquire,
  release, call, evict, sweep and terminate: a busy client is never ended, busy clients
  never exceed the caps, and every lease is released exactly once.

**The rest.** Byte identity: an agent without a pool emits the same events, the existing
MCP suites under `test/mcp/` are unchanged, and `callerIdentity` is additive. The event
joins `events/registry.ts` and its pinned count (`test/events/unit/registry.test.ts`).
Each refusal sentence is registered in `test/modelFacingSurfaces.test.ts` and found by
`test/modelFacingScan.test.ts`. `check:layering` passes for the new folder. An example,
`examples/features/<next>-mcp-client-pool.ts`†, runs on the mock: two principals with two
conversations each, one listing per principal, a full pool, and the termination outcomes.

## 11. Not in this design

- A pool shared across processes, or invalidation across a fleet. Keeping a conversation on
  one process is the deployment's job.
- Repeating a call after an expiry or a refusal. That is E3.
- Resources and prompts. Only tools are pooled.
- Following `nextCursor` in `tools/list`.
- Reattaching a remote session by id after a restart.
- An asynchronous `authorizationContext`.
- A per-tenant share of the pool.
- Opening a client in the background when a list is served from shared definitions (open
  question 2).
- Any change to what `close()` does.

## 12. Open questions

For the owner and Codex:

1. **The default definitions mode.** Per principal, as proposed? Or per client: safer for
   servers whose list follows the session, at one more listing per conversation?
2. **Opening in the background.** When a list is served from shared definitions, should the
   pool open the client in the background, so the cold start overlaps the model's first
   call? The cost is a session for a turn that never calls a tool.
3. **Protecting a turn in progress.** Should a client used in the last N seconds be safe
   from eviction, so that a new conversation is refused instead?
4. **Requiring more of the identity.** Should there be `requireTenant` as well as
   `requirePrincipal`? And should a run carry a fact that its principal was verified, so
   the pool can require it?
5. **The platform's answer in an ended session.** Does AgentCore Runtime answer a request in
   an ended runtime session with a documented refusal? E2 names `ResourceNotFoundException`
   and a "not active" `ValidationException` for code sessions. If it does, the runtime
   transport adds that refusal to the expiry rule, with its citation.
6. **Lifetime.** Should the pool replace a client before the platform's 8-hour
   `maxLifetime`, at an idle moment?
7. **Correlation.** Should the record carry a digest of the runtime session id, so operators
   can match the platform's logs? The id itself never leaves the transport.
8. **`McpClient.terminate` as a required member.** Is it `added`, or `breaking` for a
   hand-written `McpClient`?
9. **The standalone client.** Should `mcpClient` outside a pool also hear the tools-changed
   notice and drop its cached list?
10. **The bounds.** 64 clients, 8 per principal, a 30 s open, 600 s idle, a 15-minute app
    lease, a 600 s definitions limit, 256 entries and 512 shared tools are proposals.

## 13. Decisions

1. One pool per MCP server, `mcpClientPool()`. The agent path is `pool.toolProvider()`; the
   hand path is `acquire`, `lease.tools()`, `release()`.
2. The key is `identityNamespace` of the identity the caller named, through
   `ToolDispatchContext.callerIdentity` or the app's own call. The principal is required by
   default. Nothing else is read.
3. One open per key, under the pool's own signal and `initTimeoutMs`. A failure reaches
   every waiter and is not cached.
4. A lease covers one operation (the library's) or a bounded hold (the app's). A busy client
   is never evicted, closed for idleness, or terminated.
5. A full pool evicts the least recently used idle client, for the principal first and then
   the pool. When every client is busy, `PoolFullError` comes at once. There is no queue.
6. Definitions are shared per principal by default, or per client. An app's
   `authorizationContext` widens sharing across principals within a tenant, never across
   tenants.
7. Invalidation: the configuration hash is in the key; the tools-changed notice,
   `permissionsChanged`, `toolsChanged` and a time limit move the generation; stale bound
   tools refuse before sending.
8. Bound tools are bound to their conversation's key, and every `execute` checks the caller
   again.
9. `McpClient.terminate()` issues the transport's termination and reports the remote answer.
   Under `'reuse'`, AgentCore Runtime maps it to `StopRuntimeSession`. `close()` stays local,
   and the docs say so.
10. Idle expiry is 600 s by default, below the platform's 900 s, and lazy. The pool does not
    track lifetime.
11. An expiry is a 404 to a request that carried a session id, or the transport's own 404.
    It raises `SessionExpiredError`, the call is not repeated, and the client is rebuilt only
    under the same key.
12. The pool owns its lifecycle. It does not ride an agent's tool-session tier; it keeps the
    tier's laws.
13. The record is `agentfootprint.tools.mcp_client` for each list and call, and `onEvent`
    outside a run: ids, digests, outcomes and durations only.
