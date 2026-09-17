---
title: BasisRow
---

# Interface: BasisRow

Defined in: [src/core/agent/findings/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L112)

The model's basis for ONE tool call, filed before the call runs.

## Properties

### basis

> `readonly` **basis**: [`Basis`](/docs/api/type-aliases/Basis)

Defined in: [src/core/agent/findings/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L117)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/docs/api/type-aliases/Expect)

Defined in: [src/core/agent/findings/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L118)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L116)

***

### kind

> `readonly` **kind**: `"basis"`

Defined in: [src/core/agent/findings/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L113)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/findings/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L132)

How many entries of the same `_findings` value `splitFindings` dropped as
malformed. A count about the emission, present only when non-zero — it is
what `findings.declared` reports, and the row is the only place a count
about THIS declaration can live (the writer emits from rows alone).

***

### predicts?

> `readonly` `optional` **predicts?**: `string`

Defined in: [src/core/agent/findings/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L125)

***

### proposition?

> `readonly` `optional` **proposition?**: `string`

Defined in: [src/core/agent/findings/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L124)

The declared proposition and prediction, each at most `PROPOSITION_CHARS`
with any cut stated in the text itself. Present only when declared —
never defaulted, never inferred from the call's arguments.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L114)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L115)
