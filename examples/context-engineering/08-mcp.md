---
name: MCP — Model Context Protocol client
group: context-engineering
guide: ../../src/lib/mcp/
defaultInput: List files in /tmp
---

# MCP — Model Context Protocol client

Connect to an [MCP](https://modelcontextprotocol.io) server, register its tools on your Agent. The MCP ecosystem keeps growing — there are servers for filesystems, databases, GitHub, Slack, Notion, etc. — and now any of them work with `agent.tools(...)` in two lines.

## What MCP is

MCP is Anthropic's open standard for connecting LLMs to external tools, data sources, and applications. An MCP server **exposes** tools over a transport (stdio for local subprocesses, Streamable HTTP for remote). An MCP client **consumes** those tools and translates them into the host's native tool format.

agentfootprint's `mcpClient` is the client side. The server side (exposing your agent as an MCP tool to OTHER LLMs) is a separate concern, not yet shipped.

## Anatomy

```typescript
import { Agent, mcpClient } from 'agentfootprint';

// Connect once at startup
const slack = await mcpClient({
  name: 'slack',
  transport: {
    transport: 'stdio',
    command: 'npx',
    args: ['@example/slack-mcp'],
  },
});

// Pull all tools from the server
const tools = await slack.tools();

// Register on the agent in one call
const agent = Agent.create({ provider })
  .tools(tools)
  .build();

await agent.run({ message: 'Send "deploy succeeded" to #alerts' });

// Close transport on shutdown
await slack.close();
```

## Transports

```typescript
// stdio — local subprocess
{ transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'], env?: {...}, cwd?: '...' }

// Streamable HTTP — remote server
{ transport: 'http', url: 'https://mcp.example.com/v1', headers?: { Authorization: 'Bearer ...' } }
```

## Lazy peer dep

`@modelcontextprotocol/sdk` is **not** in `dependencies` or `peerDependencies`. It's lazy-required: the `require()` call only fires when a consumer actually constructs a client. Apps that don't use MCP have zero runtime cost.

If the SDK is missing when you call `mcpClient(...)`, you get a friendly install hint:

```
mcpClient requires @modelcontextprotocol/sdk.
  Install:  npm install @modelcontextprotocol/sdk
```

## Agent.tools(...) — the convenience method

`agent.tool(t)` registers one tool. `agent.tools(arr)` registers many. Pair the latter with `await mcpClient(...).tools()` for the most common MCP flow.

```typescript
agent
  .tools(await slack.tools())
  .tools(await github.tools())
  .tools(await db.tools())
  .build();
```

Tool name uniqueness is still validated at `.build()` time across all sources — manual `.tool()` calls AND every MCP server's tool list. Duplicates throw early.

## Lifecycle

```typescript
const client = await mcpClient({...});
await client.tools();      // first call — fetches from server, caches
await client.tools();      // cached — no roundtrip
await client.refresh();    // forces re-fetch (server tools changed)
await client.close();      // tears down the transport
```

## When `mcpClient` vs `defineTool`

| Use `mcpClient` when... | Use `defineTool` when... |
|---|---|
| The tool exists in someone else's MCP server | The tool is your own code |
| You want to integrate Slack / GitHub / Notion / ... | You're building application-specific tools |
| Tool inventory may change (server-side updates) | Tool list is static / version-controlled |
| You want one connection × many tools | You're defining single-purpose helpers |

Both produce the same `Tool` interface. The agent doesn't know — and doesn't care — where its tools came from.

## Compliance & auth

Auth flows through the transport headers (`http`) or env vars (`stdio` subprocess). agentfootprint doesn't see the credentials — they're set at the transport layer. Apply your existing secret-management workflow (Vault, AWS Secrets, Doppler, ...).

## Related

- **[Tools](../core/02-agent-with-tools.md)** — `defineTool`, the inline alternative
- **[Skills](./02-skill.md)** — LLM-activated body + tools (different intent: skills are *behavior*, MCP tools are *capability sources*)
- **[RAG](./07-rag.md)** — retrieval as a different kind of "external data" integration
