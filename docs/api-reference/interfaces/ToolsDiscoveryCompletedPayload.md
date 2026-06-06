[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolsDiscoveryCompletedPayload

# Interface: ToolsDiscoveryCompletedPayload

Defined in: [src/events/payloads.ts:368](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L368)

Emitted when `ToolProvider.list(ctx)` resolves successfully. The
`durationMs` is the wall-clock between `tools.discovery_started` and
resolution; `toolCount` is the size of the returned tool list. For
sync providers `durationMs` is ~0; for async hub-backed providers
this is your observability hook for catalog-fetch latency.

## Properties

### durationMs

> `readonly` **durationMs**: `number`

Defined in: [src/events/payloads.ts:371](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L371)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:370](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L370)

***

### providerId

> `readonly` **providerId**: `string` \| `undefined`

Defined in: [src/events/payloads.ts:369](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L369)

***

### toolCount

> `readonly` **toolCount**: `number`

Defined in: [src/events/payloads.ts:372](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L372)
