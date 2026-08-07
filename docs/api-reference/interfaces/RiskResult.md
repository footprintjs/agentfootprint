[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RiskResult

# Interface: RiskResult

Defined in: [src/adapters/types.ts:498](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L498)

## Properties

### category

> `readonly` **category**: `"pii"` \| `"prompt_injection"` \| `"runaway_loop"` \| `"cost_overrun"` \| `"hallucination_flag"`

Defined in: [src/adapters/types.ts:501](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L501)

***

### evidence

> `readonly` **evidence**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/adapters/types.ts:507](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L507)

***

### flagged

> `readonly` **flagged**: `boolean`

Defined in: [src/adapters/types.ts:499](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L499)

***

### severity

> `readonly` **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

Defined in: [src/adapters/types.ts:500](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L500)

***

### suggestedAction

> `readonly` **suggestedAction**: `"warn"` \| `"redact"` \| `"abort"`

Defined in: [src/adapters/types.ts:508](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L508)
