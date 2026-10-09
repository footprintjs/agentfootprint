---
title: ToolChoiceRow
---

# Interface: ToolChoiceRow

Defined in: src/core/agent/toolChoice/types.ts:61

The classifier's pick for one model call, filed BEFORE the call from the
tools slot (`buildToolsSlot · composeStage`), so the record holds what was
offered, what the classifier ranked and what was actually served — in
that order, on one row.

## Properties

### chosen?

> `readonly` `optional` **chosen?**: `string`

Defined in: src/core/agent/toolChoice/types.ts:72

The provider's own pick; absent when it named nothing offered.

***

### classifier

> `readonly` **classifier**: `object`

Defined in: src/core/agent/toolChoice/types.ts:66

The port name and the provider's resolved model string.

#### model

> `readonly` **model**: `string`

#### name

> `readonly` **name**: `string`

***

### confidence

> `readonly` **confidence**: `number`

Defined in: src/core/agent/toolChoice/types.ts:73

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/toolChoice/types.ts:63

***

### kind

> `readonly` **kind**: `"pick"`

Defined in: src/core/agent/toolChoice/types.ts:62

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: src/core/agent/toolChoice/types.ts:76

Wall-clock milliseconds around the classifier call.

***

### narrowed

> `readonly` **narrowed**: `boolean`

Defined in: src/core/agent/toolChoice/types.ts:80

Whether `served` is the top-N plus the doors (true) or the full merged wire (false).

***

### narrowedSkipped?

> `readonly` `optional` **narrowedSkipped?**: [`NarrowSkipReason`](/docs/api/type-aliases/NarrowSkipReason)

Defined in: src/core/agent/toolChoice/types.ts:82

Present exactly when a `serve: { top }` agent served the full set anyway, and why.

***

### offered

> `readonly` **offered**: readonly `string`[]

Defined in: src/core/agent/toolChoice/types.ts:68

The candidates the classifier was asked about: the merged wire MINUS the always-served doors, in offered order.

***

### ranked

> `readonly` **ranked**: readonly [`ToolChoiceScore`](/docs/api/interfaces/ToolChoiceScore)[]

Defined in: src/core/agent/toolChoice/types.ts:70

The provider's distribution, highest first (ties keep offered order); an unscored name is absent.

***

### served

> `readonly` **served**: readonly `string`[]

Defined in: src/core/agent/toolChoice/types.ts:78

The names the slot COMMITTED for this call — the list the receipt hashes and `servedView` rebuilds.

***

### source

> `readonly` **source**: `"classifier"`

Defined in: src/core/agent/toolChoice/types.ts:64

***

### usage?

> `readonly` `optional` **usage?**: `object`

Defined in: src/core/agent/toolChoice/types.ts:74

#### inputTokens

> `readonly` **inputTokens**: `number`

#### outputTokens

> `readonly` **outputTokens**: `number`
