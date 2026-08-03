[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskResult

# Interface: RiskResult

Defined in: [src/adapters/types.ts:378](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L378)

## Properties

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:381](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L381)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:387](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L387)

***

### flagged

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:379](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L379)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:380](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L380)

***

### suggestedAction

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:388](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L388)
