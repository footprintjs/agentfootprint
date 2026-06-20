---
title: RiskFlaggedPayload
---

# Interface: RiskFlaggedPayload

Defined in: [src/events/payloads.ts:556](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L556)

## Properties

### action

> `readonly` **action**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/events/payloads.ts:566](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L566)

***

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/events/payloads.ts:558](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L558)

***

### detector

> `readonly` **detector**: `"custom"` \| `"nemo_guardrails"` \| `"llama_guard"` \| `"heuristic"`

Defined in: [src/events/payloads.ts:564](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L564)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/events/payloads.ts:565](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L565)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/events/payloads.ts:557](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L557)
