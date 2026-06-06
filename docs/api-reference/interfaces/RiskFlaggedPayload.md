[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskFlaggedPayload

# Interface: RiskFlaggedPayload

Defined in: [src/events/payloads.ts:451](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L451)

## Properties

### action

> `readonly` **action**: `"abort"` \| `"warn"` \| `"redact"`

Defined in: [src/events/payloads.ts:461](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L461)

***

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/events/payloads.ts:453](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L453)

***

### detector

> `readonly` **detector**: `"custom"` \| `"nemo_guardrails"` \| `"llama_guard"` \| `"heuristic"`

Defined in: [src/events/payloads.ts:459](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L459)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/events/payloads.ts:460](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L460)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/events/payloads.ts:452](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L452)
