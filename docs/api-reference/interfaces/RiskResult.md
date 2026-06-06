[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskResult

# Interface: RiskResult

Defined in: [src/adapters/types.ts:279](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L279)

## Properties

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:282](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L282)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L288)

***

### flagged

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L280)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L281)

***

### suggestedAction

> `readonly` **suggestedAction**: `"abort"` \| `"warn"` \| `"redact"`

Defined in: [src/adapters/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/adapters/types.ts#L289)
