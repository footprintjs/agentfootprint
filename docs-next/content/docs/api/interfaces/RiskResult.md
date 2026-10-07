---
title: "~~Interface: RiskResult~~"
---

# ~~Interface: RiskResult~~

Defined in: [src/adapters/types.ts:745](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L745)

## Deprecated

No implementation exists — see [RiskDetector](/docs/api/interfaces/RiskDetector). Removed in 10.0.0.

## Properties

### ~~category~~

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:748](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L748)

***

### ~~evidence~~

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:754](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L754)

***

### ~~flagged~~

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:746](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L746)

***

### ~~severity~~

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:747](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L747)

***

### ~~suggestedAction~~

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:755](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L755)
