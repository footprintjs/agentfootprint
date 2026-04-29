[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mockMcpClient

# Function: mockMcpClient()

> **mockMcpClient**(`options`): [`McpClient`](/agentfootprint/api/generated/interfaces/McpClient.md)

Defined in: [agentfootprint/src/lib/mcp/mockMcpClient.ts:70](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/mockMcpClient.ts#L70)

Build an in-memory `McpClient`. Useful when you want to develop
against MCP semantics without spawning subprocesses, hitting the
network, or installing `@modelcontextprotocol/sdk`. Same `McpClient`
shape as `mcpClient(opts)` — code that consumes one accepts the other.

## Parameters

### options

[`MockMcpClientOptions`](/agentfootprint/api/generated/interfaces/MockMcpClientOptions.md)

## Returns

[`McpClient`](/agentfootprint/api/generated/interfaces/McpClient.md)
