[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / McpClientOptions

# Interface: McpClientOptions

Defined in: [src/lib/mcp/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/mcp/types.ts#L61)

## Properties

### clientInfo?

> `readonly` `optional` **clientInfo?**: `object`

Defined in: [src/lib/mcp/types.ts:77](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/mcp/types.ts#L77)

Optional client identity sent on connect. Default:
`{ name: 'agentfootprint', version: <package version> }`.

#### name

> `readonly` **name**: `string`

#### version

> `readonly` **version**: `string`

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/lib/mcp/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/mcp/types.ts#L68)

Logical name for observability + tool-call routing. Surfaces in
Lens chips and event payloads. Defaults to `'mcp'`. Recommend
setting per-server (`'slack-mcp'`, `'github-mcp'`) when you
connect to multiple servers.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/lib/mcp/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/mcp/types.ts#L80)

Abort the connection / list / call paths. Honored by the SDK.

***

### transport

> `readonly` **transport**: [`McpTransport`](/agentfootprint/api/generated/type-aliases/McpTransport.md)

Defined in: [src/lib/mcp/types.ts:71](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/mcp/types.ts#L71)

Transport configuration — stdio or http.
