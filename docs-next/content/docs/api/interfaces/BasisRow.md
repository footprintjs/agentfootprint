---
title: BasisRow
---

# Interface: BasisRow

Defined in: [src/core/agent/findings/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L93)

The model's basis for ONE tool call, filed before the call runs.

## Properties

### basis

> `readonly` **basis**: [`Basis`](/docs/api/type-aliases/Basis)

Defined in: [src/core/agent/findings/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L98)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/docs/api/type-aliases/Expect)

Defined in: [src/core/agent/findings/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L99)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L97)

***

### kind

> `readonly` **kind**: `"basis"`

Defined in: [src/core/agent/findings/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L94)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/findings/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L106)

How many entries of the same `_findings` value `splitFindings` dropped as
malformed. A count about the emission, present only when non-zero — it is
what `findings.declared` reports, and the row is the only place a count
about THIS declaration can live (the writer emits from rows alone).

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L95)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L96)
