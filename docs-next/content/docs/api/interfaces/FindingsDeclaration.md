---
title: FindingsDeclaration
---

# Interface: FindingsDeclaration

Defined in: [src/core/agent/findings/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L83)

The wire shape under `_findings` — on a tool call's args, or as the top-level
key of a JSON answer. Every field optional: the model declares what it
declares, and `reserved.ts · splitFindings` drops what it cannot read.

## Properties

### basis?

> `readonly` `optional` **basis?**: [`Basis`](/docs/api/type-aliases/Basis)

Defined in: [src/core/agent/findings/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L84)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/docs/api/type-aliases/Expect)

Defined in: [src/core/agent/findings/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L85)

***

### previous?

> `readonly` `optional` **previous?**: readonly `PreviousStanding`[]

Defined in: [src/core/agent/findings/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L86)
