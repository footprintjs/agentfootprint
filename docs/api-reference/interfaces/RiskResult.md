[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskResult

# Interface: RiskResult

Defined in: [agentfootprint/src/adapters/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L147)

## Properties

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [agentfootprint/src/adapters/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L150)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [agentfootprint/src/adapters/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L156)

***

### flagged

> `readonly` **flagged**: `boolean`

Defined in: [agentfootprint/src/adapters/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L148)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [agentfootprint/src/adapters/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L149)

***

### suggestedAction

> `readonly` **suggestedAction**: `"abort"` \| `"warn"` \| `"redact"`

Defined in: [agentfootprint/src/adapters/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L157)
