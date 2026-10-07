---
title: "~~Interface: RiskResult~~"
---

# ~~Interface: RiskResult~~

Defined in: [src/adapters/types.ts:787](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L787)

## Deprecated

No implementation exists — see [RiskDetector](/docs/api/interfaces/RiskDetector). Removed in 10.0.0.

## Properties

### ~~category~~

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:790](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L790)

***

### ~~evidence~~

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:796](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L796)

***

### ~~flagged~~

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:788](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L788)

***

### ~~severity~~

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:789](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L789)

***

### ~~suggestedAction~~

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:797](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L797)
