[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolChoiceRow

# Interface: ToolChoiceRow

Defined in: [src/core/agent/toolChoice/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L61)

The classifier's pick for one model call, filed BEFORE the call from the
tools slot (`buildToolsSlot · composeStage`), so the record holds what was
offered, what the classifier ranked and what was actually served — in
that order, on one row.

## Properties

### chosen?

> `readonly` `optional` **chosen?**: `string`

Defined in: [src/core/agent/toolChoice/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L72)

The provider's own pick; absent when it named nothing offered.

***

### classifier

> `readonly` **classifier**: `object`

Defined in: [src/core/agent/toolChoice/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L66)

The port name and the provider's resolved model string.

#### model

> `readonly` **model**: `string`

#### name

> `readonly` **name**: `string`

***

### confidence

> `readonly` **confidence**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:73](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L73)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L63)

***

### kind

> `readonly` **kind**: `"pick"`

Defined in: [src/core/agent/toolChoice/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L62)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/toolChoice/types.ts:76](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L76)

Wall-clock milliseconds around the classifier call.

***

### narrowed

> `readonly` **narrowed**: `boolean`

Defined in: [src/core/agent/toolChoice/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L80)

Whether `served` is the top-N plus the doors (true) or the full merged wire (false).

***

### narrowedSkipped?

> `readonly` `optional` **narrowedSkipped?**: [`NarrowSkipReason`](/agentfootprint/api/generated/type-aliases/NarrowSkipReason.md)

Defined in: [src/core/agent/toolChoice/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L82)

Present exactly when a `serve: { top }` agent served the full set anyway, and why.

***

### offered

> `readonly` **offered**: readonly `string`[]

Defined in: [src/core/agent/toolChoice/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L68)

The candidates the classifier was asked about: the merged wire MINUS the always-served doors, in offered order.

***

### ranked

> `readonly` **ranked**: readonly [`ToolChoiceScore`](/agentfootprint/api/generated/interfaces/ToolChoiceScore.md)[]

Defined in: [src/core/agent/toolChoice/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L70)

The provider's distribution, highest first (ties keep offered order); an unscored name is absent.

***

### served

> `readonly` **served**: readonly `string`[]

Defined in: [src/core/agent/toolChoice/types.ts:78](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L78)

The names the slot COMMITTED for this call — the list the receipt hashes and `servedView` rebuilds.

***

### source

> `readonly` **source**: `"classifier"`

Defined in: [src/core/agent/toolChoice/types.ts:64](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L64)

***

### usage?

> `readonly` `optional` **usage?**: `object`

Defined in: [src/core/agent/toolChoice/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L74)

#### inputTokens

> `readonly` **inputTokens**: `number`

#### outputTokens

> `readonly` **outputTokens**: `number`
