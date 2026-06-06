[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mcpClient

# Function: mcpClient()

> **mcpClient**(`opts`): `Promise`\<[`McpClient`](/agentfootprint/api/generated/interfaces/McpClient.md)\>

Defined in: [src/lib/mcp/mcpClient.ts:58](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/mcpClient.ts#L58)

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
