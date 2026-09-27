---
title: FindingsDeclaration
---

# Interface: FindingsDeclaration

Defined in: [src/core/agent/findings/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L95)

The wire shape under `_findings` — on a tool call's args, or as the top-level
key of a JSON answer. Every field optional: the model declares what it
declares, and `reserved.ts · splitFindings` drops what it cannot read.

## Properties

### basis?

> `readonly` `optional` **basis?**: [`Basis`](/docs/api/type-aliases/Basis)

Defined in: [src/core/agent/findings/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L96)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/docs/api/type-aliases/Expect)

Defined in: [src/core/agent/findings/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L97)

***

### predicts?

> `readonly` `optional` **predicts?**: `string`

Defined in: [src/core/agent/findings/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L106)

What the result should show if the proposition holds — one line, optional.

***

### previous?

> `readonly` `optional` **previous?**: readonly `PreviousStanding`[]

Defined in: [src/core/agent/findings/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L107)

***

### proposition?

> `readonly` `optional` **proposition?**: `string`

Defined in: [src/core/agent/findings/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L104)

What the call tests — one line, declared BEFORE the result exists, so a
later `ruled-out` or `open` standing on that result can be read against
a proposition the model wrote without seeing the result. Optional; the
schema recommends it when `basis` is `'exploratory'`.
