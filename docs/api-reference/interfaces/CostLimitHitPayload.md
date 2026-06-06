[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CostLimitHitPayload

# Interface: CostLimitHitPayload

Defined in: [src/events/payloads.ts:484](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L484)

## Properties

### action

> `readonly` **action**: `"abort"` \| `"warn"` \| `"degrade"`

Defined in: [src/events/payloads.ts:488](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L488)

***

### actual

> `readonly` **actual**: `number`

Defined in: [src/events/payloads.ts:487](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L487)

***

### kind

> `readonly` **kind**: `"max_tokens"` \| `"max_cost"` \| `"max_iterations"` \| `"max_wallclock"`

Defined in: [src/events/payloads.ts:485](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L485)

***

### limit

> `readonly` **limit**: `number`

Defined in: [src/events/payloads.ts:486](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L486)
