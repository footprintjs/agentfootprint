---
title: "~~Interface: RiskResult~~"
---

# ~~Interface: RiskResult~~

Defined in: [src/adapters/types.ts:732](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L732)

## Deprecated

No implementation exists — see [RiskDetector](/docs/api/interfaces/RiskDetector). Removed in 10.0.0.

## Properties

### ~~category~~

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:735](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L735)

***

### ~~evidence~~

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:741](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L741)

***

### ~~flagged~~

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:733](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L733)

***

### ~~severity~~

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:734](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L734)

***

### ~~suggestedAction~~

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:742](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L742)
