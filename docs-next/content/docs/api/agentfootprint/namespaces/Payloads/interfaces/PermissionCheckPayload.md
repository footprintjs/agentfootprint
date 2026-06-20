---
title: PermissionCheckPayload
---

# Interface: PermissionCheckPayload

Defined in: [src/events/payloads.ts:487](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L487)

## Properties

### actor

> `readonly` **actor**: `string`

Defined in: [src/events/payloads.ts:489](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L489)

***

### capability

> `readonly` **capability**: `"tool_call"` \| `"memory_read"` \| `"memory_write"` \| `"external_net"` \| `"user_data"`

Defined in: [src/events/payloads.ts:488](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L488)

***

### policyEngine?

> `readonly` `optional` **policyEngine?**: `"custom"` \| `"opa"` \| `"cerbos"`

Defined in: [src/events/payloads.ts:492](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L492)

***

### policyRuleId?

> `readonly` `optional` **policyRuleId?**: `string`

Defined in: [src/events/payloads.ts:493](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L493)

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [src/events/payloads.ts:494](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L494)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/events/payloads.ts:496](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L496)

v2.12 — telemetry tag carried through from PermissionDecision.reason.

***

### result

> `readonly` **result**: `"allow"` \| `"deny"` \| `"halt"` \| `"gate_open"`

Defined in: [src/events/payloads.ts:491](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L491)

***

### target?

> `readonly` `optional` **target?**: `string`

Defined in: [src/events/payloads.ts:490](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L490)
