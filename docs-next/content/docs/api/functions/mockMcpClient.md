---
title: mockMcpClient
---

# Function: mockMcpClient()

> **mockMcpClient**(`options`): [`McpClient`](/docs/api/interfaces/McpClient)

Defined in: [src/lib/mcp/mockMcpClient.ts:70](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/mcp/mockMcpClient.ts#L70)

Build an in-memory `McpClient`. Useful when you want to develop
against MCP semantics without spawning subprocesses, hitting the
network, or installing `@modelcontextprotocol/sdk`. Same `McpClient`
shape as `mcpClient(opts)` — code that consumes one accepts the other.

## Parameters

### options

[`MockMcpClientOptions`](/docs/api/interfaces/MockMcpClientOptions)

## Returns

[`McpClient`](/docs/api/interfaces/McpClient)
