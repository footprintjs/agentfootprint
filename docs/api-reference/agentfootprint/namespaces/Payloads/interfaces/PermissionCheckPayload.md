[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / PermissionCheckPayload

# Interface: PermissionCheckPayload

Defined in: [src/events/payloads.ts:406](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L406)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/events/payloads.ts:408](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L408)

***

### capability

> `readonly` **capability**: `"tool_call"` \| `"memory_read"` \| `"memory_write"` \| `"external_net"` \| `"user_data"`

Defined in: [src/events/payloads.ts:407](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L407)

***

### policyEngine?

> `readonly` `optional` **policyEngine?**: `"custom"` \| `"opa"` \| `"cerbos"`

Defined in: [src/events/payloads.ts:411](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L411)

***

### policyRuleId?

> `readonly` `optional` **policyRuleId?**: `string`

Defined in: [src/events/payloads.ts:412](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L412)

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [src/events/payloads.ts:413](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L413)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/events/payloads.ts:415](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L415)

v2.12 — telemetry tag carried through from PermissionDecision.reason.

***

### result

> `readonly` **result**: `"allow"` \| `"deny"` \| `"halt"` \| `"gate_open"`

Defined in: [src/events/payloads.ts:410](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L410)

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/events/payloads.ts:409](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/events/payloads.ts#L409)
