**Support** — an MCP server somebody deployed TO AWS Bedrock AgentCore Runtime
(`agentcore deploy` with `--protocol MCP`), reached as an ordinary MCP transport.

## Why it exists
A Runtime-hosted MCP server is not a plain URL. Every request goes through
`InvokeAgentRuntime`; it lands in a runtime SESSION that has to be carried from
call to call (or the next request may land on a new microVM); and while that
session is being set up, the platform answers with an HTTP **200** whose
JSON-RPC body says `-32005 "Session operation in progress, please retry"`. The
AgentCore docs say the caller must read the body and retry with short
exponential backoff, because MCP clients do not. Without this folder, that
refusal reaches the model as a failed tool call.

## Example
```ts
import { agentCoreRuntimeMcpTransport, mcpClient } from 'agentfootprint/providers';

// One client per conversation: 'reuse' keeps ONE runtime session per transport.
const orders = await mcpClient({
  name: 'orders',
  transport: agentCoreRuntimeMcpTransport({
    agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3',
    region: 'us-west-2',
    // auth: 'sigv4'                       (default — IAM, through the AWS SDK)
    // auth: { bearer: agentCoreIdentity({ region: 'us-west-2' }) }   (OAuth inbound auth)
    // session: 'per-call'                 (no session carried — a stateless server)
    retry: { onRetry: ({ attempt, waitMs }) => log.info({ attempt, waitMs }, 'runtime session busy') },
  }),
});
const agent = Agent.create({ provider, model }).tools(await orders.tools()).build();
```

## What it reads / what it writes
Reads the MCP client's requests and the runtime's replies. Holds one runtime
session id per `'reuse'` transport. Writes nothing to a run: no scope, no event,
no sentence. A vended bearer token is used for one request and dropped.

## The rules here
1. **One port, three strategies.** `transport.ts` returns an `http` member of
   `McpTransport`; `mcpClient` never learns this is AgentCore. The choices are
   strategies, one file each, composed outermost first: retry
   (`sessionBusy.ts`) → session (`session.ts`) → auth (`invoke.ts` for SigV4,
   the shared vending fetch for a bearer). Every retry re-applies the session
   and is signed or vended afresh.
2. **Every AWS name is the SDK's.** The SigV4 strategy maps HTTP onto
   `InvokeAgentRuntimeRequest` / `InvokeAgentRuntimeResponse` field for field:
   `payload`, `contentType`, `accept`, `mcpSessionId`, `mcpProtocolVersion`,
   `runtimeSessionId`, `agentRuntimeArn`, `qualifier`, `accountId`; back from
   `statusCode`, `contentType`, `mcpSessionId`, `mcpProtocolVersion`,
   `runtimeSessionId`, `response`. Pinned in `test/adapters/aws/awsCommandPin.ts`.
3. **Bearer goes over HTTPS.** The SDK's client has one auth scheme, SigV4. A
   runtime behind an OAuth authorizer is reached at
   `https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ARN}/invocations`
   with the token vended per request by the same code as `gatewayTransport`.
4. **`'reuse'` pins the runtime session.** The SDK fills a FRESH random
   `runtimeSessionId` on every call that leaves it unset; `'reuse'` chooses one
   per transport and sends it on every request, and the MCP client carries the
   `Mcp-Session-Id` the platform returns. One transport is one session: build a
   client per conversation. `'per-call'` sends neither id and hides the
   returned one, so nothing carries over; it needs a stateless server.
5. **Only the contract's refusal is retried.** `sessionBusy` matches ONE
   JSON-RPC reply with code `-32005` AND the "session operation in progress"
   message — `ConflictException` shares the code and is not retryable. Not a
   batch, not SSE, not another status, not `-32003` (throttling also arrives as
   an HTTP 200 JSON-RPC error; the contract does not call it retryable, so it is
   delivered). The SDK-thrown 409 `RetryableConflictException` is retried by the
   SDK itself (`$retryable`), so it is not retried again here. The loop is
   `mcp/throttleRetry.ts` · `retryingFetchWhen` — the 429 loop, with this one
   decision passed in. Default: 5 attempts, ≤10 s of waiting.
6. **POST only on the SDK path.** A GET (server-message stream) or DELETE (end a
   session) has no `InvokeAgentRuntime` form; it is answered 405 locally, which
   the MCP Streamable HTTP spec defines as "not offered" for both.

## Files
- `transport.ts` — the facade: options, the endpoint URL, the composition.
- `sessionBusy.ts` — the retry decision (one function).
- `session.ts` — `'reuse'` and `'per-call'`.
- `invoke.ts` — the SigV4 strategy over `InvokeAgentRuntimeCommand` (the only
  file that loads `@aws-sdk/client-bedrock-agentcore`).
