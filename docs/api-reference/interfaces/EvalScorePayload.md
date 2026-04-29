[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EvalScorePayload

# Interface: EvalScorePayload

Defined in: [agentfootprint/src/events/payloads.ts:370](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L370)

## Properties

### evaluator?

> `readonly` `optional` **evaluator?**: `"llm"` \| `"fn"` \| `"heuristic"`

Defined in: [agentfootprint/src/events/payloads.ts:376](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L376)

***

### evidence?

> `readonly` `optional` **evidence?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [agentfootprint/src/events/payloads.ts:377](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L377)

***

### metricId

> `readonly` **metricId**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:371](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L371)

***

### target

> `readonly` **target**: `"iteration"` \| `"turn"` \| `"run"` \| `"toolCall"`

Defined in: [agentfootprint/src/events/payloads.ts:374](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L374)

***

### targetRef

> `readonly` **targetRef**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:375](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L375)

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:373](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L373)

***

### value

> `readonly` **value**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:372](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L372)
