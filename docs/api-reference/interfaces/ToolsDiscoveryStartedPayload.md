[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolsDiscoveryStartedPayload

# Interface: ToolsDiscoveryStartedPayload

Defined in: [src/events/payloads.ts:356](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L356)

Emitted at the start of a `ToolProvider.list(ctx)` call inside the
Discover stage. Pairs with `tools.discovery_completed` (success) or
`tools.discovery_failed` (error). Use the pair to measure async-
provider latency per iteration without joining stages by hand.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:358](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L358)

***

### providerId

> `readonly` **providerId**: `string` \| `undefined`

Defined in: [src/events/payloads.ts:357](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L357)
