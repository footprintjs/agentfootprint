[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / ToolsDiscoveryFailedPayload

# Interface: ToolsDiscoveryFailedPayload

Defined in: [src/events/payloads.ts:384](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L384)

Emitted when a custom `ToolProvider.list(ctx)` throws or rejects.
The iteration is aborted; a configured `reliability` rule decides
whether to retry, fall back, or fail-fast. `providerId` lets
consumers route alerts to the right hub adapter (rube / mcp /
custom-discovery). `durationMs` measures how long the failed call
spent before throwing, so timeouts vs immediate rejections are
distinguishable.

## Properties

### durationMs

> `readonly` **durationMs**: `number`

Defined in: [src/events/payloads.ts:389](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L389)

***

### error

> `readonly` **error**: `string`

Defined in: [src/events/payloads.ts:386](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L386)

***

### errorName

> `readonly` **errorName**: `string`

Defined in: [src/events/payloads.ts:387](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L387)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:388](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L388)

***

### providerId

> `readonly` **providerId**: `string` \| `undefined`

Defined in: [src/events/payloads.ts:385](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L385)
