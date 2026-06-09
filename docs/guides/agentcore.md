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
Identity vends the token. agentfootprint exposes a `CredentialProvider` port
(`agentfootprint/identity`); a tool asks it for a token and uses it locally:

```ts
import { defineTool } from 'agentfootprint';
import { agentCoreIdentity } from 'agentfootprint/identity'; // or staticTokens({...}) for dev

const credentials = agentCoreIdentity({ region: 'us-east-1' });

const listRepos = defineTool({
  name: 'list_repos',
  description: "List the user's GitHub repos.",
  inputSchema: { type: 'object', properties: {} },
  execute: async () => {
    const cred = await credentials.getCredential({ service: 'github', mode: 'user', scopes: ['repo'] });
    if (cred.status === 'authorization-required') {
      // 3LO consent: surface cred.authorizationUrl to the user — e.g. pause the
      // run via pause/resume — then retry after they authorize.
      return `Please authorize: ${cred.authorizationUrl}`;
    }
    return callGitHub({ headers: cred.credential.toHeaders() }); // used locally (universal applicator)
  },
});
```

- **2LO** (`mode:'machine'`) → token returned inline.
- **3LO** (`mode:'user'`) → may return `authorization-required` with a consent
  URL; surface it to the user (pause/resume fits naturally), then retry. AgentCore
  caches refresh tokens, so consent usually happens once.
- **🔒 Secrets never enter the trace.** Use the token **locally** inside `execute`
  (as a header); **never** write it to tracked scope (`setValue`) — tracked writes
  flow to the commit log / recorders / observability export. Pair with
  `RedactionPolicy` for defence in depth. ([`examples/features/17-identity.ts`](../../examples/features/17-identity.ts)
  asserts the vended token never reaches the snapshot.)
- Dev/test without AWS: `staticTokens({ github: '...' })`.

> A first-class credential *subflow* + `scope.$getCredential(...)` sugar (so 3LO
> consent auto-pauses the run) is a planned follow-up — the port + adapters above
> are the stable foundation.

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
