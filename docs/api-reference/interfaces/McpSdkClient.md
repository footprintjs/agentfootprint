[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / McpSdkClient

# Interface: McpSdkClient

Defined in: [agentfootprint/src/lib/mcp/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L130)

Minimal structural type capturing the parts of the MCP SDK client
we touch. Defined locally so we can:
  1. Inject a mock for tests (`McpClientOptions._client`)
  2. Avoid a hard import on `@modelcontextprotocol/sdk` (which is
     a lazy peer-dep)

The real SDK exports a richer surface; we narrow to what's needed.

## Methods

### callTool()

> **callTool**(`args`): `Promise`\<\{ `content`: readonly `object`[]; `isError?`: `boolean`; \}\>

Defined in: [agentfootprint/src/lib/mcp/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L139)

#### Parameters

##### args

###### arguments?

`Readonly`\<`Record`\<`string`, `unknown`\>\>

###### name

`string`

###### signal?

`AbortSignal`

Forwarded from `McpClientOptions.signal` so consumers can cancel hung tool calls.

#### Returns

`Promise`\<\{ `content`: readonly `object`[]; `isError?`: `boolean`; \}\>

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [agentfootprint/src/lib/mcp/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L151)

#### Returns

`Promise`\<`void`\>

***

### connect()

> **connect**(`transport`): `Promise`\<`void`\>

Defined in: [agentfootprint/src/lib/mcp/types.ts:131](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L131)

#### Parameters

##### transport

`unknown`

#### Returns

`Promise`\<`void`\>

***

### listTools()

> **listTools**(): `Promise`\<\{ `tools`: readonly `object`[]; \}\>

Defined in: [agentfootprint/src/lib/mcp/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/mcp/types.ts#L132)

#### Returns

`Promise`\<\{ `tools`: readonly `object`[]; \}\>
