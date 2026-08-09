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
import { agentCoreRuntimeHost, agentCoreSessions } from 'agentfootprint/hosting';

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
beside `server`, because a server you own already has an address. One more, if
a framework sits in front: a catch-all handler (Fastify, Express) answers before
the attached host ever sees the request, so register the framework's routes as a
delegation to the host.

### …and when all you wanted was a route of your own

Binding the socket yourself is a lot of ceremony for one diagnostic endpoint.
Since 7.27.0 the inverse option exists: the host binds the port as usual and
hands you every path it does **not** own.

```ts
nodeHost({ port: 8080, onUnhandled: (req, res) => myRoutes(req, res) })
```

```bash
npx tsx examples/deploy/own-routes.ts
```

[`own-routes.ts`](./own-routes.ts) serves the agent, the conversation door and a
`/debug/trace` of its own on one port with no server to create — and breaks a
route on purpose to show the cost: that request gets a 500, the agent beside it
does not notice. The host's own paths never reach your hook (a wrong method on
one of them included), and it is refused beside `{ server }`, where unmatched
paths already reach your own listeners.

## When the caller cannot be called — the conversation door

Some callers cannot host an inbound endpoint at all. A browser dials out and
parks a connection that the agent pushes work down; `HostRequest → HostReply`
has no way to say that, because it is one exchange and this is a conversation.

Since 7.25.0 a host that can carry one says so (`'conversation'` in
`capabilities`) and opens it beside `serve()`:

```ts
const host = nodeHost({ port: 8080 });                   // or agentCoreRuntimeHost()
await standingAgent({ agent, sessions, host });          // /invoke
await host.serveConversations((conversation) => {        // /conversation (or /ws)
  conversation.onFrame((frame) => conversation.send(answer(frame)));
  conversation.onClose((why) => log(why.by, why.reason));
});
```

**Both doors share one socket** — which is the point, since the runtimes that
need a conversation are the ones that hand a container exactly one port. On
`agentCoreRuntimeHost` the door is `/ws`, the session id is readable from the
runtime's header *or* the query string (a browser cannot set a header on a
WebSocket), and a `Sec-WebSocket-Protocol` bearer arrives in your handler as an
ordinary `authorization` header. Its ceilings are **declared**:
`{ maxFrameBytes: 32768, idleMs: 900000 }` — read them and chunk or heartbeat on
your own protocol, because the port does neither for you.

```bash
npx tsx examples/deploy/echo-conversation.ts
```

[`echo-conversation.ts`](./echo-conversation.ts) holds a real WebSocket
conversation with itself on the same socket that answers `/invoke`, and shows
the two refusals you will meet: a frame past the declared ceiling
(`FrameTooLargeError`) and a send down a channel that has ended
(`ConversationClosedError`). Neither is silent, on purpose.

## What plugs into the rest of AgentCore

Once your agent runs in the container, the other AgentCore primitives attach
through agentfootprint adapters — see the
[AgentCore integration guide](../../docs/guides/agentcore.md):

- **Memory** → `AgentCoreStore` (`agentfootprint/memory`)
- **Observability** → `agentcoreObservability` (`agentfootprint/observe`)
- **Gateway tools** → `gatewayTransport()` + `mcpClient()` (`agentfootprint/providers`)
- **Identity** (downstream OAuth) → `agentCoreIdentity()` (`agentfootprint/security`)
- **Policy** → nothing to attach. AgentCore enforces policy **at the Gateway**,
  in front of the tool; a denial arrives as an MCP error on the tool call and
  lands in the loop as that tool's result. (`agentCorePolicy()` is retired in
  9.4.0 — it dispatched a command AgentCore does not have. For rules you own,
  use `PermissionPolicy.fromRoles(...)` or `.toolMiddleware()`.)

## A note on verification

The host is plain HTTP with no AWS SDK on its path, so its conformance-suite
result is real verification. Everything that calls an AWS SDK — the `'memory'`
session store, `AgentCoreStore.search()` — is **contract-mapped and
injection-tested**: exercised through the adapters' `_client` / `_sdk` seams,
never against AWS.

Since 9.4.0 the command NAMES are no longer only contract-mapped: one registry
(`test/adapters/aws/`) pins the SDK command constructors every AWS adapter
dispatches, and fails the build for a command the installed SDK does not
export. That check exists because contract-mapping alone let two adapters ship
calls that were never made against AWS — one of them a command that does not
exist at all.

## See also — the same agent, no cloud

[`standing-agent.ts`](./standing-agent.ts) is the identical composition on
`nodeHost` + `memorySessions`. The agent code between them is byte-identical;
only the two adapters differ. That is the whole point of the ports.
