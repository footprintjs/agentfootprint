# Deploy an agentfootprint agent on AWS Bedrock AgentCore Runtime

AgentCore Runtime is a **container contract**: package your agent as an ARM64
image that serves the runtime's HTTP protocol on `0.0.0.0:8080`.

| Endpoint | Contract |
|---|---|
| `POST /invocations` | JSON `{ "prompt": "..." }` in → JSON `{ "response", "status" }` (or SSE) out |
| `GET /ping` | `{ "status": "Healthy" \| "HealthyBusy", "time_of_last_update": <unix> }` |
| Session | `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header |

Since 7.15.0 you do not write that yourself. `agentCoreRuntimeHost()` **is** the
contract, as an adapter on the `AgentHost` port:

```ts
import { standingAgent } from 'agentfootprint/hosting';
import { agentCoreRuntimeHost, agentCoreSessions } from 'agentfootprint/hosting-providers';

const handle = await standingAgent({
  agent,
  host: agentCoreRuntimeHost(),                              // 0.0.0.0:8080
  sessions: agentCoreSessions({ store: 'session-storage' }), // survives a stop/resume
});
process.on('SIGTERM', () => void handle.close());
```

[`agentcore-runtime.ts`](./agentcore-runtime.ts) is that entry point **and** its
own integration test:

```bash
# drive the real /invocations + /ping contract locally (two turns, one session), then exit:
npx tsx examples/deploy/agentcore-runtime.ts

# listen forever (what the container does):
AGENTCORE_SERVE=1 npx tsx examples/deploy/agentcore-runtime.ts
```

It passes the same host conformance suite as `nodeHost`, over a real socket —
see `test/hosting/host-contract.test.ts`.

## Make it real

1. Swap `buildAgent()`'s `mock()` for a real provider — `providerFromEnv()` picks
   Bedrock/Anthropic/Azure from the environment, so the model runs on AgentCore's
   own infra. Nothing else changes.
2. (Optional) Stream: send `Accept: text/event-stream` and the same handler
   produces Server-Sent Events instead of one JSON body. The caller chooses, not
   the server — `reply.emit(chunk)` in your handler is all it takes.
3. (Optional) Outlive the session: swap the store for
   `agentCoreSessions({ store: 'memory', memoryId, region })`, which writes one
   AgentCore Memory event per turn.
4. Build for ARM64 and push (see [`Dockerfile`](./Dockerfile)):
   ```bash
   docker buildx build --platform linux/arm64 -t <ecr-uri>:latest --push .
   aws bedrock-agentcore-control create-agent-runtime \
     --agent-runtime-name my-agent --container-uri <ecr-uri>:latest --network-mode PUBLIC
   ```
5. Invoke: `aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn <arn> --payload '{"prompt":"..."}'`.

## When the container has one port

A runtime that gives your container a single port makes "serve the agent" and
"serve a WebSocket upgrade" compete for it. Since 7.22.0 they don't have to:
create the `node:http` server yourself, add your `'upgrade'` listener, listen,
and hand the server to the host — `agentCoreRuntimeHost({ server })` (or
`nodeHost({ server })`) attaches its routes instead of binding a socket.

```bash
npx tsx examples/deploy/one-port.ts
```

[`one-port.ts`](./one-port.ts) proves all of it in one run: the agent answers,
your own `/metrics` route answers, a raw upgrade handshake echoes beside them,
and after `handle.close()` the socket is still listening with your routes and
your upgrade intact. Two rules to carry into a real deployment: a path the host
does not own is **yours** — it will never write a 404 on your server, so an
unrouted path hangs rather than 404s — and `port` / `hostname` are refused
beside `server`, because a server you own already has an address.

## What plugs into the rest of AgentCore

Once your agent runs in the container, the other AgentCore primitives attach
through agentfootprint adapters — see the
[AgentCore integration guide](../../docs/guides/agentcore.md):

- **Memory** → `AgentCoreStore` (`agentfootprint/memory-providers`)
- **Observability** → `agentcoreObservability` (`agentfootprint/observability-providers`)
- **Gateway tools** → `gatewayTransport()` + `mcpClient()` (`agentfootprint/tool-providers`)
- **Identity** (downstream OAuth) → `agentCoreIdentity()` (`agentfootprint/identity`)
- **Policy** (authorize each tool call) → `agentCorePolicy()` (`agentfootprint/security`)

## A note on verification

The host is plain HTTP with no AWS SDK on its path, so its conformance-suite
result is real verification. Everything that calls an AWS SDK — the `'memory'`
session store, `agentCorePolicy`, `AgentCoreStore.search()` — is
**contract-mapped and injection-tested**: exercised through the adapters'
`_client` / `_sdk` seams, never against AWS. Confirm command and field names
against your installed `@aws-sdk/client-bedrock-agentcore`; real-cloud
verification lands with a field deployment.

## See also — the same agent, no cloud

[`standing-agent.ts`](./standing-agent.ts) is the identical composition on
`nodeHost` + `memorySessions`. The agent code between them is byte-identical;
only the two adapters differ. That is the whole point of the ports.
