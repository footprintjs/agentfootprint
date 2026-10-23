---
title: ToolChoiceErrorRow
---

# Interface: ToolChoiceErrorRow

Defined in: [src/core/agent/toolChoice/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L96)

The classifier was asked and produced no answer: the provider's status
and error text (the PROVIDER's words — allowed on the record) and the
latency spent. The full merged wire was served — an error row is never a
narrowing.

## Properties

### classifier

> `readonly` **classifier**: `object`

Defined in: [src/core/agent/toolChoice/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L100)

#### name

> `readonly` **name**: `string`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L98)

***

### kind

> `readonly` **kind**: `"pick-error"`

Defined in: [src/core/agent/toolChoice/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L97)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L103)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/toolChoice/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L102)

***

### narrowedSkipped?

> `readonly` `optional` **narrowedSkipped?**: [`NarrowSkipReason`](/docs/api/type-aliases/NarrowSkipReason)

Defined in: [src/core/agent/toolChoice/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L112)

Present exactly when the run was configured with `serve: { top }` — the
reason narrowing did not happen, same vocabulary and law as
`ToolChoiceRow.narrowedSkipped`. Absent under `serve: 'all'`, where
nothing was ever going to narrow.

***

### served

> `readonly` **served**: readonly `string`[]

Defined in: [src/core/agent/toolChoice/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L105)

The names the slot committed — the full merged wire, by the fail-open law.

***

### source

> `readonly` **source**: `"classifier"`

Defined in: [src/core/agent/toolChoice/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L99)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/toolChoice/types.ts#L101)
