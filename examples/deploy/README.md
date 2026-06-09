# Deploy an agentfootprint agent on AWS Bedrock AgentCore Runtime

AgentCore Runtime is a **container contract**, not an adapter: package your agent
as an ARM64 image that serves the runtime's HTTP protocol on `0.0.0.0:8080`.

| Endpoint | Contract |
|---|---|
| `POST /invocations` | JSON `{ "prompt": "..." }` in → JSON `{ "response", "status" }` (or SSE) out |
| `GET /ping` | `{ "status": "Healthy" \| "HealthyBusy", "time_of_last_update": <unix> }` |

[`agentcore-runtime.ts`](./agentcore-runtime.ts) is the reference handler **and** its
own integration test:

```bash
# self-test the /invocations + /ping contract locally, then exit:
npx tsx examples/deploy/agentcore-runtime.ts

# listen forever (what the container does):
AGENTCORE_SERVE=1 npx tsx examples/deploy/agentcore-runtime.ts
```

## Make it real

1. Swap `buildAgent()`'s `mock()` for a real provider — `providerFromEnv()` picks
   Bedrock/Anthropic/Azure from the environment, so the model runs on AgentCore's
   own infra. Nothing else in the handler changes.
2. (Optional) Stream: the contract also accepts `Content-Type: text/event-stream`
   — emit `data: {...}` chunks from `/invocations` using `agentfootprint/stream`
   for incremental output.
3. Build for ARM64 and push (see [`Dockerfile`](./Dockerfile)):
   ```bash
   docker buildx build --platform linux/arm64 -t <ecr-uri>:latest --push .
   aws bedrock-agentcore-control create-agent-runtime \
     --agent-runtime-name my-agent --container-uri <ecr-uri>:latest --network-mode PUBLIC
   ```
4. Invoke: `aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn <arn> --payload '{"prompt":"..."}'`.

## What plugs into the rest of AgentCore

Once your agent runs in the container, the other AgentCore primitives attach
through agentfootprint adapters — see the
[AgentCore integration guide](../../docs/guides/agentcore.md):

- **Memory** → `AgentCoreStore` (`agentfootprint/memory-providers`)
- **Observability** → `agentcoreObservability` (`agentfootprint/observability-providers`)
- **Gateway tools** → the MCP tool path (`agentfootprint/tool-providers`)
- **Identity** (downstream OAuth) → `agentCoreIdentity()` (`agentfootprint/identity`)
