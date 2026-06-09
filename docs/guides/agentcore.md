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
| **Identity** (downstream OAuth) | ✅ adapter | `agentCoreIdentity()` + the credential subflow — `agentfootprint/identity` |
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
Identity vends the token. agentfootprint models this as a `CredentialProvider`
port + an observable **credential subflow** that pauses for 3-legged consent:

```ts
import { agentCoreIdentity } from 'agentfootprint/identity';

const credentials = agentCoreIdentity({ region: 'us-east-1' });
const agent = Agent.create({ provider, model, credentials }).build();

// inside a tool: ask for a token; machine-to-machine (2LO) returns directly,
// user-delegated (3LO) pauses the run with a consent URL, resumes after consent.
const token = await scope.$getCredential({ service: 'github', mode: 'user', scopes: ['repo'] });
```

- **2LO** (`mode:'machine'`) → token returned inline.
- **3LO** (`mode:'user'`) → if consent is needed, the run **pauses** with an
  `authorizationUrl` (the existing pause/resume + checkpoint); after the user
  authorizes, `resume()` continues and the token is retrieved (AgentCore caches
  refresh tokens, so this usually happens once).
- **Secrets never enter tracked memory** — vended tokens bypass the commit log /
  recorders / observability export and are redaction-protected, so they can't leak
  into a trace.

See the credential subflow in the trace as `sf-credential`. Dev/test without AWS:
`staticTokens({ github: '...' })`.

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
