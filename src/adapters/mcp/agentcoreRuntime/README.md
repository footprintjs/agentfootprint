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

// The default session strategy, 'per-call', is safe to share: build it once.
const orders = await mcpClient({
  name: 'orders',
  transport: agentCoreRuntimeMcpTransport({
    agentRuntimeArn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3',
    region: 'us-west-2',
    // auth: 'sigv4'                       (default — IAM, through the AWS SDK)
    // auth: { bearer: agentCoreIdentity({ region: 'us-west-2' }), service: 'my-runtime-oauth' }
    //                                     (OAuth inbound auth; `service` = your OAuth2 provider)
    // session: 'reuse'                    (one runtime session per CLIENT — build a
    //                                     client per conversation, never share it)
    retry: { onRetry: ({ attempt, waitMs }) => log.info({ attempt, waitMs }, 'runtime session busy') },
  }),
});
const agent = Agent.create({ provider, model }).tools(await orders.tools()).build();
```

## What it reads / what it writes
Reads the MCP client's requests and the runtime's replies. Under `'reuse'`,
holds each client's connection — its runtime session id and the server's own
session id — under a handle the transport issued (at most 256, least recently
used forgotten first; a client's `DELETE` forgets its own). Writes nothing to a run: no scope, no event, no
sentence. A vended bearer token is used for one request and dropped.

## The rules here
1. **One port, three strategies.** `transport.ts` returns an `http` member of
   `McpTransport`; `mcpClient` never learns this is AgentCore. The choices are
   strategies, one file each, composed outermost first: session
   (`session.ts`) → retry (`sessionBusy.ts`) → auth (`invoke.ts` for SigV4,
   the shared vending fetch for a bearer). The session is applied once per
   request, so every attempt of it lands in the same runtime session; every
   attempt is signed or vended afresh.
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
4. **`'per-call'` is the default — isolation by construction.** It sends a
   fresh runtime session id of its own with every request (as fresh as the
   SDK's default, but one the transport knows, so it can be scrubbed) and no
   `Mcp-Session-Id`, and hides the `Mcp-Session-Id` the platform returns, so nothing carries over and one client built at startup can serve
   every user of a process. It needs a stateless server (the runtime's
   recommended default). **`'reuse'` keeps one session per CLIENT, keyed by
   the transport:** a request with no `Mcp-Session-Id` (a client's
   `initialize`) opens a connection with a fresh runtime id; the server's
   `Mcp-Session-Id` is stored with it and the client is handed a random handle
   in its place, which every later request is translated back from. A server
   that numbers sessions per process (every fresh microVM says `s-1`) cannot
   put two clients in one session, and a handle the transport does not know is
   answered 404 "Session not found" here, unsent. One client is one session
   for whoever calls through it — build a client per conversation.
5. **Only the session-busy refusal is retried — and only here.** `sessionBusy`
   matches ONE JSON-RPC reply with code `-32005` AND the "session operation in
   progress" message (`ConflictException` shares the code and is not
   retryable), or the API's 409 whose `x-amzn-errortype` is
   `RetryableConflictException`. Not a batch, not SSE, not `-32003` (throttling
   also arrives as an HTTP 200 JSON-RPC error; the contract does not call it
   retryable, so it is delivered). The loop is `mcp/throttleRetry.ts` ·
   `retryingFetchWhen` — the 429 loop, with this one decision passed in.
   Default: 5 attempts, ≤10 s of waiting. A 429 is left to `mcpClient`'s own
   throttle retry, which wraps this transport like any other.
6. **The SDK's own retry is off.** The client `invoke.ts` builds has
   `maxAttempts: 1`: the SDK's standard policy re-sends after a 5xx or a dropped
   connection — a `tools/call` that may have run, in the same pinned session.
   A non-2xx service exception is handed on as the `Response` it was (status,
   `x-amzn-errortype`, `retry-after`); a failure with no status is thrown once.
   A `client` the caller passes keeps its own policy — build it with
   `maxAttempts: 1`.
7. **POST only on the SDK path.** A GET (server-message stream) or DELETE (end a
   session) has no `InvokeAgentRuntime` form; it is answered 405 locally, which
   the MCP Streamable HTTP spec defines as "not offered" for both.
8. **An auth failure says what failed, never how.** A 401, a 403 or an AWS
   auth error type (`authFailure.ts`) keeps its status and `x-amzn-errortype`,
   and its body becomes `"<type> (HTTP <status>) …"`: AWS can quote the signed
   request back — the session token and both session ids among it — and the
   MCP client's error text reaches the model, the history and `tool_end`. The
   hosted server's own JSON-RPC error is kept whole. Both auth strategies.
9. **No user-delegated bearer.** `auth.mode` must be `'machine'`: the vending
   request names no user, so a `'user'` token would be sent for whoever calls
   through the client. For a token per user, build a transport per user whose
   provider vends that user's token.
10. **A failure never repeats what the request carried.** Any non-2xx body,
   and the error of a 2xx JSON-RPC error reply (inside its strings, so it stays
   valid JSON; a `result` is never touched), has every session id and credential
   header value this request sent replaced (`echo.ts`; on the bearer path
   every header but a short list of non-secret ones, so an `x-api-key` or a
   DPoP proof is covered too): AWS validation errors quote the value they
   refused, the runtime sends some platform errors as a 200 JSON-RPC error,
   and the body becomes the model's tool error. Any other 2xx answer, a stream
   included, is handed on unread.

## Files
- `transport.ts` — the facade: options, the endpoint URL, the composition.
- `sessionBusy.ts` — the retry decision (one function).
- `session.ts` — `'per-call'` (default) and `'reuse'`.
- `authFailure.ts` — an auth failure answered with its type and status only.
- `echo.ts` — a failure body never repeats a session id or credential the request sent.
- `errorType.ts` — the bare `x-amzn-errortype` name.
- `invoke.ts` — the SigV4 strategy over `InvokeAgentRuntimeCommand` (the only
  file that loads `@aws-sdk/client-bedrock-agentcore`).
