---
title: "~~Interface: RiskResult~~"
---

# ~~Interface: RiskResult~~

Defined in: [src/adapters/types.ts:691](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L691)

## Deprecated

No implementation exists — see [RiskDetector](/docs/api/interfaces/RiskDetector). Removed in 10.0.0.

## Properties

### ~~category~~

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:694](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L694)

***

### ~~evidence~~

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:700](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L700)

***

### ~~flagged~~

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:692](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L692)

***

### ~~severity~~

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:693](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L693)

***

### ~~suggestedAction~~

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:701](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L701)
