[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionCheckPayload

# Interface: PermissionCheckPayload

Defined in: [agentfootprint/src/events/payloads.ts:307](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L307)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:309](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L309)

***

### capability

> `readonly` **capability**: `"tool_call"` \| `"memory_read"` \| `"memory_write"` \| `"external_net"` \| `"user_data"`

Defined in: [agentfootprint/src/events/payloads.ts:308](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L308)

***

### policyEngine?

> `readonly` `optional` **policyEngine?**: `"custom"` \| `"opa"` \| `"cerbos"`

Defined in: [agentfootprint/src/events/payloads.ts:312](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L312)

***

### policyRuleId?

> `readonly` `optional` **policyRuleId?**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:313](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L313)

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:314](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L314)

***

### result

> `readonly` **result**: `"allow"` \| `"deny"` \| `"gate_open"`

Defined in: [agentfootprint/src/events/payloads.ts:311](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L311)

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:310](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L310)
