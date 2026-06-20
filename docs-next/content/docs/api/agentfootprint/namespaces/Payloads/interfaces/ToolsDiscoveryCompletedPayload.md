---
title: ToolsDiscoveryCompletedPayload
---

# Interface: ToolsDiscoveryCompletedPayload

Defined in: [src/events/payloads.ts:410](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L410)

Emitted when `ToolProvider.list(ctx)` resolves successfully. The
`durationMs` is the wall-clock between `tools.discovery_started` and
resolution; `toolCount` is the size of the returned tool list. For
sync providers `durationMs` is ~0; for async hub-backed providers
this is your observability hook for catalog-fetch latency.

## Properties

### durationMs

> `readonly` **durationMs**: `number`

Defined in: [src/events/payloads.ts:413](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L413)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:412](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L412)

***

### providerId

> `readonly` **providerId**: `string` \| `undefined`

Defined in: [src/events/payloads.ts:411](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L411)

***

### toolCount

> `readonly` **toolCount**: `number`

Defined in: [src/events/payloads.ts:414](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L414)
