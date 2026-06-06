[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MockMcpClientOptions

# Interface: MockMcpClientOptions

Defined in: [src/lib/mcp/mockMcpClient.ts:57](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/mockMcpClient.ts#L57)

## Properties

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/lib/mcp/mockMcpClient.ts:59](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/mockMcpClient.ts#L59)

Logical server name. Surfaces in observability + error messages.

***

### tools

> `readonly` **tools**: readonly [`MockMcpTool`](/agentfootprint/api/generated/interfaces/MockMcpTool.md)[]

Defined in: [src/lib/mcp/mockMcpClient.ts:61](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/lib/mcp/mockMcpClient.ts#L61)

Tools exposed by the mock server.
