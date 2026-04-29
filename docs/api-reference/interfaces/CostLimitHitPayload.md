[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CostLimitHitPayload

# Interface: CostLimitHitPayload

Defined in: [agentfootprint/src/events/payloads.ts:362](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L362)

## Properties

### action

> `readonly` **action**: `"abort"` \| `"warn"` \| `"degrade"`

Defined in: [agentfootprint/src/events/payloads.ts:366](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L366)

***

### actual

> `readonly` **actual**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:365](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L365)

***

### kind

> `readonly` **kind**: `"max_tokens"` \| `"max_cost"` \| `"max_iterations"` \| `"max_wallclock"`

Defined in: [agentfootprint/src/events/payloads.ts:363](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L363)

***

### limit

> `readonly` **limit**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:364](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L364)
