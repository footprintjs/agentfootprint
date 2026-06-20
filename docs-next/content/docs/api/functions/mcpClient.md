---
title: mcpClient
---

# Function: mcpClient()

> **mcpClient**(`opts`): `Promise`\<[`McpClient`](/docs/api/interfaces/McpClient)\>

Defined in: [src/lib/mcp/mcpClient.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/mcp/mcpClient.ts#L58)

Connect to an MCP server. Returns an `McpClient` that exposes the
server's tools as agentfootprint `Tool[]` and a `close()` to tear
down the transport.

## Parameters

### opts

[`McpClientOptions`](/docs/api/interfaces/McpClientOptions)

## Returns

`Promise`\<[`McpClient`](/docs/api/interfaces/McpClient)\>

## Throws

when `@modelcontextprotocol/sdk` is not installed (see
  error message for `npm install` hint), or when the transport
  fails to connect.
