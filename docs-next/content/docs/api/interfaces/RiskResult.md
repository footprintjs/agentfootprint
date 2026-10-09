---
title: "~~Interface: RiskResult~~"
---

# ~~Interface: RiskResult~~

Defined in: src/adapters/types.ts:764

## Deprecated

No implementation exists — see [RiskDetector](/docs/api/interfaces/RiskDetector). Removed in 10.0.0.

## Properties

### ~~category~~

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: src/adapters/types.ts:767

***

### ~~evidence~~

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/adapters/types.ts:773

***

### ~~flagged~~

> `readonly` **flagged**: `boolean`

Defined in: src/adapters/types.ts:765

***

### ~~severity~~

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: src/adapters/types.ts:766

***

### ~~suggestedAction~~

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: src/adapters/types.ts:774
