---
title: "~~Interface: RiskResult~~"
---

# ~~Interface: RiskResult~~

Defined in: [src/adapters/types.ts:625](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L625)

## Deprecated

No implementation exists — see [RiskDetector](/docs/api/interfaces/RiskDetector). Removed in 10.0.0.

## Properties

### ~~category~~

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:628](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L628)

***

### ~~evidence~~

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:634](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L634)

***

### ~~flagged~~

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:626](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L626)

***

### ~~severity~~

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:627](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L627)

***

### ~~suggestedAction~~

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:635](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L635)
