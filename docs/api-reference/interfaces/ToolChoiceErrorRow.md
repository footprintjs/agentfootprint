[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolChoiceErrorRow

# Interface: ToolChoiceErrorRow

Defined in: [src/core/agent/toolChoice/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L91)

The classifier was asked and produced no answer: the provider's status
and error text (the PROVIDER's words — allowed on the record) and the
latency spent. The full merged wire was served — an error row is never a
narrowing.

## Properties

### classifier

> `readonly` **classifier**: `object`

Defined in: [src/core/agent/toolChoice/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L95)

#### name

> `readonly` **name**: `string`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L93)

***

### kind

> `readonly` **kind**: `"pick-error"`

Defined in: [src/core/agent/toolChoice/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L92)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L98)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/toolChoice/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L97)

***

### narrowedSkipped?

> `readonly` `optional` **narrowedSkipped?**: [`NarrowSkipReason`](/agentfootprint/api/generated/type-aliases/NarrowSkipReason.md)

Defined in: [src/core/agent/toolChoice/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L107)

Present exactly when the run was configured with `serve: { top }` — the
reason narrowing did not happen, same vocabulary and law as
`ToolChoiceRow.narrowedSkipped`. Absent under `serve: 'all'`, where
nothing was ever going to narrow.

***

### served

> `readonly` **served**: readonly `string`[]

Defined in: [src/core/agent/toolChoice/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L100)

The names the slot committed — the full merged wire, by the fail-open law.

***

### source

> `readonly` **source**: `"classifier"`

Defined in: [src/core/agent/toolChoice/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L94)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolChoice/types.ts#L96)
