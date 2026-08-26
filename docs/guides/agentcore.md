# AWS Bedrock AgentCore

> **Like:** agentfootprint is the *engine + dashboard* of the car; AgentCore is the
> *road, fuel network, and security gates*. They're complementary — author and
> observe your agent with agentfootprint, deploy and operate it on AgentCore.

[AgentCore](https://aws.amazon.com/bedrock/agentcore/) is AWS's managed platform
for running agents in production: a serverless **Runtime**, plus **Memory**,
**Observability**, **Gateway** (tools), **Identity**, **Code Interpreter**, and
**Browser**. agentfootprint plugs into each through the same ports-and-adapters
model it uses everywhere else — your agent code doesn't change when you move it
onto AgentCore.

## Coverage at a glance

| AgentCore service | agentfootprint | How |
|---|---|---|
| **Runtime** (deploy/scale) | ✅ adapter | `agentCoreRuntimeHost()` + `agentCoreSessions()` — `agentfootprint/hosting` |
| **Memory** | ✅ adapter | `AgentCoreStore` (incl. `search()` over `RetrieveMemoryRecords`) — `agentfootprint/memory` |
| **Observability** | ✅ adapter | `agentcoreObservability` (CloudWatch) / `otelObservability` (OTLP) — `agentfootprint/observe` |
| **Gateway** (tools) | ✅ via MCP | `gatewayTransport()` + `mcpClient()` — per-request vended auth — `agentfootprint/providers` |
| **Runtime models** | ✅ provider | `bedrock()` (Nova/Claude) + `BedrockCacheStrategy` — `agentfootprint/providers` |
| **Identity** (downstream OAuth) | ✅ adapter | `agentCoreIdentity()` / `staticTokens()` (the `CredentialProvider` port) — `agentfootprint/security` |
| **Code Interpreter** | ✅ adapter | `agentCoreCodeRunner()` behind the `CodeRunner` port — `agentfootprint/providers` |
| **Browser** | ✅ adapter | `agentCoreBrowser()` behind the `BrowserRunner` port, incl. the human takeover — `agentfootprint/providers` |
| **Policy** | ⛔ enforced at the Gateway, by design | Policy reached GA in March 2026 — Cedar rules attached to a **Gateway**, evaluated inside it. There is still **no dry-run/evaluate API** (re-verified against `@aws-sdk/client-bedrock-agentcore-control` 3.1118.0, all 165 commands enumerated), so `agentCorePolicy()` stays retired: nothing exists for an adapter to call. Use `PermissionPolicy` / `.toolMiddleware()` for rules you own — `agentfootprint/security` |
| **Evaluations** | ✅ adapter + fork | `agentCoreEvaluationSpans()` shapes spans so AWS's evaluators can score them — `agentfootprint/observe`. Our own `$eval` + `QualityRecorder` stay: **their evaluators say what the score is, our trace says why** |

> **Not a competitor to AWS's own SDK.** AWS ships `bedrock-agentcore` on npm, whose
> `BedrockAgentCoreApp` serves the same `/invocations` + `/ping` contract our runtime host does.
> If all you need is to serve that contract, use theirs. What agentfootprint adds is the part
> that is not the contract: the same agent moves between clouds because only the *adapter*
> changes, every host passes one conformance suite over a real socket, sessions and checkpoints
> are a port with several stores behind it, and the whole run leaves a causal trace. Pick on
> that basis, not on who serves HTTP.

**How much of this is verified:** the Runtime host is plain HTTP with no AWS SDK on its path
and passes the host conformance suite over a real socket. Every adapter that calls an AWS SDK
is **contract-mapped and injection-tested** — exercised through its `_client` / `_sdk` seam,
never against AWS. Both `agentCoreSessions` modes have since been run against the real service
by a production integration: `'session-storage'` behaved as documented, and `'memory'` had a
real defect that no injected fake could have shown (fixed in 7.22.1 — see
[Sessions](#sessions--where-a-conversation-lives)). The remaining SDK adapters are still
contract-mapped only.

The framing that matters: **agentfootprint owns *authoring + self-explaining
observability*; AgentCore owns *managed deploy + infra*.** Nothing below replaces
your agent logic — it attaches the AgentCore primitive to the agent you already
built.

---

## Runtime — deploy your agent

AgentCore Runtime is a **container contract**: an ARM64 image serving the runtime
HTTP protocol on `0.0.0.0:8080`.

| Endpoint | Contract |
|---|---|
| `POST /invocations` | JSON `{ "prompt": "..." }` → JSON `{ "response", "status" }` (or SSE) |
| `GET /ping` | `{ "status": "Healthy" \| "HealthyBusy", "time_of_last_update": <unix> }` |
| Session | `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header |

That contract is now an adapter on the `AgentHost` port, so the container's whole
entry point is:

```ts
import { standingAgent } from 'agentfootprint/hosting';
import { agentCoreRuntimeHost, agentCoreSessions } from 'agentfootprint/hosting';

const handle = await standingAgent({
  agent,
  host: agentCoreRuntimeHost(),                              // 0.0.0.0:8080
  sessions: agentCoreSessions({ store: 'session-storage' }), // survives a stop/resume
});
process.on('SIGTERM', () => void handle.close());
```

The runnable version + Dockerfile + deploy steps are in
[`examples/deploy/`](../../examples/deploy/) — it's the entry point *and* its own
integration test (`npx tsx examples/deploy/agentcore-runtime.ts`). Swap the
sample `mock()` for `providerFromEnv()` and the model runs on Bedrock.

**One port, two protocols.** A container gets one port, so if yours must also
answer a WebSocket upgrade, hand the host a `node:http` server you own instead
of letting it bind one:

```ts
const server = createServer();
server.on('upgrade', handleWebSocket);                  // yours
await new Promise<void>((r) => server.listen(8080, '0.0.0.0', r));

const handle = await standingAgent({
  agent,
  host: agentCoreRuntimeHost({ server }),               // ← attaches, binds nothing
  sessions: agentCoreSessions({ store: 'session-storage' }),
});
```

`/invocations` and `/ping` answer on your socket, every other path stays yours
(the host never writes a 404 on a server it does not own — so an unmatched path
*hangs* unless you route it), and `close()` detaches and drains without closing
your socket. Runnable: [`examples/deploy/one-port.ts`](../../examples/deploy/one-port.ts).

Two things to know before you reach for it. A framework that installs a
catch-all handler (Fastify, Express) answers first, so the attached host never
sees the request — register the framework's routes as a delegation to the host,
or let the host own the socket. And if all you want is a route of your own
beside the runtime's, the inverse option is cheaper:

```ts
agentCoreRuntimeHost({ onUnhandled: (req, res) => myDiagnosticRoutes(req, res) })
```

The host binds the container's port as usual and hands you every path it does
*not* own, instead of answering 404 for your application. `/invocations`,
`/ping` and `/ws` never reach it (a wrong method on one of them included), a
throw inside it is that request's 500, and it is refused beside `{ server }`,
where unmatched paths already reach your own listeners. Runnable:
[`examples/deploy/own-routes.ts`](../../examples/deploy/own-routes.ts).

**Field facts worth knowing before you deploy** (both reported from a real deployment):

- **`runtimeSessionId` must be ≥ 33 characters.** The service validates the length and
  rejects shorter ids, so a tidy `"c-1"` fails. Send a UUID (or your own id with a stable
  prefix). It arrives as the `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header and
  becomes `HostRequest.sessionId`.
- **A direct-code (zip / `NODE_22`) deployment serves `/ws` fine.** The vendor docs describe
  WebSocket support for *container* deployments only, which reads as a restriction — it
  isn't one in practice.

---

## Sessions — where a conversation lives

`agentCoreSessions({ store })` picks the checkpoint's home at construction:

```ts
agentCoreSessions({ store: 'session-storage' });                       // a JSON file, no SDK
agentCoreSessions({ store: 'memory', memoryId: process.env.MEMORY_ID! }); // one Memory event per turn
```

The `'memory'` mode stores the envelope as **JSON text** and parses it back (7.22.1). That is
not a style choice: handed an object as an event blob, the service stores its own host
language's `toString()` of it and returns `{format=conversation-v1, data={...}}` — not JSON,
and **lossy**. Envelopes written by 7.15.0–7.22.0 are unrecoverable; there is nothing to
migrate. Start those conversations again.

Both modes refuse rather than guess. An unknown envelope `format` is refused by name, and a
stored session that is present but **unreadable** raises `UnreadableEnvelopeError` naming the
session — because an unreadable stored conversation and an absent one are different facts, and
only one of them is safe to answer with a fresh start. Only a session that was never written
hydrates as "no conversation".

---

## Memory — `AgentCoreStore`

```ts
import { Agent, defineMemory, MEMORY_TYPES } from 'agentfootprint';
import { AgentCoreStore } from 'agentfootprint/memory';

const store = new AgentCoreStore({
  memoryId: 'arn:aws:bedrock:us-east-1:123:memory/my-mem',
  region: 'us-east-1',
});
const memory = defineMemory({ id: 'conversation', type: MEMORY_TYPES.EPISODIC, store });
const agent = Agent.create({ provider, model }).memory(memory).build();
```

Maps the `MemoryStore` interface onto AgentCore's session/event model. Example:
[`examples/memory/09-agentcore-store.ts`](../../examples/memory/09-agentcore-store.ts).

**7.22.1:** entries are stored as **JSON text**, for the same reason session envelopes are —
handed an object, the service stores its own `toString()` of it and returns bytes nothing can
decode. Entries written before 7.22.1 are **unrecoverable**; delete them or point the store at
a fresh memory resource. A blob that is present and cannot be decoded now raises
`UnreadableMemoryEntryError` naming the event and session, rather than being skipped — a
`list()` one entry short reads as "never remembered", which is an agent that has forgotten
something it was told and cannot say so.

`store.search()` wraps AgentCore's server-side `RetrieveMemoryRecords`. It ranks on
AWS's side and takes a **text** query, so pass one alongside the vector — omit it
and the store says so by name rather than returning an empty result that reads as
"no matches":

```ts
await store.search(identity, queryVector, { text: 'where does Ada like to sit?', k: 5 });
```

Stores that rank locally ignore `text`, so passing both is always safe.
**Note:** `search` returns AgentCore's derived memory *records*, not the events this
store wrote — their ids belong to AgentCore, and results carry
`metadata.source: 'agentcore-memory-record'` so this is never a surprise.

---

## Observability — `agentcoreObservability`

```ts
import { agentcoreObservability } from 'agentfootprint/observe';
import { microtaskBatchDriver } from 'footprintjs/detach';

agent.enable.observability({
  strategy: agentcoreObservability({ region: 'us-east-1', logGroupName: '/agentfootprint/my-agent' }),
  detach: { driver: microtaskBatchDriver, mode: 'forget' }, // don't block the loop on network
});
```

Ships every event to CloudWatch in AgentCore's schema, so your steps appear
alongside AgentCore's own runtime telemetry. Running outside AgentCore, or want a
different backend? Use `otelObservability` (OTLP → X-Ray / Honeycomb / Datadog /
Grafana…). Example: [`examples/features/04-observability.ts`](../../examples/features/04-observability.ts).

---

## Gateway — tools over MCP

AgentCore Gateway turns APIs/Lambdas into **MCP** tools. agentfootprint already
speaks MCP, so Gateway tools flow in through the normal tool path — no AgentCore-
specific code:

```ts
import { Agent } from 'agentfootprint';
import { agentCoreIdentity } from 'agentfootprint/security';
import { gatewayTransport, mcpClient, staticTools } from 'agentfootprint/providers';

const gateway = await mcpClient({
  name: 'gateway',
  transport: gatewayTransport({
    url: process.env.GATEWAY_MCP_URL!,
    credentials: agentCoreIdentity({ region: 'us-west-2' }),
    service: 'gateway',
  }),
});
const agent = Agent.create({ provider, model })
  .toolProvider(staticTools(await gateway.tools()))
  .build();
```

`gatewayTransport` vends the auth headers **per request** rather than fixing them
at connect time — a Gateway token expires, and a standing agent outlives it. The
token is used once and dropped: never cached, never stored on the transport,
never logged, and never in an error message. The plain `http` transport is still
there for a static API key.

### `agentCoreGatewayTransport` — the four facts that are AgentCore's (9.66.0)

`gatewayTransport` is deliberately vendor-free, so four AgentCore specifics had
nowhere to live. They now live in one file, and one call configures the lot:

```ts
import { agentCoreGatewayTransport, mcpClient } from 'agentfootprint/providers';

const gateway = await mcpClient({
  name: 'gateway',
  transport: agentCoreGatewayTransport({
    gatewayId: 'my-gateway-a1b2c3d4e5',
    region: 'us-east-1',
    credentials: agentCoreIdentity({ region: 'us-east-1' }),
    policySessionId: () => currentSessionId,   // see below
  }),
});
```

- **The endpoint shape** — `agentCoreGatewayUrl({ gatewayId, region })` builds
  `https://{gatewayId}.gateway.bedrock-agentcore.{region}.amazonaws.com/mcp`,
  which nobody remembers correctly.
- **`AGENTCORE_POLICY_SESSION_HEADER`** — AgentCore's *temporal* policies decide
  on SEQUENCES of actions ("not after three refunds", "only once approved"), and
  a sequence needs a boundary. Pass `policySessionId` and it is stamped on every
  request. **Pass a function, not a string, on any transport more than one
  person shares** — the header is resolved per request, so `() => currentSessionId`
  keeps each caller's history their own. A fixed string on a shared transport
  merges everybody into one policy session, which makes one person's earlier
  actions count against another person's rule.
- **`AGENTCORE_GATEWAY_SEARCH_TOOL`** — the catalogue's own semantic search,
  `x_amz_bedrock_agentcore_search`. `gatewaySearchTool(tools)` finds it and
  `hasGatewaySearch(tools)` tests for it; both answer `undefined`/`false`
  permanently rather than transiently, because semantic search is enabled when a
  Gateway is CREATED and cannot be turned on later.

  Note what is deliberately absent: a `search(gateway, query)` convenience.
  Executing a tool needs a `ToolExecutionContext` that belongs to the agent
  loop, and a call made on a fabricated one appears in no trace — the model
  would get a shortlist whose origin nothing can explain. Register the search
  tool like any other tool instead, and the search becomes an ordinary,
  attributable tool call.
- **`AGENTCORE_SIGV4_SERVICE`** — `'bedrock-agentcore'`, the name a SigV4
  signature for a Gateway is computed against.

### The Gateway is also a model router

Since mid-2026 a Gateway can front model providers as well as tools, serving
`/v1/chat/completions` and friends. Nothing new is needed for that — it is an
OpenAI-shaped endpoint, so the existing provider reaches it:

```ts
import { openai } from 'agentfootprint/providers';

const provider = openai({
  baseURL: 'https://my-gateway-a1b2c3d4e5.gateway.bedrock-agentcore.us-east-1.amazonaws.com/v1',
  apiKey: async () => (await credentials.getCredential({ service: 'gateway' })).credential.token,
});
```

The callback form matters here for the same reason it does everywhere else: a
gateway token expires, and `apiKey` is re-read before every request.

---

## Identity — downstream OAuth (`agentCoreIdentity`)

> **Three ways to get a credential, since 9.66.0.** A *machine* request vends the
> agent's own token (`M2M`). A *user* request does one of two things, chosen by
> `userFlow`: `'consent'` (the default) sends the person to an approval screen
> once and remembers it, while `'exchange'` trades the login they already have
> for a scoped downstream token with no screen at all — available only where the
> credential provider was configured for that exchange, and a decision to make
> deliberately, since the consent screen is what asks the person. Services whose
> credential is an API key rather than an OAuth token are named in
> `apiKeyServices` and come back as an `apiKey` credential.
>
> When a consent screen *is* shown, the round-trip ends in **your** web app:
> `completeAgentCoreAuthorization({ sessionId, userId | userToken })` is the
> handshake your callback route calls after it has confirmed who the browser
> belongs to. It lives outside the provider on purpose — that route runs in a
> different process from the agent, and often a different service.
>
> The shape this takes in agentfootprint is a **pause**: the first vend answers
> `authorization-required`, the person approves, your route completes the
> handshake, and the same request re-run is `issued`. The consent, and the wait,
> are both in the trace.

When a tool needs to call GitHub/Slack/Google **on behalf of the user**, AgentCore
Identity vends the token. The recommended pattern is **declare-and-push**: the
tool *declares* the credential it needs, and the framework resolves it **before**
invoking and injects it as `ctx.credential` — no fetching inside the tool, and the
credential is never in `inputSchema`, so the LLM never sees it:

```ts
import { Agent, defineTool } from 'agentfootprint';
import { agentCoreIdentity } from 'agentfootprint/security'; // or staticTokens({...}) for dev

const listRepos = defineTool({
  name: 'list_repos',
  description: "List the user's GitHub repos.",
  inputSchema: { type: 'object', properties: {} },
  needs: { credential: 'github', mode: 'user', scopes: ['repo'] }, // ← DECLARE
  execute: async (_args, ctx) =>
    callGitHub({ headers: ctx.credential!.toHeaders() }),          // ← pushed in
});

const agent = Agent.create({
  provider, model,
  credentials: agentCoreIdentity({ region: 'us-east-1' }),         // attach ONCE
}).tools([listRepos]).build();
```

- **Resolve-before-invoke**: issued → injected as `ctx.credential`; 3LO consent
  needed → **the run PAUSES** (8.6.0) and the caller receives
  `{ service, sessionId, authorizationUrl }` on the pause outcome — a
  `standingAgent` answers 202 with `{ awaiting }`, and `agent.resume(checkpoint)`
  re-resolves the credential and runs the tool that was waiting;
  `agentfootprint.credential.authorization_required` is emitted throughout,
  carrying `{ service, sessionId }` and never the URL. Provider failure → the
  reason is surfaced + emitted, and the tool **never runs half-authed**.
  AgentCore caches refresh tokens, so consent usually happens once.

  The consent URL is a **bearer capability** — it carries a session-correlating
  `state` parameter, so whoever holds it can complete the flow. It reaches the
  caller and nothing else: not the conversation, the snapshot, the narrative,
  the event stream or a recording. Set `onAuthorizationRequired: 'tell-model'`
  if you want the model to route around a consent block instead; the turn then
  raises `CredentialConsentRequiredError` rather than reporting a completion
  the tool never earned.
- **`mode`**: omitted → `machine` (2-legged/M2M). Declare `mode: 'user'`
  explicitly for on-behalf-of-user (3-legged) delegation.
- **Per-request identity scoping** (opt-in via `workloadName`): pass
  `agent.run({ message, identity: { tenant, principal, conversationId } })` and
  configure `agentCoreIdentity({ region, workloadName: 'my-agent' })`. AgentCore's
  `GetResourceOauth2Token` has no user field — the user is bound at
  workload-token acquisition — so for `mode: 'user'` requests the adapter
  exchanges `(workloadName, userId)` via `GetWorkloadAccessTokenForUserId` for a
  USER-SCOPED workload token and vends with it: AgentCore then keys its token
  vault + 3LO grants per (workload, user). Default `userId` is
  `identity.principal`; `tenant` has no native AgentCore field — encode it via
  `userIdFor: ({ tenant, principal }) => `` `${tenant}:${principal}` `` if you
  need tenant-scoped vault entries. Without `workloadName`, the static
  `workloadIdentityToken` flows unchanged.
- **🔒 Secrets never enter the trace.** The credential lives only in `ctx`; the
  `credential.*` events carry kind/service/reason — never the token; secret
  fields are non-enumerable, so even an accidental `JSON.stringify` of the
  credential emits no secret. Never write it to tracked scope (`setValue`).
  ([`examples/features/17-identity.ts`](../../examples/features/17-identity.ts)
  asserts the vended token never reaches the snapshot.)
- Dev/test without AWS: `staticTokens({ github: '...' })` — swap to
  `agentCoreIdentity` in one line; the tool never changes.
- **Transient retry:** wrap the provider with
  `withCredentialRetry(agentCoreIdentity({ region }), { maxAttempts: 3 })` so
  network blips to the vault (AgentCore documents 500/429 as retryable) retry
  with backoff BEFORE failing closed. Same option vocabulary as the LLM-provider
  `withRetry`; 3LO consent and 4xx are never retried; exhausted retries behave
  exactly like an unwrapped provider (per-attempt visibility via `onRetry`).
- **Escape hatch (dynamic needs):** `ctx.credentials.getCredential({ service })`
  pulls on demand — fail-closed (it throws when no provider is attached; check
  `ctx.hasCredentials` for an intentional degraded mode).

> A first-class credential *subflow* node (so 3LO consent auto-pauses the run)
> is a planned follow-up — the port + declare-and-push above are the stable
> foundation.

---

## Code Interpreter and Browser — two ports, two backends

Both are AgentCore *services your agent calls*, and both now sit behind a port
of their own rather than inside a hand-written tool. (This page used to say
"wrap them as tools, and don't build a port until a second backend has real
pull." A second backend showed up — `localCodeRunner` — so the advice was
followed and then outgrown, which is the outcome it was hoping for.)

### Code Interpreter — the `CodeRunner` port

`agentCoreCodeRunner()` is a real managed sandbox; `localCodeRunner()` is
process isolation on this machine and says so. `codeRunnerTool` is the tool that
holds one, with the session leased per run through `ctx.onTeardown`.

### Browser — the `BrowserRunner` port (9.68.0)

```ts
import { agentCoreBrowser } from 'agentfootprint/providers';

const browser = agentCoreBrowser({ region: 'us-east-1' });
const session = await browser.start({ key: toolSessionKey(ctx, 'run') });
```

**A browser session has two doors, and confusing them costs a day.**

- **The automation stream** is a CDP WebSocket, and it is where everything
  page-shaped happens: navigate, find an element, fill a form. Attach Playwright
  or another CDP client to `session.automationEndpoint`. This library does not
  depend on Playwright and does not drive the page for you — it hands you the
  endpoint and stays out of the way.
- **`InvokeBrowser`** is what the adapter calls, and it is operating-system
  input *above* the page: `click`, `type`, `press`, `screenshot`. Its action
  union — read off the SDK rather than remembered — is exactly `mouseClick |
  mouseMove | mouseDrag | mouseScroll | keyType | keyPress | keyShortcut |
  screenshot`. **There is no navigate action.** If you came here looking for
  one, you want the other door.

### The takeover — a person finishes the step the agent cannot

```ts
await session.handControlTo('person');   // the automation stream stops
// …they sign in, clear the CAPTCHA, approve the consent screen, watching live
await session.handControlTo('agent');    // and the agent carries on
```

Underneath, that is `UpdateBrowserStream` setting the automation stream to
`DISABLED` and back to `ENABLED`: the live-view user is already connected, and
stopping automation is what lets their input through.

This is the shape agentfootprint is for. Pair it with a check-in and the agent
*pauses* rather than guesses — the handover, the wait, and the resume are all
ordinary events in the trace, so "why did this run take four minutes?" has an
answer that names a person and a login screen.

**One contradiction left as AWS wrote it:** the devguide says a session defaults
to 15 minutes and `StartBrowserSession`'s API reference says 3600 seconds. The
adapter sends no timeout unless you pass `sessionTimeoutSeconds`, so the service
applies whichever it actually means rather than this library picking a side.

---

## Policy & Evaluations

- **Policy** → **nothing to attach, and that is the correct answer.** AgentCore
  enforces policy AT THE GATEWAY, in front of the tool, before a request reaches
  your process. A denial comes back as an **MCP error** on the tool call made
  through `mcpClient(...)` and lands in the ReAct loop as that tool's result,
  which the model reads and adapts to. The library's job is to surface that
  honestly, not to pre-evaluate a copy of the rule.

  `agentCorePolicy({ policyStoreId })` tried to do the latter and is **retired in
  9.4.0**: it dispatched `EvaluatePolicyCommand`, which does not exist in
  `@aws-sdk/client-bedrock-agentcore` — AgentCore has no data-plane
  authorization call at all. The export remains and refuses at construction with
  the full explanation.

  **Still true after Policy went GA (March 2026).** The service is real now —
  Cedar (and Dogwood, for rules about *sequences* of actions) evaluated inside a
  Gateway you attach a policy engine to, default-deny, forbid-wins. What has not
  appeared is anything to call: re-enumerating all 165 commands of
  `@aws-sdk/client-bedrock-agentcore-control` 3.1118.0 finds no `EvaluatePolicy`,
  no `TestPolicy`, no `IsAuthorized`. AWS's own testing story is deploying the
  engine in `LOG_ONLY` mode and reading the traces. So the retirement was not a
  gap we left open — it was the architecture, and it held.

  One thing a client *can* do, and this library will: temporal (session-aware)
  policies group a caller's actions by the
  `x-amzn-bedrock-agentcore-policy-session-id` request header. Stamping our
  session id there is what lets AWS's rules reason about a conversation instead
  of a single call.

  For rules you own, the `PermissionChecker` port is unchanged:

  ```ts
  import { PermissionPolicy } from 'agentfootprint/security';

  const policy = PermissionPolicy.fromRoles({ readonly: ['lookup'] }, 'readonly');
  Agent.create({ provider, model, permissionChecker: policy }).build();
  ```

  It composes with `gatedTools` unchanged and neither knows the other exists: the
  gate decides what the model is *shown*, the checker decides what actually
  *runs*. A local allowlist also doubles as a sync `gatedTools` predicate; a
  remote checker cannot, because that predicate is synchronous.
- **Evaluations** (quality monitoring) → two things that compose, not two
  things that compete.

  **Theirs.** AgentCore Evaluations reached GA in March 2026 with 13 built-in
  evaluators, and since July 2026 it scores agents that **do not run on AWS** —
  any agent whose OpenTelemetry spans reach CloudWatch and match its contract.
  Two details decide whether yours do, and both are settings on our OTel
  adapter:

  ```ts
  import { agentCoreEvaluationSpans } from 'agentfootprint/observe';

  agent.enable.observability({ strategy: agentCoreEvaluationSpans({ serviceName: 'support-agent' }) });
  ```

  That is a *configuration* of `otelObservability`, not a second adapter: it
  sets the instrumentation scope name their classifier routes on
  (`AGENTCORE_EVALUATIONS_SCOPE_NAME`) and turns on `captureContent`, which puts
  the turn's prompt and answer on the span where a scorer can read them. Both
  are opt-in on the neutral adapter, because content on a span is an export of
  content — see `captureContent` before you enable it. Getting those spans to
  CloudWatch is separate and yours (an OTLP exporter with AWS's documented
  headers, or a runtime that does it for you).

  **Ours.** Keep emitting `$eval(name, score)` and `QualityRecorder`. The
  division worth stating plainly: **AWS's evaluators tell you what the score is;
  the agentfootprint trace tells you why it happened.** A low
  tool-selection score is a number until you can see which context the choice
  was made from — that part is not something an evaluator computes.

---

## What's a gap (honest)

- Code Interpreter / Browser ship as **examples**, not first-class adapters.
- **Evaluations** map to agentfootprint primitives rather than a dedicated
  AgentCore Evaluations API binding.
- The **control plane** (every `Create*`) is yours — AWS SDK or CDK.
- Everything that calls an AWS SDK is **contract-mapped and injection-tested**,
  not verified against AWS — except the two `agentCoreSessions` modes, which a
  production integration has now run against the real service. Confirm command
  and field names against your installed `@aws-sdk/client-bedrock-agentcore`.
