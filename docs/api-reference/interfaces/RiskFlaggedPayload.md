[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskFlaggedPayload

# Interface: RiskFlaggedPayload

Defined in: [agentfootprint/src/events/payloads.ts:329](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L329)

## Properties

### action

> `readonly` **action**: `"abort"` \| `"warn"` \| `"redact"`

Defined in: [agentfootprint/src/events/payloads.ts:339](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L339)

***

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [agentfootprint/src/events/payloads.ts:331](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L331)

***

### detector

> `readonly` **detector**: `"custom"` \| `"nemo_guardrails"` \| `"llama_guard"` \| `"heuristic"`

Defined in: [agentfootprint/src/events/payloads.ts:337](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L337)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [agentfootprint/src/events/payloads.ts:338](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L338)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [agentfootprint/src/events/payloads.ts:330](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L330)
