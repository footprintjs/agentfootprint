---
title: EvalScorePayload
---

# Interface: EvalScorePayload

Defined in: [src/events/payloads.ts:597](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L597)

## Properties

### evaluator?

> `readonly` `optional` **evaluator?**: `"llm"` \| `"fn"` \| `"heuristic"`

Defined in: [src/events/payloads.ts:603](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L603)

***

### evidence?

> `readonly` `optional` **evidence?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/events/payloads.ts:604](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L604)

***

### metricId

> `readonly` **metricId**: `string`

Defined in: [src/events/payloads.ts:598](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L598)

***

### target

> `readonly` **target**: `"iteration"` \| `"turn"` \| `"run"` \| `"toolCall"`

Defined in: [src/events/payloads.ts:601](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L601)

***

### targetRef

> `readonly` **targetRef**: `string`

Defined in: [src/events/payloads.ts:602](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L602)

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/events/payloads.ts:600](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L600)

***

### value

> `readonly` **value**: `number`

Defined in: [src/events/payloads.ts:599](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L599)
