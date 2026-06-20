---
title: ToolsDiscoveryFailedPayload
---

# Interface: ToolsDiscoveryFailedPayload

Defined in: [src/events/payloads.ts:426](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L426)

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

Defined in: [src/events/payloads.ts:431](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L431)

***

### error

> `readonly` **error**: `string`

Defined in: [src/events/payloads.ts:428](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L428)

***

### errorName

> `readonly` **errorName**: `string`

Defined in: [src/events/payloads.ts:429](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L429)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:430](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L430)

***

### providerId

> `readonly` **providerId**: `string` \| `undefined`

Defined in: [src/events/payloads.ts:427](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L427)
