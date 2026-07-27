---
title: RiskResult
---

# Interface: RiskResult

Defined in: [src/adapters/types.ts:360](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L360)

## Properties

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:363](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L363)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:369](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L369)

***

### flagged

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:361](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L361)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:362](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L362)

***

### suggestedAction

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:370](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L370)
