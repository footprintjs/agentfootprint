---
title: RiskResult
---

# Interface: RiskResult

Defined in: [src/adapters/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L280)

## Properties

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:283](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L283)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L289)

***

### flagged

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L281)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L282)

***

### suggestedAction

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L290)
