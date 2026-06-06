[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / McpHttpTransport

# Interface: McpHttpTransport

Defined in: [src/lib/mcp/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/types.ts#L49)

`http` transport — speaks MCP over Streamable HTTP. Best for remote
servers, web environments, and multi-user scenarios.

## Properties

### headers?

> `readonly` `optional` **headers?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/lib/mcp/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/types.ts#L54)

Optional auth headers (e.g., `Authorization: Bearer ...`).

***

### transport

> `readonly` **transport**: `"http"`

Defined in: [src/lib/mcp/types.ts:50](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/types.ts#L50)

***

### url

> `readonly` **url**: `string`

Defined in: [src/lib/mcp/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/lib/mcp/types.ts#L52)

MCP server endpoint URL.
