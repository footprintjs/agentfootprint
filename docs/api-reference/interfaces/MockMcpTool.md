[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MockMcpTool

# Interface: MockMcpTool

Defined in: [src/lib/mcp/mockMcpClient.ts:36](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/mockMcpClient.ts#L36)

A scripted tool exposed by the mock MCP server.

## Properties

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/lib/mcp/mockMcpClient.ts:40](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/mockMcpClient.ts#L40)

Description surfaced to the LLM via the tool schema.

***

### handler?

> `readonly` `optional` **handler?**: (`args`) => `Promise`\<`string`\>

Defined in: [src/lib/mcp/mockMcpClient.ts:54](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/mockMcpClient.ts#L54)

Async handler that runs when the agent calls this tool. Receives
the args the LLM produced; returns the string result the agent
sees as the tool-result message.

Defaults to `async () => '[mock result]'` when omitted — useful
when the consumer cares about wiring not behavior.

#### Parameters

##### args

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`string`\>

***

### inputSchema

> `readonly` **inputSchema**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/lib/mcp/mockMcpClient.ts:45](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/mockMcpClient.ts#L45)

JSON-schema-like input schema. Passed through to the agent's tool
registry verbatim — same as a real MCP server's `listTools()`.

***

### name

> `readonly` **name**: `string`

Defined in: [src/lib/mcp/mockMcpClient.ts:38](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/mockMcpClient.ts#L38)

Tool name as the LLM sees it.
