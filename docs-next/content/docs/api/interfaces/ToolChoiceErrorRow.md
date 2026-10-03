---
title: ToolChoiceErrorRow
---

# Interface: ToolChoiceErrorRow

Defined in: src/core/agent/toolChoice/types.ts:91

The classifier was asked and produced no answer: the provider's status
and error text (the PROVIDER's words — allowed on the record) and the
latency spent. The full merged wire was served — an error row is never a
narrowing.

## Properties

### classifier

> `readonly` **classifier**: `object`

Defined in: src/core/agent/toolChoice/types.ts:95

#### name

> `readonly` **name**: `string`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/toolChoice/types.ts:93

***

### kind

> `readonly` **kind**: `"pick-error"`

Defined in: src/core/agent/toolChoice/types.ts:92

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: src/core/agent/toolChoice/types.ts:98

***

### message

> `readonly` **message**: `string`

Defined in: src/core/agent/toolChoice/types.ts:97

***

### narrowedSkipped?

> `readonly` `optional` **narrowedSkipped?**: [`NarrowSkipReason`](/docs/api/type-aliases/NarrowSkipReason)

Defined in: src/core/agent/toolChoice/types.ts:107

Present exactly when the run was configured with `serve: { top }` — the
reason narrowing did not happen, same vocabulary and law as
`ToolChoiceRow.narrowedSkipped`. Absent under `serve: 'all'`, where
nothing was ever going to narrow.

***

### served

> `readonly` **served**: readonly `string`[]

Defined in: src/core/agent/toolChoice/types.ts:100

The names the slot committed — the full merged wire, by the fail-open law.

***

### source

> `readonly` **source**: `"classifier"`

Defined in: src/core/agent/toolChoice/types.ts:94

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: src/core/agent/toolChoice/types.ts:96
