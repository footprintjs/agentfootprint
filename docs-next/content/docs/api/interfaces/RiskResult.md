---
title: "~~Interface: RiskResult~~"
---

# ~~Interface: RiskResult~~

Defined in: [src/adapters/types.ts:723](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L723)

## Deprecated

No implementation exists — see [RiskDetector](/docs/api/interfaces/RiskDetector). Removed in 10.0.0.

## Properties

### ~~category~~

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:726](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L726)

***

### ~~evidence~~

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:732](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L732)

***

### ~~flagged~~

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:724](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L724)

***

### ~~severity~~

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:725](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L725)

***

### ~~suggestedAction~~

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:733](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L733)
