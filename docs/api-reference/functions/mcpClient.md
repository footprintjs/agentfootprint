[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mcpClient

# Function: mcpClient()

> **mcpClient**(`opts`): `Promise`\<[`McpClient`](/agentfootprint/api/generated/interfaces/McpClient.md)\>

Defined in: [agentfootprint/src/lib/mcp/mcpClient.ts:57](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/mcpClient.ts#L57)

Connect to an MCP server. Returns an `McpClient` that exposes the
server's tools as agentfootprint `Tool[]` and a `close()` to tear
down the transport.

## Parameters

### opts

[`McpClientOptions`](/agentfootprint/api/generated/interfaces/McpClientOptions.md)

## Returns

`Promise`\<[`McpClient`](/agentfootprint/api/generated/interfaces/McpClient.md)\>

## Throws

when `@modelcontextprotocol/sdk` is not installed (see
  error message for `npm install` hint), or when the transport
  fails to connect.
