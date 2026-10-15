**Support** — reaching hosted MCP servers on a vendor's platform.

## What it reads / what it writes
Reads connection configuration and per-request credentials; returns the remote
catalog to `src/mcp/`. No scope, no sentence.

## The one law here
Vendor shape stops here; the tool declarations it produces are data the tool
list (a Lens) may later narrow. Every adapter hands `mcpClient` an existing
`McpTransport` member — `mcpClient` never special-cases a vendor.

## MCP servers hosted on AgentCore Runtime
A Gateway is a catalogue of tools; a server deployed TO AgentCore Runtime is
reached differently: through `InvokeAgentRuntime`, inside a runtime session the
client must carry, and with a "session operation in progress" refusal that
arrives as an HTTP 200 JSON-RPC error no MCP client retries.
`agentCoreRuntimeMcpTransport` handles all three as strategies (retry, session,
auth) inside an ordinary `http` transport. Rules and example:
[`agentcoreRuntime/README.md`](agentcoreRuntime/README.md).

```ts
const orders = await mcpClient({
  name: 'orders',
  transport: agentCoreRuntimeMcpTransport({ agentRuntimeArn, region: 'us-west-2' }),
});
```

## Files
- `agentcore.ts` — one gateway, one file.
- `agentcoreRuntime/` — one Runtime-hosted MCP server: the facade, and one file
  per strategy.
