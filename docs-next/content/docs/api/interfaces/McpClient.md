---
title: McpClient
---

# Interface: McpClient

Defined in: [src/lib/mcp/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/mcp/types.ts#L96)

What `mcpClient(opts)` returns. Connect once; call `.tools()` to
snapshot the tool list, `.refresh()` to re-list after the server's
tools change, `.close()` when done.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/lib/mcp/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/mcp/types.ts#L98)

Logical name from options (or default `'mcp'`).

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [src/lib/mcp/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/mcp/types.ts#L116)

Close the underlying transport. After `close()` the client is unusable.

#### Returns

`Promise`\<`void`\>

***

### refresh()

> **refresh**(): `Promise`\<readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]\>

Defined in: [src/lib/mcp/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/mcp/types.ts#L113)

Force a refresh from the server. Use when you suspect the server
has dynamically added/removed tools mid-session (e.g., after the
server processes a config update).

#### Returns

`Promise`\<readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]\>

***

### tools()

> **tools**(): `Promise`\<readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]\>

Defined in: [src/lib/mcp/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/mcp/types.ts#L106)

List the server's tools as agentfootprint `Tool[]`. First call
after `mcpClient(...)` is the snapshot used to register on the
agent; subsequent calls re-fetch (cheap, in-memory cached by the
SDK between fetches).

#### Returns

`Promise`\<readonly [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\>[]\>
