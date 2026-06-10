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
| **Runtime** (deploy/scale) | ✅ template | ARM64 container serving `/invocations` + `/ping` — [`examples/deploy/`](../../examples/deploy/) |
| **Memory** | ✅ adapter | `AgentCoreStore` — `agentfootprint/memory-providers` |
| **Observability** | ✅ adapter | `agentcoreObservability` (CloudWatch) / `otelObservability` (OTLP) — `agentfootprint/observability-providers` |
| **Gateway** (tools) | ✅ via MCP | Gateway exposes tools as MCP; consume them via `agentfootprint/tool-providers` |
| **Runtime models** | ✅ provider | `bedrock()` (Nova/Claude) + `BedrockCacheStrategy` — `agentfootprint/llm-providers` |
| **Identity** (downstream OAuth) | ✅ adapter | `agentCoreIdentity()` / `staticTokens()` (the `CredentialProvider` port) — `agentfootprint/identity` |
| **Code Interpreter / Browser** | 📋 example | wrap as a `defineTool` calling the AgentCore SDK (snippets below) |
| **Policy** | ✅ overlaps | use `gatedTools` (`agentfootprint/security`) for action control |
| **Evaluations** | ✅ overlaps | emit `$eval` + `QualityRecorder`; export via the observability adapter |

The framing that matters: **agentfootprint owns *authoring + self-explaining
observability*; AgentCore owns *managed deploy + infra*.** Nothing below replaces
your agent logic — it attaches the AgentCore primitive to the agent you already
built.

---

## Runtime — deploy your agent

AgentCore Runtime is a **container contract**, not an adapter. Package your agent
as an ARM64 image serving the runtime HTTP protocol on `0.0.0.0:8080`:

| Endpoint | Contract |
|---|---|
| `POST /invocations` | JSON `{ "prompt": "..." }` → JSON `{ "response", "status" }` (or SSE) |
| `GET /ping` | `{ "status": "Healthy" \| "HealthyBusy", "time_of_last_update": <unix> }` |

The reference handler + Dockerfile + deploy steps are in
[`examples/deploy/`](../../examples/deploy/) — it's the handler *and* its own
integration test (`npx tsx examples/deploy/agentcore-runtime.ts`). Swap the
sample `mock()` for `providerFromEnv()` and the model runs on Bedrock.

---

## Memory — `AgentCoreStore`

```ts
import { Agent, defineMemory, MEMORY_TYPES } from 'agentfootprint';
import { AgentCoreStore } from 'agentfootprint/memory-providers';

const store = new AgentCoreStore({
  memoryId: 'arn:aws:bedrock:us-east-1:123:memory/my-mem',
  region: 'us-east-1',
});
const memory = defineMemory({ id: 'conversation', type: MEMORY_TYPES.EPISODIC, store });
const agent = Agent.create({ provider, model }).memory(memory).build();
```

Maps the `MemoryStore` interface onto AgentCore's session/event model. Example:
[`examples/memory/09-agentcore-store.ts`](../../examples/memory/09-agentcore-store.ts).
**Gap:** AgentCore's server-side `retrieve` (semantic search) isn't surfaced yet —
`get`/`put`/`list` work today; `agentcoreRetrieve()` is planned.

---

## Observability — `agentcoreObservability`

```ts
import { agentcoreObservability } from 'agentfootprint/observability-providers';
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
import { mcpClient } from 'agentfootprint/tool-providers';

// AgentCore Gateway speaks MCP — connect to its MCP endpoint with mcpClient.
// (See adapters.md for the exact transport options.)
const gateway = await mcpClient({ transport: { /* MCP transport → your Gateway /mcp URL */ } });
const agent = Agent.create({ provider, model }).toolProvider(gateway).build();
```

---

## Identity — downstream OAuth (`agentCoreIdentity`)

When a tool needs to call GitHub/Slack/Google **on behalf of the user**, AgentCore
Identity vends the token. The recommended pattern is **declare-and-push**: the
tool *declares* the credential it needs, and the framework resolves it **before**
invoking and injects it as `ctx.credential` — no fetching inside the tool, and the
credential is never in `inputSchema`, so the LLM never sees it:

```ts
import { Agent, defineTool } from 'agentfootprint';
import { agentCoreIdentity } from 'agentfootprint/identity'; // or staticTokens({...}) for dev

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
  needed → the consent URL is surfaced to the LLM (the tool is skipped) and
  `agentfootprint.credential.authorization_required` is emitted; provider failure
  → the reason is surfaced + emitted, and the tool **never runs half-authed**.
  AgentCore caches refresh tokens, so consent usually happens once.
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

## Code Interpreter / Browser — wrap as tools

These are AgentCore *services your agent calls*, so they're just tools. Keep the
tool vendor-neutral and let the backend swap:

```ts
import { defineTool } from 'agentfootprint';

const codeInterpreter = defineTool({
  name: 'code_interpreter',
  description: 'Run Python in a sandbox; returns stdout/stderr.',
  // input schema …
  execute: async ({ code }) => {
    // call AgentCore Code Interpreter via @aws-sdk/client-bedrock-agentcore;
    // or E2B / a local Docker sandbox — the agent + prompt never change.
    return runInSandbox(code);
  },
});
```

The same shape wraps **Browser** (managed headless browser). If you later need a
second backend (E2B, Browserbase, local), lift the body behind a small
`SandboxBackend` / `BrowserBackend` interface — but don't build that until a
second backend has real pull.

---

## Policy & Evaluations

- **Policy** (control agent actions) → agentfootprint's `gatedTools` /
  `PermissionPolicy` (`agentfootprint/security`) is your allow/deny layer.
- **Evaluations** (quality monitoring) → emit `$eval(name, score)` and use
  `QualityRecorder`; export the scores through the observability adapter.

---

## What's a gap (honest)

- AgentCore Memory **semantic `retrieve`** isn't surfaced (`get`/`put`/`list` are).
- Code Interpreter / Browser ship as **examples**, not first-class adapters.
- Policy / Evaluations map to agentfootprint primitives rather than a dedicated
  AgentCore Policy/Evaluations API binding.
