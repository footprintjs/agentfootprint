---
title: ToolsDiscoveryStartedPayload
---

# Interface: ToolsDiscoveryStartedPayload

Defined in: [src/events/payloads.ts:398](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L398)

Emitted at the start of a `ToolProvider.list(ctx)` call inside the
Discover stage. Pairs with `tools.discovery_completed` (success) or
`tools.discovery_failed` (error). Use the pair to measure async-
provider latency per iteration without joining stages by hand.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:400](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L400)

***

### providerId

> `readonly` **providerId**: `string` \| `undefined`

Defined in: [src/events/payloads.ts:399](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L399)
