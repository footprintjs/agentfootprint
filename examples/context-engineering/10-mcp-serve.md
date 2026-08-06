---
name: MCP — serve your tools to other clients
group: context-engineering
guide: ../../src/lib/mcp/
defaultInput: lookup order 5512
---

# MCP — serve your tools to other clients

`mcpClient` pulls someone else's tools **in**. `mcpServe` pushes yours **out** — so the tool you already wrote, tested and governed can be called by any MCP client: a desktop host, another team's agent, an IDE.

## Anatomy

```typescript
import { mcpServe } from 'agentfootprint/providers';

const handle = await mcpServe([lookupOrder, refundOrder], {
  name: 'support-desk',
  version: '1.0.0',
});

process.on('SIGINT', () => void handle.close());
```

That is a live MCP server. `handle.toolNames` lists what it advertises; `handle.close()` stops it and is idempotent.

## Serving is the same door, not a second one

A served tool is **the object you passed in**. `mcpServe` holds your `Tool` by reference and calls `tool.execute(args, ctx)` — it never copies the schema and re-implements the body, never unwraps a decorator. So a permission check inside `execute` is still what runs when a remote client calls it. Serving is not a back door; it is the same door with a longer corridor.

## What it refuses at construction

| Declared | Refused because |
|---|---|
| `checkIn` | It asks a human to approve the call before it runs. MCP is request/response — there is no pause to carry that ask, so serving it would drop the consent gate silently. |
| `needs` without `credentials` | The tool would run with `ctx.credential` undefined. Pass `mcpServe(tools, { credentials })` and it is resolved before `execute`, fail-closed. |

Duplicate names and an empty tool list are refused too.

## A hostile client cannot take the loop down

Unknown tool names, `null`/numeric/array arguments, and tools that throw all come back as `isError: true` results. The server answers the next call normally. Args are forwarded verbatim — a second, weaker copy of the tool's own contract is not validation.

## Transports

```typescript
{ transport: 'stdio' }                                    // default; stdout belongs to the protocol
{ transport: 'http', port: 8931, path: '/mcp' }           // Streamable HTTP, stateless
```

`@modelcontextprotocol/sdk` is a lazy peer dependency — the `require()` only fires when you call `mcpServe`.

## Related

- **[MCP client](./08-mcp.md)** — the other direction
- **[Tools](../core/02-agent-with-tools.md)** — `defineTool`, the primitive being served
